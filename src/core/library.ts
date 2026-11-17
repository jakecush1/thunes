/**
 * Saved scenes, kept in a single localStorage entry. Newest first, capped,
 * tolerant of missing or corrupted storage, and sanitised on read.
 */

import type { SavedScene, SceneDocument, SceneLibrary } from '../types';
import { createEmitter } from './emitter';
import { sanitizeDocument } from './serialize';
import { cleanTitle, isRecord } from './validate';

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SceneLibraryOptions {
  /** Default: window.localStorage, resolved lazily; in-memory only when unavailable. */
  storage?: KeyValueStorage;
  /** Storage key. Default LIBRARY_KEY. */
  key?: string;
  /** Clock in epoch milliseconds. Default Date.now. */
  now?: () => number;
  /** Maximum number of saved scenes; the oldest are dropped. Default 50. */
  maxEntries?: number;
}

export const LIBRARY_KEY = 'thunes.scenes.v1';
export const LIBRARY_MAX_ENTRIES = 50;
/** Longest accepted thumbnail data URL, characters (~200 kB). */
export const MAX_THUMBNAIL_LENGTH = 200_000;

const SAVED_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Resolves window.localStorage without throwing (it can throw in private mode or sandboxed frames). */
export function defaultStorage(): KeyValueStorage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

function validThumbnail(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/') && value.length <= MAX_THUMBNAIL_LENGTH;
}

function cloneEntry(e: SavedScene): SavedScene {
  return { ...e, document: sanitizeDocument(e.document) };
}

function parseEntries(text: string | null, max: number): SavedScene[] {
  if (!text) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const list = isRecord(raw) && Array.isArray(raw.entries) ? raw.entries : [];
  const out: SavedScene[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (out.length >= max) break;
    if (!isRecord(item)) continue;
    const { id, savedAt, thumbnail } = item;
    if (typeof id !== 'string' || !SAVED_ID_RE.test(id) || seen.has(id)) continue;
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) continue;
    if (!validThumbnail(thumbnail)) continue;
    seen.add(id);
    out.push({ id, title: cleanTitle(item.title), savedAt, thumbnail, document: sanitizeDocument(item.document) });
  }
  out.sort((a, b) => b.savedAt - a.savedAt);
  return out;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Creates the saved-scene library. Never throws at construction. */
export function createSceneLibrary(options: SceneLibraryOptions = {}): SceneLibrary {
  const key = options.key ?? LIBRARY_KEY;
  const now = options.now ?? Date.now;
  const max = Math.max(1, Math.floor(options.maxEntries ?? LIBRARY_MAX_ENTRIES));
  const changed = createEmitter<void>();
  let storage: KeyValueStorage | null | undefined = options.storage;
  let entries: SavedScene[] | null = null;

  function getStorage(): KeyValueStorage | null {
    if (storage === undefined) storage = defaultStorage();
    return storage;
  }

  function load(): SavedScene[] {
    if (entries) return entries;
    let text: string | null = null;
    try {
      text = getStorage()?.getItem(key) ?? null;
    } catch {
      text = null;
    }
    entries = parseEntries(text, max);
    return entries;
  }

  /** Writes `next`; on failure throws a readable Error and keeps the previous contents. */
  function write(next: SavedScene[]): void {
    const s = getStorage();
    if (s) {
      try {
        s.setItem(key, JSON.stringify({ version: 1, entries: next }));
      } catch (err) {
        const quota =
          err instanceof Error &&
          (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(err.message));
        throw new Error(
          quota
            ? 'Not enough browser storage to save this scene. Delete some saved scenes and try again.'
            : 'This browser would not let the scene be saved (storage is unavailable).',
        );
      }
    }
    entries = next;
    changed.emit();
  }

  return {
    list() {
      return load().map(cloneEntry);
    },

    save(entry: { title: string; thumbnail: string; document: SceneDocument; id?: string }) {
      if (!validThumbnail(entry.thumbnail)) {
        throw new Error('The scene preview image is missing or too large.');
      }
      const current = load();
      const id = typeof entry.id === 'string' && SAVED_ID_RE.test(entry.id) ? entry.id : uniqueId(current);
      const saved: SavedScene = {
        id,
        title: cleanTitle(entry.title),
        savedAt: now(),
        thumbnail: entry.thumbnail,
        document: sanitizeDocument(entry.document),
      };
      const next = [saved, ...current.filter((e) => e.id !== id)].slice(0, max);
      write(next);
      return cloneEntry(saved);
    },

    remove(id: string) {
      const current = load();
      if (!current.some((e) => e.id === id)) return;
      write(current.filter((e) => e.id !== id));
    },

    subscribe(listener) {
      return changed.on(listener);
    },
  };

  function uniqueId(current: SavedScene[]): string {
    let id = randomId();
    while (current.some((e) => e.id === id)) id = randomId();
    return id;
  }
}
