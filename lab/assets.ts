// Dev-only lab page for the asset pipeline (see assets.html). Everything the
// e2e script needs is on window.__thunes: the registry, the last upload
// report and `lab`, a few helpers that pose characters and render contact sheets.
import * as THREE from 'three';
import { createAppRegistry } from '../src/assets';
import { createAudioEngine } from '../src/audio/engine';
import type { CharacterInstance, UploadReport } from '../src/types';

const registry = createAppRegistry();
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// ——— Catalogue lists ———

function row(label: string, detail: string, onRemove?: () => void): HTMLLIElement {
  const item = document.createElement('li');
  const name = document.createElement('span');
  name.textContent = label;
  const small = document.createElement('small');
  small.textContent = detail;
  item.append(name, small);
  if (onRemove) {
    const button = document.createElement('button');
    button.textContent = 'remove';
    button.addEventListener('click', onRemove);
    item.append(button);
  }
  return item;
}

function renderLists(): void {
  const remover = (id: string, source: string): (() => void) | undefined => (source === 'upload' ? () => void registry.removeUpload(id) : undefined);
  $('characters').replaceChildren(...registry.listCharacters().filter((d) => d.source !== 'builtin').map((d) => row(d.name, d.id, remover(d.id, d.source))));
  $('dances').replaceChildren(...registry.listDances().filter((d) => d.source !== 'builtin').map((d) => row(d.name, `${d.id}${d.bpm ? ` · ${d.bpm} bpm` : ''}`, remover(d.id, d.source))));
  $('songs').replaceChildren(...registry.listSongs().filter((d) => d.source !== 'builtin').map((d) => row(d.title, `${d.id}${d.bpm ? ` · ${d.bpm} bpm` : ''}`, remover(d.id, d.source))));
  for (const list of ['characters', 'dances', 'songs']) {
    for (const item of Array.from($(list).children)) (item as HTMLElement).dataset.id = item.querySelector('small')?.textContent?.split(' · ')[0] ?? '';
  }
}
registry.subscribe(renderLists);
renderLists();

// ——— Uploads ———

const state: { reports: UploadReport[]; busy: boolean } = { reports: [], busy: false };

async function upload(files: File[]): Promise<UploadReport> {
  state.busy = true;
  $('status').textContent = `Adding ${files.length} file(s)…`;
  try {
    const report = await registry.addUploads(files);
    state.reports.push(report);
    const added = [...report.characters.map((d) => `character: ${d.name}`), ...report.dances.map((d) => `dance: ${d.name}`), ...report.songs.map((d) => `song: ${d.title}${d.bpm ? ` (${d.bpm} bpm)` : ''}`)];
    const items = added.map((line) => row(line, ''));
    for (const problem of report.problems) {
      const item = document.createElement('li');
      item.className = 'problem';
      item.textContent = `${problem.file}: ${problem.reason}`;
      items.push(item);
    }
    $('report').replaceChildren(...items);
    return report;
  } finally {
    state.busy = false;
    $('status').textContent = '';
  }
}

const input = $<HTMLInputElement>('files');
input.addEventListener('change', () => {
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (files.length > 0) void upload(files);
});

// ——— Scene ———

const canvas = $<HTMLCanvasElement>('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.autoClear = false;
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x444a5a, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(2, 5, 4);
scene.add(sun);
const grid = new THREE.GridHelper(4, 8, 0x8890a8, 0x4a4f60);
scene.add(grid);
// A marker on the +Z side of the floor: dancers should face it (and the camera behind it).
const marker = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.08), new THREE.MeshBasicMaterial({ color: 0xff7755 }));
marker.position.set(0, 0.01, 1.2);
scene.add(marker);
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);

const LANDMARKS = ['Hips', 'Head', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot'] as const;
type Landmark = (typeof LANDMARKS)[number];
type Landmarks = Record<Landmark, [number, number, number] | null>;

function landmarksOf(instance: CharacterInstance): Landmarks {
  const out = {} as Landmarks;
  const v = new THREE.Vector3();
  for (const name of LANDMARKS) {
    const node = instance.bones[name];
    out[name] = node ? (v.setFromMatrixPosition(node.matrixWorld).toArray().map((n) => Math.round(n * 1000) / 1000) as [number, number, number]) : null;
  }
  return out;
}

interface Posed {
  instance: CharacterInstance;
  mixer: THREE.AnimationMixer;
  duration: number;
  height: number;
  setTime(seconds: number): void;
  dispose(): void;
}

async function pose(characterId: string, danceId: string, mirror = false): Promise<Posed> {
  const [character, clip] = await Promise.all([registry.loadCharacter(characterId), registry.loadRetargetedClip({ characterId, danceId, mirror })]);
  const instance = character.instantiate();
  const mixer = new THREE.AnimationMixer(instance.root);
  mixer.clipAction(clip).play();
  return {
    instance,
    mixer,
    duration: clip.duration,
    height: character.height,
    setTime(seconds) {
      mixer.setTime(seconds);
      instance.root.updateMatrixWorld(true);
    },
    dispose() {
      mixer.stopAllAction();
      instance.dispose();
    },
  };
}

const lab = {
  state,
  upload,
  catalogue() {
    return {
      characters: registry.listCharacters().map((d) => ({ id: d.id, name: d.name, source: d.source })),
      dances: registry.listDances().map((d) => ({ id: d.id, name: d.name, source: d.source, bpm: d.bpm ?? null, clip: d.clip ?? null })),
      songs: registry.listSongs().map((d) => ({ id: d.id, title: d.title, source: d.source, bpm: d.bpm ?? null, duration: d.duration ?? null })),
    };
  },
  /** Plays a dance on a character without rendering and returns the landmark positions at evenly spaced times. */
  async probe(characterId: string, danceId: string, samples = 10): Promise<{ duration: number; height: number; rest: Landmarks; frames: Landmarks[] }> {
    const posed = await pose(characterId, danceId);
    try {
      posed.instance.root.updateMatrixWorld(true);
      const frames: Landmarks[] = [];
      for (let i = 0; i < samples; i++) {
        posed.setTime((posed.duration * (i + 0.5)) / samples);
        frames.push(landmarksOf(posed.instance));
      }
      const character = await registry.loadCharacter(characterId);
      const rest = character.instantiate();
      rest.root.updateMatrixWorld(true);
      const restLandmarks = landmarksOf(rest);
      rest.dispose();
      return { duration: posed.duration, height: posed.height, rest: restLandmarks, frames };
    } finally {
      posed.dispose();
    }
  },
  /** Renders a contact sheet: one row per character × dance pair, one column per time (fraction of the clip). */
  async sheet(rows: { characterId: string; danceId: string }[], fractions: number[] = [0.2, 0.5, 0.8]): Promise<{ width: number; height: number }> {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    renderer.setScissorTest(false);
    renderer.setClearColor(0x30333d, 1);
    renderer.clear();
    renderer.setScissorTest(true);
    const cellW = Math.floor(width / fractions.length);
    const cellH = Math.floor(height / rows.length);
    camera.aspect = cellW / cellH;
    camera.position.set(0, 1.05, 2.9 / Math.tan(THREE.MathUtils.degToRad(15)) / 2.4);
    camera.lookAt(0, 0.95, 0);
    camera.updateProjectionMatrix();
    for (let r = 0; r < rows.length; r++) {
      const posed = await pose(rows[r]!.characterId, rows[r]!.danceId);
      scene.add(posed.instance.root);
      for (let c = 0; c < fractions.length; c++) {
        posed.setTime(posed.duration * fractions[c]!);
        const x = c * cellW;
        const y = height - (r + 1) * cellH;
        renderer.setViewport(x, y, cellW, cellH);
        renderer.setScissor(x + 1, y + 1, cellW - 2, cellH - 2);
        renderer.setClearColor(r % 2 === 0 ? 0x3b3e48 : 0x41444f, 1);
        renderer.clear();
        renderer.render(scene, camera);
      }
      scene.remove(posed.instance.root);
      posed.dispose();
    }
    // Textures of file characters may still be uploading on the first frame; the caller can render twice.
    return { width, height };
  },
  /**
   * Plays a song through the audio engine as if its tempo were unknown and
   * reports the tempo the engine detected (the TEMPO-DETECTOR HOOK).
   */
  async engineTempo(songId: string): Promise<{ status: string; bpm: number | null; stored: number | null; message?: string }> {
    let stored: number | null = null;
    const engine = createAudioEngine({
      loadSong: (id) => registry.loadSong(id),
      getSong: (id) => {
        const def = registry.getSong(id);
        if (!def) return undefined;
        const { bpm: _known, ...rest } = def;
        return rest;
      },
      setSongBpm: (_id, bpm) => {
        stored = bpm;
      },
    });
    try {
      await engine.unlock();
      engine.sync({ songId, muted: true, volume: 0, beatSync: true });
      const deadline = performance.now() + 15000;
      while (performance.now() < deadline) {
        const status = engine.status;
        if (status.state === 'playing') return { status: 'playing', bpm: status.bpm, stored };
        if (status.state === 'error') return { status: 'error', bpm: null, stored, message: status.message };
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return { status: engine.status.state, bpm: null, stored };
    } finally {
      engine.dispose();
    }
  },
};

declare global {
  interface Window {
    __thunes?: Record<string, unknown>;
  }
}

const handle = { ready: false, registry, lab };
window.__thunes = handle;
void registry.uploadsRestored.then(async () => {
  renderLists();
  await lab.sheet([{ characterId: 'builtin:mannequin', danceId: 'library:example-side-sway' }], [0.1, 0.35, 0.6, 0.85]).catch((error: unknown) => console.warn('initial sheet failed', error));
  handle.ready = true;
});
