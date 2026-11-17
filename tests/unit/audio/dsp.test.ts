import { describe, expect, it } from 'vitest';
import { addWrapped, applyGain, foldLoop, fromDb, limitLoop, masterLoop, masterLoopAsync, peakOf, rmsOf, seamRatio, toDb } from '../../../src/audio/dsp';
import { createRandom } from '../../../src/audio/sequence';
import { duckEnvelope } from '../../../src/audio/synth';

describe('levels', () => {
  it('converts between decibels and amplitude', () => {
    expect(toDb(1)).toBe(0);
    expect(toDb(0.5)).toBeCloseTo(-6.02, 2);
    expect(toDb(0)).toBe(-Infinity);
    expect(fromDb(-20)).toBeCloseTo(0.1, 9);
  });

  it('measures peak and RMS across channels', () => {
    const a = new Float32Array([0.5, -0.5, 0.5, -0.5]);
    const b = new Float32Array([0, 0, -0.75, 0]);
    expect(peakOf([a, b])).toBe(0.75);
    expect(rmsOf([a])).toBeCloseTo(0.5, 6);
    applyGain([a], 2);
    expect(Array.from(a)).toEqual([1, -1, 1, -1]);
  });
});

describe('folding', () => {
  it('adds everything past the loop end back onto the start', () => {
    const source = new Float32Array([1, 2, 3, 4, 10, 20, 30, 40, 100]);
    expect(Array.from(foldLoop(source, 4))).toEqual([111, 22, 33, 44]);
  });

  it('adds with an offset, wrapping around', () => {
    const loop = new Float32Array(5);
    addWrapped(loop, new Float32Array([1, 2, 3, 4]), 3);
    expect(Array.from(loop)).toEqual([3, 4, 0, 1, 2]);
    addWrapped(loop, new Float32Array([1, 1, 1, 1, 1, 1, 1]), 4);
    expect(Array.from(loop)).toEqual([5, 5, 1, 2, 4]);
  });

  it('makes a decaying tail continuous across the seam', () => {
    // A burst right at the end of the loop whose ring-out lies in the tail.
    const loopLength = 2000;
    const source = new Float32Array(3000);
    for (let i = 1900; i < 3000; i++) source[i] = Math.sin((i - 1900) * 0.2) * Math.exp(-(i - 1900) / 150);
    const cut = source.slice(0, loopLength);
    const folded = foldLoop(source, loopLength);
    expect(seamRatio([folded])).toBeLessThan(1.2);
    expect(seamRatio([cut])).toBeGreaterThan(2);
  });
});

describe('limitLoop', () => {
  function noisy(length: number, seed: number): Float32Array {
    const random = createRandom(seed);
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++) data[i] = (random() * 2 - 1) * 0.3;
    return data;
  }

  it('leaves audio below the ceiling untouched', () => {
    const data = noisy(1000, 1);
    const copy = data.slice();
    limitLoop([data], 0.5, 64);
    expect(Array.from(data)).toEqual(Array.from(copy));
  });

  it('keeps every sample at or below the ceiling and only touches the neighbourhood of peaks', () => {
    const left = noisy(5000, 2);
    const right = noisy(5000, 3);
    left[1000] = 1.4;
    right[1003] = -1.1;
    left[4998] = 0.9; // next to the seam
    const before = left.slice();
    limitLoop([left, right], 0.5, 64);
    expect(peakOf([left, right])).toBeLessThanOrEqual(0.5);
    expect(left[1000]).toBeCloseTo(0.5, 5);
    // Far from any peak nothing changes.
    for (let i = 2000; i < 4000; i++) expect(left[i]).toBe(before[i]);
    // The reduction is linked: the right channel is turned down with the left at the peak.
    expect(Math.abs(right[1000])).toBeLessThan(0.3 * (0.5 / 1.4) + 1e-6);
    // The gain wraps around the seam: samples at the very start are reduced by the peak at the end.
    expect(Math.abs(left[2])).toBeLessThan(Math.abs(before[2]));
  });

  it('applies a smooth gain (no steps larger than the window allows)', () => {
    const data = new Float32Array(4000).fill(0.25);
    data[2000] = 1;
    limitLoop([data], 0.5, 200);
    let worst = 0;
    for (let i = 1; i < 4000; i++) if (i !== 2000 && i !== 2001) worst = Math.max(worst, Math.abs(data[i] - data[i - 1]));
    expect(worst).toBeLessThan(0.25 * (0.5 / 201) * 1.01);
    expect(data[2000]).toBeCloseTo(0.5, 5);
    expect(data[100]).toBe(0.25);
  });

  it('matches a brute-force reference', () => {
    const data = noisy(700, 9);
    for (const i of [5, 130, 133, 400, 695]) data[i] *= 6;
    const ceiling = 0.4;
    const half = 10;
    const n = data.length;
    const need = Array.from(data, (v) => (Math.abs(v) > ceiling ? ceiling / Math.abs(v) : 1));
    const wrap = (i: number): number => ((i % n) + n) % n;
    const minimum = need.map((_, i) => Math.min(...Array.from({ length: 2 * half + 1 }, (_u, k) => need[wrap(i - half + k)])));
    const expected = Array.from(data, (v, i) => {
      let sum = 0;
      for (let k = -half; k <= half; k++) sum += minimum[wrap(i + k)];
      return v * (sum / (2 * half + 1));
    });
    limitLoop([data], ceiling, 2 * half);
    for (let i = 0; i < n; i++) expect(data[i]).toBeCloseTo(expected[i], 5);
  });
});

describe('masterLoop', () => {
  it('brings different material to the same RMS under the ceiling', () => {
    const results = [0.01, 0.2, 0.9].map((level, index) => {
      const random = createRandom(index + 1);
      const data = new Float32Array(48000);
      for (let i = 0; i < data.length; i++) {
        const kick = Math.exp(-(i % 12000) / 800) * Math.sin(i * 0.008) * 3;
        data[i] = ((random() * 2 - 1) * 0.5 + kick) * level;
      }
      const result = masterLoop([data], { targetRmsDb: -15, ceilingDb: -1.2, windowSamples: 288 });
      expect(toDb(peakOf([data]))).toBeCloseTo(result.peakDb, 6);
      return result;
    });
    for (const result of results) {
      expect(result.peakDb).toBeLessThanOrEqual(-1.2 + 1e-6);
      expect(Math.abs(result.rmsDb - -15)).toBeLessThan(0.5);
    }
  });

  it('gives the same result when run in pausable steps', async () => {
    const make = (): Float32Array => {
      const random = createRandom(5);
      const data = new Float32Array(20000);
      for (let i = 0; i < data.length; i++) data[i] = (random() * 2 - 1) * 0.1 + (i % 5000 < 40 ? 0.9 : 0);
      return data;
    };
    const options = { targetRmsDb: -15, ceilingDb: -1.2, windowSamples: 288 };
    const a = make();
    const b = make();
    let pauses = 0;
    const sync = masterLoop([a], options);
    const stepped = await masterLoopAsync([b], options, async () => {
      pauses++;
    });
    expect(stepped).toEqual(sync);
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(pauses).toBeGreaterThan(1);
    expect(sync.limitedDb).toBeGreaterThan(0);
  });

  it('leaves silence alone', () => {
    const data = new Float32Array(100);
    masterLoop([data], { targetRmsDb: -15, ceilingDb: -1, windowSamples: 16 });
    expect(peakOf([data])).toBe(0);
  });
});

describe('seamRatio', () => {
  it('is small for a signal that loops cleanly and large for one that jumps', () => {
    const n = 4800;
    const clean = new Float32Array(n);
    const jump = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      clean[i] = Math.sin((2 * Math.PI * 10 * i) / n);
      jump[i] = Math.sin((2 * Math.PI * 10.25 * i) / n);
    }
    expect(seamRatio([clean])).toBeLessThan(1.1);
    expect(seamRatio([jump])).toBeGreaterThan(10);
  });
});

describe('duckEnvelope', () => {
  it('ducks at each hit, recovers, and repeats with the loop', () => {
    const loop = 2;
    const env = duckEnvelope([0, 0.5, 1, 1.5], loop, 6, 0.25);
    const at = (seconds: number): number => env[Math.round(seconds * 1000)];
    expect(at(0.006)).toBeCloseTo(1, 2);
    expect(at(0.3)).toBe(0);
    expect(at(0.506)).toBeCloseTo(1, 2);
    expect(at(0.1)).toBeGreaterThan(0.2);
    expect(at(0.1)).toBeLessThan(0.8);
    // Periodic: the tail region repeats the loop.
    for (const t of [0.05, 0.1, 0.4, 0.62, 1.3]) {
      expect(at(t + loop)).toBeCloseTo(at(t), 5);
      expect(at(t + 2 * loop)).toBeCloseTo(at(t), 5);
    }
    expect(env.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('carries a hit at the end of the loop over to the start', () => {
    const env = duckEnvelope([1.9], 2, 3, 0.4);
    // 0.1 s after the wrapped hit (which was at −0.1 s) the envelope is still recovering.
    expect(env[0]).toBeGreaterThan(0.3);
    expect(env[Math.round(0.35 * 1000)]).toBe(0);
  });
});
