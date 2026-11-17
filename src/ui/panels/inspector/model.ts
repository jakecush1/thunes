/**
 * Pure data for the dancer inspector: which settings each tab owns, what a
 * tab reset restores, and which dances the quick chooser shows.
 * No DOM here, so it is unit-tested in Node.
 */
import { DANCER_DEFAULTS, DANCER_FIELDS } from '../../../config';
import type { NumberField } from '../../../config';
import type { DancerSettings } from '../../../types';

export type InspectorTab = 'dance' | 'move' | 'motion' | 'look' | 'body' | 'warp';
export type NumericDancerKey = keyof typeof DANCER_FIELDS;

/** One slider row: which setting it edits and how it is labelled. */
export interface SliderSpec {
  key: NumericDancerKey;
  label: string;
  field: NumberField;
}

const slider = (key: NumericDancerKey, label: string): SliderSpec => ({ key, label, field: DANCER_FIELDS[key] });

/** Slider rows per tab, in display order. `group` starts a sub-heading. */
export const MOVE_SLIDERS: readonly SliderSpec[] = [
  slider('rotation', 'Rotation'),
  slider('scale', 'Scale'),
  slider('x', 'Left / right'),
  slider('z', 'Back / front'),
  slider('y', 'Height'),
];
export const MOTION_SLIDERS: readonly SliderSpec[] = [
  slider('speed', 'Speed'),
  slider('offset', 'Phase offset'),
  slider('trimStart', 'Trim start'),
  slider('trimEnd', 'Trim end'),
];
export const BODY_SIZE_SLIDERS: readonly SliderSpec[] = [slider('headSize', 'Head'), slider('handSize', 'Hands'), slider('footSize', 'Feet')];
export const BODY_SHAKE_SLIDERS: readonly SliderSpec[] = [
  slider('shakeBody', 'Body'),
  slider('shakeArms', 'Arms'),
  slider('shakeNeck', 'Neck'),
  slider('shakeSpeed', 'Shake speed'),
];
export const WARP_SLIDERS: readonly SliderSpec[] = [slider('warpAmount', 'Amount'), slider('warpSpeed', 'Speed'), slider('warpWaves', 'Waves')];

/**
 * Settings each tab's reset restores. Move keeps the floor position (x/z):
 * resetting it would stack every dancer on the centre spot.
 */
export const TAB_RESET_KEYS: Record<Exclude<InspectorTab, 'dance'>, readonly (keyof DancerSettings)[]> = {
  move: ['rotation', 'scale', 'y'],
  motion: ['speed', 'offset', 'trimStart', 'trimEnd', 'mirror'],
  look: ['shine', 'metal', 'tint'],
  body: ['headSize', 'handSize', 'footSize', 'shakeBody', 'shakeArms', 'shakeNeck', 'shakeSpeed'],
  warp: ['warpAmount', 'warpSpeed', 'warpWaves', 'warpMode', 'warpAlong', 'warpEffect'],
};

/** The patch that puts a tab's settings back to DANCER_DEFAULTS. */
export function resetPatch(tab: Exclude<InspectorTab, 'dance'>): Partial<DancerSettings> {
  const patch: Partial<DancerSettings> = {};
  const target = patch as Record<keyof DancerSettings, unknown>;
  for (const key of TAB_RESET_KEYS[tab]) target[key] = DANCER_DEFAULTS[key];
  return patch;
}

/** True when every setting of the tab already equals its default (the reset button is then disabled). */
export function isTabAtDefaults(tab: Exclude<InspectorTab, 'dance'>, dancer: DancerSettings): boolean {
  return TAB_RESET_KEYS[tab].every((key) => Object.is(dancer[key], DANCER_DEFAULTS[key]));
}

/**
 * The dances the inspector's quick chooser shows: the first `count` of the
 * catalogue, with the current dance guaranteed to be among the first `visible`
 * (the desktop panel shows fewer cards than the phone sheet).
 */
export function danceShortlist<T extends { id: string }>(dances: readonly T[], currentId: string | null, count: number, visible = count): T[] {
  const list = dances.slice(0, count);
  if (currentId === null) return list;
  const index = list.findIndex((d) => d.id === currentId);
  if (index >= 0 && index < visible) return list;
  const current = dances.find((d) => d.id === currentId);
  if (!current) return list;
  const rest = list.filter((d) => d.id !== currentId);
  return [current, ...rest].slice(0, count);
}

/** "8 beats", "120 bpm" or '' — the note next to the dance name. */
export function danceNote(dance: { bpm?: number; beats?: number } | undefined): string {
  if (!dance) return '';
  if (dance.beats) return `${dance.beats} beats`;
  if (dance.bpm) return `${Math.round(dance.bpm)} bpm`;
  return '';
}

/** Tint presets (the first, 'none', keeps the character's own colours). */
export const TINT_PRESETS: readonly { value: string; name: string; swatch: string }[] = [
  { value: 'none', name: 'Original colours', swatch: 'linear-gradient(135deg, #f1ecff 0 48%, #8f88b8 52% 100%)' },
  { value: '#19cdb8', name: 'Teal', swatch: '#19cdb8' },
  { value: '#ff7a5c', name: 'Coral', swatch: '#ff7a5c' },
  { value: '#ffc13d', name: 'Amber', swatch: '#ffc13d' },
  { value: '#b08cff', name: 'Violet', swatch: '#b08cff' },
  { value: '#4aa8ff', name: 'Sky', swatch: '#4aa8ff' },
  { value: '#ff7ac8', name: 'Bubblegum', swatch: '#ff7ac8' },
  { value: '#b6f24a', name: 'Lime', swatch: '#b6f24a' },
];
