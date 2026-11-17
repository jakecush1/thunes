/**
 * Lab page for the dancer, interaction and camera-loop systems and the
 * thumbnailer. Dev only. The real store, the real registry and the real stage
 * with a fake beat clock.
 *
 * URL parameters:
 *   scene=starter|app|empty|six|fx|crowd   (default starter: a fixed test crew; app: the real starter scene)
 *   bpm=<n> (fake clock tempo, default 120)   hud=0   quality=low|medium|high
 *
 * window.__thunes exposes: store, registry, stage, audio, thumbnails, scenes,
 * load(name), memory(), screenOf(id, bone), benchmark(frames), thumbSheet(urls, columns).
 */
import * as THREE from 'three';
import { createAppRegistry } from '../src/assets';
import { UI_DEFAULTS } from '../src/config';
import { starterDocument } from '../src/core/starter';
import { defaultDancer, emptyDocument } from '../src/core/serialize';
import { createStore } from '../src/core/store';
import { createCameraLoopSystem } from '../src/stage/cameraLoop';
import { createDancerSystem } from '../src/stage/dancers';
import { createInteractionSystem } from '../src/stage/interaction';
import { createStage } from '../src/stage/stage';
import { createThumbnailer } from '../src/stage/thumbnails';
import type { CanonicalBone } from '../src/rig/bones';
import type { DancerState, Quality, SceneDocument } from '../src/types';
import { createFakeAudio } from './fakes';

const params = new URLSearchParams(location.search);
const registry = createAppRegistry();
const characterIds = registry.listCharacters().map((def) => def.id);
const danceIds = registry.listDances().map((def) => def.id);

/**
 * The fixed four-dancer crew the browser checks were written against. It is
 * deliberately independent of the app's starter scene, so that scene can be
 * rearranged without touching the tests.
 */
function testCrew(): SceneDocument {
  const doc = emptyDocument();
  doc.dancers = [
    { ...defaultDancer('d1', 'builtin:mannequin', 'builtin:groove'), x: 0, z: 0 },
    { ...defaultDancer('d2', 'builtin:robot', 'builtin:robot'), x: -1.4, z: 0, rotation: 10 },
    { ...defaultDancer('d3', 'builtin:toy', 'builtin:hands-up'), x: 1.4, z: 0, rotation: -10 },
    { ...defaultDancer('d4', 'builtin:lanky', 'builtin:disco-point'), x: -0.7, z: -1.2 },
  ];
  return doc;
}

const scenes: Record<string, () => SceneDocument> = {
  starter: testCrew,
  /** The scene a first-time visitor sees in the real app. */
  app: () => starterDocument(),
  empty: emptyDocument,
  /** All six characters, each with a different dance. */
  six() {
    const doc = emptyDocument();
    doc.dancers = characterIds.slice(0, 6).map((characterId, i) => ({
      ...defaultDancer(`s${i + 1}`, characterId, danceIds[(i * 2 + 1) % danceIds.length]!),
      x: (i - 2.5) * 1.35,
      z: i % 2 === 0 ? 0 : -0.9,
    }));
    doc.camera = { position: [0, 2.1, 8.6], target: [0, 0.95, 0] };
    return doc;
  },
  /** One frame exercising warp, shake, body sizes, tint and metal. */
  fx() {
    const doc = emptyDocument();
    const base = (id: string, characterId: string, x: number) => ({ ...defaultDancer(id, characterId, 'builtin:groove'), x, z: 0 });
    doc.dancers = [
      { ...base('f1', 'builtin:mannequin', -3.2), warpAmount: 0.8, warpWaves: 2.5, warpMode: 'wave', warpAlong: 'y', warpEffect: 'x' },
      { ...base('f2', 'builtin:toy', -1.6), warpAmount: 0.7, warpWaves: 3, warpMode: 'pulse', warpAlong: 'y', warpEffect: 'x' },
      { ...base('f3', 'builtin:lanky', 0), headSize: 2.2, handSize: 2.4, footSize: 2 },
      { ...base('f4', 'builtin:mannequin', 1.6), tint: '#ff4fa3', shine: 0.9 },
      { ...base('f5', 'builtin:robot', 3.2), metal: 1, shine: 0.95, tint: '#ffd27a' },
      { ...base('f6', 'builtin:stick', 0.8), z: -1.6, shakeBody: 1, shakeArms: 1, shakeNeck: 1, shakeSpeed: 1.5, headSize: 0.5 },
    ];
    doc.camera = { position: [0, 2.0, 8.2], target: [0, 0.95, 0] };
    return doc;
  },
  /** A full stage: eight dancers. */
  crowd() {
    const doc = emptyDocument();
    doc.dancers = Array.from({ length: 8 }, (_, i) => ({
      ...defaultDancer(`c${i + 1}`, characterIds[i % characterIds.length]!, danceIds[i % danceIds.length]!),
      x: ((i % 4) - 1.5) * 1.5,
      z: i < 4 ? 0.4 : -1.2,
    }));
    return doc;
  },
};

const store = createStore({ initial: { ui: { ...UI_DEFAULTS, quality: (params.get('quality') as Quality | null) ?? 'medium' } } });
store.loadDocument((scenes[params.get('scene') ?? 'starter'] ?? testCrew)());

const audio = createFakeAudio(Number(params.get('bpm')) || 120);
/** CPU time of the latest frame: from the clock tick at its start to the end of the render call. */
const cost = { startedAt: 0, last: 0, total: 0, max: 0, frames: 0 };
const timedAudio = {
  tick: () => {
    cost.startedAt = performance.now();
    return audio.tick();
  },
  levels: () => audio.levels(),
};

const stage = createStage(
  { container: document.getElementById('stage') as HTMLElement, store, registry, audio: timedAudio },
  { systems: [createDancerSystem, createInteractionSystem, createCameraLoopSystem] },
);
const renderer = stage.context.renderer;
const render = renderer.render.bind(renderer);
renderer.render = (scene, camera) => {
  render(scene, camera);
  if (cost.startedAt > 0) {
    cost.last = performance.now() - cost.startedAt;
    cost.total += cost.last;
    cost.max = Math.max(cost.max, cost.last);
    cost.frames++;
    cost.startedAt = 0;
  }
};
const thumbnails = createThumbnailer({ registry });
stage.start();

const hud = document.getElementById('hud') as HTMLElement;
if (params.get('hud') === '0') hud.remove();
else {
  setInterval(() => {
    const info = stage.debug();
    hud.textContent = `${info.fps.toFixed(0)} fps · ${cost.last.toFixed(2)} ms cpu · ${info.drawCalls} calls · ${info.triangles} tris\n${info.dancers
      .map((d) => `${d.id} ${d.status} ${d.characterId} ${d.danceId} t=${d.clipTime.toFixed(2)}`)
      .join('\n')}`;
  }, 250);
}

const world = new THREE.Vector3();

declare global {
  interface Window {
    __thunes?: Record<string, unknown>;
  }
}

window.__thunes = {
  ready: true,
  store,
  registry,
  stage,
  audio,
  thumbnails,
  characterIds,
  danceIds,
  scenes: Object.keys(scenes),
  load(name: string) {
    store.loadDocument((scenes[name] ?? emptyDocument)());
  },
  /** Replace the scene with the given dancers (ids are kept; missing settings take the defaults). */
  setDancers(list: (Partial<DancerState> & Pick<DancerState, 'id' | 'characterId' | 'danceId'>)[]) {
    store.loadDocument({ ...emptyDocument(), dancers: list.map((d) => ({ ...defaultDancer(d.id, d.characterId, d.danceId), ...d })) });
  },
  memory() {
    return { ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0 };
  },
  /** Client coordinates of a dancer's bone as currently posed (default: the hips), for pointer tests. */
  screenOf(id: string, bone: CanonicalBone | 'Hips' = 'Hips') {
    const dancer = stage.debug().dancers.find((d) => d.id === id);
    const at = dancer?.landmarks[bone as 'Hips'];
    if (!at) return null;
    const { camera, canvas } = stage.context;
    camera.updateMatrixWorld();
    world.set(at[0], at[1], at[2]).project(camera);
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + ((world.x + 1) / 2) * rect.width, y: rect.top + ((1 - world.y) / 2) * rect.height };
  },
  /** Client coordinates of a point on the floor. */
  screenAt(x: number, y: number, z: number) {
    const { camera, canvas } = stage.context;
    camera.updateMatrixWorld();
    world.set(x, y, z).project(camera);
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + ((world.x + 1) / 2) * rect.width, y: rect.top + ((1 - world.y) / 2) * rect.height };
  },
  /** Measure `frames` rendered frames: mean/max CPU time per frame and the mean interval between frames. */
  benchmark(frames = 120) {
    return new Promise((resolve) => {
      cost.total = 0;
      cost.max = 0;
      cost.frames = 0;
      const startedAt = performance.now();
      const step = () => {
        if (cost.frames < frames) {
          requestAnimationFrame(step);
          return;
        }
        resolve({
          frames: cost.frames,
          cpuMean: cost.total / cost.frames,
          cpuMax: cost.max,
          interval: (performance.now() - startedAt) / cost.frames,
          fps: stage.fps,
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
        });
      };
      requestAnimationFrame(step);
    });
  },
  /** Lay image data URLs out on a labelled contact sheet and return it as a PNG data URL. */
  async thumbSheet(items: { label: string; url: string }[], columns = 6, background = '#5b6170') {
    const size = 256;
    const rows = Math.ceil(items.length / columns);
    const canvas = document.createElement('canvas');
    canvas.width = columns * size;
    canvas.height = rows * (size + 22);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    for (let i = 0; i < items.length; i++) {
      const image = new Image();
      image.src = items[i]!.url;
      await image.decode();
      const x = (i % columns) * size;
      const y = Math.floor(i / columns) * (size + 22);
      ctx.drawImage(image, x, y, size, size);
      ctx.fillText(items[i]!.label, x + 6, y + size + 15);
    }
    return canvas.toDataURL('image/png');
  },
};
