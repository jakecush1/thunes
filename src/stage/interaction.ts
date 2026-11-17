/**
 * The interaction system: orbit controls on the canvas plus selecting and
 * dragging dancers.
 *
 *   'look'  orbits; a click still selects.
 *   'grab'  drags dancers; orbit rotation is off (zooming still works).
 *   'both'  drags when the gesture starts on a dancer, orbits otherwise.
 *
 * Dancers are picked through cheap proxy cylinders (see picking.ts). Our
 * pointer listeners are registered before the orbit controls connect, so a
 * gesture that grabs a dancer can keep the controls from ever seeing it.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA_LIMITS, STAGE_RADIUS } from '../config';
import type { AppState, InteractionMode } from '../types';
import { stageHub } from './hub';
import { CLICK_SLOP, clampTarget, clampToStage, dragPlaneHeight, maxPolarAngle, pickNearest, rayCylinder, rayPlaneY } from './picking';
import type { FrameContext, StageSystem, StageSystemFactory } from './system';

/** The camera stays at least this far above the floor (metres). */
export const MIN_CAMERA_HEIGHT = 0.08;
/** Per-frame camera travel (metres) below which the view counts as settled / as perfectly still. */
const COARSE_MOTION = 1e-4;
const FINE_MOTION = 1e-8;
/** Height range of the orbit target (metres). */
export const TARGET_MIN_Y = 0;
export const TARGET_MAX_Y = 3;

interface Gesture {
  pointerId: number;
  startX: number;
  startY: number;
  /** The pointer travelled further than a click allows. */
  moved: boolean;
  /** Another pointer joined (pinch): never a click. */
  multi: boolean;
  /** Dancer under the pointer when it went down. */
  targetId: string | null;
  /** This gesture drags `targetId` (the orbit controls never saw it). */
  grab: boolean;
  /** At least one position update was sent to the store. */
  dragged: boolean;
  planeY: number;
  offsetX: number;
  offsetZ: number;
}

const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _before = new THREE.Vector3();
const _spot = { x: 0, z: 0 };

/** The interaction system factory (see the file comment). */
export const createInteractionSystem: StageSystemFactory = (context) => {
  const { canvas, camera, cameraTarget, store } = context;
  const hub = stageHub(context);

  const controls = new OrbitControls(camera, null);
  // One shared vector: whatever moves the target (controls, scene loads, the camera loop) is seen by everyone.
  controls.target = cameraTarget;
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.rotateSpeed = 0.75;
  controls.zoomSpeed = 0.9;
  controls.screenSpacePanning = true;
  controls.minDistance = CAMERA_LIMITS.minDistance;
  controls.maxDistance = CAMERA_LIMITS.maxDistance;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  let mode: InteractionMode = 'both';
  let viewOnly = false;
  let loopOn = false;
  let gesture: Gesture | null = null;
  /** The orbit controls are in the middle of a gesture. */
  let orbiting = false;
  /** The camera moved noticeably since the last commit to the store. */
  let dirty = false;
  /** The camera moved at all since the last commit (the tail of the damping). */
  let drifting = false;
  let calm = 0;
  let committing = false;
  /** The store's camera was changed by somebody else; adopt it on the next frame. */
  let external = false;
  let wasLocked = false;
  const lastPosition = camera.position.clone();
  const lastTarget = cameraTarget.clone();
  let cursor = '';

  const locked = (): boolean => loopOn || hub.cameraLocked;

  function setCursor(next: string): void {
    if (next === cursor) return;
    cursor = next;
    canvas.style.cursor = next;
  }

  /** Fill _origin/_direction with the world-space ray under a pointer event. */
  function pointerRay(event: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    const nx = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const ny = -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    camera.updateMatrixWorld();
    _origin.setFromMatrixPosition(camera.matrixWorld);
    _direction.set(nx, ny, 0.5).unproject(camera).sub(_origin).normalize();
  }

  /** Index into the hub's proxies of the dancer under the current ray, or -1. */
  function pick(): number {
    hub.refreshProxies();
    return pickNearest(_origin.x, _origin.y, _origin.z, _direction.x, _direction.y, _direction.z, hub.proxies, hub.count);
  }

  function findDancer(id: string) {
    const dancers = store.getState().dancers;
    for (let i = 0; i < dancers.length; i++) if (dancers[i]!.id === id) return dancers[i]!;
    return null;
  }

  function hover(id: string | null): void {
    hub.hoveredId = id;
    if (id === null) setCursor('');
    else setCursor(mode === 'look' ? 'pointer' : 'grab');
  }

  function endGesture(event: PointerEvent | null): void {
    const g = gesture;
    if (!g) return;
    gesture = null;
    if (g.grab && event && canvas.hasPointerCapture(g.pointerId)) canvas.releasePointerCapture(g.pointerId);
    if (g.dragged) store.commit();
  }

  function onPointerDown(event: PointerEvent): void {
    if (locked()) return;
    if (gesture) {
      // A second pointer: a pinch for the controls, or noise while dragging a dancer.
      gesture.multi = true;
      if (gesture.grab) event.stopImmediatePropagation();
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerRay(event);
    const index = viewOnly ? -1 : pick();
    const targetId = index >= 0 ? hub.ids[index]! : null;
    const g: Gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      multi: false,
      targetId,
      grab: false,
      dragged: false,
      planeY: 0,
      offsetX: 0,
      offsetZ: 0,
    };
    gesture = g;
    if (targetId === null || mode === 'look') return;
    const dancer = findDancer(targetId);
    if (!dancer) return;

    // Grab: the dancer moves on the horizontal plane through the grabbed point.
    const t = rayCylinder(_origin.x, _origin.y, _origin.z, _direction.x, _direction.y, _direction.z, hub.proxies[index]!);
    const hitY = _origin.y + _direction.y * Math.max(0, t);
    g.planeY = dragPlaneHeight(_origin.y, hitY, dancer.y);
    const onPlane = rayPlaneY(_origin.y, _direction.y, g.planeY);
    if (onPlane < 0) return;
    g.offsetX = dancer.x - (_origin.x + _direction.x * onPlane);
    g.offsetZ = dancer.z - (_origin.z + _direction.z * onPlane);
    g.grab = true;
    event.stopImmediatePropagation();
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    hover(targetId);
    setCursor('grabbing');
  }

  function onPointerMove(event: PointerEvent): void {
    const g = gesture;
    if (!g) {
      if (event.pointerType !== 'mouse' || locked() || viewOnly) {
        if (hub.hoveredId !== null) hover(null);
        return;
      }
      pointerRay(event);
      const index = pick();
      hover(index >= 0 ? hub.ids[index]! : null);
      return;
    }
    if (event.pointerId !== g.pointerId) return;
    if (!g.moved && Math.hypot(event.clientX - g.startX, event.clientY - g.startY) > CLICK_SLOP) {
      g.moved = true;
      if (g.grab && g.targetId !== null && store.getState().ui.selectedId !== g.targetId) store.select(g.targetId);
    }
    if (!g.grab || !g.moved || g.targetId === null) return;
    pointerRay(event);
    const t = rayPlaneY(_origin.y, _direction.y, g.planeY);
    if (t < 0) return;
    clampToStage(_origin.x + _direction.x * t + g.offsetX, _origin.z + _direction.z * t + g.offsetZ, STAGE_RADIUS, _spot);
    store.updateDancer(g.targetId, { x: _spot.x, z: _spot.z }, { transient: true });
    g.dragged = true;
  }

  function onPointerUp(event: PointerEvent): void {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    const click = !g.moved && !g.multi && !g.dragged;
    endGesture(event);
    if (click && !viewOnly && !locked() && store.getState().ui.selectedId !== g.targetId) store.select(g.targetId);
    if (event.pointerType === 'mouse' && !locked() && !viewOnly) {
      pointerRay(event);
      const index = pick();
      hover(index >= 0 ? hub.ids[index]! : null);
    } else {
      hover(null);
    }
  }

  function onPointerCancel(event: PointerEvent): void {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    endGesture(event);
    hover(null);
  }

  function onPointerLeave(): void {
    if (!gesture) hover(null);
  }

  const onOrbitStart = (): void => {
    orbiting = true;
  };
  const onOrbitEnd = (): void => {
    orbiting = false;
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);
  controls.addEventListener('start', onOrbitStart);
  controls.addEventListener('end', onOrbitEnd);
  controls.connect(canvas);

  function commitPose(): void {
    committing = true;
    try {
      store.setCamera({
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [cameraTarget.x, cameraTarget.y, cameraTarget.z],
      });
    } finally {
      committing = false;
    }
  }

  const system: StageSystem = {
    sync(state: AppState, previous: AppState | null) {
      mode = state.ui.mode;
      viewOnly = state.ui.viewOnly;
      loopOn = state.scene.cameraLoop;
      controls.enableRotate = mode !== 'grab';
      controls.enabled = !locked();
      if (loopOn || viewOnly) {
        // Whatever was going on with a dancer ends here (a running drag is committed).
        if (gesture && (loopOn || gesture.grab)) endGesture(null);
        if (hub.hoveredId !== null) hover(null);
      }
      // The camera was set from outside (a scene was loaded): the stage has applied it already.
      if (previous && state.camera !== previous.camera && !committing) external = true;
    },
    update(frame: FrameContext) {
      if (locked()) {
        if (controls.enabled) controls.enabled = false;
        wasLocked = true;
        return;
      }
      if (!controls.enabled) controls.enabled = true;

      if (external) {
        // Flush whatever damping was left so it cannot nudge the pose that was just loaded.
        controls.enableDamping = false;
        controls.update();
        controls.enableDamping = true;
        const pose = frame.state.camera;
        camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
        cameraTarget.set(pose.target[0], pose.target[1], pose.target[2]);
        camera.lookAt(cameraTarget);
      } else {
        controls.maxPolarAngle = maxPolarAngle(cameraTarget.y, camera.position.distanceTo(cameraTarget), MIN_CAMERA_HEIGHT);
        controls.update();

        // Keep the target near the stage; the camera follows so the view only slides.
        _before.copy(cameraTarget);
        if (clampTarget(cameraTarget, STAGE_RADIUS, TARGET_MIN_Y, TARGET_MAX_Y)) camera.position.add(cameraTarget).sub(_before);
        if (camera.position.y < MIN_CAMERA_HEIGHT) {
          camera.position.y = MIN_CAMERA_HEIGHT;
          camera.lookAt(cameraTarget);
        }
      }

      // How far the view moved since the previous frame (gestures also move it between frames).
      const motion = Math.max(
        Math.abs(camera.position.x - lastPosition.x),
        Math.abs(camera.position.y - lastPosition.y),
        Math.abs(camera.position.z - lastPosition.z),
        Math.abs(cameraTarget.x - lastTarget.x),
        Math.abs(cameraTarget.y - lastTarget.y),
        Math.abs(cameraTarget.z - lastTarget.z),
      );
      lastPosition.copy(camera.position);
      lastTarget.copy(cameraTarget);
      if (external || wasLocked) {
        external = false;
        wasLocked = false;
        dirty = false;
        drifting = false;
        return;
      }

      // Commit once the damping has all but stopped, and once more when it is completely still.
      if (motion > 0) drifting = true;
      if (motion > COARSE_MOTION) {
        dirty = true;
        calm = 0;
      }
      if (orbiting) return;
      if (dirty) {
        if (motion <= COARSE_MOTION && ++calm >= 3) {
          dirty = false;
          commitPose();
        }
      } else if (drifting && motion <= FINE_MOTION) {
        drifting = false;
        commitPose();
      }
    },
    dispose() {
      endGesture(null);
      hub.hoveredId = null;
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      controls.removeEventListener('start', onOrbitStart);
      controls.removeEventListener('end', onOrbitEnd);
      controls.dispose();
      canvas.style.cursor = '';
    },
  };
  return system;
};
