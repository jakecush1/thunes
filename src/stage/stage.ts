/**
 * The stage: renderer, camera and render loop, composed from systems.
 *
 *   const stage = createStage({ container, store, registry, audio }, { systems: [createDancerSystem] });
 *   stage.start();
 *
 * Built-in systems (CORE_SYSTEMS) draw the environment and the strobe; further
 * systems (dancers, pointer interaction, camera loop…) are plugged in through
 * `options.systems` or `stage.addSystem()`.
 */
import * as THREE from 'three';
import { CAMERA_LIMITS } from '../config';
import type { AppState, CameraPose, CaptureOptions, Stage, StageDebugInfo, StageDeps } from '../types';
import { createEnvironmentSystem } from './environment';
import { createPlacesSystem } from './places';
import { bufferSize, qualitySettings } from './quality';
import { createStrobeSystem } from './strobe';
import type { FrameContext, StageContext, StageSystem, StageSystemFactory } from './system';

/** The systems every stage has, in update order. */
export const CORE_SYSTEMS: readonly StageSystemFactory[] = [createEnvironmentSystem, createPlacesSystem, createStrobeSystem];

export interface StageOptions {
  /** Extra systems, created after the core systems in the given order. */
  systems?: readonly StageSystemFactory[];
}

/** The Stage plus the hooks later modules use to extend it. */
export interface StageHandle extends Stage {
  /** Shared renderer/scene/camera objects (the same object every system received). */
  readonly context: StageContext;
  /** Create a system from its factory, sync it with the current state and add it to the frame. */
  addSystem(factory: StageSystemFactory): StageSystem;
  /** Dispose a system and take it out of the frame. */
  removeSystem(system: StageSystem): void;
}

/** Largest capture edge in pixels (also limited by the GPU's maximum texture size). */
const MAX_CAPTURE_SIZE = 8192;

/**
 * Create the stage inside `deps.container`. The canvas fills the container and
 * follows its size and the display's pixel ratio. Nothing is drawn until `start()`.
 */
export function createStage(deps: StageDeps, options: StageOptions = {}): StageHandle {
  const { container, store, registry, audio } = deps;

  // ── Renderer ──
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Khronos PBR Neutral keeps material colours true and only rolls off highlights.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%;outline:none;';
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.appendChild(canvas);

  // ── Scene and camera ──
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_LIMITS.fov, 1, CAMERA_LIMITS.near, CAMERA_LIMITS.far);
  const captureCamera = camera.clone();
  const cameraTarget = new THREE.Vector3();
  const context: StageContext = { renderer, scene, camera, cameraTarget, canvas, container, store, registry };

  let disposed = false;
  let running = false;
  let contextLost = false;
  let pixelRatio = 1;
  const sizeScratch = new THREE.Vector2();

  function applyPose(target: THREE.PerspectiveCamera, pose: CameraPose): void {
    target.position.set(pose.position[0], pose.position[1], pose.position[2]);
    target.up.set(0, 1, 0);
    target.lookAt(pose.target[0], pose.target[1], pose.target[2]);
  }

  /** Match the drawing buffer to the container and the quality level, then redraw so no blank frame shows. */
  function resize(): void {
    if (disposed) return;
    const quality = qualitySettings(store.getState().ui.quality, window.devicePixelRatio || 1);
    const size = bufferSize(container.clientWidth, container.clientHeight, quality.pixelRatio, renderer.capabilities.maxTextureSize);
    renderer.getSize(sizeScratch);
    const changed = size.pixelRatio !== pixelRatio || size.width !== sizeScratch.x || size.height !== sizeScratch.y;
    if (!changed) return;
    pixelRatio = size.pixelRatio;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(size.width, size.height, false);
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
    if (running) renderer.render(scene, camera);
  }

  // ── Systems ──
  const systems: StageSystem[] = [];

  function syncCore(state: AppState, previous: AppState | null): void {
    if (!previous || state.camera !== previous.camera) {
      applyPose(camera, state.camera);
      cameraTarget.set(state.camera.target[0], state.camera.target[1], state.camera.target[2]);
    }
    if (!previous || state.scene.exposure !== previous.scene.exposure) {
      renderer.toneMappingExposure = state.scene.exposure;
    }
    if (!previous || state.ui.quality !== previous.ui.quality) resize();
  }

  function addSystem(factory: StageSystemFactory): StageSystem {
    const system = factory(context);
    systems.push(system);
    system.sync?.(store.getState(), null);
    return system;
  }

  function removeSystem(system: StageSystem): void {
    const index = systems.indexOf(system);
    if (index < 0) return;
    systems.splice(index, 1);
    system.dispose?.();
  }

  syncCore(store.getState(), null);
  for (const factory of CORE_SYSTEMS) addSystem(factory);
  for (const factory of options.systems ?? []) addSystem(factory);

  const unsubscribe = store.subscribe((state, previous) => {
    syncCore(state, previous);
    for (let i = 0; i < systems.length; i++) systems[i]!.sync?.(state, previous);
  });

  // ── Size tracking ──
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  let ratioQuery: MediaQueryList | null = null;
  function onRatioChange(): void {
    watchPixelRatio();
    resize();
  }
  function watchPixelRatio(): void {
    ratioQuery?.removeEventListener('change', onRatioChange);
    ratioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    ratioQuery.addEventListener('change', onRatioChange);
  }
  watchPixelRatio();
  resize();

  // ── Context loss ──
  function onContextLost(event: Event): void {
    event.preventDefault();
    contextLost = true;
  }
  function onContextRestored(): void {
    contextLost = false;
    for (let i = 0; i < systems.length; i++) systems[i]!.contextRestored?.();
  }
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  // ── Frame loop ──
  // `clock` and `levels` are replaced every frame before any system reads them.
  const frame: FrameContext = {
    clock: { time: 0, delta: 0, beat: 0, bpm: 0 },
    levels: { level: 0, bass: 0, mid: 0, treble: 0 },
    state: store.getState(),
  };
  let fps = 0;
  let lastFrameAt = 0;

  function onFrame(now: number): void {
    const elapsed = now - lastFrameAt;
    lastFrameAt = now;
    // Ignore the first frame and long pauses (hidden tab).
    if (elapsed > 0 && elapsed < 500) {
      const instant = 1000 / elapsed;
      fps = fps === 0 ? instant : fps + (instant - fps) * 0.08;
    }
    frame.clock = audio.tick();
    frame.levels = audio.levels();
    frame.state = store.getState();
    for (let i = 0; i < systems.length; i++) systems[i]!.update?.(frame);
    if (!contextLost) renderer.render(scene, camera);
  }

  function capture(captureOptions: CaptureOptions = {}): string {
    renderer.getDrawingBufferSize(sizeScratch);
    const liveWidth = Math.max(1, sizeScratch.x);
    const liveHeight = Math.max(1, sizeScratch.y);
    const liveAspect = liveWidth / liveHeight;
    const limit = Math.min(MAX_CAPTURE_SIZE, renderer.capabilities.maxTextureSize);
    let width = captureOptions.width ?? (captureOptions.height ? captureOptions.height * liveAspect : liveWidth);
    let height = captureOptions.height ?? (captureOptions.width ? captureOptions.width / liveAspect : liveHeight);
    width = Math.min(limit, Math.max(1, Math.round(width)));
    height = Math.min(limit, Math.max(1, Math.round(height)));

    renderer.getSize(sizeScratch);
    const cssWidth = sizeScratch.x;
    const cssHeight = sizeScratch.y;

    for (let i = 0; i < systems.length; i++) systems[i]!.beforeCapture?.();
    let url = '';
    try {
      // A separate camera: the live one keeps its pose and aspect.
      captureCamera.copy(camera, false);
      if (captureOptions.camera) applyPose(captureCamera, captureOptions.camera);
      captureCamera.aspect = width / height;
      captureCamera.updateProjectionMatrix();
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      renderer.render(scene, captureCamera);
      url = canvas.toDataURL(captureOptions.type ?? 'image/png', captureOptions.quality);
    } finally {
      for (let i = systems.length - 1; i >= 0; i--) systems[i]!.afterCapture?.();
      // Restore and redraw in the same task: the browser never presents the capture-sized frame.
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(cssWidth, cssHeight, false);
      renderer.render(scene, camera);
    }
    return url;
  }

  return {
    canvas,
    context,
    addSystem,
    removeSystem,
    start() {
      if (disposed || running) return;
      running = true;
      lastFrameAt = 0;
      renderer.setAnimationLoop(onFrame);
    },
    stop() {
      if (!running) return;
      running = false;
      renderer.setAnimationLoop(null);
    },
    getCameraPose(): CameraPose {
      return {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [cameraTarget.x, cameraTarget.y, cameraTarget.z],
      };
    },
    capture,
    resync() {
      for (let i = 0; i < systems.length; i++) systems[i]!.resync?.();
    },
    get fps() {
      return fps;
    },
    debug(): StageDebugInfo {
      const info: StageDebugInfo = {
        dancers: [],
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        fps,
      };
      for (let i = 0; i < systems.length; i++) systems[i]!.debug?.(info);
      return info;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      running = false;
      renderer.setAnimationLoop(null);
      unsubscribe();
      resizeObserver.disconnect();
      ratioQuery?.removeEventListener('change', onRatioChange);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      for (let i = systems.length - 1; i >= 0; i--) systems[i]!.dispose?.();
      systems.length = 0;
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
