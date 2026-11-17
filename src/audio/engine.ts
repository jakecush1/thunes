/**
 * The audio engine: plays the selected song as a seamless loop, keeps the
 * shared beat clock in step with it and measures levels for the visuals.
 *
 *   song source ─ gain (fade in/out) ─┬─ bus ─┬─ master (volume / mute) ─ output
 *   previous song ─ gain ─────────────┘       └─ analyser (levels; unaffected by volume)
 */

import type { AssetRegistry, AudioEngine, AudioLevels, AudioSettings, AudioStatus, ClockSnapshot } from '../types';
import { DEFAULT_BPM } from '../config';
import type { AudioPosition } from './clock';
import { detectBufferBpm } from './bpm';
import { BeatClock, PositionSmoother } from './clock';
import { renderPattern } from './synth';

/** Seconds between scheduling a song and its first sample (lets the audio thread pick it up). */
const START_LEAD = 0.03;
/** Fade-in of a starting song / fade-out of the one it replaces, seconds. */
const FADE_IN = 0.015;
const FADE_OUT = 0.3;
/** Time constant of volume and mute changes, seconds. */
const GAIN_SMOOTHING = 0.03;
/** How quickly the reported levels fall back after a peak, seconds (time constant). */
const LEVEL_RELEASE = 0.12;

/** Band edges in Hz for bass / mid / treble. */
const BANDS = [
  { from: 30, to: 220 },
  { from: 220, to: 2500 },
  { from: 2500, to: 12000 },
] as const;
/**
 * Mean analyser reading (0..1 on the analyser's decibel scale) that maps to a
 * level of 0 and of 1, per band. Calibrated on the built-in songs so each band
 * swings across most of 0..1 on typical dance music.
 */
const BAND_FLOOR = [0.55, 0.28, 0.1] as const;
const BAND_FULL = [0.85, 0.48, 0.36] as const;
/** RMS amplitude that maps to an overall level of 1. */
const LEVEL_FULL_RMS = 0.36;

interface Playing {
  songId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  /** Context time of the song's first sample. */
  startedAt: number;
  bpm: number;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function readable(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === 'string' && error ? error : 'The song could not be played';
}

/**
 * Create the audio engine. Nothing audible (and no AudioContext) exists until
 * `unlock()` is called from a user gesture; until then `sync` only remembers
 * the settings and `tick` runs the clock freely at DEFAULT_BPM.
 */
export function createAudioEngine(deps: Pick<AssetRegistry, 'loadSong' | 'getSong' | 'setSongBpm'>): AudioEngine {
  const clock = new BeatClock(DEFAULT_BPM);
  const smoother = new PositionSmoother();
  const position: AudioPosition = { seconds: 0, latency: 0 };
  const listeners = new Set<(status: AudioStatus) => void>();
  const levels: AudioLevels = { level: 0, bass: 0, mid: 0, treble: 0 };

  let ctx: AudioContext | null = null;
  let bus: GainNode | null = null;
  let master: GainNode | null = null;
  let analyser: AnalyserNode | null = null;
  let spectrum: Uint8Array<ArrayBuffer> | null = null;
  let waveform: Float32Array<ArrayBuffer> | null = null;
  let bandBins: { from: number; to: number }[] = [];

  let unlocked = false;
  let disposed = false;
  let desired: AudioSettings | null = null;
  /** The song id most recently asked for (playing, loading or failed). */
  let requested: string | null = null;
  let requestSeq = 0;
  let current: Playing | null = null;
  /** Decoded audio for the current and the previous song only. */
  let buffers = new Map<string, AudioBuffer>();
  let status: AudioStatus = { state: 'idle' };
  let levelsAt = -1;

  function setStatus(next: AudioStatus): void {
    status = next;
    for (const listener of [...listeners]) listener(next);
  }

  function applyGain(): void {
    if (!ctx || !master || !desired) return;
    const volume = clamp01(desired.volume);
    // Squared so the slider feels even to the ear.
    const target = desired.muted ? 0 : volume * volume;
    master.gain.setTargetAtTime(target, ctx.currentTime, GAIN_SMOOTHING);
  }

  function fadeOut(playing: Playing, until: number): void {
    if (!ctx) return;
    const now = ctx.currentTime;
    const param = playing.gain.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(0, until);
    const { source, gain } = playing;
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    try {
      source.stop(until + 0.02);
    } catch {
      // Already stopped.
    }
  }

  function stopCurrent(): void {
    if (current && ctx) fadeOut(current, ctx.currentTime + FADE_OUT);
    current = null;
    clock.stopSong();
  }

  function start(songId: string, buffer: AudioBuffer, bpm: number): void {
    if (!ctx || !bus) return;
    const now = ctx.currentTime;
    const startedAt = now + START_LEAD;
    const previous = current;
    if (previous) fadeOut(previous, startedAt + FADE_OUT);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.setValueAtTime(0, startedAt);
    gain.gain.linearRampToValueAtTime(1, startedAt + FADE_IN);
    source.connect(gain).connect(bus);
    source.start(startedAt);

    // Keep the audio of this song and the one before it; drop the rest.
    const kept = new Map<string, AudioBuffer>();
    const previousBuffer = previous ? buffers.get(previous.songId) : undefined;
    if (previous && previousBuffer) kept.set(previous.songId, previousBuffer);
    kept.set(songId, buffer);
    buffers = kept;

    current = { songId, source, gain, startedAt, bpm };
    clock.startSong({ bpm, loopSeconds: buffer.duration });
    setStatus({ state: 'playing', songId, bpm });
  }

  async function prepare(songId: string, context: AudioContext, isWanted: () => boolean): Promise<{ buffer: AudioBuffer; bpm: number } | null> {
    const source = await deps.loadSong(songId);
    const def = deps.getSong(songId);
    // Skip the expensive part if another song has been chosen in the meantime.
    if (!isWanted()) return null;
    let buffer = buffers.get(songId);
    if (!buffer) {
      buffer =
        source.kind === 'pattern'
          ? await renderPattern(source.pattern, { sampleRate: context.sampleRate })
          : // decodeAudioData detaches its input, and the registry may hand out the same bytes again.
            await context.decodeAudioData(source.data.slice(0));
    }
    let bpm = def?.bpm ?? (source.kind === 'pattern' ? source.pattern.bpm : undefined);
    if (bpm === undefined) {
      // TEMPO-DETECTOR HOOK: this song has no known tempo. Estimate it from the decoded audio and
      // let the registry remember it (uploads persist it); fall back to the default tempo when no beat stands out.
      let estimate: number | null = null;
      try {
        estimate = detectBufferBpm(buffer)?.bpm ?? null;
      } catch (error) {
        console.warn('[audio] tempo detection failed', error);
      }
      if (estimate !== null) deps.setSongBpm(songId, estimate);
      bpm = estimate ?? DEFAULT_BPM;
    }
    return { buffer, bpm: bpm > 0 ? bpm : DEFAULT_BPM };
  }

  function changeSong(songId: string | null): void {
    requested = songId;
    const seq = ++requestSeq;
    if (songId === null) {
      stopCurrent();
      setStatus({ state: 'idle' });
      return;
    }
    const context = ctx;
    if (!context) return;
    if (current && current.songId === songId) {
      // Asked to go back to the song that is still playing (a newer request was abandoned).
      setStatus({ state: 'playing', songId, bpm: current.bpm });
      return;
    }
    setStatus({ state: 'loading', songId });
    const isWanted = (): boolean => seq === requestSeq && !disposed;
    prepare(songId, context, isWanted).then(
      (ready) => {
        // Only the latest request may start; an older one that finishes late is dropped.
        if (!ready || !isWanted()) return;
        start(songId, ready.buffer, ready.bpm);
      },
      (error: unknown) => {
        if (seq !== requestSeq || disposed) return;
        stopCurrent();
        setStatus({ state: 'error', songId, message: readable(error) });
      },
    );
  }

  function apply(): void {
    if (!ctx || !desired || disposed) return;
    applyGain();
    if (desired.songId !== requested) changeSong(desired.songId);
  }

  function build(): void {
    const AudioContextClass: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AudioContextClass({ latencyHint: 'interactive' });
    bus = ctx.createGain();
    master = ctx.createGain();
    master.gain.value = 0;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.5;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -20;
    bus.connect(master).connect(ctx.destination);
    bus.connect(analyser);
    spectrum = new Uint8Array(analyser.frequencyBinCount);
    waveform = new Float32Array(analyser.fftSize);
    const hzPerBin = ctx.sampleRate / analyser.fftSize;
    bandBins = BANDS.map((band) => ({
      from: Math.max(1, Math.round(band.from / hzPerBin)),
      to: Math.min(analyser!.frequencyBinCount - 1, Math.round(band.to / hzPerBin)),
    }));
  }

  function outputLatency(context: AudioContext): number {
    const latency = context.outputLatency || context.baseLatency || 0;
    return latency > 0 && latency < 0.5 ? latency : 0;
  }

  function zeroLevels(): AudioLevels {
    levels.level = 0;
    levels.bass = 0;
    levels.mid = 0;
    levels.treble = 0;
    return levels;
  }

  const engine: AudioEngine = {
    async unlock(): Promise<void> {
      if (disposed) return;
      if (!ctx) build();
      unlocked = true;
      apply();
      const context = ctx;
      if (context && context.state !== 'running') {
        try {
          await context.resume();
        } catch {
          // Still blocked by the browser; a later unlock() (another gesture) tries again.
        }
      }
    },

    get unlocked(): boolean {
      return unlocked;
    },

    sync(audio: AudioSettings): void {
      desired = { songId: audio.songId, muted: audio.muted, volume: audio.volume, beatSync: audio.beatSync };
      apply();
    },

    tick(): ClockSnapshot {
      const wall = performance.now() / 1000;
      if (ctx && current && ctx.state === 'running') {
        position.seconds = smoother.update(wall, ctx.currentTime) - current.startedAt;
        position.latency = outputLatency(ctx);
        return clock.tick(wall, position);
      }
      return clock.tick(wall, null);
    },

    get clock(): ClockSnapshot {
      return clock.snapshot;
    },

    levels(): AudioLevels {
      if (!ctx || !analyser || !spectrum || !waveform || !current || !desired || desired.muted || ctx.state !== 'running') {
        levelsAt = -1;
        return zeroLevels();
      }
      const now = performance.now() / 1000;
      const elapsed = levelsAt < 0 ? 1 : now - levelsAt;
      // Several callers in the same frame share one measurement.
      if (elapsed < 0.004) return levels;
      levelsAt = now;
      const keep = Math.exp(-elapsed / LEVEL_RELEASE);

      analyser.getByteFrequencyData(spectrum);
      analyser.getFloatTimeDomainData(waveform);
      let sum = 0;
      for (let i = 0; i < waveform.length; i++) sum += waveform[i] * waveform[i];
      const overall = clamp01(Math.sqrt(sum / waveform.length) / LEVEL_FULL_RMS);
      levels.level = Math.max(overall, levels.level * keep);

      for (let b = 0; b < 3; b++) {
        const { from, to } = bandBins[b];
        let total = 0;
        for (let i = from; i <= to; i++) total += spectrum[i];
        const mean = total / ((to - from + 1) * 255);
        const value = clamp01((mean - BAND_FLOOR[b]) / (BAND_FULL[b] - BAND_FLOOR[b]));
        if (b === 0) levels.bass = Math.max(value, levels.bass * keep);
        else if (b === 1) levels.mid = Math.max(value, levels.mid * keep);
        else levels.treble = Math.max(value, levels.treble * keep);
      }
      return levels;
    },

    get status(): AudioStatus {
      return status;
    },

    subscribe(listener: (status: AudioStatus) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      requestSeq++;
      if (current) {
        try {
          current.source.stop();
        } catch {
          // Already stopped.
        }
      }
      current = null;
      clock.stopSong();
      buffers.clear();
      listeners.clear();
      status = { state: 'idle' };
      if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
    },
  };

  return engine;
}
