import { describe, expect, it } from 'vitest';
import type { SongPattern } from '../../../src/audio/pattern';
import { BUILTIN_SONGS } from '../../../src/audio/songs';
import {
  arrange, chordAt, createRandom, expandPattern, hashString, midiToHz, noteNameToMidi, parseChord, parseSteps,
  patternSeconds, pitchAtOrAbove, resolvePitch, resolveSection, stepSeconds, stepTime, stepVelocity,
} from '../../../src/audio/sequence';
import { AUDIO_DEFAULTS } from '../../../src/config';

function song(overrides: Partial<SongPattern> = {}): SongPattern {
  return {
    format: 'thunes-song@1',
    bpm: 120,
    bars: 2,
    seed: 7,
    tracks: { kick: { kind: 'kick', humanize: 0 }, bass: { kind: 'bass' } },
    sections: {
      A: {
        bars: 1,
        chords: ['Am', 'F'],
        parts: { kick: 'x...x...x...x...', bass: { steps: 'x.......x.......', pitches: ['1', '5'], gate: 2 } },
      },
    },
    arrangement: ['A', 'A'],
    ...overrides,
  };
}

describe('seeded random', () => {
  it('is deterministic per seed and uniform in [0, 1)', () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const c = createRandom(43);
    const first = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(first);
    expect(Array.from({ length: 5 }, () => c())).not.toEqual(first);
    const random = createRandom(1);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const v = random();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 20000).toBeCloseTo(0.5, 1);
  });

  it('hashes strings stably', () => {
    expect(hashString('kick')).toBe(hashString('kick'));
    expect(hashString('kick')).not.toBe(hashString('snare'));
    expect(hashString('')).toBe(0x811c9dc5);
  });
});

describe('step timing', () => {
  it('places straight 16ths evenly', () => {
    expect(stepSeconds(120)).toBeCloseTo(0.125, 12);
    expect(stepTime(0, 120)).toBe(0);
    expect(stepTime(4, 120)).toBeCloseTo(0.5, 12);
    expect(stepTime(7, 90)).toBeCloseTo((7 * 60) / 90 / 4, 12);
  });

  it('delays every second 16th with swing and leaves the others alone', () => {
    const unit = stepSeconds(120);
    expect(stepTime(2, 120, 1)).toBeCloseTo(2 * unit, 12);
    expect(stepTime(1, 120, 1)).toBeCloseTo((1 + 1 / 3) * unit, 12); // full swing = triplet
    expect(stepTime(3, 120, 0.5)).toBeCloseTo((3 + 1 / 6) * unit, 12);
    expect(stepTime(32, 120, 0.7)).toBeCloseTo(32 * unit, 12); // bar lines never move
  });

  it('is monotonic and continuous for fractional steps', () => {
    let previous = stepTime(0, 100, 0.8);
    expect(previous).toBe(0);
    for (let step = 0.125; step <= 8; step += 0.125) {
      const time = stepTime(step, 100, 0.8);
      expect(time).toBeGreaterThan(previous);
      expect(time - previous).toBeLessThan(stepSeconds(100));
      previous = time;
    }
  });
});

describe('pitches and chords', () => {
  it('converts note names', () => {
    expect(noteNameToMidi('C4')).toBe(60);
    expect(noteNameToMidi('A4')).toBe(69);
    expect(noteNameToMidi('F#2')).toBe(42);
    expect(noteNameToMidi('Bb3')).toBe(58);
    expect(noteNameToMidi('chord')).toBeNull();
    expect(midiToHz(69)).toBeCloseTo(440, 9);
    expect(midiToHz(57)).toBeCloseTo(220, 9);
  });

  it('parses chord names', () => {
    expect(parseChord('Am').tones).toEqual([0, 3, 7]);
    expect(parseChord('Am').root).toBe(9);
    expect(parseChord('F#m7')).toMatchObject({ root: 6, tones: [0, 3, 7, 10] });
    expect(parseChord('Bbmaj7')).toMatchObject({ root: 10, tones: [0, 4, 7, 11] });
    expect(parseChord('Esus4').degrees['3']).toBe(5);
    expect(parseChord('C').degrees['7']).toBe(10);
    expect(parseChord('Cmaj7').degrees['7']).toBe(11);
    expect(() => parseChord('Hm')).toThrow(/Unknown chord/);
    expect(() => parseChord('Cwat')).toThrow(/Unknown chord/);
  });

  it('resolves absolute, chord-relative and whole-chord pitches', () => {
    const am = parseChord('Am');
    expect(resolvePitch(61, am, 0)).toEqual([61]);
    expect(resolvePitch('E2', am, 0)).toEqual([40]);
    expect(pitchAtOrAbove(9, 28)).toBe(33);
    expect(resolvePitch('1', am, 28)).toEqual([33]); // A1
    expect(resolvePitch('5', am, 28)).toEqual([40]);
    expect(resolvePitch('1+', am, 28)).toEqual([45]);
    expect(resolvePitch('3--', am, 60)).toEqual([69 + 3 - 24]);
    expect(resolvePitch('chord', am, 48)).toEqual([48, 52, 57]); // C3 E3 A3
    expect(resolvePitch('chord', parseChord('F'), 48)).toEqual([48, 53, 57]); // C3 F3 A3: one voice moves
    expect(() => resolvePitch('1', null, 28)).toThrow(/needs a chord/);
    expect(() => resolvePitch('x9', am, 28)).toThrow(/Unknown pitch/);
  });

  it('finds the chord at a step, including split bars', () => {
    const chords = [[parseChord('Am')], [parseChord('F'), parseChord('G')]];
    expect(chordAt(chords, 0)?.root).toBe(9);
    expect(chordAt(chords, 16)?.root).toBe(5);
    expect(chordAt(chords, 24)?.root).toBe(7);
    expect(chordAt(chords, 32)?.root).toBe(9); // repeats
    expect(chordAt([], 3)).toBeNull();
  });
});

describe('step strings', () => {
  it('maps characters to velocities', () => {
    expect(stepVelocity('.')).toBe(0);
    expect(stepVelocity('x')).toBe(0.8);
    expect(stepVelocity('X')).toBe(1);
    expect(stepVelocity('o')).toBe(0.45);
    expect(stepVelocity('5')).toBe(0.5);
    expect(() => stepVelocity('?')).toThrow();
  });

  it('parses bars, ignoring spaces and bar lines', () => {
    expect(parseSteps('x... x... | x... x.X.')).toHaveLength(16);
    expect(parseSteps(['x...x...x...x...', '................'])).toHaveLength(32);
    expect(parseSteps('x...x...x...x...x...x...x...x...')).toHaveLength(32);
    expect(() => parseSteps('x...')).toThrow(/multiple of 16/);
  });
});

describe('sections and arrangement', () => {
  const pattern = song({
    bars: 6,
    sections: {
      A: { bars: 2, chords: ['Am'], parts: { kick: 'x...x...x...x...', bass: { bar: [[0, '1', 4]] } } },
      B: { extends: 'A', chords: ['F'], parts: { kick: ['x...x...x...x...', 'x.x.x.x.x.x.x.xx'], bass: null } },
      C: { extends: 'B', bars: 1 },
    },
    arrangement: ['A', 'B', 'C', 'C'],
  });

  it('applies extends, overrides and removals', () => {
    const b = resolveSection(pattern, 'B');
    expect(b.bars).toBe(2);
    expect(b.chords).toEqual(['F']);
    expect(Object.keys(b.parts)).toEqual(['kick']);
    expect(resolveSection(pattern, 'C').bars).toBe(1);
    expect(() => resolveSection(pattern, 'nope')).toThrow(/Unknown section/);
    expect(() => resolveSection(song({ sections: { A: { extends: 'A' } } }), 'A')).toThrow(/extends itself/);
  });

  it('lays sections out on the bar grid and checks the total length', () => {
    expect(arrange(pattern).map((entry) => [entry.name, entry.startBar])).toEqual([['A', 0], ['B', 2], ['C', 4], ['C', 5]]);
    expect(() => arrange({ ...pattern, bars: 8 })).toThrow(/6 bars long but the song says 8/);
  });

  it('expands drum parts with fills in the right bars', () => {
    const kicks = expandPattern(pattern).filter((event) => event.track === 'kick').map((event) => event.step);
    // A: bars 0-1 four on the floor; B: bar 2 plain, bar 3 fill; C twice: bar 4, bar 5 plain.
    expect(kicks.filter((step) => step < 32)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
    expect(kicks.filter((step) => step >= 48 && step < 64)).toEqual([48, 50, 52, 54, 56, 58, 60, 62, 63]);
    expect(kicks.filter((step) => step >= 64)).toEqual([64, 68, 72, 76, 80, 84, 88, 92]);
  });
});

describe('expandPattern', () => {
  it('produces time-stamped, sorted events with resolved pitches', () => {
    const events = expandPattern(song());
    expect(events.map((event) => event.time)).toEqual([...events.map((event) => event.time)].sort((a, b) => a - b));
    const bass = events.filter((event) => event.track === 'bass');
    // Bar 1 is Am (the section's chords restart with every arrangement entry): A1 then E2.
    expect(bass.map((event) => event.notes)).toEqual([[33], [40], [33], [40]]);
    expect(bass.map((event) => event.time)).toEqual([0, 1, 2, 3]);
    expect(bass[0].duration).toBeCloseTo(0.25, 9);
    const kicks = events.filter((event) => event.track === 'kick');
    expect(kicks).toHaveLength(8);
    expect(kicks.every((event) => event.velocity === 0.8 && event.notes.length === 0)).toBe(true);
    expect(patternSeconds(song())).toBe(4);
  });

  it('follows the chords bar by bar within a section', () => {
    const pattern = song({
      bars: 2,
      sections: { A: { bars: 2, chords: ['Am', 'F'], parts: { bass: { bar: [[0, '1', 4], [8, ['1', '5'], 4, 0.5]] } } } },
      arrangement: ['A'],
    });
    const bass = expandPattern(pattern).filter((event) => event.track === 'bass');
    expect(bass.map((event) => event.notes)).toEqual([[33], [33, 40], [29], [29, 36]]);
    expect(bass.map((event) => event.velocity)).toEqual([0.8, 0.5, 0.8, 0.5]);
  });

  it('applies swing per track and transposition', () => {
    const pattern = song({
      swing: 1,
      tracks: { hat: { kind: 'hat', humanize: 0 }, rim: { kind: 'perc', swing: 0, humanize: 0 }, bass: { kind: 'bass', transpose: 12 } },
      sections: { A: { bars: 1, chords: ['C'], parts: { hat: 'xxxx............', rim: 'xxxx............', bass: { notes: [[1, 'C2', 1]] } } } },
    });
    const events = expandPattern(pattern);
    const unit = 0.125;
    expect(events.filter((e) => e.track === 'hat' && e.step < 16).map((e) => e.time)).toEqual([0, unit * (1 + 1 / 3), unit * 2, unit * (3 + 1 / 3)].map((t) => expect.closeTo(t, 9)));
    expect(events.filter((e) => e.track === 'rim' && e.step < 16).map((e) => e.time)).toEqual([0, unit, unit * 2, unit * 3]);
    expect(events.find((e) => e.track === 'bass')?.notes).toEqual([48]);
  });

  it('humanises velocities deterministically from the seed', () => {
    const pattern = song({ tracks: { kick: { kind: 'kick', humanize: 0.3 }, bass: { kind: 'bass' } } });
    const a = expandPattern(pattern).filter((e) => e.track === 'kick').map((e) => e.velocity);
    const b = expandPattern(pattern).filter((e) => e.track === 'kick').map((e) => e.velocity);
    const c = expandPattern({ ...pattern, seed: 8 }).filter((e) => e.track === 'kick').map((e) => e.velocity);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(new Set(a).size).toBeGreaterThan(1);
    expect(a.every((v) => v > 0.8 * 0.69 && v < 0.8 * 1.31)).toBe(true);
  });

  it('rejects malformed patterns with readable messages', () => {
    expect(() => expandPattern({ ...song(), format: 'other' as 'thunes-song@1' })).toThrow(/Unsupported song format/);
    expect(() => expandPattern(song({ bpm: 0 }))).toThrow(/tempo/);
    expect(() => expandPattern(song({ bars: 3 }))).toThrow(/2 bars long but the song says 3/);
    expect(() => expandPattern(song({ sections: { A: { bars: 1, parts: { kick: { notes: [[0, 'C2', 1]] } } } } }))).toThrow(/drum/);
    expect(() => expandPattern(song({ sections: { A: { bars: 1, parts: { kick: 'x..' } } } }))).toThrow(/multiple of 16/);
    expect(() => expandPattern(song({ sections: { A: { bars: 1, parts: { bass: { notes: [[0, '1', 1]] } } } } }))).toThrow(/needs a chord/);
  });
});

describe('built-in songs', () => {
  it('has six original songs with unique ids, including the default', () => {
    expect(BUILTIN_SONGS).toHaveLength(6);
    const ids = BUILTIN_SONGS.map((s) => s.id);
    expect(new Set(ids).size).toBe(6);
    expect(ids.every((id) => /^builtin:[a-z0-9-]+$/.test(id))).toBe(true);
    expect(ids).toContain(AUDIO_DEFAULTS.songId);
    expect(new Set(BUILTIN_SONGS.map((s) => s.title)).size).toBe(6);
    expect(BUILTIN_SONGS.every((s) => s.source === 'builtin' && s.vibe && s.pattern && !s.url)).toBe(true);
  });

  it('has distinct tempos between 85 and 142 bpm and 8 to 16 bars', () => {
    const tempos = BUILTIN_SONGS.map((s) => s.bpm ?? 0);
    expect(new Set(tempos).size).toBe(6);
    for (const s of BUILTIN_SONGS) {
      expect(s.bpm).toBe(s.pattern?.bpm);
      expect(s.bpm).toBeGreaterThanOrEqual(85);
      expect(s.bpm).toBeLessThanOrEqual(142);
      expect(s.pattern?.bars).toBeGreaterThanOrEqual(8);
      expect(s.pattern?.bars).toBeLessThanOrEqual(16);
      expect(s.duration).toBeCloseTo(patternSeconds(s.pattern!), 9);
    }
  });

  it.each(BUILTIN_SONGS.map((s) => [s.id, s] as const))('%s expands into a full arrangement', (_id, def) => {
    const pattern = def.pattern!;
    const events = expandPattern(pattern);
    const steps = pattern.bars * 16;
    expect(events.length).toBeGreaterThan(pattern.bars * 12);
    expect(events.every((e) => e.step >= 0 && e.step < steps && e.time >= 0 && e.time < patternSeconds(pattern))).toBe(true);
    // Every track is used, there is a kick in every bar, and pitched notes are in a sane range.
    for (const track of Object.keys(pattern.tracks)) expect(events.some((e) => e.track === track), track).toBe(true);
    for (let bar = 0; bar < pattern.bars; bar++) {
      expect(events.some((e) => e.track === 'kick' && e.step === bar * 16), `kick on bar ${bar}`).toBe(true);
    }
    for (const e of events) for (const note of e.notes) expect(note >= 24 && note <= 96, `${e.track} note ${note}`).toBe(true);
    // An A/B structure: the second half is not a copy of the first.
    const half = (from: number): string => events.filter((e) => e.step >= from && e.step < from + steps / 2).map((e) => `${e.track}@${e.step - from}:${e.notes.join('.')}`).join(' ');
    expect(half(0)).not.toBe(half(steps / 2));
    // JSON-compatible data.
    expect(JSON.parse(JSON.stringify(pattern))).toEqual(pattern);
  });
});
