import { describe, expect, it } from 'vitest';
import { detectBpm, detectBufferBpm, foldBpm, onsetEnvelope } from '../../../src/audio/bpm';

const RATE = 22050;

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TrackOptions {
  bpm: number;
  seconds?: number;
  /** 0..1: how late every second 16th is played. */
  swing?: number;
  /** Linear level of added white noise. */
  noise?: number;
  /** Kick on every beat (default) or only on beats 1 and 3. */
  halfTimeKick?: boolean;
  /** Add a snare on beats 2 and 4. */
  snare?: boolean;
  seed?: number;
  rate?: number;
}

/** A synthetic drum loop: kick on the beat, hats on the 8ths (swung 16ths in between when swing > 0). */
function drumTrack(options: TrackOptions): Float32Array {
  const rate = options.rate ?? RATE;
  const seconds = options.seconds ?? 20;
  const out = new Float32Array(Math.floor(seconds * rate));
  const rnd = random(options.seed ?? 1);
  const beat = 60 / options.bpm;
  const sixteenth = beat / 4;
  const kick = (at: number): void => {
    const start = Math.floor(at * rate);
    let phase = 0;
    for (let i = 0; i < rate * 0.25 && start + i < out.length; i++) {
      const t = i / rate;
      phase += (2 * Math.PI * (50 + 90 * Math.exp(-t * 30))) / rate;
      out[start + i] = out[start + i]! + 0.8 * Math.sin(phase) * Math.exp(-t * 14);
    }
  };
  const noiseHit = (at: number, level: number, decay: number): void => {
    const start = Math.floor(at * rate);
    let previous = 0;
    for (let i = 0; i < rate * 0.12 && start + i < out.length; i++) {
      const white = rnd() * 2 - 1;
      const high = white - previous; // crude high-pass
      previous = white;
      out[start + i] = out[start + i]! + level * high * Math.exp((-i / rate) * decay);
    }
  };
  const steps = Math.floor(seconds / sixteenth);
  for (let step = 0; step < steps; step++) {
    const late = step % 2 === 1 ? (options.swing ?? 0) * sixteenth * (1 / 3) : 0;
    const at = step * sixteenth + late;
    const inBar = step % 16;
    if (inBar % 4 === 0 && (!options.halfTimeKick || inBar % 8 === 0)) kick(at);
    if (options.snare && inBar % 8 === 4) noiseHit(at, 0.5, 25);
    if (inBar % 2 === 0) noiseHit(at, 0.25, 60);
    else if ((options.swing ?? 0) > 0) noiseHit(at, 0.12, 80);
  }
  if (options.noise) for (let i = 0; i < out.length; i++) out[i] = out[i]! + (rnd() * 2 - 1) * options.noise;
  return out;
}

describe('foldBpm', () => {
  it('folds by octaves into 80–160', () => {
    expect(foldBpm(120)).toBe(120);
    expect(foldBpm(60)).toBe(120);
    expect(foldBpm(70)).toBe(140);
    expect(foldBpm(180)).toBe(90);
    expect(foldBpm(200)).toBe(100);
    expect(foldBpm(160)).toBe(80);
    expect(foldBpm(40)).toBe(80);
  });
});

describe('onsetEnvelope', () => {
  it('spikes where sounds start and is flat in silence', () => {
    const track = drumTrack({ bpm: 120, seconds: 4 });
    const hop = 128;
    const envelope = onsetEnvelope(track, RATE, hop);
    const at = (seconds: number): number => Math.max(...envelope.subarray(Math.round((seconds * RATE) / hop) - 1, Math.round((seconds * RATE) / hop) + 3));
    expect(at(1.0)).toBeGreaterThan(3 * at(1.15));
    expect(Math.max(...onsetEnvelope(new Float32Array(RATE * 2), RATE, hop))).toBe(0);
  });
});

describe('detectBpm', () => {
  for (const bpm of [80, 90, 100, 110, 120, 128, 140, 150]) {
    it(`finds ${bpm} BPM on a clean kick-and-hat track`, () => {
      const estimate = detectBpm(drumTrack({ bpm }), RATE);
      expect(estimate).not.toBeNull();
      expect(Math.abs(estimate!.bpm - bpm)).toBeLessThanOrEqual(1);
      expect(estimate!.confidence).toBeGreaterThan(0.2);
    });
  }

  it('resolves fractional tempi', () => {
    const estimate = detectBpm(drumTrack({ bpm: 123.5, seconds: 30 }), RATE);
    expect(Math.abs(estimate!.bpm - 123.5)).toBeLessThanOrEqual(0.5);
  });

  it('folds slow and fast tempi into 80–160', () => {
    expect(Math.abs(detectBpm(drumTrack({ bpm: 70, seconds: 30 }), RATE)!.bpm - 140)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(detectBpm(drumTrack({ bpm: 174, seconds: 30 }), RATE)!.bpm - 87)).toBeLessThanOrEqual(1);
  });

  it('copes with noise', () => {
    for (const bpm of [96, 126]) {
      const estimate = detectBpm(drumTrack({ bpm, noise: 0.08, seed: 7 }), RATE);
      expect(estimate, `${bpm} BPM`).not.toBeNull();
      expect(Math.abs(estimate!.bpm - bpm)).toBeLessThanOrEqual(1);
    }
  });

  it('copes with swing', () => {
    for (const bpm of [100, 124]) {
      const estimate = detectBpm(drumTrack({ bpm, swing: 0.6, snare: true }), RATE);
      expect(estimate, `${bpm} BPM`).not.toBeNull();
      expect(Math.abs(estimate!.bpm - bpm)).toBeLessThanOrEqual(1);
    }
  });

  it('copes with a backbeat and a half-time kick', () => {
    const estimate = detectBpm(drumTrack({ bpm: 112, halfTimeKick: true, snare: true }), RATE);
    expect(Math.abs(estimate!.bpm - 112)).toBeLessThanOrEqual(1);
  });

  it('works at 44.1 and 48 kHz', () => {
    for (const rate of [44100, 48000]) {
      const estimate = detectBpm(drumTrack({ bpm: 120, seconds: 12, rate }), rate);
      expect(Math.abs(estimate!.bpm - 120)).toBeLessThanOrEqual(1);
    }
  });

  it('returns null for silence, very short input and nonsense rates', () => {
    expect(detectBpm(new Float32Array(RATE * 10), RATE)).toBeNull();
    expect(detectBpm(drumTrack({ bpm: 120, seconds: 1 }), RATE)).toBeNull();
    expect(detectBpm(new Float32Array(0), RATE)).toBeNull();
    expect(detectBpm(drumTrack({ bpm: 120 }), 0)).toBeNull();
  });

  it('returns null for pure noise and for a steady tone', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const rnd = random(seed);
      const noise = new Float32Array(RATE * 20);
      for (let i = 0; i < noise.length; i++) noise[i] = (rnd() * 2 - 1) * 0.5;
      expect(detectBpm(noise, RATE), `seed ${seed}`).toBeNull();
    }
    const tone = new Float32Array(RATE * 10);
    for (let i = 0; i < tone.length; i++) tone[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / RATE);
    expect(detectBpm(tone, RATE)).toBeNull();
  });
});

describe('detectBufferBpm', () => {
  it('mixes channels and analyses the middle of long buffers', () => {
    const left = drumTrack({ bpm: 132, seconds: 100, rate: 11025 });
    const right = new Float32Array(left.length);
    const buffer = { numberOfChannels: 2, sampleRate: 11025, length: left.length, getChannelData: (c: number) => (c === 0 ? left : right) };
    const estimate = detectBufferBpm(buffer);
    expect(Math.abs(estimate!.bpm - 132)).toBeLessThanOrEqual(1);
    expect(detectBufferBpm({ numberOfChannels: 0, sampleRate: 44100, length: 0, getChannelData: () => new Float32Array(0) })).toBeNull();
  });
});
