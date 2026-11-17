/**
 * SongPattern: a JSON-compatible description of a looping, synthesised song.
 *
 * A pattern is pure data, so new songs can be authored by hand (or by an AI
 * assistant) without touching the synthesiser. It is rendered to an audio
 * buffer in the browser by `renderPattern` (synth.ts).
 *
 * ── How a song is put together ─────────────────────────────────────────────
 *
 *   tracks        the instruments (id → instrument parameters)
 *   sections      named blocks of 1..n bars; each gives every track a part
 *   arrangement   the order in which sections play; the whole thing loops
 *
 * Time is a grid of 16 steps per bar (16th notes, four beats per bar).
 *
 * Drum parts are step strings, one character per step:
 *
 *     '.' or '-'  rest          'x'  normal hit (0.8)      'X'  accent (1.0)
 *     'o'         ghost (0.45)  '1'…'9'  velocity 0.1 … 0.9
 *
 *   Spaces and '|' are ignored, so "x... x... x... x..." is one bar of four on
 *   the floor. A string may hold several bars (a multiple of 16 steps). A part
 *   may be one string or a list of strings; the bars it contains are repeated
 *   to fill the section, so ["x...x...x...x...", "x...x...x..xx.x."] alternates
 *   two bars. Put a fill in the last bar of a list that is as long as the section.
 *
 * Pitched parts are objects with any of:
 *
 *     notes   [step, pitch, length, velocity?] with step counted from the start
 *             of the section (may be fractional; length in steps)
 *     bar     the same, but counted from the start of a bar and repeated in
 *             every bar of the section (ideal with chord-relative pitches)
 *     steps   a step string (as for drums) whose hits take their pitches, in
 *             turn, from `pitches` (the turn restarts every bar); each note is
 *             `gate` steps long
 *
 * A pitch is one of:
 *
 *     60, 'C4', 'F#2', 'Bb3'   an absolute note (MIDI number or name; C4 = 60)
 *     '1' '3' '5' '7'          root / third / fifth / seventh of the chord
 *                              that sounds at that step ('2' '4' '6' '9' too);
 *                              a trailing '+' or '-' moves it up or down an
 *                              octave ('1+', '5-', '1++')
 *     'chord'                  every tone of the current chord, closely voiced
 *     [pitch, pitch, …]        several pitches struck together
 *
 * Chords are named per bar in the section (`chords`, repeated to fill it):
 * 'Am', 'F', 'G7', 'Cmaj7', 'Dm7', 'Esus4', 'Bdim', 'Em9', 'Aadd9', 'C6' …
 * Two or more names in one entry ("Am7 D7") share the bar equally. The root of
 * a chord-relative note is the first such pitch at or above the track's `low`.
 */

/** One or more bars of drum steps. See the file header for the characters. */
export type StepPattern = string | string[];

/** An absolute note (MIDI number or name such as 'F#2'), a chord-relative token ('1', '5-', 'chord'). */
export type Pitch = number | string;

/** [step, pitch(es), length in steps, velocity 0..1 (default 0.8)]. */
export type NoteEvent = [step: number, pitch: Pitch | Pitch[], length: number, velocity?: number];

/** A pitched part. All three sources may be combined. */
export interface NotePart {
  /** Notes placed from the start of the section. */
  notes?: NoteEvent[];
  /** Notes placed from the start of a bar, repeated in every bar. */
  bar?: NoteEvent[];
  /** Rhythm; each hit takes the next entry of `pitches`. */
  steps?: StepPattern;
  /** Pitches for `steps`, used in turn and restarted every bar (default ['1']). */
  pitches?: (Pitch | Pitch[])[];
  /** Note length for `steps`, in steps (default 1). */
  gate?: number;
}

/** What one track plays in one section. */
export type Part = StepPattern | NotePart;

export interface SongSection {
  /** Length in bars. Required unless inherited through `extends`. */
  bars?: number;
  /** Start from a copy of another section, then override `bars`, `chords` and individual parts. */
  extends?: string;
  /** Chord names, one entry per bar, repeated to fill the section. */
  chords?: string[];
  /** Track id → part. `null` silences a part inherited through `extends`. */
  parts?: Record<string, Part | null>;
}

/** Mix controls shared by every instrument. */
export interface TrackMix {
  /** Linear level, 1 = the instrument's natural level (default 1). */
  gain?: number;
  /** Stereo position, -1 (left) … 1 (right) (default 0). */
  pan?: number;
  /** Send level into the shared reverb, 0..1 (default 0). */
  reverb?: number;
  /** Send level into the shared feedback delay, 0..1 (default 0). */
  delay?: number;
  /** How strongly the track is ducked by the key track, 0..1 (default 0). */
  duck?: number;
  /** Swing for this track, overriding the song's. */
  swing?: number;
  /** Random velocity variation, 0..1 (default 0.08 for drums, 0 for pitched tracks). */
  humanize?: number;
}

export type DrumKind = 'kick' | 'snare' | 'clap' | 'hat' | 'openhat' | 'perc';
export type PercVariant = 'rim' | 'tom' | 'conga' | 'shaker' | 'cowbell' | 'tamb';

export interface DrumInstrument extends TrackMix {
  kind: DrumKind;
  /** Pitch offset in semitones (default 0). */
  tune?: number;
  /** Multiplier on the natural decay time (default 1). */
  decay?: number;
  /** Brightness / attack character, 0 (dull, soft) … 1 (bright, clicky) (default 0.5). */
  tone?: number;
  /** For kind 'perc': which sound (default 'rim'). */
  variant?: PercVariant;
}

export type SynthKind = 'bass' | 'pluck' | 'lead' | 'pad' | 'keys';
export type SynthWave = 'sine' | 'triangle' | 'saw' | 'square' | 'fm';

/**
 * A subtractive (or two-operator FM) synth voice. `kind` selects sensible
 * defaults for everything below; every field can be overridden.
 */
export interface SynthInstrument extends TrackMix {
  kind: SynthKind;
  /** Oscillator shape. 'fm' is a sine carrier modulated by a sine (see fmRatio / fmAmount). */
  wave?: SynthWave;
  /** Unison oscillators per note, 1..5. */
  voices?: number;
  /** Unison detune in cents (total spread is ± this). */
  detune?: number;
  /** Stereo spread of the unison oscillators, 0..1. */
  width?: number;
  /** Level of a sine one octave below, 0..1. */
  sub?: number;
  /** Lowest root for chord-relative pitches (note name or MIDI number). */
  low?: Pitch;
  /** Transposition in semitones applied to every note. */
  transpose?: number;
  /** Low-pass cutoff in Hz at rest. */
  cutoff?: number;
  /** Filter resonance (Q), about 0.5 … 12. */
  resonance?: number;
  /** How far the filter envelope opens the cutoff, in octaves. */
  envAmount?: number;
  /** Filter envelope decay, seconds. */
  envDecay?: number;
  /** Amplitude envelope: attack / decay / release in seconds, sustain 0..1. */
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  /** FM: modulator frequency as a multiple of the note frequency. */
  fmRatio?: number;
  /** FM: modulation index at the note's start (0 … about 8). */
  fmAmount?: number;
  /** FM: seconds for the modulation to die away to its sustain level. */
  fmDecay?: number;
  /** Vibrato depth in cents (0 = none) and rate in Hz. */
  vibrato?: number;
  vibratoRate?: number;
}

export type Instrument = DrumInstrument | SynthInstrument;

export interface DelayEffect {
  /** Delay time in 16th-note steps (default 3, a dotted eighth). */
  steps?: number;
  /** Feedback 0 … 0.85 (default 0.4). */
  feedback?: number;
  /** Low-pass in the feedback path, Hz (default 3500). */
  tone?: number;
  /** 0 = mono repeats, 1 = repeats bounce between left and right (default 0.7). */
  spread?: number;
  /** Return level (default 1). */
  level?: number;
}

export interface ReverbEffect {
  /** Decay time in seconds (default 1.8). */
  seconds?: number;
  /** Brightness of the tail: low-pass in Hz (default 6000). */
  tone?: number;
  /** Gap before the tail starts, seconds (default 0.015). */
  predelay?: number;
  /** Return level (default 1). */
  level?: number;
}

export interface DuckEffect {
  /** Id of the track that triggers the ducking (default: the first 'kick' track). */
  key?: string;
  /** Gain reduction at full `duck` amount, 0..1 (default 0.6). */
  depth?: number;
  /** Recovery time in beats (default 0.75). */
  release?: number;
}

export interface SongEffects {
  delay?: DelayEffect;
  reverb?: ReverbEffect;
  duck?: DuckEffect;
}

export interface SongPattern {
  format: 'thunes-song@1';
  /** Tempo in beats per minute. */
  bpm: number;
  /** Loop length in bars of four beats. Must equal the summed length of `arrangement`. */
  bars: number;
  /** Shuffle, 0 (straight) … 1 (triplet feel): every second 16th is played late. */
  swing?: number;
  /** Seed for all noise and humanisation; the same pattern always renders the same audio. */
  seed: number;
  /** Instruments by track id. */
  tracks: Record<string, Instrument>;
  /** Sections by name. */
  sections: Record<string, SongSection>;
  /** Section names in playing order. */
  arrangement: string[];
  effects?: SongEffects;
}

/** Steps (16th notes) per bar and per beat. */
export const STEPS_PER_BAR = 16;
export const STEPS_PER_BEAT = 4;

const DRUM_KINDS: readonly string[] = ['kick', 'snare', 'clap', 'hat', 'openhat', 'perc'];

/** True for percussion instruments (which take step-string parts). */
export function isDrum(instrument: Instrument): instrument is DrumInstrument {
  return DRUM_KINDS.includes(instrument.kind);
}
