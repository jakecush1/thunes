/**
 * Per-device preferences that persist across sessions but are not part of a
 * scene. Stored as one JSON entry; every read is validated and falls back to
 * safe defaults, and no function here throws.
 */

import { AUDIO_DEFAULTS, AUDIO_FIELDS, UI_DEFAULTS } from '../config';
import type { InteractionMode, Quality } from '../types';
import { defaultStorage, type KeyValueStorage } from './library';
import { SKIP, clampNumber, isRecord, validateMode, validateQuality } from './validate';

export interface Prefs {
  mode: InteractionMode;
  quality: Quality;
  /** 0..1 */
  volume: number;
  muted: boolean;
  /** Hint id → seen. Ids match /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/; at most MAX_HINTS entries. */
  seenHints: Record<string, boolean>;
}

export const PREFS_KEY = 'thunes.prefs.v1';
export const MAX_HINTS = 100;
const HINT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** A fresh copy of the default preferences. */
export function defaultPrefs(): Prefs {
  return { mode: UI_DEFAULTS.mode, quality: UI_DEFAULTS.quality, volume: AUDIO_DEFAULTS.volume, muted: AUDIO_DEFAULTS.muted, seenHints: {} };
}

function mergeHints(target: Record<string, boolean>, value: unknown): void {
  if (!isRecord(value)) return;
  for (const k of Object.keys(value)) {
    if (!HINT_RE.test(k)) continue;
    const v = value[k];
    if (typeof v !== 'boolean') continue;
    if (!(k in target) && Object.keys(target).length >= MAX_HINTS) continue;
    target[k] = v;
  }
}

/** Applies the valid parts of `patch` to `base` (returns a new object). Unknown keys and invalid values are ignored. */
export function sanitizePrefs(patch: unknown, base: Prefs = defaultPrefs()): Prefs {
  const out: Prefs = { ...base, seenHints: { ...base.seenHints } };
  if (!isRecord(patch)) return out;
  const mode = validateMode(patch.mode);
  if (mode !== SKIP) out.mode = mode;
  const quality = validateQuality(patch.quality);
  if (quality !== SKIP) out.quality = quality;
  const volume = clampNumber(patch.volume, AUDIO_FIELDS.volume.min, AUDIO_FIELDS.volume.max);
  if (volume !== SKIP) out.volume = volume;
  if (typeof patch.muted === 'boolean') out.muted = patch.muted;
  mergeHints(out.seenHints, patch.seenHints);
  return out;
}

/** Reads preferences (default storage: localStorage, resolved safely). Missing or corrupted data gives defaults. */
export function loadPrefs(storage?: KeyValueStorage | null): Prefs {
  try {
    const s = storage === undefined ? defaultStorage() : storage;
    const text = s?.getItem(PREFS_KEY);
    return sanitizePrefs(text ? JSON.parse(text) : null);
  } catch {
    return defaultPrefs();
  }
}

/**
 * Merges `patch` into the stored preferences (seenHints entries are merged,
 * not replaced) and writes them back. Returns the resulting preferences;
 * storage failures are ignored.
 */
export function savePrefs(patch: Partial<Prefs>, storage?: KeyValueStorage | null): Prefs {
  const s = storage === undefined ? defaultStorage() : storage;
  const next = sanitizePrefs(patch, loadPrefs(s));
  try {
    s?.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Quota or private mode: preferences are a convenience, not critical.
  }
  return next;
}
