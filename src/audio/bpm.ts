/**
 * Tempo detection for songs that come without a known tempo.
 *
 *   1. Onset strength: the signal is split into a low band (kicks, bass) and a
 *      high band (hats, snares) with one-pole filters; per 5.8 ms frame the
 *      log energy of each band is differenced and half-wave rectified, so the
 *      envelope spikes where something starts.
 *   2. Periodicity: the autocorrelation of that envelope.
 *   3. Comb scoring: every tempo from 80 to 160 BPM is scored by the mean
 *      autocorrelation at 1, 2, … 8 beat periods (one "tooth" per beat), so a
 *      tempo only scores when the envelope repeats at every multiple of its
 *      beat. Tempi outside 80–160 fold into that octave (60 → 120, 180 → 90).
 *
 * Pure functions; no Web Audio objects are needed (detectBufferBpm accepts
 * anything shaped like an AudioBuffer).
 */

/** Result of detectBpm. */
export interface TempoEstimate {
  /** Beats per minute in [80, 160), rounded to 0.1 (and snapped to whole numbers when close). */
  bpm: number;
  /** 0..1: how clearly the beat stands out. */
  confidence: number;
}

/** Folded tempo range. */
export const BPM_FOLD_MIN = 80;
export const BPM_FOLD_MAX = 160;

/** At most this much audio is analysed (taken from the middle of longer songs). */
const MAX_ANALYSIS_SECONDS = 90;
/** Shorter signals cannot hold enough beats to judge. */
const MIN_ANALYSIS_SECONDS = 3;
/** Envelope frames per second (approximately; the hop is a whole number of samples). */
const ENVELOPE_RATE = 172;
/** Comb teeth: beat multiples scored per tempo. */
const TEETH = 8;
/** Peak below this (linear) counts as silence. */
const SILENCE_PEAK = 1e-4;
/** Smallest log-energy jump (summed over the bands) that counts as an onset. */
const MIN_ONSET = 0.5;
/** Log-energy rises smaller than this per band are treated as ripple, not onsets. */
const RIPPLE = 0.12;
/** Minimum comb score (mean normalised autocorrelation) for a tempo to count as found. */
const MIN_SCORE = 0.12;

/** Folds any positive tempo into [80, 160) by octaves. */
export function foldBpm(bpm: number): number {
  if (!(bpm > 0) || !Number.isFinite(bpm)) return bpm;
  let folded = bpm;
  while (folded < BPM_FOLD_MIN) folded *= 2;
  while (folded >= BPM_FOLD_MAX) folded /= 2;
  return folded;
}

/**
 * Onset-strength envelope of a mono signal: one value per hop of
 * `hop` samples, zero mean removed is NOT applied (values are ≥ 0).
 */
export function onsetEnvelope(samples: Float32Array, sampleRate: number, hop: number): Float32Array {
  const frames = Math.floor(samples.length / hop);
  const envelope = new Float32Array(Math.max(0, frames));
  if (frames < 2) return envelope;
  // One-pole low-pass coefficients: 150 Hz splits off the kick; the high band is everything above ~4 kHz.
  const lowA = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
  const highA = 1 - Math.exp((-2 * Math.PI * 4000) / sampleRate);
  let low = 0;
  let lowpassHigh = 0;
  let previousLow = 0;
  let previousMid = 0;
  let previousHigh = 0;
  let carryLow = 0;
  let carryMid = 0;
  let carryHigh = 0;
  // Floor at −60 dB relative to full scale keeps the logarithm calm in quiet passages.
  const floor = 1e-6;
  for (let f = 0; f < frames; f++) {
    let lowEnergy = 0;
    let midEnergy = 0;
    let highEnergy = 0;
    const start = f * hop;
    for (let i = start; i < start + hop; i++) {
      const x = samples[i]!;
      low += lowA * (x - low);
      lowpassHigh += highA * (x - lowpassHigh);
      const high = x - lowpassHigh;
      const mid = lowpassHigh - low;
      lowEnergy += low * low;
      midEnergy += mid * mid;
      highEnergy += high * high;
    }
    // Energies are averaged with the previous frame: a steady tone whose period does not fit the frame would otherwise ripple.
    const l = Math.log((lowEnergy + carryLow) / (2 * hop) + floor);
    const m = Math.log((midEnergy + carryMid) / (2 * hop) + floor);
    const h = Math.log((highEnergy + carryHigh) / (2 * hop) + floor);
    carryLow = lowEnergy;
    carryMid = midEnergy;
    carryHigh = highEnergy;
    if (f > 1) {
      envelope[f] = Math.max(0, l - previousLow - RIPPLE) + Math.max(0, m - previousMid - RIPPLE) + Math.max(0, h - previousHigh - RIPPLE);
    }
    previousLow = l;
    previousMid = m;
    previousHigh = h;
  }
  return envelope;
}

/**
 * Estimates the tempo of a mono signal. Returns null for silence, for signals
 * shorter than three seconds and when no beat stands out (noise, ambient
 * material). The result is folded into 80–160 BPM.
 */
export function detectBpm(samples: Float32Array, sampleRate: number): TempoEstimate | null {
  if (!(sampleRate > 0) || samples.length < sampleRate * MIN_ANALYSIS_SECONDS) return null;

  // Analysis window: the middle of long songs (intros are often beatless).
  const maxSamples = Math.floor(sampleRate * MAX_ANALYSIS_SECONDS);
  const window = samples.length > maxSamples ? samples.subarray(Math.floor((samples.length - maxSamples) / 2), Math.floor((samples.length - maxSamples) / 2) + maxSamples) : samples;

  let peak = 0;
  for (let i = 0; i < window.length; i += 7) {
    const a = Math.abs(window[i]!);
    if (a > peak) peak = a;
  }
  if (!(peak > SILENCE_PEAK)) return null;

  const hop = Math.max(1, Math.round(sampleRate / ENVELOPE_RATE));
  const rate = sampleRate / hop;
  const envelope = onsetEnvelope(window, sampleRate, hop);
  const n = envelope.length;

  // Remove the mean so that a constant onset level does not correlate with itself.
  let mean = 0;
  let strongest = 0;
  for (let i = 0; i < n; i++) {
    mean += envelope[i]!;
    if (envelope[i]! > strongest) strongest = envelope[i]!;
  }
  // A real onset multiplies a band's energy; ripples of a steady sound stay far below that.
  if (strongest < MIN_ONSET) return null;
  mean /= n;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    envelope[i] = envelope[i]! - mean;
    energy += envelope[i]! * envelope[i]!;
  }
  if (!(energy > 1e-9)) return null;

  // Autocorrelation up to TEETH beats of the slowest tempo (limited to half the envelope).
  const longestBeat = (60 / BPM_FOLD_MIN) * rate;
  const maxLag = Math.min(Math.floor(n / 2), Math.ceil(longestBeat * TEETH) + 2);
  if (maxLag < longestBeat * 2) return null;
  const ac = new Float32Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0, end = n - lag; i < end; i++) sum += envelope[i]! * envelope[i + lag]!;
    // Unbiased: normalise by the number of overlapping frames.
    ac[lag] = sum / energy * (n / (n - lag));
  }

  const score = (bpm: number): number => {
    const beat = (60 / bpm) * rate;
    let sum = 0;
    let teeth = 0;
    for (let k = 1; k <= TEETH; k++) {
      const lag = beat * k;
      const i = Math.floor(lag);
      if (i + 1 > maxLag) break;
      const t = lag - i;
      sum += ac[i]! * (1 - t) + ac[i + 1]! * t;
      teeth++;
    }
    return teeth > 0 ? sum / teeth : -Infinity;
  };

  // Coarse sweep, then a fine sweep around the winner.
  let best = 0;
  let bestScore = -Infinity;
  let total = 0;
  let count = 0;
  for (let bpm = BPM_FOLD_MIN; bpm < BPM_FOLD_MAX; bpm += 0.25) {
    const s = score(bpm);
    total += s;
    count++;
    if (s > bestScore) {
      bestScore = s;
      best = bpm;
    }
  }
  for (let bpm = Math.max(BPM_FOLD_MIN, best - 0.3); bpm <= Math.min(BPM_FOLD_MAX - 0.01, best + 0.3); bpm += 0.02) {
    const s = score(bpm);
    if (s > bestScore) {
      bestScore = s;
      best = bpm;
    }
  }
  if (!(bestScore >= MIN_SCORE)) return null;
  // The winner must also stand clear of the average tempo's score.
  const average = total / count;
  if (!(bestScore - average > MIN_SCORE * 0.75)) return null;

  let bpm = Math.round(best * 10) / 10;
  if (Math.abs(bpm - Math.round(bpm)) <= 0.25) bpm = Math.round(bpm);
  if (bpm >= BPM_FOLD_MAX) bpm = BPM_FOLD_MAX / 2;
  return { bpm, confidence: Math.max(0, Math.min(1, bestScore)) };
}

/** The part of an AudioBuffer that detectBufferBpm reads. */
export interface AudioBufferLike {
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  readonly length: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * detectBpm for a decoded audio buffer: mixes the channels of the analysed
 * stretch (at most 90 s from the middle) to mono first.
 */
export function detectBufferBpm(buffer: AudioBufferLike): TempoEstimate | null {
  const maxSamples = Math.floor(buffer.sampleRate * MAX_ANALYSIS_SECONDS);
  const length = Math.min(buffer.length, maxSamples);
  if (length <= 0 || buffer.numberOfChannels < 1) return null;
  const start = Math.floor((buffer.length - length) / 2);
  const mono = new Float32Array(length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) mono[i] = mono[i]! + data[start + i]!;
  }
  if (buffer.numberOfChannels > 1) {
    const gain = 1 / buffer.numberOfChannels;
    for (let i = 0; i < length; i++) mono[i] = mono[i]! * gain;
  }
  return detectBpm(mono, buffer.sampleRate);
}
