/**
 * Pure sequencing helpers: turn a SongPattern into a flat, time-stamped list
 * of note events. No Web Audio here, so everything is unit-testable in Node.
 */

import type { Instrument, NoteEvent, NotePart, Part, Pitch, SongPattern, SongSection, StepPattern } from './pattern';
import { STEPS_PER_BAR, isDrum } from './pattern';

// ───────────────────────────────────────────────────────────── PRNG ──

/**
 * Deterministic pseudo-random generator (mulberry32).
 * Returns a function that yields floats in [0, 1); the same seed always gives the same sequence.
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (FNV-1a), for deriving per-track seeds. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// ──────────────────────────────────────────────────────────── Timing ──

/** Seconds per 16th-note step at `bpm`. */
export function stepSeconds(bpm: number): number {
  return 60 / bpm / 4;
}

/**
 * Time in seconds of a (possibly fractional) step counted from the loop start.
 * Swing (0..1) delays the second 16th of every eighth by up to a third of a
 * step (1 = triplet shuffle); positions in between are stretched smoothly, so
 * the mapping is continuous and monotonic.
 */
export function stepTime(step: number, bpm: number, swing = 0): number {
  const unit = stepSeconds(bpm);
  if (swing <= 0) return step * unit;
  const pair = Math.floor(step / 2);
  const within = step - pair * 2; // 0..2
  const late = 1 + Math.min(1, swing) / 3; // where the odd step lands
  const warped = within <= 1 ? within * late : late + (within - 1) * (2 - late);
  return (pair * 2 + warped) * unit;
}

// ─────────────────────────────────────────────────── Pitches & chords ──

const NOTE_OFFSETS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** MIDI number of a note name such as 'C4' (= 60), 'F#2', 'Bb3'; null if it is not a note name. */
export function noteNameToMidi(name: string): number | null {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!match) return null;
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return NOTE_OFFSETS[match[1]] + accidental + (Number(match[3]) + 1) * 12;
}

/** Frequency in Hz of a MIDI note number (A4 = 69 = 440 Hz). */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** A chord reduced to what the sequencer needs. */
export interface Chord {
  /** Pitch class of the root, 0 (C) … 11 (B). */
  root: number;
  /** Semitone offsets of the chord tones above the root, ascending, starting with 0. */
  tones: number[];
  /** Offsets used for the degree tokens '2' '3' '4' '5' '6' '7' '9'. */
  degrees: Record<string, number>;
}

const QUALITIES: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '9': [0, 4, 7, 10, 14],
  m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  '5': [0, 7],
};

/** Parse a chord name ('Am7', 'F#maj7', 'Bb', 'Esus4'). Throws a readable error for unknown names. */
export function parseChord(name: string): Chord {
  const match = /^([A-G])([#b]?)(.*)$/.exec(name.trim());
  const tones = match ? QUALITIES[match[3]] : undefined;
  if (!match || !tones) throw new Error(`Unknown chord "${name}"`);
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  const root = (NOTE_OFFSETS[match[1]] + accidental + 12) % 12;
  const minor = tones.includes(3);
  const third = tones.find((t) => t >= 2 && t <= 5) ?? (minor ? 3 : 4);
  const fifth = tones.find((t) => t >= 6 && t <= 8) ?? 7;
  const seventh = tones.find((t) => t === 10 || t === 11) ?? 10;
  return {
    root,
    tones,
    degrees: { '1': 0, '2': 2, '3': third, '4': 5, '5': fifth, '6': 9, '7': seventh, '8': 12, '9': 14 },
  };
}

/** Lowest MIDI note with pitch class `pitchClass` that is at or above `low`. */
export function pitchAtOrAbove(pitchClass: number, low: number): number {
  return low + ((((pitchClass - low) % 12) + 12) % 12);
}

/**
 * Resolve one pitch to MIDI numbers.
 * Absolute pitches ignore the chord. Degree tokens are measured from the
 * chord's root (the first one at or above `low`); 'chord' gives every chord
 * tone folded into the octave starting at `low` (a close voicing that moves
 * little from chord to chord).
 */
export function resolvePitch(pitch: Pitch, chord: Chord | null, low: number): number[] {
  if (typeof pitch === 'number') return [pitch];
  const absolute = noteNameToMidi(pitch);
  if (absolute !== null) return [absolute];
  if (!chord) throw new Error(`Pitch "${pitch}" needs a chord, but the section has no chords`);
  if (pitch === 'chord') {
    const voiced = chord.tones.map((tone) => pitchAtOrAbove((chord.root + tone) % 12, low));
    return Array.from(new Set(voiced)).sort((a, b) => a - b);
  }
  const match = /^([1-9])([+-]*)$/.exec(pitch);
  if (!match) throw new Error(`Unknown pitch "${pitch}"`);
  let octaves = 0;
  for (const mark of match[2]) octaves += mark === '+' ? 1 : -1;
  return [pitchAtOrAbove(chord.root, low) + chord.degrees[match[1]] + octaves * 12];
}

// ─────────────────────────────────────────────────────── Step strings ──

/** Velocity (0..1) of one step character; 0 for a rest. Throws for unknown characters. */
export function stepVelocity(char: string): number {
  if (char === '.' || char === '-') return 0;
  if (char === 'x') return 0.8;
  if (char === 'X') return 1;
  if (char === 'o') return 0.45;
  if (char >= '1' && char <= '9') return Number(char) / 10;
  throw new Error(`Unknown step character "${char}"`);
}

/**
 * Flatten a step pattern into one velocity per step (0 = rest).
 * Spaces and '|' are ignored; every string must hold whole bars (a multiple of 16 steps).
 */
export function parseSteps(pattern: StepPattern): number[] {
  const out: number[] = [];
  for (const text of typeof pattern === 'string' ? [pattern] : pattern) {
    const clean = text.replace(/[\s|]/g, '');
    if (clean.length === 0 || clean.length % STEPS_PER_BAR !== 0) {
      throw new Error(`Step pattern "${text}" has ${clean.length} steps; expected a multiple of ${STEPS_PER_BAR}`);
    }
    for (const char of clean) out.push(stepVelocity(char));
  }
  if (out.length === 0) throw new Error('Empty step pattern');
  return out;
}

// ─────────────────────────────────────────────────────────── Sections ──

/** A section with `extends` chains applied. */
export interface ResolvedSection {
  bars: number;
  chords: string[];
  parts: Record<string, Part>;
}

/** Apply `extends` (recursively) and drop parts set to null. Throws on unknown names, cycles or a missing length. */
export function resolveSection(pattern: SongPattern, name: string, seen: string[] = []): ResolvedSection {
  const section: SongSection | undefined = pattern.sections[name];
  if (!section) throw new Error(`Unknown section "${name}"`);
  if (seen.includes(name)) throw new Error(`Section "${name}" extends itself`);
  const base: ResolvedSection = section.extends
    ? resolveSection(pattern, section.extends, [...seen, name])
    : { bars: 0, chords: [], parts: {} };
  const parts: Record<string, Part> = { ...base.parts };
  for (const [track, part] of Object.entries(section.parts ?? {})) {
    if (part === null) delete parts[track];
    else parts[track] = part;
  }
  const bars = section.bars ?? base.bars;
  if (!Number.isInteger(bars) || bars < 1) throw new Error(`Section "${name}" needs a whole number of bars`);
  return { bars, chords: section.chords ?? base.chords, parts };
}

/** Where each arrangement entry starts. */
export interface ArrangedSection {
  name: string;
  /** First bar of this entry within the loop. */
  startBar: number;
  section: ResolvedSection;
}

/** Lay the arrangement out on the bar grid. Throws if its length differs from `pattern.bars`. */
export function arrange(pattern: SongPattern): ArrangedSection[] {
  const out: ArrangedSection[] = [];
  let bar = 0;
  for (const name of pattern.arrangement) {
    const section = resolveSection(pattern, name);
    out.push({ name, startBar: bar, section });
    bar += section.bars;
  }
  if (bar !== pattern.bars) {
    throw new Error(`Arrangement is ${bar} bars long but the song says ${pattern.bars}`);
  }
  return out;
}

/** The chord sounding at `step` (counted from the section start), or null if the section has none. */
export function chordAt(chords: Chord[][], step: number): Chord | null {
  if (chords.length === 0) return null;
  const bar = Math.max(0, Math.floor(step / STEPS_PER_BAR));
  const inBar = chords[bar % chords.length];
  const within = Math.max(0, step - bar * STEPS_PER_BAR);
  return inBar[Math.min(inBar.length - 1, Math.floor((within / STEPS_PER_BAR) * inBar.length))];
}

// ───────────────────────────────────────────────────────────── Events ──

/** One note to synthesise. */
export interface SeqEvent {
  /** Track id. */
  track: string;
  /** Position on the 16th grid, counted from the loop start (before swing). */
  step: number;
  /** Start in seconds from the loop start (after swing). */
  time: number;
  /** Held length in seconds. */
  duration: number;
  /** 0..1, after humanisation. */
  velocity: number;
  /** MIDI notes sounded together (empty for drums). */
  notes: number[];
}

const DEFAULT_LOW: Record<string, number> = { bass: 28, pluck: 60, lead: 60, pad: 48, keys: 48 };

/** Lowest root (MIDI) for chord-relative pitches on this instrument. */
export function instrumentLow(instrument: Instrument): number {
  if (isDrum(instrument)) return 0;
  const low = instrument.low;
  if (typeof low === 'number') return low;
  if (typeof low === 'string') {
    const midi = noteNameToMidi(low);
    if (midi === null) throw new Error(`"low" must be a note name or MIDI number, got "${low}"`);
    return midi;
  }
  return DEFAULT_LOW[instrument.kind];
}

function isNotePart(part: Part): part is NotePart {
  return typeof part === 'object' && !Array.isArray(part);
}

/**
 * Expand a pattern into every note of one pass through the loop, sorted by
 * time. Deterministic: humanisation draws from a generator seeded by
 * `pattern.seed` and the track id.
 */
export function expandPattern(pattern: SongPattern): SeqEvent[] {
  if (pattern.format !== 'thunes-song@1') throw new Error(`Unsupported song format "${String(pattern.format)}"`);
  if (!(pattern.bpm > 20 && pattern.bpm < 400)) throw new Error(`Unreasonable tempo ${pattern.bpm}`);
  const events: SeqEvent[] = [];
  const arranged = arrange(pattern);
  const totalSteps = pattern.bars * STEPS_PER_BAR;

  for (const [track, instrument] of Object.entries(pattern.tracks)) {
    const drum = isDrum(instrument);
    const swing = instrument.swing ?? pattern.swing ?? 0;
    const humanize = instrument.humanize ?? (drum ? 0.08 : 0);
    const random = createRandom((pattern.seed ^ hashString(track)) >>> 0);
    const low = instrumentLow(instrument);
    const transpose = drum ? 0 : (instrument.transpose ?? 0);

    const push = (step: number, lengthSteps: number, velocity: number, notes: number[]): void => {
      if (step < 0 || step >= totalSteps || velocity <= 0) return;
      const jitter = humanize > 0 ? 1 + (random() * 2 - 1) * humanize : 1;
      const time = stepTime(step, pattern.bpm, swing);
      const end = stepTime(step + Math.max(0.05, lengthSteps), pattern.bpm, swing);
      events.push({
        track,
        step,
        time,
        duration: end - time,
        velocity: Math.min(1, Math.max(0.02, velocity * jitter)),
        notes,
      });
    };

    for (const { name, startBar, section } of arranged) {
      const part = section.parts[track];
      if (part === undefined) continue;
      const base = startBar * STEPS_PER_BAR;
      const sectionSteps = section.bars * STEPS_PER_BAR;

      if (!isNotePart(part)) {
        const steps = parseSteps(part);
        for (let i = 0; i < sectionSteps; i++) {
          const velocity = steps[i % steps.length];
          if (velocity > 0) push(base + i, 1, velocity, []);
        }
        continue;
      }
      if (drum) throw new Error(`Track "${track}" is a drum; its part in "${name}" must be a step string`);

      const chords = section.chords.map((entry) => entry.trim().split(/\s+/).map(parseChord));
      const resolve = (pitch: Pitch | Pitch[], step: number): number[] => {
        const chord = chordAt(chords, step);
        const list = Array.isArray(pitch) ? pitch : [pitch];
        return list.flatMap((p) => resolvePitch(p, chord, low)).map((midi) => midi + transpose);
      };
      const place = (note: NoteEvent, offset: number): void => {
        const step = note[0] + offset;
        if (step >= sectionSteps) return;
        // A note may ring past the end of its section (and of the loop); the renderer folds the tail.
        push(base + step, note[2], note[3] ?? 0.8, resolve(note[1], step));
      };

      for (const note of part.notes ?? []) place(note, 0);
      if (part.bar) {
        for (let bar = 0; bar < section.bars; bar++) {
          for (const note of part.bar) place(note, bar * STEPS_PER_BAR);
        }
      }
      if (part.steps) {
        const steps = parseSteps(part.steps);
        const pitches = part.pitches && part.pitches.length > 0 ? part.pitches : ['1'];
        const gate = part.gate ?? 1;
        let turn = 0;
        for (let i = 0; i < sectionSteps; i++) {
          if (i % STEPS_PER_BAR === 0) turn = 0;
          const velocity = steps[i % steps.length];
          if (velocity <= 0) continue;
          push(base + i, gate, velocity, resolve(pitches[turn % pitches.length], i));
          turn++;
        }
      }
    }
  }

  events.sort((a, b) => a.time - b.time || (a.track < b.track ? -1 : a.track > b.track ? 1 : 0));
  return events;
}

/** Loop length in seconds. */
export function patternSeconds(pattern: SongPattern): number {
  return (pattern.bars * 4 * 60) / pattern.bpm;
}
