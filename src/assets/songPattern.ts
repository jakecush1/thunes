/**
 * Validation of song patterns ('thunes-song@1', see src/audio/pattern.ts) that
 * come from outside the code base: library JSON files and uploads.
 */
import type { SongPattern } from '../audio/pattern';
import { expandPattern } from '../audio/sequence';

const MAX_BARS = 256;
const MAX_TRACKS = 32;
const INSTRUMENT_KINDS: readonly string[] = ['kick', 'snare', 'clap', 'hat', 'openhat', 'perc', 'bass', 'pluck', 'lead', 'pad', 'keys'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when the value looks like a song pattern file (by its `format` field). */
export function looksLikeSongPattern(value: unknown): boolean {
  return isRecord(value) && value.format === 'thunes-song@1';
}

/** True when the value looks like a dance scheme file (by its `format` field). */
export function looksLikeDanceScheme(value: unknown): boolean {
  return isRecord(value) && value.format === 'thunes-dance@1';
}

/**
 * Checks parsed JSON against the song pattern format and returns it typed.
 * Throws an Error with a readable message naming the first problem. The
 * pattern is also expanded once, so unknown sections, wrong bar counts, bad
 * chord names or step strings are caught here instead of at playback.
 */
export function validateSongPattern(input: unknown): SongPattern {
  if (!isRecord(input)) throw new Error('a song pattern must be a JSON object');
  if (input.format !== 'thunes-song@1') throw new Error('"format" must be "thunes-song@1"');
  const { bpm, bars, seed, swing, tracks, sections, arrangement } = input;
  if (typeof bpm !== 'number' || !(bpm >= 30 && bpm <= 300)) throw new Error('"bpm" must be a number between 30 and 300');
  if (typeof bars !== 'number' || !Number.isInteger(bars) || bars < 1 || bars > MAX_BARS) throw new Error(`"bars" must be a whole number between 1 and ${MAX_BARS}`);
  if (seed !== undefined && (typeof seed !== 'number' || !Number.isFinite(seed))) throw new Error('"seed" must be a number');
  if (swing !== undefined && (typeof swing !== 'number' || !(swing >= 0 && swing <= 1))) throw new Error('"swing" must be between 0 and 1');
  if (!isRecord(tracks) || Object.keys(tracks).length === 0) throw new Error('"tracks" must list at least one instrument');
  if (Object.keys(tracks).length > MAX_TRACKS) throw new Error(`a song may have at most ${MAX_TRACKS} tracks`);
  for (const [id, instrument] of Object.entries(tracks)) {
    if (!isRecord(instrument) || typeof instrument.kind !== 'string' || !INSTRUMENT_KINDS.includes(instrument.kind)) {
      throw new Error(`track "${id}" needs a "kind" (one of ${INSTRUMENT_KINDS.join(', ')})`);
    }
  }
  if (!isRecord(sections) || Object.keys(sections).length === 0) throw new Error('"sections" must contain at least one section');
  for (const [name, section] of Object.entries(sections)) {
    if (!isRecord(section)) throw new Error(`section "${name}" must be an object`);
    if (section.parts !== undefined) {
      if (!isRecord(section.parts)) throw new Error(`section "${name}": "parts" must be an object`);
      for (const track of Object.keys(section.parts)) {
        if (!(track in tracks)) throw new Error(`section "${name}" has a part for the unknown track "${track}"`);
      }
    }
  }
  if (!Array.isArray(arrangement) || arrangement.length === 0 || !arrangement.every((name) => typeof name === 'string')) {
    throw new Error('"arrangement" must be a list of section names');
  }
  const pattern = { ...input, seed: typeof seed === 'number' ? seed : 1 } as unknown as SongPattern;
  try {
    expandPattern(pattern);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
  return pattern;
}
