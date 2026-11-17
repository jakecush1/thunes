// Keyframe, easing and oscillator maths, and the authoring conveniences.
import { describe, expect, it } from 'vitest';
import {
  SNAP_BEATS,
  easeValue,
  evalControl,
  evalKeys,
  evalOscillator,
  evaluateControls,
  expandScheme,
  sampleControls,
  sortKeys,
  waveValue,
  wrap,
} from '../../../src/dances/evaluate';
import { CONTROLS, EASES, mirrorControl, resolveTarget } from '../../../src/dances/scheme';
import type { DanceKey, DanceScheme } from '../../../src/dances/scheme';

const scheme = (extra: Partial<DanceScheme>): DanceScheme => ({ format: 'thunes-dance@1', beats: 4, bpm: 120, ...extra });

describe('easing', () => {
  it('starts at 0 and ends at 1 for every ease', () => {
    for (const ease of EASES) {
      expect(easeValue(ease, 0)).toBe(0);
      expect(easeValue(ease, 1)).toBe(1);
      expect(easeValue(ease, -1)).toBe(0);
      expect(easeValue(ease, 2)).toBe(1);
    }
  });

  it('has the documented shapes', () => {
    expect(easeValue('linear', 0.3)).toBeCloseTo(0.3);
    expect(easeValue('in', 0.5)).toBeCloseTo(0.25);
    expect(easeValue('out', 0.5)).toBeCloseTo(0.75);
    expect(easeValue('inOut', 0.5)).toBeCloseTo(0.5);
    expect(easeValue('inOut', 0.25)).toBeLessThan(0.25);
    expect(easeValue('hold', 0.999)).toBe(0);
    // Overshoot goes past the target by roughly a tenth, then settles.
    let peak = 0;
    for (let u = 0; u <= 1; u += 0.01) peak = Math.max(peak, easeValue('overshoot', u));
    expect(peak).toBeGreaterThan(1.05);
    expect(peak).toBeLessThan(1.15);
  });

  it('snap waits, then whips in during the last quarter beat', () => {
    const span = 2;
    expect(easeValue('snap', 0.5, span)).toBe(0);
    expect(easeValue('snap', 1 - SNAP_BEATS / span, span)).toBeCloseTo(0);
    expect(easeValue('snap', 1 - SNAP_BEATS / span / 2, span)).toBeGreaterThan(0.8);
    // On an interval shorter than the snap window it simply eases out over the whole interval.
    expect(easeValue('snap', 0.5, 0.1)).toBeCloseTo(0.875);
  });
});

describe('keyframes', () => {
  const keys: DanceKey[] = sortKeys([
    [2, 10, 'linear'],
    [0, 0, 'linear'],
    [3, -10, 'hold'],
  ]);

  it('sorts keys by beat', () => {
    expect(keys.map((key) => key[0])).toEqual([0, 2, 3]);
  });

  it('hits every key exactly and interpolates between them', () => {
    expect(evalKeys(keys, 4, 0)).toBe(0);
    expect(evalKeys(keys, 4, 2)).toBe(10);
    expect(evalKeys(keys, 4, 3)).toBe(-10);
    expect(evalKeys(keys, 4, 1)).toBeCloseTo(5);
    expect(evalKeys(keys, 4, 2.9)).toBe(10); // hold
  });

  it('wraps around the loop: after the last key it eases into the first', () => {
    expect(evalKeys(keys, 4, 3.5)).toBeCloseTo(-5);
    expect(evalKeys(keys, 4, 4)).toBeCloseTo(0);
    expect(evalKeys(keys, 4, 5)).toBeCloseTo(evalKeys(keys, 4, 1));
    expect(evalKeys(keys, 4, -0.5)).toBeCloseTo(-5);
  });

  it('wraps a curve whose first key is not on beat 0', () => {
    const late: DanceKey[] = [
      [1, 4, 'linear'],
      [3, 8, 'linear'],
    ];
    expect(evalKeys(late, 4, 0)).toBeCloseTo(6); // half-way from the key on 3 back to the key on 1
    expect(evalKeys(late, 4, 2)).toBeCloseTo(6);
    expect(evalKeys(late, 4, 3.5)).toBeCloseTo(7);
  });

  it('is constant with a single key and defaults to inOut', () => {
    expect(evalKeys([[1, 7]], 4, 3.3)).toBe(7);
    const soft: DanceKey[] = [
      [0, 0],
      [2, 10],
    ];
    expect(evalKeys(soft, 4, 1)).toBeCloseTo(5);
    expect(evalKeys(soft, 4, 0.5)).toBeLessThan(2.5);
  });
});

describe('oscillators', () => {
  it('has the documented wave shapes', () => {
    expect(waveValue('sine', 0)).toBeCloseTo(0);
    expect(waveValue('sine', 0.25)).toBeCloseTo(1);
    expect(waveValue('sine', 0.75)).toBeCloseTo(-1);
    expect(waveValue('bounce', 0)).toBeCloseTo(0);
    expect(waveValue('bounce', 0.5)).toBeCloseTo(1);
    expect(waveValue('bounce', 1)).toBeCloseTo(0);
    expect(waveValue('bounce', 1.5)).toBeCloseTo(1);
    expect(waveValue('triangle', 0)).toBeCloseTo(0);
    expect(waveValue('triangle', 0.125)).toBeCloseTo(0.5);
    expect(waveValue('triangle', 0.25)).toBeCloseTo(1);
    expect(waveValue('triangle', 0.5)).toBeCloseTo(0);
    expect(waveValue('triangle', 0.75)).toBeCloseTo(-1);
    expect(waveValue('pulse', 0.25)).toBe(1);
    expect(waveValue('pulse', 0.75)).toBe(0);
    expect(waveValue('pulse', 0.1, 0.2)).toBe(1);
    expect(waveValue('pulse', 0.4, 0.2)).toBe(0);
    for (const wave of ['sine', 'bounce', 'triangle', 'pulse'] as const) {
      for (const u of [0.1, 0.37, 0.8]) expect(waveValue(wave, u + 3)).toBeCloseTo(waveValue(wave, u));
      for (let u = 0; u < 1; u += 0.01) expect(Math.abs(waveValue(wave, u))).toBeLessThanOrEqual(1);
    }
  });

  it('applies amplitude, period, phase and bias', () => {
    const osc = { control: 'hips.shift', amp: 2, period: 4, phase: 1, bias: 10 } as const;
    expect(evalOscillator(osc, 1)).toBeCloseTo(10);
    expect(evalOscillator(osc, 2)).toBeCloseTo(12);
    expect(evalOscillator(osc, 4)).toBeCloseTo(8);
    expect(evalOscillator(osc, 6)).toBeCloseTo(evalOscillator(osc, 2));
  });

  it('wrap keeps values in range', () => {
    expect(wrap(5, 4)).toBe(1);
    expect(wrap(-1, 4)).toBe(3);
    expect(wrap(4, 4)).toBe(0);
  });
});

describe('scheme evaluation', () => {
  it('adds tracks and oscillators to the base pose', () => {
    const s = scheme({
      base: { 'spine.lean': 10 },
      tracks: [{ control: 'spine.lean', keys: [[0, 0, 'linear'], [2, 20, 'linear']] }],
      oscillators: [{ control: 'spine.lean', amp: 3, period: 4 }],
    });
    expect(evaluateControls(s, 0)['spine.lean']).toBeCloseTo(10);
    expect(evaluateControls(s, 1)['spine.lean']).toBeCloseTo(10 + 10 + 3);
    expect(evaluateControls(s, 2)['spine.lean']).toBeCloseTo(30);
    expect(evaluateControls(s, 0)['spine.side']).toBe(0);
  });

  it('clamps to the control range', () => {
    const s = scheme({ base: { 'leftArm.elbow': 400, 'rightArm.elbow': -50, 'hips.crouch': 5 } });
    const v = evaluateControls(s, 0);
    expect(v['leftArm.elbow']).toBe(CONTROLS['leftArm.elbow'].max);
    expect(v['rightArm.elbow']).toBe(0);
    expect(v['hips.crouch']).toBe(CONTROLS['hips.crouch'].max);
  });

  it('resolves both-sides shorthands, with exact names taking precedence', () => {
    expect(resolveTarget('arms.raise')).toEqual(['leftArm.raise', 'rightArm.raise']);
    expect(resolveTarget('feet.turn')).toEqual(['leftFoot.turn', 'rightFoot.turn']);
    expect(resolveTarget('legs.knee')).toEqual(['leftLeg.knee', 'rightLeg.knee']);
    expect(resolveTarget('spine.lean')).toEqual(['spine.lean']);
    expect(resolveTarget('arms.nope')).toEqual([]);
    const s = scheme({ base: { 'leftArm.raise': 50, 'arms.raise': 20 }, oscillators: [{ control: 'arms.elbow', amp: 10, period: 4 }] });
    const v = evaluateControls(s, 1);
    expect(v['leftArm.raise']).toBe(50);
    expect(v['rightArm.raise']).toBe(20);
    expect(v['leftArm.elbow']).toBeCloseTo(10);
    expect(v['rightArm.elbow']).toBeCloseTo(10);
  });

  it('mirror drives the other side, delayed by the given beats', () => {
    expect(mirrorControl('leftArm.raise')).toEqual({ control: 'rightArm.raise', sign: 1 });
    expect(mirrorControl('rightFoot.side')).toEqual({ control: 'leftFoot.side', sign: 1 });
    expect(mirrorControl('spine.twist')).toEqual({ control: 'spine.twist', sign: -1 });
    expect(mirrorControl('spine.lean')).toEqual({ control: 'spine.lean', sign: 1 });

    const s = scheme({ tracks: [{ control: 'leftArm.raise', keys: [[0, 0, 'linear'], [1, 90, 'linear'], [2, 0, 'linear']], mirror: 2 }] });
    for (const beat of [0, 0.5, 1, 1.7, 2.5, 3, 3.9]) {
      expect(evaluateControls(s, beat + 2)['rightArm.raise']).toBeCloseTo(evaluateControls(s, beat)['leftArm.raise']);
    }
    expect(evaluateControls(s, 1)['leftArm.raise']).toBeCloseTo(90);
    expect(evaluateControls(s, 1)['rightArm.raise']).toBeCloseTo(0);
    expect(evaluateControls(s, 3)['rightArm.raise']).toBeCloseTo(90);

    const together = scheme({ oscillators: [{ control: 'rightLeg.spread', amp: 10, period: 4, mirror: true }] });
    expect(evaluateControls(together, 1)['leftLeg.spread']).toBeCloseTo(10);
    expect(evaluateControls(together, 1)['rightLeg.spread']).toBeCloseTo(10);
  });

  it('mirror on a lateral centre control adds the sign-flipped, delayed copy', () => {
    // Author the first half only; the mirror supplies the second half.
    const s = scheme({ tracks: [{ control: 'hips.shift', keys: [[0, 0, 'linear'], [1, 0.1, 'linear'], [2, 0, 'linear']], mirror: 2 }] });
    expect(evaluateControls(s, 1)['hips.shift']).toBeCloseTo(0.1);
    expect(evaluateControls(s, 3)['hips.shift']).toBeCloseTo(-0.1);
    expect(evaluateControls(s, 0.5)['hips.shift']).toBeCloseTo(-evaluateControls(s, 2.5)['hips.shift']);
  });

  it('repeat loops a phrase over the whole dance', () => {
    const s = scheme({ beats: 8, tracks: [{ control: 'head.nod', repeat: 2, keys: [[0, 0, 'linear'], [1, 20, 'linear']] }] });
    for (const beat of [0.25, 1, 1.5]) {
      for (const cycle of [1, 2, 3]) expect(evaluateControls(s, beat + 2 * cycle)['head.nod']).toBeCloseTo(evaluateControls(s, beat)['head.nod']);
    }
    expect(evaluateControls(s, 5)['head.nod']).toBeCloseTo(20);
    expect(evaluateControls(s, 5.5)['head.nod']).toBeCloseTo(10);
  });

  it('lag delays a layer or a whole control; scale multiplies a layer', () => {
    const keys: DanceKey[] = [
      [0, 0, 'linear'],
      [2, 20, 'linear'],
    ];
    const plain = scheme({ tracks: [{ control: 'head.nod', keys }] });
    const layerLag = scheme({ tracks: [{ control: 'head.nod', keys, lag: 0.5, scale: 2 }] });
    const controlLag = scheme({ tracks: [{ control: 'head.nod', keys }], lag: { 'head.nod': 0.5 } });
    for (const beat of [0.5, 1.2, 3]) {
      const reference = evaluateControls(plain, beat - 0.5)['head.nod'];
      expect(evaluateControls(layerLag, beat)['head.nod']).toBeCloseTo(2 * reference);
      expect(evaluateControls(controlLag, beat)['head.nod']).toBeCloseTo(reference);
    }
    // A control lag given for a group reaches both sides.
    const expanded = expandScheme(scheme({ oscillators: [{ control: 'arms.wrist', amp: 10, period: 4 }], lag: { 'arms.wrist': 1 } }));
    expect(evalControl(expanded, 'leftArm.wrist', 2)).toBeCloseTo(10);
    expect(evalControl(expanded, 'rightArm.wrist', 2)).toBeCloseTo(10);
  });

  it('samples one loop without repeating the loop point, and smooth rounds off corners', () => {
    const sharp = scheme({ tracks: [{ control: 'head.nod', keys: [[0, 0, 'hold'], [2, 20, 'hold']] }] });
    const samples = sampleControls(sharp, 40)['head.nod'];
    expect(samples).toHaveLength(40);
    expect(samples[0]).toBe(0);
    expect(samples[19]).toBe(0);
    expect(samples[20]).toBe(20);
    expect(samples[39]).toBe(20);

    const soft = sampleControls({ ...sharp, smooth: { 'head.nod': 1 } }, 40)['head.nod'];
    expect(soft[20]).toBeGreaterThan(2);
    expect(soft[20]).toBeLessThan(18);
    expect(soft[10]).toBeCloseTo(0, 5);
    expect(soft[30]).toBeCloseTo(20, 5);
    // The blur is periodic: the step at the loop point is softened too, and the mean is kept.
    expect(soft[0]).toBeGreaterThan(2);
    expect(soft[0]).toBeLessThan(18);
    const mean = (values: Float64Array) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(soft)).toBeCloseTo(mean(samples), 6);
  });
});
