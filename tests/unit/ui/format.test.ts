import { describe, expect, it } from 'vitest';
import { DANCER_FIELDS, SCENE_FIELDS } from '../../../src/config';
import { clampToField, fillPercent, formatValue, formatValueText, parseValue, slugify, snapshotFileName, wrapDegrees } from '../../../src/ui/format';

describe('formatValue', () => {
  it('uses the field digits and unit', () => {
    expect(formatValue(1.2, DANCER_FIELDS.scale)).toBe('1.20×');
    expect(formatValue(35, DANCER_FIELDS.rotation)).toBe('35°');
    expect(formatValue(1.25, SCENE_FIELDS.cameraLoopHeight)).toBe('1.3 m');
    expect(formatValue(240, SCENE_FIELDS.strobeBpm)).toBe('240 bpm');
    expect(formatValue(0.5, DANCER_FIELDS.offset)).toBe('0.50');
  });
  it('writes negatives with a real minus and never shows -0', () => {
    expect(formatValue(-1.2, DANCER_FIELDS.x)).toBe('−1.20 m');
    expect(formatValue(-0.001, DANCER_FIELDS.x)).toBe('0.00 m');
    expect(formatValue(-0.4, DANCER_FIELDS.rotation)).toBe('0°');
    expect(formatValueText(-1.2, DANCER_FIELDS.x)).toBe('-1.20 m');
  });
  it('survives non-finite input', () => {
    expect(formatValue(Number.NaN, DANCER_FIELDS.speed)).toBe('0.00×');
  });
});

describe('parseValue', () => {
  const x = DANCER_FIELDS.x;
  it('accepts units, commas, unicode minus and a plus sign', () => {
    expect(parseValue('1.5', x)).toBe(1.5);
    expect(parseValue('−1,25 m', x)).toBe(-1.25);
    expect(parseValue('+2', x)).toBe(2);
    expect(parseValue('45°', DANCER_FIELDS.rotation)).toBe(45);
    expect(parseValue(' .5x ', DANCER_FIELDS.speed)).toBe(0.5);
  });
  it('clamps and snaps to the step', () => {
    expect(parseValue('99', x)).toBe(6);
    expect(parseValue('1.234', x)).toBe(1.23);
    expect(parseValue('12.34', SCENE_FIELDS.strobeBpm)).toBe(30);
    expect(parseValue('3.33', DANCER_FIELDS.warpWaves)).toBe(3.3);
  });
  it('returns null without a number', () => {
    expect(parseValue('', x)).toBeNull();
    expect(parseValue('abc', x)).toBeNull();
    expect(parseValue('-', x)).toBeNull();
  });
});

describe('clampToField / fillPercent', () => {
  it('snaps on the min-anchored grid without float noise', () => {
    expect(clampToField(0.1 + 0.2, DANCER_FIELDS.offset)).toBe(0.3);
    expect(clampToField(0.26, DANCER_FIELDS.scale)).toBe(0.26);
    expect(clampToField(Number.NaN, DANCER_FIELDS.scale)).toBe(0.25);
  });
  it('reports the fill as a percentage', () => {
    expect(fillPercent(0, DANCER_FIELDS.x)).toBe('50.00%');
    expect(fillPercent(-99, DANCER_FIELDS.x)).toBe('0.00%');
    expect(fillPercent(6, DANCER_FIELDS.x)).toBe('100.00%');
  });
});

describe('wrapDegrees', () => {
  it('wraps into [-180, 180)', () => {
    expect(wrapDegrees(0)).toBe(0);
    expect(wrapDegrees(180)).toBe(-180);
    expect(wrapDegrees(195)).toBe(-165);
    expect(wrapDegrees(-195)).toBe(165);
    expect(wrapDegrees(720 + 15)).toBe(15);
    expect(Object.is(wrapDegrees(-360), 0)).toBe(true);
  });
});

describe('file names', () => {
  it('slugifies titles', () => {
    expect(slugify('My Crew!  Ünïcode')).toBe('my-crew-unicode');
    expect(slugify('***')).toBe('scene');
  });
  it('names snapshots after the title and time', () => {
    const date = new Date(2026, 10, 17, 9, 5);
    expect(snapshotFileName('Late night crew', date)).toBe('thunes-late-night-crew-2026-11-17-0905.png');
    expect(snapshotFileName('', date)).toBe('thunes-2026-11-17-0905.png');
  });
});
