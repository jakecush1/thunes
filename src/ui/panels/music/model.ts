/**
 * Pure helpers for the music drawer: text for the pill and the track rows,
 * and the level-bar heights computed from the audio engine's levels.
 */
import { DEFAULT_BPM } from '../../../config';
import type { AudioLevels, AudioStatus, SongDef } from '../../../types';

/** "2:48" for 168 s; '' when unknown. */
export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Tempo label for a track row ('' when unknown). */
export function formatBpm(bpm: number | undefined): string {
  return bpm !== undefined && Number.isFinite(bpm) && bpm > 0 ? String(Math.round(bpm)) : '';
}

/** Second line of a track row: its vibe, artist, or where it came from. */
export function songVibe(song: SongDef): string {
  const parts = [song.vibe, song.artist].filter((p): p is string => typeof p === 'string' && p.trim() !== '');
  if (parts.length) return parts.join(' · ');
  if (song.source === 'upload') return 'Your upload';
  if (song.source === 'library') return 'From the library';
  return '';
}

export interface MusicSummaryInput {
  song: SongDef | undefined;
  /** The chosen id (may be set while `song` is unknown, e.g. a missing upload). */
  songId: string | null;
  status: AudioStatus;
  muted: boolean;
  /** The splash has been dismissed (audio may be running). */
  entered: boolean;
}

export interface MusicSummary {
  title: string;
  meta: string;
  /** The tempo to show and to animate with. */
  bpm: number;
  /** Music is audible right now. */
  live: boolean;
}

/** Title and status line for the collapsed pill. */
export function musicSummary(input: MusicSummaryInput): MusicSummary {
  const { song, songId, status, muted, entered } = input;
  if (songId === null) return { title: 'No music', meta: 'Pick a track', bpm: DEFAULT_BPM, live: false };
  const title = song?.title ?? 'Missing track';
  const forThis = status.state !== 'idle' && status.songId === songId;
  const bpm = forThis && status.state === 'playing' ? status.bpm : (song?.bpm ?? DEFAULT_BPM);
  const tempo = `${Math.round(bpm)} bpm`;
  if (forThis && status.state === 'error') return { title, meta: 'Could not play', bpm, live: false };
  if (forThis && status.state === 'loading') return { title, meta: 'Loading…', bpm, live: false };
  if (muted) return { title, meta: `Muted · ${tempo}`, bpm, live: false };
  if (forThis && status.state === 'playing') return { title, meta: `Now playing · ${tempo}`, bpm, live: true };
  return { title, meta: entered ? tempo : `Ready · ${tempo}`, bpm, live: false };
}

/** Quantisation steps for bar heights (only changed steps touch the DOM). */
export const LEVEL_STEPS = 24;
/** Bars never collapse completely, so they still read as bars. */
export const LEVEL_FLOOR = 0.12;

/**
 * Heights (0..1) for `out.length` level bars from the engine's levels.
 * Bars alternate between bass, mid, treble and overall loudness, with a small
 * per-bar wobble over `time` so equal bands do not move in lockstep.
 */
export function levelBarHeights(levels: AudioLevels, time: number, out: Float32Array): Float32Array {
  for (let i = 0; i < out.length; i++) {
    const band = i % 4;
    const raw = band === 0 ? levels.bass : band === 1 ? levels.mid : band === 2 ? levels.treble : levels.level;
    const wobble = 0.85 + 0.15 * Math.sin(time * (5 + i * 1.7) + i * 2.1);
    const v = Math.min(1, Math.max(0, raw * 1.35 * wobble));
    out[i] = LEVEL_FLOOR + (1 - LEVEL_FLOOR) * v;
  }
  return out;
}

/** Height → step index 0..LEVEL_STEPS. */
export function levelStep(height: number): number {
  return Math.min(LEVEL_STEPS, Math.max(0, Math.round(height * LEVEL_STEPS)));
}
