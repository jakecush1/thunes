/**
 * Pure validation helpers shared by the store and the serializer.
 *
 * Every function here treats its input as untrusted: only known own keys are
 * read, numbers are clamped to the ranges in config.ts, enums and colours are
 * checked, and invalid values are ignored (patches) or replaced by defaults
 * (documents).
 */

import {
  AUDIO_FIELDS,
  DANCER_DEFAULTS,
  DANCER_FIELDS,
  DANCER_LOOK_FIELDS,
  DEFAULT_CAMERA,
  MIN_TRIM_SPAN,
  SCENE_FIELDS,
  type NumberField,
} from '../config';
import type {
  AudioSettings,
  Axis,
  CameraPose,
  DancerSettings,
  DancerState,
  FloorStyle,
  InteractionMode,
  Quality,
  SceneSettings,
  UiState,
  WarpMode,
} from '../types';

/** Asset ids (characters, dances, songs, background presets) must match this. */
export const ASSET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,95}$/;
/** Dancer ids must match this. */
export const DANCER_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
/** '#rrggbb', any case. */
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
/** Maximum title length in characters (after cleaning). */
export const MAX_TITLE_LENGTH = 60;
/** Default scene title. */
export const DEFAULT_TITLE = '';
/** Largest absolute camera coordinate accepted, metres. */
export const MAX_CAMERA_COORD = 500;

/** Returned by validators to mean "ignore this value". */
export const SKIP: unique symbol = Symbol('skip');
export type Skip = typeof SKIP;
export type Validator<V> = (value: unknown) => V | Skip;

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** True for non-null objects that are not arrays. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Clamps a finite number into [min, max]; returns SKIP for anything else. Normalises -0 to 0. */
export function clampNumber(value: unknown, min: number, max: number): number | Skip {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SKIP;
  const v = value < min ? min : value > max ? max : value;
  return v === 0 ? 0 : v;
}

/** Validator for a config.ts number field. */
export function numberField(field: NumberField): Validator<number> {
  return (v) => clampNumber(v, field.min, field.max);
}

/** Wraps degrees into [-180, 180]; values already inside the range are kept as they are. */
export function wrapDegrees(deg: number): number {
  if (deg >= -180 && deg <= 180) return deg === 0 ? 0 : deg;
  const w = ((((deg + 180) % 360) + 360) % 360) - 180;
  return w === 0 ? 0 : w;
}

/** Normalises '#RRGGBB' to lower case; SKIP for anything else. */
export function normalizeColor(value: unknown): string | Skip {
  return typeof value === 'string' && COLOR_RE.test(value) ? value.toLowerCase() : SKIP;
}

const nullableColor: Validator<string | null> = (v) => (v === null ? null : normalizeColor(v));
const bool: Validator<boolean> = (v) => (typeof v === 'boolean' ? v : SKIP);
const assetId: Validator<string> = (v) => (typeof v === 'string' && ASSET_ID_RE.test(v) ? v : SKIP);
const nullableAssetId: Validator<string | null> = (v) => (v === null ? null : assetId(v));
function oneOf<T extends string | number>(values: readonly T[]): Validator<T> {
  return (v) => ((values as readonly unknown[]).includes(v) ? (v as T) : SKIP);
}
function nullableNumber(field: NumberField): Validator<number | null> {
  return (v) => (v === null ? null : clampNumber(v, field.min, field.max));
}

/** Validates an asset id; returns null when invalid. */
export function validAssetId(value: unknown): string | null {
  const v = assetId(value);
  return v === SKIP ? null : v;
}

type Validators<T> = { [K in keyof T]?: Validator<T[K]> };

/**
 * Applies the validated subset of `patch` to `current`.
 * Returns `current` itself when nothing changes; `touched` lists the keys
 * that carried a valid value (changed or not).
 */
export function applyPatch<T extends object>(
  current: T,
  patch: unknown,
  validators: Validators<T>,
  touched?: Set<string>,
): T {
  if (!isRecord(patch)) return current;
  let out: T | null = null;
  for (const key in validators) {
    if (!hasOwn(validators, key) || !hasOwn(patch, key)) continue;
    const raw = patch[key];
    if (raw === undefined) continue;
    const validator = validators[key] as Validator<T[typeof key]>;
    const value = validator(raw);
    if (value === SKIP) continue;
    touched?.add(key);
    if (value !== current[key]) {
      out ??= { ...current };
      out[key] = value;
    }
  }
  return out ?? current;
}

const AXES: readonly Axis[] = ['x', 'y', 'z'];
const WARP_MODES: readonly WarpMode[] = ['wave', 'pulse'];
const FLOOR_STYLES: readonly FloorStyle[] = ['grid', 'checker', 'tiles', 'none'];
const MODES: readonly InteractionMode[] = ['look', 'grab', 'both'];
const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

/** Validators for every editable dancer field (identity `id` excluded). */
export const DANCER_VALIDATORS: Validators<DancerState> = {
  characterId: assetId,
  danceId: assetId,
  x: numberField(DANCER_FIELDS.x),
  z: numberField(DANCER_FIELDS.z),
  y: numberField(DANCER_FIELDS.y),
  rotation: (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return SKIP;
    return wrapDegrees(v);
  },
  scale: numberField(DANCER_FIELDS.scale),
  speed: numberField(DANCER_FIELDS.speed),
  offset: numberField(DANCER_FIELDS.offset),
  trimStart: numberField(DANCER_FIELDS.trimStart),
  trimEnd: numberField(DANCER_FIELDS.trimEnd),
  mirror: bool,
  shine: nullableNumber(DANCER_LOOK_FIELDS.shine),
  metal: nullableNumber(DANCER_LOOK_FIELDS.metal),
  tint: nullableColor,
  headSize: numberField(DANCER_FIELDS.headSize),
  handSize: numberField(DANCER_FIELDS.handSize),
  footSize: numberField(DANCER_FIELDS.footSize),
  shakeBody: numberField(DANCER_FIELDS.shakeBody),
  shakeArms: numberField(DANCER_FIELDS.shakeArms),
  shakeNeck: numberField(DANCER_FIELDS.shakeNeck),
  shakeSpeed: numberField(DANCER_FIELDS.shakeSpeed),
  warpAmount: numberField(DANCER_FIELDS.warpAmount),
  warpSpeed: numberField(DANCER_FIELDS.warpSpeed),
  warpWaves: numberField(DANCER_FIELDS.warpWaves),
  warpMode: oneOf(WARP_MODES),
  warpAlong: oneOf(AXES),
  warpEffect: oneOf(AXES),
};

/** Keys of DancerSettings (useful for copying settings). */
export const DANCER_SETTING_KEYS = Object.keys(DANCER_DEFAULTS) as (keyof DancerSettings)[];

/**
 * Patches a dancer: validates/clamps every field, then keeps
 * trimEnd - trimStart >= MIN_TRIM_SPAN by moving the trim field that was not
 * in the patch (trimEnd when both or neither were patched).
 * Returns `current` when nothing changes.
 */
export function applyDancerPatch(current: DancerState, patch: unknown): DancerState {
  const touched = new Set<string>();
  let next = applyPatch(current, patch, DANCER_VALIDATORS, touched);
  if (next.trimEnd - next.trimStart < MIN_TRIM_SPAN - 1e-9) {
    const moveStart = touched.has('trimEnd') && !touched.has('trimStart');
    next = next === current ? { ...current } : next;
    if (moveStart) {
      next.trimStart = Math.max(DANCER_FIELDS.trimStart.min, next.trimEnd - MIN_TRIM_SPAN);
    } else {
      next.trimEnd = Math.min(DANCER_FIELDS.trimEnd.max, next.trimStart + MIN_TRIM_SPAN);
    }
    if (next.trimStart === current.trimStart && next.trimEnd === current.trimEnd && shallowEqual(next, current)) return current;
  }
  return next;
}

/** Validators for scene settings. */
export const SCENE_VALIDATORS: Validators<SceneSettings> = {
  background: assetId,
  backgroundColor: normalizeColor,
  floorStyle: oneOf(FLOOR_STYLES),
  floorColor: nullableColor,
  brightness: numberField(SCENE_FIELDS.brightness),
  exposure: numberField(SCENE_FIELDS.exposure),
  fog: numberField(SCENE_FIELDS.fog),
  strobeIntensity: numberField(SCENE_FIELDS.strobeIntensity),
  strobeBpm: numberField(SCENE_FIELDS.strobeBpm),
  strobeSync: bool,
  strobeDivision: oneOf<1 | 2 | 4>([1, 2, 4]),
  cameraLoop: bool,
  cameraLoopPeriod: numberField(SCENE_FIELDS.cameraLoopPeriod),
  cameraLoopHeight: numberField(SCENE_FIELDS.cameraLoopHeight),
  cameraLoopTargetHeight: numberField(SCENE_FIELDS.cameraLoopTargetHeight),
  cameraLoopDistance: numberField(SCENE_FIELDS.cameraLoopDistance),
};

/** Validators for audio settings. */
export const AUDIO_VALIDATORS: Validators<AudioSettings> = {
  songId: nullableAssetId,
  muted: bool,
  volume: numberField(AUDIO_FIELDS.volume),
  beatSync: bool,
};

/** Validators for UI state, except selectedId (which needs the dancer list). */
export const UI_VALIDATORS: Validators<UiState> = {
  mode: oneOf(MODES),
  quality: oneOf(QUALITIES),
  uiHidden: bool,
  entered: bool,
  strobeAllowed: bool,
  viewOnly: bool,
};

/** Validators for prefs-like enums, exported for reuse. */
export const validateMode: Validator<InteractionMode> = oneOf(MODES);
export const validateQuality: Validator<Quality> = oneOf(QUALITIES);

/**
 * Cleans a title: strips control characters, collapses whitespace, trims and
 * cuts to MAX_TITLE_LENGTH characters (code points). Non-strings give DEFAULT_TITLE.
 */
export function cleanTitle(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_TITLE;
  // Bound the work on hostile input before running regexes over it.
  const s = value.length > 4096 ? value.slice(0, 4096) : value;
  const cleaned = s
    // C0/C1 controls, bidi overrides/isolates, zero-width and BOM characters.
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(cleaned);
  return chars.length > MAX_TITLE_LENGTH ? chars.slice(0, MAX_TITLE_LENGTH).join('').trim() : cleaned;
}

function readVec3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const n: unknown = value[i];
    if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > MAX_CAMERA_COORD) return null;
    out[i] = n === 0 ? 0 : n;
  }
  return out;
}

/**
 * Validates a camera pose: finite coordinates within MAX_CAMERA_COORD and
 * position at least 1 cm from target. Returns a fresh pose, or null when invalid.
 */
export function sanitizeCamera(value: unknown): CameraPose | null {
  if (!isRecord(value)) return null;
  const position = readVec3(value.position);
  const target = readVec3(value.target);
  if (!position || !target) return null;
  const d = Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]);
  if (!(d >= 0.01)) return null;
  return { position, target };
}

/** A fresh copy of DEFAULT_CAMERA. */
export function defaultCamera(): CameraPose {
  return { position: [...DEFAULT_CAMERA.position], target: [...DEFAULT_CAMERA.target] };
}

/** Compares two camera poses by value. */
export function cameraEqual(a: CameraPose, b: CameraPose): boolean {
  for (let i = 0; i < 3; i++) {
    if (a.position[i] !== b.position[i] || a.target[i] !== b.target[i]) return false;
  }
  return true;
}

/** Shallow equality of two plain objects with the same key set. */
export function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  }
  return true;
}

/** Element-wise shallow equality of two dancer lists. */
export function dancersEqual(a: readonly DancerState[], b: readonly DancerState[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!shallowEqual(a[i], b[i])) return false;
  return true;
}
