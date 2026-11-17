/**
 * Pure helpers for the scene drawer: preset groups, the pill summary and the
 * strobe warning wording.
 */
import type { BackgroundKind, BackgroundPreset } from '../../../stage/backgrounds';
import type { FloorStyle, SceneSettings } from '../../../types';

export const BACKDROP_GROUPS: readonly { kind: BackgroundKind; label: string }[] = [
  { kind: 'gradient', label: 'Gradients' },
  { kind: 'sky', label: 'Skies' },
  { kind: 'solid', label: 'Solids' },
];

/** Presets of one kind, in catalogue order. */
export function presetsOfKind(presets: readonly BackgroundPreset[], kind: BackgroundKind): BackgroundPreset[] {
  return presets.filter((p) => p.kind === kind);
}

export const FLOOR_LABELS: Record<FloorStyle, string> = { grid: 'Grid', checker: 'Checker', tiles: 'Tiles', none: 'None' };

/** What the floor colour swatches colour, per style. */
export const FLOOR_COLOR_LABELS: Record<FloorStyle, string> = {
  grid: 'Line colour',
  checker: 'Square colour',
  tiles: 'Tile colour',
  none: 'Floor colour',
};

/** Preset floor colours (lower-case hex; the store normalises colours to lower case). */
export const FLOOR_COLORS: readonly { value: string; name: string }[] = [
  { value: '#f3e9d2', name: 'Cream' },
  { value: '#f28a2e', name: 'Orange' },
  { value: '#d9553b', name: 'Red' },
  { value: '#e9b949', name: 'Mustard' },
  { value: '#6aa6d8', name: 'Sky' },
];

/** Swatch value standing for floorColor === null. */
export const AUTO_FLOOR = 'auto';

/** Pill second line: "Club Haze · grid floor · orbit on". */
export function sceneSummary(scene: SceneSettings, backdropName: string): string {
  const floor = scene.floorStyle === 'none' ? 'no floor' : `${scene.floorStyle} floor`;
  const parts = [backdropName, floor];
  if (scene.cameraLoop) parts.push('orbit on');
  if (scene.strobeIntensity > 0) parts.push('strobe');
  return parts.join(' · ');
}

/** The always-visible note under the strobe controls. */
export const STROBE_NOTE = 'Flashing light can trigger seizures in people with photosensitive epilepsy. Leave intensity at 0 if unsure.';

/** Body of the consent question. */
export function strobeConsentMessage(reducedMotion: boolean): string {
  const base =
    'The strobe flashes bright light across the whole screen. Flashing light can trigger seizures in people with photosensitive epilepsy. Only turn it on if everyone watching is comfortable with that.';
  return reducedMotion ? `${base} Your device is set to reduce motion, so you may prefer to keep it off.` : base;
}

/** Text of the non-blocking prompt shown when a loaded or shared scene has a strobe. */
export function strobePromptMessage(reducedMotion: boolean): string {
  return reducedMotion
    ? 'This scene has a strobe light. It stays off (your device asks for reduced motion) unless you allow flashing.'
    : 'This scene has a strobe light. It stays off until you allow flashing.';
}

/** Readout for 0..1 values shown as percentages. */
export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
