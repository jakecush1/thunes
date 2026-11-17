/**
 * Minimal stand-ins for lab pages: a beat clock with synthetic levels, an
 * in-memory store and an empty asset registry. Dev only.
 */
import { AUDIO_DEFAULTS, DANCER_DEFAULTS, DEFAULT_CAMERA, MAX_DANCERS, SCENE_DEFAULTS, UI_DEFAULTS } from '../src/config';
import type {
  AppState,
  AssetRegistry,
  AudioEngine,
  AudioLevels,
  ClockSnapshot,
  DancerState,
  SceneDocument,
  Store,
  StoreListener,
} from '../src/types';

export interface FakeAudio extends Pick<AudioEngine, 'tick' | 'levels'> {
  /** Number of tick() calls so far. */
  readonly ticks: number;
  bpm: number;
}

/**
 * A clock driven by performance.now at a fixed tempo (default 120 BPM) with
 * levels that pulse on every beat (bass strongest on the beat, treble on the off-beat).
 */
export function createFakeAudio(bpm = 120): FakeAudio {
  const startedAt = performance.now();
  const clock: ClockSnapshot = { time: 0, delta: 0, beat: 0, bpm };
  const levels: AudioLevels = { level: 0, bass: 0, mid: 0, treble: 0 };
  let ticks = 0;
  return {
    bpm,
    get ticks() {
      return ticks;
    },
    tick() {
      const time = (performance.now() - startedAt) / 1000;
      clock.delta = time - clock.time;
      clock.time = time;
      clock.beat += (clock.delta * this.bpm) / 60;
      clock.bpm = this.bpm;
      ticks++;
      return clock;
    },
    levels() {
      const phase = clock.beat - Math.floor(clock.beat);
      levels.bass = Math.exp(-5 * phase);
      levels.treble = 0.25 + 0.5 * Math.exp(-8 * ((phase + 0.5) % 1));
      levels.mid = 0.35 + 0.15 * Math.sin(clock.beat * Math.PI * 0.5);
      levels.level = Math.min(1, 0.25 + 0.6 * levels.bass + 0.15 * levels.treble);
      return levels;
    },
  };
}

export interface FakeStoreInit {
  scene?: Partial<AppState['scene']>;
  ui?: Partial<AppState['ui']>;
  camera?: AppState['camera'];
  dancers?: DancerState[];
}

/**
 * In-memory Store built from the defaults in config.ts. State is immutable and
 * unchanged branches keep their identity, like the real store. No clamping, no history.
 */
export function createFakeStore(init: FakeStoreInit = {}): Store {
  let state: AppState = {
    title: 'Lab',
    dancers: init.dancers ?? [],
    scene: { ...SCENE_DEFAULTS, ...init.scene },
    audio: { ...AUDIO_DEFAULTS },
    camera: init.camera ?? DEFAULT_CAMERA,
    ui: { ...UI_DEFAULTS, ...init.ui },
  };
  const listeners = new Set<StoreListener>();
  let nextId = 1;

  function set(next: AppState): void {
    const previous = state;
    state = next;
    for (const listener of [...listeners]) listener(state, previous);
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    addDancer(dancerInit) {
      if (state.dancers.length >= MAX_DANCERS) return null;
      const dancer: DancerState = { ...DANCER_DEFAULTS, id: `d${nextId++}`, ...dancerInit };
      set({ ...state, dancers: [...state.dancers, dancer], ui: { ...state.ui, selectedId: dancer.id } });
      return dancer;
    },
    removeDancer(id) {
      const ui = state.ui.selectedId === id ? { ...state.ui, selectedId: null } : state.ui;
      set({ ...state, dancers: state.dancers.filter((d) => d.id !== id), ui });
    },
    cloneDancer(id) {
      const source = state.dancers.find((d) => d.id === id);
      if (!source || state.dancers.length >= MAX_DANCERS) return null;
      const dancer: DancerState = { ...source, id: `d${nextId++}`, x: source.x + 1 };
      set({ ...state, dancers: [...state.dancers, dancer], ui: { ...state.ui, selectedId: dancer.id } });
      return dancer;
    },
    updateDancer(id, patch) {
      set({ ...state, dancers: state.dancers.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
    },
    clearDancers() {
      set({ ...state, dancers: [], ui: { ...state.ui, selectedId: null } });
    },
    updateScene(patch) {
      set({ ...state, scene: { ...state.scene, ...patch } });
    },
    updateAudio(patch) {
      set({ ...state, audio: { ...state.audio, ...patch } });
    },
    setCamera(pose) {
      set({ ...state, camera: pose });
    },
    updateUi(patch) {
      set({ ...state, ui: { ...state.ui, ...patch } });
    },
    select(id) {
      set({ ...state, ui: { ...state.ui, selectedId: id } });
    },
    setTitle(title) {
      set({ ...state, title });
    },
    getDocument(): SceneDocument {
      return {
        version: 1,
        title: state.title,
        dancers: state.dancers.map((d) => ({ ...d })),
        scene: { ...state.scene },
        audio: { songId: state.audio.songId, beatSync: state.audio.beatSync },
        camera: state.camera,
      };
    },
    loadDocument(document) {
      set({
        ...state,
        title: document.title,
        dancers: document.dancers,
        scene: document.scene,
        audio: { ...state.audio, ...document.audio },
        camera: document.camera,
        ui: { ...state.ui, selectedId: null },
      });
    },
    commit() {},
    undo() {},
    redo() {},
    canUndo: () => false,
    canRedo: () => false,
  };
}

/** A registry with an empty catalogue; every load rejects. */
export function createFakeRegistry(): AssetRegistry {
  const missing = (kind: string, id: string) => Promise.reject(new Error(`Fake registry has no ${kind} "${id}"`));
  return {
    listCharacters: () => [],
    listDances: () => [],
    listSongs: () => [],
    getCharacter: () => undefined,
    getDance: () => undefined,
    getSong: () => undefined,
    loadCharacter: (id) => missing('character', id),
    loadDance: (id) => missing('dance', id),
    loadSong: (id) => missing('song', id),
    loadRetargetedClip: (request) => missing('dance', request.danceId),
    setSongBpm() {},
    addUploads: () => Promise.resolve({ characters: [], dances: [], songs: [], problems: [] }),
    removeUpload: () => Promise.resolve(),
    subscribe: () => () => {},
  };
}
