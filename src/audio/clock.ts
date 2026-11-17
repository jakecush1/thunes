/**
 * The beat clock: pure logic, no Web Audio types.
 *
 * Rules
 *  - `time` is monotonic seconds since the first tick; `delta` is the step
 *    since the previous tick, clamped to MAX_DELTA (so a tab that was in the
 *    background does not make animations leap).
 *  - While a song plays, `beat` follows the audio position exactly:
 *    beat = anchor + (audioSeconds − latency) × bpm / 60. It is not affected by
 *    the delta clamp, so visuals are in sync again the moment the tab returns.
 *  - Without a playing song, `beat` advances by delta × bpm / 60 at the current
 *    tempo (the last song's, or DEFAULT_BPM if none was ever loaded).
 *  - When a song starts, the anchor is the whole beat nearest to the current
 *    beat, so beat 0 of the music lands on a whole beat of the dance. The same
 *    happens each time a song whose length is not a whole number of beats loops.
 *  - `beat` never decreases: if re-anchoring puts the music slightly behind,
 *    the beat waits (for at most half a beat) until the music catches up.
 */

import type { ClockSnapshot } from '../types';
import { DEFAULT_BPM } from '../config';

/** Largest `delta` a tick may report, seconds. */
export const MAX_DELTA = 0.1;

/** A loop this close to a whole number of beats (in beats) is treated as exact. */
const WHOLE_BEAT_TOLERANCE = 0.02;

/** Where the audible song is, as measured by the audio engine. */
export interface AudioPosition {
  /** Seconds of audio played since the song started (keeps counting across loops; negative before it starts). */
  seconds: number;
  /** Output latency in seconds: sound scheduled now is heard this much later. Default 0. */
  latency?: number;
}

/** What the clock needs to know about a song that starts playing. */
export interface SongTiming {
  /** Tempo in beats per minute. */
  bpm: number;
  /** Length of the loop in seconds, if the song loops. */
  loopSeconds?: number;
}

/**
 * Beat position of a looping song, in beats since its anchor.
 * A loop that is a whole number of beats long (within tolerance) simply keeps
 * counting. Otherwise every pass starts on the whole beat nearest to where the
 * previous pass ended, so the downbeat of the music stays on a whole beat.
 */
export function loopedBeats(seconds: number, bpm: number, loopSeconds: number | undefined): number {
  const rate = bpm / 60;
  if (seconds <= 0) return 0;
  if (!loopSeconds || !(loopSeconds > 0)) return seconds * rate;
  const loopBeats = loopSeconds * rate;
  const whole = Math.round(loopBeats);
  if (whole < 1) return seconds * rate;
  const passes = Math.floor(seconds / loopSeconds);
  const within = seconds - passes * loopSeconds;
  if (Math.abs(loopBeats - whole) <= WHOLE_BEAT_TOLERANCE) {
    // Exact loop: scale so one pass is precisely `whole` beats (absorbs sample rounding).
    return passes * whole + (within / loopSeconds) * whole;
  }
  return passes * whole + within * rate;
}

/**
 * The shared musical clock. Call `tick` once per frame; call `startSong` /
 * `stopSong` when the audible song changes. `snapshot` is one object that is
 * updated in place on every tick (no per-frame allocation): read it, do not keep it.
 */
export class BeatClock {
  readonly snapshot: ClockSnapshot = { time: 0, delta: 0, beat: 0, bpm: DEFAULT_BPM };

  private lastWall: number | null = null;
  private song: SongTiming | null = null;
  private anchor = 0;
  private needsResync = false;

  /** @param bpm free-running tempo before any song has been loaded (default DEFAULT_BPM). */
  constructor(bpm: number = DEFAULT_BPM) {
    this.snapshot.bpm = bpm;
  }

  /** True while the beat is following a song. */
  get following(): boolean {
    return this.song !== null;
  }

  /**
   * A song starts playing now (its audio position is 0 at this moment).
   * Adopts its tempo and re-anchors to the nearest whole beat.
   */
  startSong(timing: SongTiming): void {
    this.song = { bpm: timing.bpm, loopSeconds: timing.loopSeconds };
    this.anchor = Math.round(this.snapshot.beat);
    this.needsResync = false;
    this.snapshot.bpm = timing.bpm;
  }

  /** The song stopped: keep its tempo and carry on free-running from the current beat. */
  stopSong(): void {
    this.song = null;
    this.needsResync = false;
  }

  /** Change the tempo (for example when a tempo estimate arrives). A playing song keeps its downbeat on a whole beat. */
  setBpm(bpm: number): void {
    if (!(bpm > 0)) return;
    this.snapshot.bpm = bpm;
    if (this.song) {
      this.song.bpm = bpm;
      this.needsResync = true;
    }
  }

  /**
   * Advance the clock.
   * @param wallSeconds a monotonic wall-clock reading in seconds (e.g. performance.now() / 1000)
   * @param audio the audible song's position, or null when nothing is audible (no song, or
   *   the audio output is stalled; the beat then free-runs and re-aligns when audio returns)
   * @returns the updated snapshot (the same object every time)
   */
  tick(wallSeconds: number, audio: AudioPosition | null = null): ClockSnapshot {
    const snapshot = this.snapshot;
    let delta = this.lastWall === null ? 0 : wallSeconds - this.lastWall;
    this.lastWall = wallSeconds;
    if (!(delta > 0)) delta = 0;
    else if (delta > MAX_DELTA) delta = MAX_DELTA;
    snapshot.delta = delta;
    snapshot.time += delta;

    let beat: number;
    if (this.song && audio) {
      const heard = audio.seconds - (audio.latency ?? 0);
      const played = loopedBeats(heard, this.song.bpm, this.song.loopSeconds);
      if (this.needsResync) {
        // Put the song's beat 0 back on the whole beat nearest to where the clock is now.
        this.anchor = Math.round(snapshot.beat - played);
        this.needsResync = false;
      }
      beat = this.anchor + played;
    } else {
      if (this.song) this.needsResync = true;
      beat = snapshot.beat + (delta * snapshot.bpm) / 60;
    }
    if (beat > snapshot.beat) snapshot.beat = beat;
    return snapshot;
  }
}

/**
 * Smooths an audio clock for display. `AudioContext.currentTime` advances in
 * blocks (several milliseconds at a time), which would make motion driven by
 * it judder. This predicts the position from wall time and corrects it gently
 * towards the audio clock, snapping when they disagree by more than `snap`
 * seconds (a stall, a suspended context, a background tab).
 */
export class PositionSmoother {
  private estimate = 0;
  private lastWall = 0;
  private primed = false;

  /** @param snap disagreement (seconds) beyond which the estimate jumps to the audio clock */
  constructor(private readonly snap = 0.05, private readonly correction = 0.08) {}

  /** Forget the history (call when playback restarts). */
  reset(): void {
    this.primed = false;
  }

  /**
   * @param wallSeconds monotonic wall time, seconds
   * @param audioSeconds the audio clock's reading, seconds
   * @returns the smoothed audio time, seconds; never decreases between resets
   */
  update(wallSeconds: number, audioSeconds: number): number {
    if (!this.primed) {
      this.primed = true;
      this.estimate = audioSeconds;
    } else {
      const predicted = this.estimate + Math.max(0, wallSeconds - this.lastWall);
      const error = audioSeconds - predicted;
      const next = Math.abs(error) > this.snap ? audioSeconds : predicted + error * this.correction;
      if (next > this.estimate) this.estimate = next;
    }
    this.lastWall = wallSeconds;
    return this.estimate;
  }
}
