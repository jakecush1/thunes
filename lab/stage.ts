/**
 * Lab page for the stage environment. Dev only.
 *
 * URL parameters:
 *   bg=<preset id|custom>  color=<rrggbb> (custom background colour)
 *   floor=grid|checker|tiles|none   floorColor=<rrggbb>
 *   fog=0..1  brightness=0..2  exposure=0.2..2.5  quality=low|medium|high
 *   strobe=0..1 (intensity)  allow=1 (strobe consent)  strobeBpm=<n>  sync=0|1  division=1|2|4
 *   cam=px,py,pz,tx,ty,tz   hud=0 (hide the readout)   props=0 (no reference objects)
 *
 * window.__thunes exposes: stage, store, audio, presets, setScene(patch), setUi(patch),
 * setCamera(pose), capture(options), sheet(tiles, layout), benchmark(frames), gpu.
 */
import * as THREE from 'three';
import { DEFAULT_CAMERA } from '../src/config';
import { BACKGROUNDS } from '../src/stage/backgrounds';
import { createStage } from '../src/stage/stage';
import type { StageContext, StageSystem } from '../src/stage/system';
import type { CameraPose, CaptureOptions, FloorStyle, Quality, SceneSettings, UiState } from '../src/types';
import { createFakeAudio, createFakeRegistry, createFakeStore } from './fakes';

const params = new URLSearchParams(location.search);
const num = (key: string): number | undefined => {
  const raw = params.get(key);
  if (raw === null || raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
};
const hex = (key: string): string | undefined => {
  const raw = params.get(key);
  return raw ? `#${raw.replace(/^#/, '')}` : undefined;
};

const scene: Partial<SceneSettings> = {};
if (params.has('bg')) scene.background = params.get('bg')!;
if (hex('color')) scene.backgroundColor = hex('color')!;
if (params.has('floor')) scene.floorStyle = params.get('floor') as FloorStyle;
if (hex('floorColor')) scene.floorColor = hex('floorColor')!;
if (num('fog') !== undefined) scene.fog = num('fog')!;
if (num('brightness') !== undefined) scene.brightness = num('brightness')!;
if (num('exposure') !== undefined) scene.exposure = num('exposure')!;
if (num('strobe') !== undefined) scene.strobeIntensity = num('strobe')!;
if (num('strobeBpm') !== undefined) scene.strobeBpm = num('strobeBpm')!;
if (params.has('sync')) scene.strobeSync = params.get('sync') !== '0';
if (num('division') !== undefined) scene.strobeDivision = num('division') as 1 | 2 | 4;

const ui: Partial<UiState> = {};
if (params.has('quality')) ui.quality = params.get('quality') as Quality;
if (params.get('allow') === '1') ui.strobeAllowed = true;

let camera: CameraPose = DEFAULT_CAMERA;
const cam = params.get('cam')?.split(',').map(Number);
if (cam && cam.length === 6 && cam.every(Number.isFinite)) {
  camera = { position: [cam[0]!, cam[1]!, cam[2]!], target: [cam[3]!, cam[4]!, cam[5]!] };
}

/** Reference objects: stand-in dancers, a chrome ball and a matte box. Also shows how extra systems plug in. */
function createPropsSystem(context: StageContext): StageSystem {
  const group = new THREE.Group();
  group.name = 'props';
  const disposables: { dispose(): void }[] = [];
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    disposables.push(geometry, material);
    return mesh;
  };
  const height = 1.75;
  const radius = 0.26;
  const capsule = new THREE.CapsuleGeometry(radius, height - 2 * radius, 8, 24);
  const skin = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 });
  add(capsule, skin(0xd8d0c6), 0, height / 2, 0);
  add(capsule, skin(0x3f7cff), -3, height / 2, -2.5);
  add(capsule, skin(0xd8d0c6), 3.2, height / 2, -4.5);
  add(capsule, skin(0x222226), -1, height / 2, -5.9);
  add(capsule, skin(0xffffff), 5.6, height / 2, 1.5);
  add(new THREE.SphereGeometry(0.45, 48, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 1 }), 1.7, 0.45, 1.2);
  const box = add(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardMaterial({ color: 0xe05a4f, roughness: 0.9 }), -1.8, 0.4, 1.0);
  box.rotation.y = 0.5;
  context.scene.add(group);
  return {
    dispose() {
      group.removeFromParent();
      for (const item of disposables) item.dispose();
    },
  };
}

const container = document.getElementById('stage')!;
const store = createFakeStore({ scene, ui, camera });
const audio = createFakeAudio(120);
const stage = createStage(
  { container, store, registry: createFakeRegistry(), audio },
  { systems: params.get('props') === '0' ? [] : [createPropsSystem] },
);
stage.start();

const hud = document.getElementById('hud')!;
if (params.get('hud') === '0') hud.style.display = 'none';
else {
  setInterval(() => {
    const info = stage.debug();
    const s = store.getState();
    hud.textContent = `${s.scene.background} / ${s.scene.floorStyle} / ${s.ui.quality}\n${info.fps.toFixed(0)} fps  ${info.drawCalls} calls  ${info.triangles} tris  ${stage.canvas.width}x${stage.canvas.height}`;
  }, 500);
}

interface SheetTile {
  label: string;
  scene?: Partial<SceneSettings>;
  ui?: Partial<UiState>;
  camera?: CameraPose;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

/** Capture one tile per entry (each on top of `base`) and compose them into a labelled contact sheet (PNG data URL). */
async function sheet(
  tiles: SheetTile[],
  layout: { columns?: number; width?: number; height?: number; base?: Partial<SceneSettings> } = {},
): Promise<string> {
  const columns = layout.columns ?? 4;
  const width = layout.width ?? 400;
  const height = layout.height ?? 250;
  const rows = Math.ceil(tiles.length / columns);
  const canvas = document.createElement('canvas');
  canvas.width = columns * width;
  canvas.height = rows * height;
  const ctx = canvas.getContext('2d')!;
  const before = store.getState();
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]!;
    store.updateScene({ ...before.scene, ...layout.base, ...tile.scene });
    if (tile.ui) store.updateUi(tile.ui);
    const options: CaptureOptions = { width, height };
    if (tile.camera) options.camera = tile.camera;
    const image = await loadImage(stage.capture(options));
    const x = (i % columns) * width;
    const y = Math.floor(i / columns) * height;
    ctx.drawImage(image, x, y);
    ctx.font = '13px ui-monospace, monospace';
    const textWidth = ctx.measureText(tile.label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, textWidth + 10, 19);
    ctx.fillStyle = '#fff';
    ctx.fillText(tile.label, x + 5, y + 14);
  }
  store.updateScene(before.scene);
  store.updateUi(before.ui);
  return canvas.toDataURL('image/png');
}

/**
 * Average milliseconds per rendered frame including GPU time: each frame is
 * followed by a one-pixel readPixels, which blocks until the GPU has finished.
 */
function benchmark(frames = 60): number {
  const { renderer, scene: threeScene, camera: threeCamera } = stage.context;
  const gl = renderer.getContext();
  const pixel = new Uint8Array(4);
  const draw = () => {
    renderer.render(threeScene, threeCamera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  };
  draw();
  const started = performance.now();
  for (let i = 0; i < frames; i++) draw();
  return (performance.now() - started) / frames;
}

function gpuName(): string {
  const gl = stage.context.renderer.getContext();
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  return extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : 'unknown';
}

const api = {
  ready: false,
  stage,
  store,
  audio,
  presets: BACKGROUNDS.map((p) => ({ id: p.id, name: p.name, kind: p.kind, swatch: p.swatch })),
  gpu: gpuName(),
  setScene: (patch: Partial<SceneSettings>) => store.updateScene(patch),
  setUi: (patch: Partial<UiState>) => store.updateUi(patch),
  setCamera: (pose: CameraPose) => store.setCamera(pose),
  capture: (options?: CaptureOptions) => stage.capture(options),
  sheet,
  benchmark,
};
(window as unknown as { __thunes: typeof api }).__thunes = api;

// Ready once a couple of frames have been presented.
requestAnimationFrame(() => requestAnimationFrame(() => (api.ready = true)));
