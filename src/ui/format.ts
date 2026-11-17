/**
 * Pure helpers for showing and parsing numbers in controls. Units and digits
 * come from the NumberField tables in config.ts.
 */
import type { NumberField } from '../config';

/** Units written straight after the number; every other unit gets a space ("1.2 m", "120 bpm"). */
const TIGHT_UNITS = new Set(['×', '°', '%', '']);

const MINUS = '\u2212';

/** Format a number with the field's digits and unit, e.g. 1.2 → "1.20×", -1.2 → "−1.20 m", 35 → "35°". */
export function formatValue(value: number, field: Pick<NumberField, 'unit' | 'digits'>): string {
  const digits = field.digits ?? 0;
  let text = (Number.isFinite(value) ? value : 0).toFixed(digits);
  // Avoid "-0.00" after rounding.
  if (/^-0(\.0*)?$/.test(text)) text = text.slice(1);
  if (text.startsWith('-')) text = MINUS + text.slice(1);
  const unit = field.unit ?? '';
  return TIGHT_UNITS.has(unit) ? text + unit : `${text} ${unit}`;
}

/** Spoken/ARIA form: the formatted value with a plain hyphen-minus (screen readers read U+2212 inconsistently). */
export function formatValueText(value: number, field: Pick<NumberField, 'unit' | 'digits'>): string {
  return formatValue(value, field).replace(MINUS, '-');
}

/** Clamp to [min, max] and snap to the field's step grid (anchored at min). */
export function clampToField(value: number, field: Pick<NumberField, 'min' | 'max' | 'step'>): number {
  if (!Number.isFinite(value)) return field.min;
  const clamped = Math.min(field.max, Math.max(field.min, value));
  if (!(field.step > 0)) return clamped;
  const steps = Math.round((clamped - field.min) / field.step);
  const snapped = field.min + steps * field.step;
  // Trim floating-point noise to the step's precision.
  const decimals = Math.min(10, Math.max(0, -Math.floor(Math.log10(field.step)) + 1));
  return Math.min(field.max, Math.max(field.min, Number(snapped.toFixed(decimals))));
}

/**
 * Parse what someone typed into a readout: accepts "1.5", "−1,5", "1.5 m", "45°", "+2".
 * Returns the clamped, snapped value, or null when there is no number.
 */
export function parseValue(text: string, field: Pick<NumberField, 'min' | 'max' | 'step'>): number | null {
  const cleaned = text
    .trim()
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/,/g, '.')
    .replace(/\s+/g, '');
  const match = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(cleaned);
  if (!match) return null;
  const value = Number(match[0]);
  if (!Number.isFinite(value)) return null;
  return clampToField(value, field);
}

/** Position of a value within the field's range as a CSS percentage string for `--val`. */
export function fillPercent(value: number, field: Pick<NumberField, 'min' | 'max'>): string {
  const span = field.max - field.min;
  const t = span > 0 ? (value - field.min) / span : 0;
  return `${(Math.min(1, Math.max(0, t)) * 100).toFixed(2)}%`;
}

/** Wrap an angle in degrees into [-180, 180). */
export function wrapDegrees(degrees: number): number {
  const wrapped = (((degrees + 180) % 360) + 360) % 360 - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

/** A file-name-safe slug: "My Crew!" → "my-crew". */
export function slugify(text: string, fallback = 'scene'): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

/** Download name for a stage snapshot: "thunes-my-crew-2026-11-17-1530.png" (no title: "thunes-2026-11-17-1530.png"). */
export function snapshotFileName(title: string, date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  const slug = slugify(title, '');
  return `thunes-${slug ? `${slug}-` : ''}${stamp}.png`;
}
