/**
 * The app store: immutable state with structural sharing, validated updates,
 * undo/redo over { dancers, scene }, and ordered synchronous notifications.
 */

import { AUDIO_DEFAULTS, DANCER_DEFAULTS, DANCER_FIELDS, FALLBACK_CHARACTER_ID, FALLBACK_DANCE_ID, HISTORY_LIMIT, MAX_DANCERS, UI_DEFAULTS } from '../config';
import type {
  AppState,
  AudioSettings,
  CameraPose,
  DancerState,
  SceneDocument,
  SceneSettings,
  Store,
  StoreListener,
  UiState,
  UpdateOptions,
} from '../types';
import { findCloneSpot, findFreeSpot } from './placement';
import { emptyDocument, sanitizeDocument } from './serialize';
import {
  AUDIO_VALIDATORS,
  SCENE_VALIDATORS,
  UI_VALIDATORS,
  applyDancerPatch,
  applyPatch,
  cameraEqual,
  cleanTitle,
  dancersEqual,
  isRecord,
  sanitizeCamera,
  shallowEqual,
  validAssetId,
} from './validate';

export interface StoreOptions {
  /** Initial state; every part is validated like an update. */
  initial?: Partial<Pick<AppState, 'title' | 'dancers' | 'scene' | 'audio' | 'camera' | 'ui'>>;
  /** Id generator for new dancers (tests). Must return strings matching /^[A-Za-z0-9_-]{1,32}$/. Default: random base36. */
  generateId?: () => string;
}

interface Snapshot {
  dancers: readonly DancerState[];
  scene: SceneSettings;
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomId(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  return s;
}

function repairSelection(ui: UiState, dancers: readonly DancerState[]): UiState {
  if (ui.selectedId === null || dancers.some((d) => d.id === ui.selectedId)) return ui;
  return { ...ui, selectedId: null };
}

/**
 * Creates the store. See the `Store` interface in types.ts for the contract.
 * Updates ignore unknown keys and invalid values, clamp numbers to config
 * ranges, and produce no notification or history when nothing changes.
 */
export function createStore(options: StoreOptions = {}): Store {
  const init = options.initial ?? {};
  const generateId = options.generateId ?? randomId;

  const doc = sanitizeDocument({
    title: init.title,
    dancers: init.dancers,
    scene: init.scene,
    camera: init.camera,
  });
  let state: AppState = {
    title: doc.title,
    dancers: doc.dancers,
    scene: doc.scene,
    audio: applyPatch({ ...AUDIO_DEFAULTS }, init.audio, AUDIO_VALIDATORS),
    camera: doc.camera,
    ui: { ...UI_DEFAULTS },
  };
  state = { ...state, ui: applyUi(state.ui, init.ui, state.dancers) };

  const listeners: StoreListener[] = [];
  const queue: [AppState, AppState][] = [];
  let delivering = false;

  let past: Snapshot[] = [];
  let future: Snapshot[] = [];
  /** State before the current transient gesture, or null. */
  let gestureStart: Snapshot | null = null;

  function applyUi(ui: UiState, patch: unknown, dancers: readonly DancerState[]): UiState {
    let next = applyPatch(ui, patch, UI_VALIDATORS);
    if (isRecord(patch) && Object.prototype.hasOwnProperty.call(patch, 'selectedId')) {
      const sel = patch.selectedId;
      if (sel === null || (typeof sel === 'string' && dancers.some((d) => d.id === sel))) {
        if (sel !== next.selectedId) next = { ...next, selectedId: sel };
      }
    }
    return next;
  }

  function notify(next: AppState, previous: AppState): void {
    queue.push([next, previous]);
    if (delivering) return;
    delivering = true;
    try {
      while (queue.length) {
        const [s, p] = queue.shift()!;
        for (const l of listeners.slice()) {
          try {
            l(s, p);
          } catch (err) {
            console.error('[thunes] store listener failed', err);
          }
        }
      }
    } finally {
      delivering = false;
    }
  }

  function setState(next: AppState): void {
    if (next === state) return;
    const previous = state;
    state = next;
    notify(next, previous);
  }

  function snapshot(): Snapshot {
    return { dancers: state.dancers, scene: state.scene };
  }

  function pushPast(s: Snapshot): void {
    past.push(s);
    if (past.length > HISTORY_LIMIT) past = past.slice(past.length - HISTORY_LIMIT);
    future = [];
  }

  function commitGesture(): void {
    const start = gestureStart;
    if (!start) return;
    gestureStart = null;
    if (!dancersEqual(start.dancers, state.dancers) || !shallowEqual(start.scene, state.scene)) pushPast(start);
  }

  /** Applies a change to dancers and/or scene with history semantics. */
  function change(next: AppState, transient: boolean | undefined): void {
    if (!transient) commitGesture();
    if (next === state) return;
    const historic = next.dancers !== state.dancers || next.scene !== state.scene;
    if (historic) {
      if (transient) gestureStart ??= snapshot();
      else pushPast(snapshot());
    }
    setState(next);
  }

  function withDancers(dancers: readonly DancerState[], ui?: UiState): AppState {
    return { ...state, dancers, ui: repairSelection(ui ?? state.ui, dancers) };
  }

  function uniqueDancerId(): string {
    for (let i = 0; i < 1000; i++) {
      const id = generateId();
      if (/^[A-Za-z0-9_-]{1,32}$/.test(id) && !state.dancers.some((d) => d.id === id)) return id;
    }
    // Fallback: deterministic and guaranteed unique.
    let n = state.dancers.length + 1;
    while (state.dancers.some((d) => d.id === `d${n}`)) n++;
    return `d${n}`;
  }

  function positions(exclude?: string): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (const d of state.dancers) if (d.id !== exclude) out.push({ x: d.x, z: d.z });
    return out;
  }

  const store: Store = {
    getState: () => state,

    subscribe(listener) {
      listeners.push(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
      };
    },

    addDancer(initial) {
      if (state.dancers.length >= MAX_DANCERS) return null;
      const src: Record<string, unknown> = isRecord(initial) ? { ...initial } : {};
      delete src.id;
      const characterId = validAssetId(src.characterId) ?? FALLBACK_CHARACTER_ID;
      const danceId = validAssetId(src.danceId) ?? FALLBACK_DANCE_ID;
      const base: DancerState = { ...DANCER_DEFAULTS, id: uniqueDancerId(), characterId, danceId };
      const hasPos = typeof src.x === 'number' && Number.isFinite(src.x) && typeof src.z === 'number' && Number.isFinite(src.z);
      if (!hasPos) {
        const spot = findFreeSpot(positions());
        src.x = spot.x;
        src.z = spot.z;
      }
      let dancer = applyDancerPatch(base, src);
      if (dancer.characterId !== characterId || dancer.danceId !== danceId) dancer = { ...dancer, characterId, danceId };
      const dancers = [...state.dancers, dancer];
      commitGesture();
      pushPast(snapshot());
      setState({ ...state, dancers, ui: { ...state.ui, selectedId: dancer.id } });
      return dancer;
    },

    removeDancer(id) {
      if (!state.dancers.some((d) => d.id === id)) return;
      change(withDancers(state.dancers.filter((d) => d.id !== id)), false);
    },

    cloneDancer(id) {
      const original = state.dancers.find((d) => d.id === id);
      if (!original || state.dancers.length >= MAX_DANCERS) return null;
      const spot = findCloneSpot({ x: original.x, z: original.z }, positions(id));
      const x = Math.min(DANCER_FIELDS.x.max, Math.max(DANCER_FIELDS.x.min, spot.x));
      const z = Math.min(DANCER_FIELDS.z.max, Math.max(DANCER_FIELDS.z.min, spot.z));
      const clone: DancerState = { ...original, id: uniqueDancerId(), x, z };
      commitGesture();
      pushPast(snapshot());
      setState({ ...state, dancers: [...state.dancers, clone], ui: { ...state.ui, selectedId: clone.id } });
      return clone;
    },

    updateDancer(id, patch, opts?: UpdateOptions) {
      const i = state.dancers.findIndex((d) => d.id === id);
      if (i < 0) {
        if (!opts?.transient) commitGesture();
        return;
      }
      const current = state.dancers[i];
      const next = applyDancerPatch(current, patch);
      if (next === current) {
        if (!opts?.transient) commitGesture();
        return;
      }
      const dancers = state.dancers.slice();
      dancers[i] = next;
      change({ ...state, dancers }, opts?.transient);
    },

    clearDancers() {
      if (state.dancers.length === 0) return;
      change(withDancers([]), false);
    },

    updateScene(patch, opts?: UpdateOptions) {
      const scene = applyPatch(state.scene, patch, SCENE_VALIDATORS);
      change(scene === state.scene ? state : { ...state, scene }, opts?.transient);
    },

    updateAudio(patch: Partial<AudioSettings>) {
      const audio = applyPatch(state.audio, patch, AUDIO_VALIDATORS);
      if (audio !== state.audio) setState({ ...state, audio });
    },

    setCamera(pose: CameraPose) {
      const camera = sanitizeCamera(pose);
      if (camera && !cameraEqual(camera, state.camera)) setState({ ...state, camera });
    },

    updateUi(patch: Partial<UiState>) {
      const ui = applyUi(state.ui, patch, state.dancers);
      if (ui !== state.ui) setState({ ...state, ui });
    },

    select(id) {
      store.updateUi({ selectedId: id });
    },

    setTitle(title) {
      const t = cleanTitle(title);
      if (t !== state.title) setState({ ...state, title: t });
    },

    getDocument(): SceneDocument {
      return {
        version: 1,
        title: state.title,
        dancers: state.dancers.map((d) => ({ ...d })),
        scene: { ...state.scene },
        audio: { songId: state.audio.songId, beatSync: state.audio.beatSync },
        camera: { position: [...state.camera.position], target: [...state.camera.target] },
      };
    },

    loadDocument(document) {
      const d = sanitizeDocument(document ?? emptyDocument());
      past = [];
      future = [];
      gestureStart = null;
      const audio = applyPatch(state.audio, { songId: d.audio.songId, beatSync: d.audio.beatSync }, AUDIO_VALIDATORS);
      const ui = state.ui.selectedId === null ? state.ui : { ...state.ui, selectedId: null };
      setState({ title: d.title, dancers: d.dancers, scene: d.scene, audio, camera: d.camera, ui });
    },

    commit() {
      commitGesture();
    },

    undo() {
      commitGesture();
      const prev = past.pop();
      if (!prev) return;
      future.push(snapshot());
      setState({ ...state, dancers: prev.dancers, scene: prev.scene, ui: repairSelection(state.ui, prev.dancers) });
    },

    redo() {
      commitGesture();
      const next = future.pop();
      if (!next) return;
      past.push(snapshot());
      setState({ ...state, dancers: next.dancers, scene: next.scene, ui: repairSelection(state.ui, next.dancers) });
    },

    canUndo: () => past.length > 0 || gestureStart !== null,
    canRedo: () => future.length > 0 && gestureStart === null,
  };
  return store;
}
