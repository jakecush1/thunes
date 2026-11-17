/**
 * Dance timing: how a dancer's position in its loop follows the shared clock.
 *
 * Every dancer keeps a counter `travel`, in beats of its own dance. The loop
 * phase and the clip time are pure functions of that counter, so dancers that
 * share a dance and a speed are in unison no matter when they joined.
 */

/** How one dance is driven. */
export interface DanceTempo {
  /** Follows the song's beat (true) or free-runs at its native tempo (false). */
  beatDriven: boolean;
  /** Beats per minute of the dance itself. */
  nativeBpm: number;
  /** Length of the whole clip in beats. */
  loopBeats: number;
  /** Length of the whole clip in seconds. */
  duration: number;
}

/** The part of a DanceAsset the timing needs. */
export interface DanceTiming {
  duration: number;
  bpm: number | null;
  beats: number | null;
}

/** The part of a ClockSnapshot the timing needs. */
export interface ClockLike {
  time: number;
  delta: number;
  beat: number;
}

/** The part of DancerSettings the timing needs. */
export interface LoopSettings {
  speed: number;
  offset: number;
  trimStart: number;
  trimEnd: number;
}

/** Tempo used for dances that do not state one. */
export const FREE_RUN_BPM = 120;

/** Fractional part in [0, 1), also for negative input. */
export function fract(value: number): number {
  const f = value - Math.floor(value);
  return f >= 1 ? 0 : f;
}

/** Fill `out` with how `dance` is driven under the given beat-sync setting. */
export function resolveTempo(dance: DanceTiming, beatSync: boolean, out: DanceTempo): DanceTempo {
  const duration = dance.duration > 0 ? dance.duration : 1;
  const hasGrid = dance.bpm !== null && dance.bpm > 0 && dance.beats !== null && dance.beats > 0;
  const nativeBpm = dance.bpm !== null && dance.bpm > 0 ? dance.bpm : FREE_RUN_BPM;
  out.beatDriven = beatSync && hasGrid;
  out.nativeBpm = nativeBpm;
  out.loopBeats = dance.beats !== null && dance.beats > 0 ? dance.beats : (duration * nativeBpm) / 60;
  out.duration = duration;
  return out;
}

/** The travel a dancer starts from (creation, dance change, document load, beat-sync toggle, resync). */
export function initialTravel(tempo: DanceTempo, clock: ClockLike, speed: number): number {
  return (tempo.beatDriven ? clock.beat : (clock.time * tempo.nativeBpm) / 60) * speed;
}

/**
 * Travel after one frame. `beatDelta` is the change of the clock's beat counter
 * since the previous frame.
 */
export function advanceTravel(travel: number, tempo: DanceTempo, clock: ClockLike, beatDelta: number, speed: number): number {
  return travel + (tempo.beatDriven ? beatDelta : (clock.delta * tempo.nativeBpm) / 60) * speed;
}

/** Position in the trimmed loop, 0..1. */
export function loopPhase(travel: number, tempo: DanceTempo, settings: LoopSettings): number {
  const span = Math.max(1e-6, settings.trimEnd - settings.trimStart);
  return fract(travel / (tempo.loopBeats * span) + settings.offset);
}

/** Seconds into the clip for the given travel. Always inside [trimStart, trimEnd) × duration. */
export function clipTimeAt(travel: number, tempo: DanceTempo, settings: LoopSettings): number {
  const span = Math.max(1e-6, settings.trimEnd - settings.trimStart);
  return (settings.trimStart + loopPhase(travel, tempo, settings) * span) * tempo.duration;
}

/** A stable pseudo-random number in [0, 1) derived from a string (decorrelates dancers). */
export function hashUnit(text: string, salt = 0): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
