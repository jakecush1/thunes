/**
 * Curve maths of the dance scheme: easing, keyframes, oscillators, and the
 * evaluation of every control over the loop. Pure functions, no three.js.
 */
import { CONTROLS, CONTROL_NAMES, mirrorControl, resolveTarget } from './scheme';
import type { ControlName, DanceKey, DanceOscillator, DanceScheme, DanceTrack, Ease, Wave } from './scheme';

/** A value for every control. */
export type ControlValues = Record<ControlName, number>;

/** Length of the whip of a 'snap' key, in beats. */
export const SNAP_BEATS = 0.25;
/** Fraction of the period a 'pulse' spends on each of its eased edges. */
const PULSE_EDGE = 0.08;
const OVERSHOOT = 1.70158;

/** x modulo m, always in [0, m). */
export function wrap(x: number, m: number): number {
  const r = x % m;
  return r < 0 ? r + m : r;
}

/**
 * Progress 0..1 of an eased move. `u` is the linear progress 0..1 through the
 * interval between two keys and `spanBeats` the length of that interval
 * (only 'snap' needs it). 'overshoot' briefly exceeds 1.
 */
export function easeValue(ease: Ease, u: number, spanBeats = 1): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  switch (ease) {
    case 'linear':
      return u;
    case 'in':
      return u * u;
    case 'out':
      return 1 - (1 - u) * (1 - u);
    case 'inOut':
      return u * u * (3 - 2 * u);
    case 'hold':
      return 0;
    case 'snap': {
      const window = Math.min(SNAP_BEATS, spanBeats);
      const local = 1 - ((1 - u) * spanBeats) / window;
      if (local <= 0) return 0;
      const rest = 1 - local;
      return 1 - rest * rest * rest;
    }
    case 'overshoot': {
      const v = u - 1;
      return 1 + (OVERSHOOT + 1) * v * v * v + OVERSHOOT * v * v;
    }
  }
}

/** Keys sorted by beat (a new array; the input is left alone). */
export function sortKeys(keys: readonly DanceKey[]): DanceKey[] {
  return [...keys].sort((a, b) => a[0] - b[0]);
}

/**
 * Value of a periodic keyframe curve at `beat`. `sorted` must be sorted by
 * beat with all beats in [0, period). The curve wraps: after the last key it
 * eases into the first key of the next cycle.
 */
export function evalKeys(sorted: readonly DanceKey[], period: number, beat: number): number {
  const count = sorted.length;
  if (count === 1) return sorted[0][1];
  const t = wrap(beat, period);
  // Index of the key we are moving into (the first key later than t), wrapping to 0.
  let next = 0;
  while (next < count && sorted[next][0] <= t) next++;
  const into = sorted[next % count];
  const from = sorted[(next + count - 1) % count];
  const start = next === 0 ? from[0] - period : from[0];
  const end = next === count ? into[0] + period : into[0];
  const span = end - start;
  const u = span > 0 ? (t - start) / span : 1;
  return from[1] + (into[1] - from[1]) * easeValue(into[2] ?? 'inOut', u, span);
}

/** Value of a unit wave at phase `u` (in periods). See `Wave` for the shapes. */
export function waveValue(wave: Wave, u: number, width = 0.5): number {
  switch (wave) {
    case 'sine':
      return Math.sin(2 * Math.PI * u);
    case 'bounce':
      return Math.abs(Math.sin(Math.PI * u));
    case 'triangle': {
      const f = wrap(u, 1);
      if (f < 0.25) return 4 * f;
      if (f < 0.75) return 2 - 4 * f;
      return 4 * f - 4;
    }
    case 'pulse': {
      // Centre the rising edge on u = 0 and the falling edge on u = width.
      const f = wrap(u + PULSE_EDGE / 2, 1);
      const edge = Math.min(PULSE_EDGE, width, 1 - width);
      const smooth = (x: number) => x * x * (3 - 2 * x);
      if (f < edge) return smooth(f / edge);
      if (f < width) return 1;
      if (f < width + edge) return 1 - smooth((f - width) / edge);
      return 0;
    }
  }
}

/** Value of one oscillator at `beat` (bias + amp × wave), without scale, lag or mirroring. */
export function evalOscillator(osc: DanceOscillator, beat: number): number {
  const u = (beat - (osc.phase ?? 0)) / osc.period;
  return (osc.bias ?? 0) + osc.amp * waveValue(osc.wave ?? 'sine', u, osc.width ?? 0.5);
}

/** One resolved contribution to one control. */
interface Layer {
  /** Multiplier (scale × mirror sign). */
  gain: number;
  /** Beats of delay (layer lag + mirror offset + control lag). */
  delay: number;
  keys: DanceKey[] | null;
  period: number;
  osc: DanceOscillator | null;
}

/** A scheme with groups, mirrors, repeats and lags resolved into per-control layers. */
export interface ExpandedScheme {
  beats: number;
  base: ControlValues;
  layers: Record<ControlName, Layer[]>;
  /** Blur window per control, beats (0 = none). */
  smooth: ControlValues;
}

function zeroValues(): ControlValues {
  const values = {} as ControlValues;
  for (const name of CONTROL_NAMES) values[name] = 0;
  return values;
}

/**
 * Resolves the conveniences of a (valid) scheme: both-sides shorthands become
 * two controls, `mirror` adds the twin layer, `repeat` becomes the key period,
 * and the per-control `lag` is folded into every layer's delay.
 */
export function expandScheme(scheme: DanceScheme): ExpandedScheme {
  const base = zeroValues();
  const controlLag = zeroValues();
  const smooth = zeroValues();
  const layers = {} as Record<ControlName, Layer[]>;
  for (const name of CONTROL_NAMES) layers[name] = [];

  const fill = (target: ControlValues, map: Partial<Record<string, number>> | undefined): void => {
    // Exact control names win over group shorthands, whatever the order of the entries.
    for (const pass of [2, 1]) {
      for (const [key, value] of Object.entries(map ?? {})) {
        const controls = resolveTarget(key);
        if (controls.length !== pass || value === undefined) continue;
        for (const control of controls) target[control] = value;
      }
    }
  };
  fill(base, scheme.base);
  fill(controlLag, scheme.lag);
  fill(smooth, scheme.smooth);

  const add = (layer: DanceTrack | DanceOscillator, keys: DanceKey[] | null, period: number, osc: DanceOscillator | null): void => {
    const gain = layer.scale ?? 1;
    const lag = layer.lag ?? 0;
    for (const control of resolveTarget(layer.control)) {
      layers[control].push({ gain, delay: lag, keys, period, osc });
      if (layer.mirror !== undefined && layer.mirror !== false) {
        const twin = mirrorControl(control);
        const offset = layer.mirror === true ? 0 : layer.mirror;
        layers[twin.control].push({ gain: gain * twin.sign, delay: lag + offset, keys, period, osc });
      }
    }
  };
  for (const track of scheme.tracks ?? []) add(track, sortKeys(track.keys), track.repeat ?? scheme.beats, null);
  for (const osc of scheme.oscillators ?? []) add(osc, null, osc.period, osc);
  for (const name of CONTROL_NAMES) for (const layer of layers[name]) layer.delay += controlLag[name];

  return { beats: scheme.beats, base, layers, smooth };
}

/** Unclamped, unsmoothed value of one control at `beat`. */
export function evalControl(expanded: ExpandedScheme, control: ControlName, beat: number): number {
  let value = expanded.base[control];
  for (const layer of expanded.layers[control]) {
    const t = beat - layer.delay;
    value += layer.gain * (layer.keys ? evalKeys(layer.keys, layer.period, t) : evalOscillator(layer.osc as DanceOscillator, t));
  }
  return value;
}

/** Clamps a control value to its range. */
export function clampControl(control: ControlName, value: number): number {
  const spec = CONTROLS[control];
  return value < spec.min ? spec.min : value > spec.max ? spec.max : value;
}

/** Circular blur of a periodic signal: two passes of a box of `radius` samples (in place). */
function blurPeriodic(samples: Float64Array, radius: number): void {
  const n = samples.length;
  const r = Math.min(radius, Math.floor((n - 1) / 2));
  if (r < 1) return;
  const scratch = new Float64Array(n);
  for (let pass = 0; pass < 2; pass++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += samples[wrap(k, n)];
    for (let i = 0; i < n; i++) {
      scratch[i] = sum / (2 * r + 1);
      sum += samples[wrap(i + r + 1, n)] - samples[wrap(i - r, n)];
    }
    samples.set(scratch);
  }
}

/**
 * Samples every control at `frames` evenly spaced beats covering one loop
 * (sample i is at beat i × beats / frames; the loop point itself is not
 * repeated), with smoothing and range clamping applied.
 */
export function sampleControls(scheme: DanceScheme, frames: number): Record<ControlName, Float64Array> {
  const expanded = expandScheme(scheme);
  const result = {} as Record<ControlName, Float64Array>;
  const step = scheme.beats / frames;
  for (const control of CONTROL_NAMES) {
    const samples = new Float64Array(frames);
    const constant = expanded.layers[control].length === 0;
    for (let i = 0; i < frames; i++) samples[i] = constant ? expanded.base[control] : evalControl(expanded, control, i * step);
    if (!constant && expanded.smooth[control] > 0) blurPeriodic(samples, Math.round(expanded.smooth[control] / step / 4));
    for (let i = 0; i < frames; i++) samples[i] = clampControl(control, samples[i]);
    result[control] = samples;
  }
  return result;
}

/** Every control at one beat, clamped (no smoothing: use `sampleControls` for the final curves). */
export function evaluateControls(scheme: DanceScheme, beat: number): ControlValues {
  const expanded = expandScheme(scheme);
  const values = {} as ControlValues;
  for (const control of CONTROL_NAMES) values[control] = clampControl(control, evalControl(expanded, control, beat));
  return values;
}
