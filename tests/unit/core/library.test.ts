import { describe, expect, it, vi } from 'vitest';
import { createEmitter } from '../../../src/core/emitter';
import { LIBRARY_KEY, MAX_THUMBNAIL_LENGTH, createSceneLibrary, type KeyValueStorage } from '../../../src/core/library';
import { PREFS_KEY, defaultPrefs, loadPrefs, savePrefs } from '../../../src/core/prefs';
import { emptyDocument } from '../../../src/core/serialize';

class FakeStorage implements KeyValueStorage {
  data = new Map<string, string>();
  quota = Infinity;
  writes = 0;
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (v.length > this.quota) {
      const e = new Error('The quota has been exceeded.');
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.writes++;
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

const THUMB = 'data:image/jpeg;base64,AAAA';

function setup(opts: { maxEntries?: number } = {}) {
  const storage = new FakeStorage();
  let t = 1000;
  const lib = createSceneLibrary({ storage, now: () => ++t, ...opts });
  return { storage, lib };
}

function doc(title: string) {
  return { ...emptyDocument(), title };
}

describe('scene library', () => {
  it('saves, lists newest first, overwrites by id and removes', () => {
    const { storage, lib } = setup();
    expect(lib.list()).toEqual([]);
    const a = lib.save({ title: 'A', thumbnail: THUMB, document: doc('A') });
    const b = lib.save({ title: 'B', thumbnail: THUMB, document: doc('B') });
    expect(lib.list().map((e) => e.title)).toEqual(['B', 'A']);
    expect(a.id).not.toBe(b.id);
    expect(a.savedAt).toBeLessThan(b.savedAt);
    const a2 = lib.save({ id: a.id, title: 'A2', thumbnail: THUMB, document: doc('A2') });
    expect(a2.id).toBe(a.id);
    expect(lib.list().map((e) => e.title)).toEqual(['A2', 'B']);
    // Persisted and readable by a fresh instance.
    const again = createSceneLibrary({ storage });
    expect(again.list().map((e) => e.title)).toEqual(['A2', 'B']);
    lib.remove(b.id);
    lib.remove('missing');
    expect(lib.list().map((e) => e.id)).toEqual([a.id]);
    expect(storage.data.has(LIBRARY_KEY)).toBe(true);
  });

  it('returns independent copies and sanitises titles and documents', () => {
    const { lib } = setup();
    lib.save({ title: ' hi\n there ', thumbnail: THUMB, document: { ...doc('x'), scene: { ...emptyDocument().scene, fog: 50 } } });
    const first = lib.list()[0];
    expect(first.title).toBe('hi there');
    expect(first.document.scene.fog).toBe(1);
    first.document.title = 'mutated';
    expect(lib.list()[0].document.title).toBe('x');
  });

  it('caps the number of entries, dropping the oldest', () => {
    const { lib } = setup({ maxEntries: 3 });
    for (let i = 0; i < 5; i++) lib.save({ title: `S${i}`, thumbnail: THUMB, document: doc('') });
    expect(lib.list().map((e) => e.title)).toEqual(['S4', 'S3', 'S2']);
    const { lib: big } = setup();
    for (let i = 0; i < 60; i++) big.save({ title: `S${i}`, thumbnail: THUMB, document: doc('') });
    expect(big.list()).toHaveLength(50);
  });

  it('rejects bad thumbnails', () => {
    const { lib } = setup();
    expect(() => lib.save({ title: 'x', thumbnail: 'https://evil/x.jpg', document: doc('') })).toThrow(/preview/);
    expect(() => lib.save({ title: 'x', thumbnail: 'data:text/html,<b>', document: doc('') })).toThrow(/preview/);
    expect(() => lib.save({ title: 'x', thumbnail: 'data:image/jpeg;base64,' + 'A'.repeat(MAX_THUMBNAIL_LENGTH), document: doc('') })).toThrow(/preview/);
    expect(lib.list()).toEqual([]);
  });

  it('tolerates corrupted or missing storage', () => {
    for (const bad of ['{not json', '42', '{"entries":"nope"}', '{"entries":[1,null,{"id":"x"}]}']) {
      const storage = new FakeStorage();
      storage.data.set(LIBRARY_KEY, bad);
      expect(createSceneLibrary({ storage }).list()).toEqual([]);
    }
    const storage = new FakeStorage();
    storage.data.set(
      LIBRARY_KEY,
      JSON.stringify({
        entries: [
          { id: 'ok', title: 'fine', savedAt: 5, thumbnail: THUMB, document: { title: 'd', dancers: 'x' } },
          { id: 'ok', title: 'dupe', savedAt: 9, thumbnail: THUMB, document: {} },
          { id: 'thumb', title: 't', savedAt: 9, thumbnail: 'javascript:x', document: {} },
          { id: 'newer', title: 'n', savedAt: 7, thumbnail: THUMB, document: null },
        ],
      }),
    );
    const list = createSceneLibrary({ storage }).list();
    expect(list.map((e) => e.id)).toEqual(['newer', 'ok']);
    expect(list[1].document.dancers).toEqual([]);
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => undefined,
    };
    const lib = createSceneLibrary({ storage: throwing });
    expect(lib.list()).toEqual([]);
    expect(() => lib.save({ title: 'x', thumbnail: THUMB, document: doc('') })).toThrow(/unavailable/);
  });

  it('never throws at construction when localStorage is inaccessible', () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      const lib = createSceneLibrary();
      expect(lib.list()).toEqual([]);
      const saved = lib.save({ title: 'mem', thumbnail: THUMB, document: doc('') });
      expect(lib.list()[0].id).toBe(saved.id);
      expect(loadPrefs()).toEqual(defaultPrefs());
    } finally {
      if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('throws a readable error on quota and keeps the previous contents', () => {
    const { storage, lib } = setup();
    lib.save({ title: 'keep', thumbnail: THUMB, document: doc('') });
    const before = storage.data.get(LIBRARY_KEY);
    storage.quota = 10;
    const listener = vi.fn();
    lib.subscribe(listener);
    expect(() => lib.save({ title: 'big', thumbnail: THUMB, document: doc('') })).toThrow(/Not enough browser storage/);
    expect(storage.data.get(LIBRARY_KEY)).toBe(before);
    expect(lib.list().map((e) => e.title)).toEqual(['keep']);
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies subscribers after every change', () => {
    const { lib } = setup();
    const listener = vi.fn();
    const off = lib.subscribe(listener);
    const a = lib.save({ title: 'a', thumbnail: THUMB, document: doc('') });
    lib.remove(a.id);
    lib.remove(a.id);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    lib.save({ title: 'b', thumbnail: THUMB, document: doc('') });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('prefs', () => {
  it('loads defaults, validates and merges', () => {
    const storage = new FakeStorage();
    expect(loadPrefs(storage)).toEqual(defaultPrefs());
    const p = savePrefs({ mode: 'grab', volume: 3, seenHints: { intro: true } }, storage);
    expect(p).toMatchObject({ mode: 'grab', volume: 1, seenHints: { intro: true } });
    savePrefs({ quality: 'nope' as never, muted: true, seenHints: { drag: true } }, storage);
    expect(loadPrefs(storage)).toEqual({ ...defaultPrefs(), mode: 'grab', volume: 1, muted: true, seenHints: { intro: true, drag: true } });
  });

  it('survives corrupted and hostile data', () => {
    const storage = new FakeStorage();
    storage.data.set(PREFS_KEY, '{oops');
    expect(loadPrefs(storage)).toEqual(defaultPrefs());
    storage.data.set(PREFS_KEY, '{"__proto__":{"x":1},"mode":"look","volume":"loud","seenHints":{"__proto__":true,"ok":true,"bad":"yes"}}');
    const p = loadPrefs(storage);
    expect(p.mode).toBe('look');
    expect(p.volume).toBe(defaultPrefs().volume);
    expect(p.seenHints).toEqual({ ok: true });
    expect(Object.getPrototypeOf(p.seenHints)).toBe(Object.prototype);
    const hints: Record<string, boolean> = {};
    for (let i = 0; i < 500; i++) hints[`h${i}`] = true;
    expect(Object.keys(savePrefs({ seenHints: hints }, storage).seenHints).length).toBeLessThanOrEqual(100);
    expect(savePrefs({ muted: true }, null).muted).toBe(true);
  });
});

describe('emitter', () => {
  it('emits in order, isolates throwing listeners, unsubscribes', () => {
    const e = createEmitter<number>();
    const log: number[] = [];
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    e.on(() => {
      throw new Error('x');
    });
    const off = e.on((v) => log.push(v));
    e.emit(1);
    off();
    e.emit(2);
    expect(log).toEqual([1]);
    expect(err).toHaveBeenCalledTimes(2);
    expect(e.size).toBe(1);
    e.clear();
    expect(e.size).toBe(0);
    err.mockRestore();
  });
});
