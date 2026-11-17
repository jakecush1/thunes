import { describe, expect, it } from 'vitest';
import { SCENE_DEFAULTS, SCENE_FIELDS } from '../../../src/config';
import { BACKGROUNDS, customBackground, getBackground, resolveBackground } from '../../../src/stage/backgrounds';
import { hexToRgb, luminance, mixHex, normalizeHex, rgbToHex } from '../../../src/stage/color';
import { floorColors } from '../../../src/stage/floor';
import { exposureGain, fogDensity, fogVeil } from '../../../src/stage/lighting';
import { bufferSize, qualitySettings } from '../../../src/stage/quality';
import {
  FLASH_DECAY,
  MIN_FLASH_INTERVAL,
  createStrobeState,
  flashOpacity,
  stepStrobe,
  strobeActive,
  strobePhase,
} from '../../../src/stage/strobe';

describe('colour helpers', () => {
  it('parses and formats hex colours', () => {
    expect(hexToRgb('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(hexToRgb('fff')).toEqual([1, 1, 1]);
    expect(hexToRgb('nonsense')).toEqual([0, 0, 0]);
    expect(rgbToHex(1, 0.5, -1)).toBe('#ff8000');
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
  it('computes luminance', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('#00ff00')).toBeGreaterThan(luminance('#0000ff'));
  });
});

describe('background presets', () => {
  it('has about 19 presets with unique ids and the expected mix of kinds', () => {
    expect(BACKGROUNDS.length).toBe(19);
    expect(new Set(BACKGROUNDS.map((p) => p.id)).size).toBe(BACKGROUNDS.length);
    expect(new Set(BACKGROUNDS.map((p) => p.name)).size).toBe(BACKGROUNDS.length);
    const count = (kind: string) => BACKGROUNDS.filter((p) => p.kind === kind).length;
    expect(count('gradient')).toBe(8);
    expect(count('sky')).toBe(4);
    expect(count('solid')).toBe(3);
    expect(count('place')).toBe(4);
  });
  it('gives every place a sky, its scenery and (except the boat) a natural floor', () => {
    const places = BACKGROUNDS.filter((p) => p.kind === 'place');
    expect(places.map((p) => p.place).sort()).toEqual(['city', 'desert', 'forest', 'ocean']);
    for (const p of places) {
      expect(p.sky).toBeDefined();
      expect(p.ground).toBeDefined();
      if (p.place === 'ocean') expect(p.naturalFloor).toBeUndefined();
      else expect(['grass', 'concrete', 'sand']).toContain(p.naturalFloor);
    }
    expect(BACKGROUNDS.filter((p) => p.kind !== 'place').every((p) => p.place === undefined)).toBe(true);
  });
  it('includes the default from config and never uses the reserved id', () => {
    expect(BACKGROUNDS.some((p) => p.id === SCENE_DEFAULTS.background)).toBe(true);
    expect(BACKGROUNDS.some((p) => p.id === 'custom')).toBe(false);
  });
  it('gives every preset well-formed colours, stops and a swatch', () => {
    const hex = /^#[0-9a-f]{6}$/;
    for (const p of BACKGROUNDS) {
      expect(p.swatch.length).toBeGreaterThan(3);
      expect(p.stops.length).toBeGreaterThanOrEqual(1);
      expect(p.stops.length).toBeLessThanOrEqual(4);
      for (let i = 0; i < p.stops.length; i++) {
        expect(p.stops[i]!.color).toMatch(hex);
        if (i > 0) expect(p.stops[i]!.at).toBeGreaterThan(p.stops[i - 1]!.at);
      }
      for (const c of [p.fog, p.floor.line, p.floor.accent, p.floor.glow, p.light.key, p.light.fill, p.light.bounce, p.light.rim]) {
        expect(c).toMatch(hex);
      }
      expect(p.floor.shadow).toBeGreaterThan(0);
      expect(p.floor.shadow).toBeLessThanOrEqual(1);
      if (p.kind === 'sky') {
        expect(p.sky).toBeDefined();
        expect(p.ground).toMatch(hex);
      }
      if (p.kind === 'solid') expect(p.stops.length).toBe(1);
    }
  });
  it('falls back to club for unknown ids', () => {
    expect(getBackground('nope').id).toBe('club');
    expect(resolveBackground({ background: 'nope', backgroundColor: '#123456' }).id).toBe('club');
    expect(resolveBackground({ background: 'mint', backgroundColor: '#123456' }).id).toBe('mint');
  });
  it('derives a solid from the custom colour and caches it', () => {
    const a = resolveBackground({ background: 'custom', backgroundColor: '#FFFFFF' });
    expect(a.kind).toBe('solid');
    expect(a.stops[0]!.color).toBe('#ffffff');
    expect(a.fog).toBe('#ffffff');
    expect(resolveBackground({ background: 'custom', backgroundColor: '#FFFFFF' })).toBe(a);
    const dark = customBackground('#101010');
    // Floor lines contrast with the backdrop in both directions.
    expect(luminance(a.floor.line)).toBeLessThan(0.5);
    expect(luminance(dark.floor.line)).toBeGreaterThan(0.3);
    expect(dark.floor.glowStrength).toBeGreaterThan(0);
    expect(dark.floor.shadow).toBeGreaterThan(a.floor.shadow);
  });
  it('picks floor colours from the scene or the preset', () => {
    const club = getBackground('club');
    expect(floorColors(null, club)).toEqual({ line: club.floor.line, accent: club.floor.accent });
    const custom = floorColors('#00ff00', club);
    expect(custom.line).toBe('#00ff00');
    expect(custom.accent).not.toBe('#00ff00');
  });
});

describe('quality', () => {
  it('maps levels to pixel ratio and shadows', () => {
    expect(qualitySettings('low', 3)).toEqual({ pixelRatio: 1, shadows: false, shadowMapSize: 0 });
    expect(qualitySettings('medium', 3)).toEqual({ pixelRatio: 1.5, shadows: true, shadowMapSize: 2048 });
    expect(qualitySettings('high', 3)).toEqual({ pixelRatio: 2, shadows: true, shadowMapSize: 4096 });
    expect(qualitySettings('high', 1).pixelRatio).toBe(1);
    expect(qualitySettings('medium', 1.25).pixelRatio).toBe(1.25);
    expect(qualitySettings('medium', 0.5).pixelRatio).toBe(1);
    expect(qualitySettings('medium', Number.NaN).pixelRatio).toBe(1);
  });
  it('keeps the drawing buffer positive and within the size limit', () => {
    expect(bufferSize(0, 0, 2)).toEqual({ width: 1, height: 1, pixelRatio: 2 });
    expect(bufferSize(800.7, 600.2, 1.5)).toEqual({ width: 800, height: 600, pixelRatio: 1.5 });
    const capped = bufferSize(4000, 1000, 2, 4096);
    expect(capped.pixelRatio).toBeCloseTo(1.024, 6);
    expect(capped.width * capped.pixelRatio).toBeLessThanOrEqual(4096);
  });
});

describe('fog and exposure', () => {
  it('maps the fog slider monotonically from clear to thick', () => {
    expect(fogDensity(0)).toBe(0);
    expect(fogDensity(-1)).toBe(0);
    expect(fogDensity(Number.NaN)).toBe(0);
    expect(fogDensity(2)).toBe(fogDensity(1));
    let last = 0;
    for (let f = 0.1; f <= 1.0001; f += 0.1) {
      const d = fogDensity(f);
      expect(d).toBeGreaterThan(last);
      last = d;
    }
    // Default fog barely touches a dancer at the stage centre; full fog mostly hides one.
    const transmission = (density: number, distance: number) => Math.exp(-((density * distance) ** 2));
    expect(transmission(fogDensity(SCENE_FIELDS.fog.default), 8)).toBeGreaterThan(0.95);
    expect(transmission(fogDensity(1), 8)).toBeLessThan(0.35);
  });
  it('veils the backdrop between 0 and 1', () => {
    expect(fogVeil(0)).toBe(0);
    expect(fogVeil(fogDensity(1))).toBeGreaterThan(0.99);
    expect(fogVeil(fogDensity(0.2))).toBeLessThan(0.2);
  });
  it('leaves graphic layers untouched at exposure 1', () => {
    expect(exposureGain(1)).toBe(1);
    expect(exposureGain(0.25)).toBeLessThan(1);
    expect(exposureGain(2)).toBeGreaterThan(1);
    expect(exposureGain(-1)).toBe(0);
  });
});

describe('strobe', () => {
  const synced = { strobeSync: true, strobeDivision: 2 as const, strobeBpm: 240, strobeIntensity: 0.8 };
  const free = { strobeSync: false, strobeDivision: 1 as const, strobeBpm: 120, strobeIntensity: 1 };

  it('only runs with consent and a positive intensity', () => {
    expect(strobeActive(false, 1)).toBe(false);
    expect(strobeActive(true, 0)).toBe(false);
    expect(strobeActive(true, 0.01)).toBe(true);
  });
  it('decays within about 60 ms regardless of frame rate', () => {
    expect(flashOpacity(0.8, 0)).toBeCloseTo(0.8, 6);
    expect(flashOpacity(0.8, FLASH_DECAY / 2)).toBeLessThan(0.4);
    expect(flashOpacity(0.8, FLASH_DECAY)).toBe(0);
    expect(flashOpacity(0.8, 1)).toBe(0);
    expect(flashOpacity(0.8, -0.01)).toBe(0);
    expect(flashOpacity(5, 0)).toBe(1);
    expect(FLASH_DECAY).toBeLessThanOrEqual(0.07);
  });
  it('derives the phase from the beat when synced and from time otherwise', () => {
    expect(strobePhase(synced, 123, 3.5)).toBeCloseTo(1.75, 9);
    expect(strobePhase(free, 0.5, 99)).toBe(1);
  });
  it('never flashes while inactive, whatever the clock does', () => {
    const state = createStrobeState();
    for (let i = 0; i < 600; i++) {
      const t = i / 60;
      expect(stepStrobe(state, false, free, t, t * 2)).toBe(0);
    }
  });
  it('does not flash at the moment it is switched on', () => {
    const state = createStrobeState();
    expect(stepStrobe(state, true, free, 10.01, 0)).toBe(0);
  });

  function run(scene: typeof synced | typeof free, fpsRate: number, seconds: number, bpm = 120) {
    const state = createStrobeState();
    let onsets = 0;
    let previous = 0;
    let peak = 0;
    let lit = 0;
    const frames = Math.round(seconds * fpsRate);
    for (let i = 0; i <= frames; i++) {
      const t = 0.013 + i / fpsRate;
      const opacity = stepStrobe(state, true, scene, t, (t * bpm) / 60);
      if (opacity > previous + 1e-9 && opacity > 0) onsets++;
      if (opacity > 0) lit++;
      peak = Math.max(peak, opacity);
      previous = opacity;
    }
    return { onsets, peak, litFraction: lit / (frames + 1) };
  }

  it('flashes once every strobeDivision beats when synced', () => {
    // 120 BPM, every 2 beats → 1 flash per second.
    const result = run(synced, 60, 5);
    expect(result.onsets).toBeGreaterThanOrEqual(4);
    expect(result.onsets).toBeLessThanOrEqual(5);
    expect(result.peak).toBeCloseTo(0.8, 6);
  });
  it('flashes strobeBpm times per minute when free, at any frame rate', () => {
    for (const rate of [30, 60, 144]) {
      const result = run(free, rate, 5);
      expect(result.onsets).toBeGreaterThanOrEqual(9);
      expect(result.onsets).toBeLessThanOrEqual(10);
      // Each flash lasts 60 ms out of every 500 ms.
      expect(result.litFraction).toBeLessThan(0.35);
    }
  });
  it('never exceeds three flashes per second, whatever is requested', () => {
    expect(MIN_FLASH_INTERVAL).toBeGreaterThanOrEqual(1 / 3 - 1e-12);
    const fast = { strobeSync: false, strobeDivision: 1 as const, strobeBpm: 1200, strobeIntensity: 1 };
    const state = createStrobeState();
    let lastOnset = -Infinity;
    let previous = 0;
    for (let i = 0; i < 1200; i++) {
      const t = i / 240;
      // 20 flashes per second requested.
      const opacity = stepStrobe(state, true, fast, t, (t * 300) / 60);
      if (opacity > previous + 1e-9) {
        expect(t - lastOnset).toBeGreaterThanOrEqual(MIN_FLASH_INTERVAL - 1e-9);
        lastOnset = t;
      }
      previous = opacity;
    }
  });
  it('survives a clock jump with a single flash', () => {
    const state = createStrobeState();
    stepStrobe(state, true, free, 1.0, 0);
    const opacity = stepStrobe(state, true, free, 61.0, 0);
    expect(opacity).toBe(1);
    expect(stepStrobe(state, true, free, 61.0 + FLASH_DECAY, 0)).toBe(0);
  });
});
