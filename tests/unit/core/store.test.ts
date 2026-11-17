import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIO_DEFAULTS,
  DANCER_DEFAULTS,
  DANCER_FIELDS,
  DEFAULT_CAMERA,
  FALLBACK_CHARACTER_ID,
  HISTORY_LIMIT,
  MAX_DANCERS,
  MIN_TRIM_SPAN,
  SCENE_DEFAULTS,
  SCENE_FIELDS,
  UI_DEFAULTS,
} from '../../../src/config';
import { createStore } from '../../../src/core/store';
import type { AppState, Store } from '../../../src/types';

const A = { characterId: 'builtin:mannequin', danceId: 'builtin:groove' };

function counter(store: Store): { calls: [AppState, AppState][] } {
  const calls: [AppState, AppState][] = [];
  store.subscribe((s, p) => calls.push([s, p]));
  return { calls };
}

afterEach(() => vi.restoreAllMocks());

describe('initial state', () => {
  it('uses defaults', () => {
    const s = createStore().getState();
    expect(s.dancers).toEqual([]);
    expect(s.scene).toEqual(SCENE_DEFAULTS);
    expect(s.audio).toEqual(AUDIO_DEFAULTS);
    expect(s.ui).toEqual(UI_DEFAULTS);
    expect(s.camera).toEqual(DEFAULT_CAMERA);
    expect(s.camera).not.toBe(DEFAULT_CAMERA);
    expect(s.title).toBe('');
  });

  it('validates initial values', () => {
    const s = createStore({
      initial: {
        title: '  My\nshow ',
        scene: { ...SCENE_DEFAULTS, fog: 9 },
        audio: { ...AUDIO_DEFAULTS, volume: -1 },
        ui: { ...UI_DEFAULTS, selectedId: 'nope', quality: 'high' },
        dancers: [{ ...DANCER_DEFAULTS, ...A, id: 'a1' }],
      },
    }).getState();
    expect(s.title).toBe('My show');
    expect(s.scene.fog).toBe(1);
    expect(s.audio.volume).toBe(0);
    expect(s.ui.selectedId).toBeNull();
    expect(s.ui.quality).toBe('high');
    expect(s.dancers[0].id).toBe('a1');
  });
});

describe('structural sharing and no-ops', () => {
  it('keeps untouched branches and dancers by identity', () => {
    const store = createStore();
    const a = store.addDancer(A)!;
    const b = store.addDancer(A)!;
    const before = store.getState();
    store.updateDancer(a.id, { speed: 2 });
    const after = store.getState();
    expect(after).not.toBe(before);
    expect(after.dancers).not.toBe(before.dancers);
    expect(after.dancers[1]).toBe(before.dancers[1]);
    expect(after.dancers[1].id).toBe(b.id);
    expect(after.scene).toBe(before.scene);
    expect(after.audio).toBe(before.audio);
    expect(after.camera).toBe(before.camera);
    expect(after.ui).toBe(before.ui);
    store.updateScene({ fog: 0.5 });
    expect(store.getState().dancers).toBe(after.dancers);
  });

  it('does not notify or record history for changes that change nothing', () => {
    const store = createStore();
    const d = store.addDancer(A)!;
    const { calls } = counter(store);
    const state = store.getState();
    store.updateDancer(d.id, { speed: 1 });
    store.updateDancer(d.id, { speed: Number.NaN });
    store.updateDancer(d.id, { bogus: 3 } as never);
    store.updateDancer('missing', { speed: 2 });
    store.updateScene({ fog: SCENE_DEFAULTS.fog });
    store.updateScene({});
    store.updateAudio({ volume: AUDIO_DEFAULTS.volume });
    store.updateUi({ mode: 'both' });
    store.select(d.id);
    store.setTitle('');
    store.setCamera({ position: [...DEFAULT_CAMERA.position], target: [...DEFAULT_CAMERA.target] });
    store.removeDancer('missing');
    store.commit();
    expect(calls).toHaveLength(0);
    expect(store.getState()).toBe(state);
    store.undo();
    expect(store.getState().dancers).toHaveLength(0);
    expect(store.canUndo()).toBe(false);
  });
});

describe('dancer validation', () => {
  function withDancer() {
    const store = createStore();
    const d = store.addDancer(A)!;
    const get = () => store.getState().dancers[0];
    return { store, id: d.id, get };
  }

  it('clamps every numeric field to its range', () => {
    const { store, id, get } = withDancer();
    for (const [key, f] of Object.entries(DANCER_FIELDS)) {
      if (key === 'rotation' || key === 'trimStart' || key === 'trimEnd') continue;
      store.updateDancer(id, { [key]: f.max + 100 });
      expect((get() as unknown as Record<string, unknown>)[key], key).toBe(f.max);
      store.updateDancer(id, { [key]: f.min - 100 });
      expect((get() as unknown as Record<string, unknown>)[key], key).toBe(f.min);
    }
  });

  it('rejects non-finite and wrongly typed numbers', () => {
    const { store, id, get } = withDancer();
    const before = get();
    store.updateDancer(id, { speed: Infinity, scale: -Infinity, y: Number.NaN, offset: '0.5' as never, mirror: 1 as never });
    expect(get()).toBe(before);
  });

  it('wraps rotation into [-180, 180]', () => {
    const { store, id, get } = withDancer();
    store.updateDancer(id, { rotation: 190 });
    expect(get().rotation).toBe(-170);
    store.updateDancer(id, { rotation: -540 });
    expect(get().rotation).toBe(-180);
    store.updateDancer(id, { rotation: 180 });
    expect(get().rotation).toBe(180);
    store.updateDancer(id, { rotation: 720 + 45 });
    expect(get().rotation).toBe(45);
  });

  it('validates enums, colours and nullable material values', () => {
    const { store, id, get } = withDancer();
    store.updateDancer(id, { warpMode: 'pulse', warpAlong: 'z', warpEffect: 'y' });
    expect(get()).toMatchObject({ warpMode: 'pulse', warpAlong: 'z', warpEffect: 'y' });
    store.updateDancer(id, { warpMode: 'spin' as never, warpAlong: 'w' as never, warpEffect: null as never });
    expect(get()).toMatchObject({ warpMode: 'pulse', warpAlong: 'z', warpEffect: 'y' });
    store.updateDancer(id, { tint: '#AABBCC' });
    expect(get().tint).toBe('#aabbcc');
    for (const bad of ['red', '#abc', '#aabbccdd', 'aabbcc', 12]) {
      store.updateDancer(id, { tint: bad as never });
      expect(get().tint).toBe('#aabbcc');
    }
    store.updateDancer(id, { tint: null });
    expect(get().tint).toBeNull();
    store.updateDancer(id, { shine: 2, metal: -1 });
    expect(get()).toMatchObject({ shine: 1, metal: 0 });
    store.updateDancer(id, { shine: null, metal: null });
    expect(get()).toMatchObject({ shine: null, metal: null });
    store.updateDancer(id, { characterId: 'library:robot', danceId: 'bad id!' });
    expect(get()).toMatchObject({ characterId: 'library:robot', danceId: A.danceId });
    store.updateDancer(id, { id: 'hijack' } as never);
    expect(get().id).toBe(id);
  });

  it('keeps the trim span by moving the field that was not patched', () => {
    const { store, id, get } = withDancer();
    store.updateDancer(id, { trimStart: 0.98 });
    expect(get().trimStart).toBe(DANCER_FIELDS.trimStart.max);
    expect(get().trimEnd).toBe(1);
    store.updateDancer(id, { trimStart: 0.2, trimEnd: 0.9 });
    store.updateDancer(id, { trimStart: 0.88 });
    expect(get().trimStart).toBe(0.88);
    expect(get().trimEnd).toBeCloseTo(0.93);
    store.updateDancer(id, { trimEnd: 0.1 });
    expect(get().trimEnd).toBe(0.1);
    expect(get().trimStart).toBeCloseTo(0.05);
    store.updateDancer(id, { trimEnd: 0 });
    expect(get().trimEnd).toBe(MIN_TRIM_SPAN);
    expect(get().trimStart).toBe(0);
    // Both patched: trimEnd moves.
    store.updateDancer(id, { trimStart: 0.6, trimEnd: 0.5 });
    expect(get().trimStart).toBe(0.6);
    expect(get().trimEnd).toBeCloseTo(0.65);
    expect(get().trimEnd - get().trimStart).toBeGreaterThanOrEqual(MIN_TRIM_SPAN - 1e-9);
  });
});

describe('scene, audio, ui validation', () => {
  it('clamps scene numbers and validates scene enums and colours', () => {
    const store = createStore();
    for (const [key, f] of Object.entries(SCENE_FIELDS)) {
      store.updateScene({ [key]: 1e9 });
      expect(store.getState().scene[key as keyof typeof SCENE_DEFAULTS], key).toBe(f.max);
      store.updateScene({ [key]: -1e9 });
      expect(store.getState().scene[key as keyof typeof SCENE_DEFAULTS], key).toBe(f.min);
    }
    store.updateScene({ floorStyle: 'tiles', strobeDivision: 4, backgroundColor: '#FFFFFF', floorColor: '#00FF00', background: 'sunset' });
    expect(store.getState().scene).toMatchObject({ floorStyle: 'tiles', strobeDivision: 4, backgroundColor: '#ffffff', floorColor: '#00ff00', background: 'sunset' });
    store.updateScene({ floorStyle: 'lava' as never, strobeDivision: 3 as never, backgroundColor: null as never, background: '<script>' });
    expect(store.getState().scene).toMatchObject({ floorStyle: 'tiles', strobeDivision: 4, backgroundColor: '#ffffff', background: 'sunset' });
    store.updateScene({ floorColor: null, strobeSync: false, cameraLoop: true });
    expect(store.getState().scene).toMatchObject({ floorColor: null, strobeSync: false, cameraLoop: true });
    store.updateScene({ strobeSync: 'yes' as never });
    expect(store.getState().scene.strobeSync).toBe(false);
  });

  it('validates audio and ui', () => {
    const store = createStore();
    store.updateAudio({ volume: 5, songId: null, muted: true, beatSync: false });
    expect(store.getState().audio).toEqual({ volume: 1, songId: null, muted: true, beatSync: false });
    store.updateAudio({ songId: 'x y' });
    expect(store.getState().audio.songId).toBeNull();
    store.updateAudio({ songId: 'builtin:other' });
    expect(store.getState().audio.songId).toBe('builtin:other');
    store.updateUi({ mode: 'grab', quality: 'low', uiHidden: true, entered: true, strobeAllowed: true, viewOnly: true });
    expect(store.getState().ui).toMatchObject({ mode: 'grab', quality: 'low', uiHidden: true, entered: true, strobeAllowed: true, viewOnly: true });
    store.updateUi({ mode: 'fly' as never, quality: 'ultra' as never, selectedId: 'ghost' });
    expect(store.getState().ui).toMatchObject({ mode: 'grab', quality: 'low', selectedId: null });
  });

  it('validates camera poses and titles', () => {
    const store = createStore();
    store.setCamera({ position: [1, 2, 3], target: [0, 1, 0] });
    expect(store.getState().camera).toEqual({ position: [1, 2, 3], target: [0, 1, 0] });
    const cam = store.getState().camera;
    store.setCamera({ position: [Number.NaN, 2, 3], target: [0, 1, 0] });
    store.setCamera({ position: [0, 1, 0], target: [0, 1, 0] });
    store.setCamera({ position: [1e9, 1, 0], target: [0, 1, 0] });
    store.setCamera(null as never);
    expect(store.getState().camera).toBe(cam);
    store.setTitle('x'.repeat(100));
    expect(store.getState().title).toHaveLength(60);
    store.setTitle('a\u0000b‮ c');
    expect(store.getState().title).toBe('a b c');
  });
});

describe('dancers', () => {
  it('adds with defaults, places on free spots, selects, and stops at the limit', () => {
    const store = createStore();
    const ids = new Set<string>();
    for (let i = 0; i < MAX_DANCERS; i++) {
      const d = store.addDancer({ ...A, speed: 2 })!;
      expect(d).not.toBeNull();
      expect(d.speed).toBe(2);
      expect(d.scale).toBe(1);
      expect(store.getState().ui.selectedId).toBe(d.id);
      ids.add(d.id);
    }
    expect(ids.size).toBe(MAX_DANCERS);
    const ds = store.getState().dancers;
    expect(ds[0]).toMatchObject({ x: 0, z: 0 });
    for (let i = 0; i < ds.length; i++)
      for (let j = i + 1; j < ds.length; j++) expect(Math.hypot(ds[i].x - ds[j].x, ds[i].z - ds[j].z)).toBeGreaterThanOrEqual(1.29);
    const state = store.getState();
    expect(store.addDancer(A)).toBeNull();
    expect(store.cloneDancer(ds[0].id)).toBeNull();
    expect(store.getState()).toBe(state);
  });

  it('honours explicit x and z (clamped) and ignores a supplied id', () => {
    const store = createStore();
    const d = store.addDancer({ ...A, x: 2, z: -99, id: 'mine' })!;
    expect(d).toMatchObject({ x: 2, z: -6 });
    expect(d.id).not.toBe('mine');
    const e = store.addDancer({ ...A, x: 2 })!;
    expect(e).toMatchObject({ x: 0, z: 0 });
    const f = store.addDancer({ characterId: '../../etc', danceId: A.danceId })!;
    expect(f.characterId).toBe(FALLBACK_CHARACTER_ID);
  });

  it('generates unique ids even when the generator repeats', () => {
    let n = 0;
    const store = createStore({ generateId: () => (n++ < 3 ? 'same' : `id${n}`) });
    const a = store.addDancer(A)!;
    const b = store.addDancer(A)!;
    expect(a.id).toBe('same');
    expect(b.id).not.toBe('same');
  });

  it('clones every setting beside the original and selects the copy', () => {
    const store = createStore();
    const a = store.addDancer(A)!;
    store.updateDancer(a.id, { speed: 2, tint: '#123456', warpMode: 'pulse', rotation: 30, mirror: true, shine: 0.3 });
    const orig = store.getState().dancers[0];
    const c = store.cloneDancer(a.id)!;
    expect(c.id).not.toBe(a.id);
    const { id: _a, x: _x, z: _z, ...rest } = orig;
    expect(c).toMatchObject(rest);
    expect(c.x).toBeCloseTo(orig.x + 1.4);
    expect(c.z).toBe(orig.z);
    expect(store.getState().ui.selectedId).toBe(c.id);
    expect(store.cloneDancer('missing')).toBeNull();
  });

  it('removes and clears, repairing the selection', () => {
    const store = createStore();
    const a = store.addDancer(A)!;
    const b = store.addDancer(A)!;
    store.select(a.id);
    store.removeDancer(b.id);
    expect(store.getState().ui.selectedId).toBe(a.id);
    store.removeDancer(a.id);
    expect(store.getState().ui.selectedId).toBeNull();
    store.addDancer(A);
    store.clearDancers();
    expect(store.getState().dancers).toEqual([]);
    expect(store.getState().ui.selectedId).toBeNull();
  });
});

describe('history', () => {
  it('records one step per non-transient change and undoes/redoes dancers and scene', () => {
    const store = createStore();
    const a = store.addDancer(A)!;
    store.updateDancer(a.id, { speed: 2 });
    store.updateScene({ fog: 0.7 });
    store.updateAudio({ volume: 0.1 });
    store.setTitle('t');
    store.updateUi({ uiHidden: true });
    store.undo();
    expect(store.getState().scene.fog).toBe(SCENE_DEFAULTS.fog);
    expect(store.getState().audio.volume).toBe(0.1);
    expect(store.getState().title).toBe('t');
    store.undo();
    expect(store.getState().dancers[0].speed).toBe(1);
    store.undo();
    expect(store.getState().dancers).toHaveLength(0);
    expect(store.canUndo()).toBe(false);
    store.redo();
    store.redo();
    store.redo();
    expect(store.getState().dancers[0].speed).toBe(2);
    expect(store.getState().scene.fog).toBe(0.7);
    expect(store.canRedo()).toBe(false);
  });

  it('collapses a transient gesture into one step on commit', () => {
    const store = createStore();
    const a = store.addDancer(A)!;
    for (let i = 1; i <= 10; i++) store.updateDancer(a.id, { x: i * 0.1 }, { transient: true });
    expect(store.getState().dancers[0].x).toBeCloseTo(1);
    store.commit();
    store.undo();
    expect(store.getState().dancers[0].x).toBe(0);
    store.undo();
    expect(store.getState().dancers).toHaveLength(0);
  });

  it('commits a pending gesture before a non-transient change, undo or redo', () => {
    const store = createStore();
    store.updateScene({ fog: 0.4 }, { transient: true });
    store.updateScene({ fog: 0.5 }, { transient: true });
    store.updateScene({ brightness: 1.5 });
    store.undo();
    expect(store.getState().scene).toMatchObject({ fog: 0.5, brightness: 1 });
    store.undo();
    expect(store.getState().scene.fog).toBe(SCENE_DEFAULTS.fog);
    store.redo();
    store.updateScene({ exposure: 2 }, { transient: true });
    store.undo(); // commits the gesture, then undoes it
    expect(store.getState().scene).toMatchObject({ fog: 0.5, exposure: 1 });
  });

  it('a gesture that ends where it started records nothing', () => {
    const store = createStore();
    store.updateScene({ fog: 0.9 }, { transient: true });
    store.updateScene({ fog: SCENE_DEFAULTS.fog }, { transient: true });
    store.commit();
    expect(store.canUndo()).toBe(false);
  });

  it('clears redo on a new change', () => {
    const store = createStore();
    store.updateScene({ fog: 0.4 });
    store.undo();
    expect(store.canRedo()).toBe(true);
    store.updateScene({ fog: 0.6 });
    expect(store.canRedo()).toBe(false);
    store.updateScene({ fog: 0.7 });
    store.undo();
    store.updateScene({ fog: 0.1 }, { transient: true });
    store.commit();
    expect(store.canRedo()).toBe(false);
  });

  it('is capped at HISTORY_LIMIT', () => {
    const store = createStore();
    for (let i = 0; i <= HISTORY_LIMIT + 20; i++) store.updateScene({ strobeBpm: 30 + i });
    let n = 0;
    while (store.canUndo()) {
      store.undo();
      n++;
    }
    expect(n).toBe(HISTORY_LIMIT);
    expect(store.getState().scene.strobeBpm).toBe(30 + 20);
  });

  it('drops a selection that no longer exists after undo', () => {
    const store = createStore();
    const a = store.addDancer(A)!;
    expect(store.getState().ui.selectedId).toBe(a.id);
    store.undo();
    expect(store.getState().ui.selectedId).toBeNull();
    store.redo();
    expect(store.getState().dancers[0].id).toBe(a.id);
  });

  it('loadDocument replaces the scene, keeps volume/mute and UI prefs, clears selection and history', () => {
    const store = createStore();
    const a = store.addDancer(A)!;
    store.updateAudio({ volume: 0.3, muted: true });
    store.updateUi({ quality: 'high' });
    const doc = store.getDocument();
    doc.title = 'Loaded';
    doc.dancers.push({ ...doc.dancers[0], id: 'other', x: 3 });
    doc.audio = { songId: null, beatSync: false };
    doc.scene.fog = 0.9;
    doc.camera = { position: [5, 5, 5], target: [0, 0, 0] };
    store.loadDocument(doc);
    const s = store.getState();
    expect(s.title).toBe('Loaded');
    expect(s.dancers.map((d) => d.id)).toEqual([a.id, 'other']);
    expect(s.audio).toEqual({ volume: 0.3, muted: true, songId: null, beatSync: false });
    expect(s.ui).toMatchObject({ quality: 'high', selectedId: null });
    expect(s.scene.fog).toBe(0.9);
    expect(s.camera.position).toEqual([5, 5, 5]);
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
    store.loadDocument({ garbage: true } as never);
    expect(store.getState().dancers).toEqual([]);
  });

  it('getDocument returns an independent copy', () => {
    const store = createStore();
    store.addDancer(A);
    const doc = store.getDocument();
    expect(doc.version).toBe(1);
    doc.dancers[0].x = 99;
    doc.scene.fog = 0;
    doc.camera.position[0] = 42;
    const s = store.getState();
    expect(s.dancers[0].x).toBe(0);
    expect(s.scene.fog).toBe(SCENE_DEFAULTS.fog);
    expect(s.camera.position[0]).toBe(0);
  });
});

describe('listeners', () => {
  it('receive (state, previous) synchronously in subscription order and can unsubscribe', () => {
    const store = createStore();
    const log: string[] = [];
    let prevSeen: AppState | null = null;
    const before = store.getState();
    store.subscribe((s, p) => {
      log.push('a');
      prevSeen = p;
      expect(s).toBe(store.getState());
    });
    const off = store.subscribe(() => log.push('b'));
    store.updateScene({ fog: 0.5 });
    expect(log).toEqual(['a', 'b']);
    expect(prevSeen).toBe(before);
    off();
    off();
    store.updateScene({ fog: 0.6 });
    expect(log).toEqual(['a', 'b', 'a']);
  });

  it('deliver re-entrant changes after the current notification, in order', () => {
    const store = createStore();
    const log: string[] = [];
    store.subscribe((s, p) => {
      log.push(`1:${p.scene.fog}->${s.scene.fog}`);
      if (s.scene.fog === 0.5) store.updateScene({ fog: 0.6 });
    });
    store.subscribe((s, p) => log.push(`2:${p.scene.fog}->${s.scene.fog}`));
    store.updateScene({ fog: 0.5 });
    expect(log).toEqual(['1:0.2->0.5', '2:0.2->0.5', '1:0.5->0.6', '2:0.5->0.6']);
    expect(store.getState().scene.fog).toBe(0.6);
  });

  it('a throwing listener does not stop the others', () => {
    const store = createStore();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log: string[] = [];
    store.subscribe(() => {
      throw new Error('boom');
    });
    store.subscribe(() => log.push('ok'));
    store.updateScene({ fog: 0.5 });
    expect(log).toEqual(['ok']);
    expect(err).toHaveBeenCalled();
    store.updateScene({ fog: 0.4 });
    expect(log).toEqual(['ok', 'ok']);
  });
});
