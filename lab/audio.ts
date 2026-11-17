/**
 * Audio lab (dev only): renders every built-in song, draws its waveform and
 * spectrogram, measures it, and lets you listen. Results are published on
 * window.__thunes for scripts/e2e/audio.mjs, which also calls
 * window.__thunes.engineTest() to exercise a real engine instance.
 */

import type { AssetRegistry, AudioEngine, AudioSettings, AudioStatus, SongDef, SongSource } from '../src/types';
import { DEFAULT_BPM } from '../src/config';
import { BUILTIN_SONGS } from '../src/audio/songs';
import type { RenderReport } from '../src/audio/synth';
import { renderPattern } from '../src/audio/synth';
import { expandPattern } from '../src/audio/sequence';
import { createAudioEngine } from '../src/audio/engine';
import { peakOf, rmsOf, seamRatio, toDb } from '../src/audio/dsp';

const SAMPLE_RATE = 48000;
const FFT_SIZE = 2048;
const BAND_EDGES = [0, 60, 250, 1000, 4000, 10000, 24000];
const BAND_NAMES = ['sub', 'bass', 'lowmid', 'mid', 'high', 'air'];

interface SongStats {
  id: string;
  title: string;
  bpm: number;
  bars: number;
  error: string | null;
  length: number;
  expectedLength: number;
  channels: number;
  peakDb: number;
  rmsDb: number;
  crestDb: number;
  seam: number;
  deterministic: boolean;
  /** Hash of every sample bit, to compare renders across page loads. */
  checksum: string;
  renderMs: number;
  /** Share of the energy per band, in dB relative to the total. */
  bands: Record<string, number>;
  /** Median, over all kick hits in the pattern, of the low-band (below 120 Hz) energy in the 50 ms after the hit divided by the 50 ms before it. */
  kickOnGrid: number;
  /** How far the limiter had to pull the loudest peak down, dB. */
  limitedDb: number;
  /** Milliseconds spent mixing/mastering after the parallel renders (part of renderMs). */
  mixMs: number;
  /** Longest gap between animation frames while the song rendered, milliseconds. */
  longestFrameMs: number;
  /** Left/right correlation, 1 = mono. */
  stereoCorrelation: number;
}

// ─────────────────────────────────────────────────────────── Analysis ──

/** In-place radix-2 FFT. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = Math.cos(step * k);
        const wi = Math.sin(step * k);
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

/** Power spectra (one Float32Array of FFT_SIZE/2 bins per column) of the mono mix. */
function spectrogram(buffer: AudioBuffer, columns: number): Float32Array[] {
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const window = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const out: Float32Array[] = [];
  for (let c = 0; c < columns; c++) {
    const centre = Math.floor(((c + 0.5) / columns) * buffer.length);
    for (let i = 0; i < FFT_SIZE; i++) {
      const index = (centre - FFT_SIZE / 2 + i + buffer.length) % buffer.length;
      re[i] = (left[index] + right[index]) * 0.5 * window[i];
      im[i] = 0;
    }
    fft(re, im);
    const power = new Float32Array(FFT_SIZE / 2);
    for (let i = 0; i < FFT_SIZE / 2; i++) power[i] = (re[i] * re[i] + im[i] * im[i]) / ((FFT_SIZE * FFT_SIZE) / 16);
    out.push(power);
  }
  return out;
}

function bandShares(spectra: Float32Array[], sampleRate: number): Record<string, number> {
  const totals = new Array<number>(BAND_NAMES.length).fill(0);
  const hzPerBin = sampleRate / FFT_SIZE;
  for (const power of spectra) {
    for (let i = 1; i < power.length; i++) {
      const hz = i * hzPerBin;
      let band = 0;
      while (band < BAND_NAMES.length - 1 && hz >= BAND_EDGES[band + 1]) band++;
      totals[band] += power[i];
    }
  }
  const all = totals.reduce((a, b) => a + b, 0) || 1;
  const out: Record<string, number> = {};
  BAND_NAMES.forEach((name, i) => (out[name] = Math.round(10 * Math.log10(totals[i] / all + 1e-12) * 10) / 10));
  return out;
}

/** See SongStats.kickOnGrid. `hits` are the scheduled kick times in seconds. */
function kickOnGrid(buffer: AudioBuffer, hits: number[]): number {
  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  const k = 1 - Math.exp((-2 * Math.PI * 120) / rate);
  const low = new Float32Array(data.length);
  let a = 0;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a += k * (data[i] - a);
    b += k * (a - b);
    low[i] = b;
  }
  const span = Math.floor(0.05 * rate);
  const gap = Math.floor(0.004 * rate);
  const ratios: number[] = [];
  for (const hit of hits) {
    const at = Math.round(hit * rate);
    let after = 0;
    let before = 0;
    for (let i = 0; i < span; i++) {
      after += low[(at + i) % data.length] ** 2;
      before += low[(at - gap - span + i + data.length) % data.length] ** 2;
    }
    ratios.push(after / (before + 1e-12));
  }
  ratios.sort((x, y) => x - y);
  return ratios.length > 0 ? ratios[Math.floor(ratios.length / 2)] : 0;
}

function correlation(buffer: AudioBuffer): number {
  const l = buffer.getChannelData(0);
  const r = buffer.getChannelData(1);
  let lr = 0;
  let ll = 0;
  let rr = 0;
  for (let i = 0; i < l.length; i++) {
    lr += l[i] * r[i];
    ll += l[i] * l[i];
    rr += r[i] * r[i];
  }
  return lr / (Math.sqrt(ll * rr) + 1e-12);
}

function checksum(buffer: AudioBuffer): string {
  let hash = 0x811c9dc5;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    const bits = new Int32Array(data.buffer, data.byteOffset, data.length);
    for (let i = 0; i < bits.length; i++) {
      hash ^= bits[i];
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function identical(a: AudioBuffer, b: AudioBuffer): boolean {
  if (a.length !== b.length || a.numberOfChannels !== b.numberOfChannels) return false;
  for (let c = 0; c < a.numberOfChannels; c++) {
    const x = a.getChannelData(c);
    const y = b.getChannelData(c);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  }
  return true;
}

// ──────────────────────────────────────────────────────────── Drawing ──

function drawWaveform(canvas: HTMLCanvasElement, buffer: AudioBuffer, beats: number): void {
  const g = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const data = buffer.getChannelData(0);
  g.fillStyle = '#05050a';
  g.fillRect(0, 0, width, height);
  g.fillStyle = '#5fd0ff';
  const per = data.length / width;
  for (let x = 0; x < width; x++) {
    let min = 1;
    let max = -1;
    for (let i = Math.floor(x * per); i < Math.floor((x + 1) * per); i++) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }
    g.fillRect(x, ((1 - max) / 2) * height, 1, Math.max(1, ((max - min) / 2) * height));
  }
  // Bar lines (bright) and beats (dim) along the top.
  for (let n = 0; n < beats; n++) {
    g.fillStyle = n % 16 === 0 ? '#ff5' : n % 4 === 0 ? '#fff' : '#666';
    g.fillRect(Math.round((n / beats) * width), 0, 1, n % 4 === 0 ? 8 : 4);
  }
}

function drawSpectrogram(canvas: HTMLCanvasElement, spectra: Float32Array[], sampleRate: number, beats: number): void {
  const g = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const image = g.createImageData(width, height);
  const fMin = 40;
  const fMax = 16000;
  const hzPerBin = sampleRate / FFT_SIZE;
  for (let y = 0; y < height; y++) {
    const hz = fMin * Math.pow(fMax / fMin, 1 - y / (height - 1));
    const bin = Math.min(FFT_SIZE / 2 - 1, Math.max(1, Math.round(hz / hzPerBin)));
    for (let x = 0; x < width; x++) {
      const db = 10 * Math.log10(spectra[x][bin] + 1e-12);
      const v = Math.min(1, Math.max(0, (db + 80) / 75));
      const o = (y * width + x) * 4;
      // black → purple → orange → white
      image.data[o] = 255 * Math.min(1, v * 1.6);
      image.data[o + 1] = 255 * Math.max(0, Math.min(1, v * 2 - 0.75));
      image.data[o + 2] = 255 * Math.max(0, Math.min(1, v < 0.4 ? v * 2 : 1.6 - v * 2 + Math.max(0, v - 0.8) * 5));
      image.data[o + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
  for (let n = 0; n < beats; n += 4) {
    g.fillStyle = n % 16 === 0 ? '#ff5' : '#9ff';
    g.fillRect(Math.round((n / beats) * width), height - (n % 16 === 0 ? 10 : 5), 1, 10);
  }
  g.fillStyle = '#8f8';
  g.font = '9px monospace';
  for (const hz of [100, 1000, 10000]) {
    const y = (1 - Math.log(hz / fMin) / Math.log(fMax / fMin)) * (height - 1);
    g.fillRect(0, y, 6, 1);
    g.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), 8, y + 3);
  }
}

// ──────────────────────────────────────────────────────────── Engine ──

const songsById = new Map<string, SongDef>(BUILTIN_SONGS.map((song) => [song.id, song]));
const learnedBpm: Record<string, number> = {};

const deps: Pick<AssetRegistry, 'loadSong' | 'getSong' | 'setSongBpm'> = {
  getSong: (id) => songsById.get(id),
  loadSong: async (id): Promise<SongSource> => {
    const def = songsById.get(id);
    if (!def || !def.pattern) throw new Error(`Unknown song "${id}"`);
    return { kind: 'pattern', pattern: def.pattern };
  },
  setSongBpm: (id, bpm) => {
    learnedBpm[id] = bpm;
  },
};

const nextFrame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve));

interface Sample {
  /** Wall time, seconds. */
  t: number;
  /** The clock's own time (advances by at most 0.1 s per frame), seconds. */
  time: number;
  beat: number;
  bass: number;
  mid: number;
  treble: number;
  level: number;
}

/** [min, mean, max] of one level over a run, rounded. */
function spread(samples: Sample[], key: 'bass' | 'mid' | 'treble' | 'level'): number[] {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const s of samples) {
    min = Math.min(min, s[key]);
    max = Math.max(max, s[key]);
    sum += s[key];
  }
  return [min, sum / Math.max(1, samples.length), max].map((v) => Math.round(v * 100) / 100);
}

/** Tick the engine once per frame for `seconds`, recording the clock and levels. */
async function run(engine: AudioEngine, seconds: number, log: Sample[]): Promise<Sample[]> {
  const out: Sample[] = [];
  const end = performance.now() + seconds * 1000;
  while (performance.now() < end) {
    await nextFrame();
    const clock = engine.tick();
    const levels = engine.levels();
    const sample = { t: performance.now() / 1000, time: clock.time, beat: clock.beat, bass: levels.bass, mid: levels.mid, treble: levels.treble, level: levels.level };
    out.push(sample);
    log.push(sample);
  }
  return out;
}

async function runUntil(engine: AudioEngine, log: Sample[], done: () => boolean, timeout = 20): Promise<boolean> {
  const end = performance.now() + timeout * 1000;
  while (!done() && performance.now() < end) await run(engine, 0.05, log);
  return done();
}

/** Beats per minute of wall time: what a listener sees while a song plays. */
function tempoOf(samples: Sample[]): number {
  const first = samples[0];
  const last = samples[samples.length - 1];
  return ((last.beat - first.beat) / (last.t - first.t)) * 60;
}

/** Beats per minute of clock time: the free-running rate, unaffected by slow frames (whose delta is clamped). */
function freeTempoOf(samples: Sample[]): number {
  const first = samples[0];
  const last = samples[samples.length - 1];
  return ((last.beat - first.beat) / (last.time - first.time)) * 60;
}

/** Mean bass level in the first quarter of each beat divided by the mean in the third quarter. */
function bassOnBeat(samples: Sample[]): number {
  let on = 0;
  let onCount = 0;
  let off = 0;
  let offCount = 0;
  for (const s of samples) {
    const phase = s.beat - Math.floor(s.beat);
    if (phase < 0.25) {
      on += s.bass;
      onCount++;
    } else if (phase >= 0.5 && phase < 0.75) {
      off += s.bass;
      offCount++;
    }
  }
  return on / Math.max(1, onCount) / (off / Math.max(1, offCount) + 1e-6);
}

function maxOf(samples: Sample[], key: 'bass' | 'level'): number {
  return samples.reduce((m, s) => Math.max(m, s[key]), 0);
}

/** Exercise a real engine end to end. Returns measurements for the e2e script to assert on. */
async function engineTest(): Promise<Record<string, unknown>> {
  const engine = createAudioEngine(deps);
  const statuses: AudioStatus[] = [];
  engine.subscribe((status) => statuses.push(status));
  const log: Sample[] = [];
  const first = BUILTIN_SONGS[0];
  const second = BUILTIN_SONGS[5];
  const settings: AudioSettings = { songId: first.id, muted: false, volume: 0.8, beatSync: true };
  const report: Record<string, unknown> = {};

  // Locked: the clock free-runs, nothing is loaded.
  engine.sync(settings);
  const locked = await run(engine, 0.6, log);
  report.lockedTempo = freeTempoOf(locked);
  report.lockedStatus = engine.status.state;
  report.lockedUnlocked = engine.unlocked;
  report.lockedLevel = maxOf(locked, 'level');

  // Unlock: the remembered song loads and plays.
  const t0 = performance.now();
  await engine.unlock();
  report.unlocked = engine.unlocked;
  report.statusAfterUnlock = engine.status.state;
  report.firstPlaying = await runUntil(engine, log, () => engine.status.state === 'playing');
  report.timeToPlayMs = Math.round(performance.now() - t0);
  report.firstStatus = engine.status;
  await run(engine, 0.4, log);
  const playing = await run(engine, 2.5, log);
  report.firstTempo = tempoOf(playing);
  report.firstBpm = first.bpm;
  report.firstLevelMax = maxOf(playing, 'level');
  report.firstBassMax = maxOf(playing, 'bass');
  const levels = engine.levels();
  report.levelsSample = { ...levels };
  const longer = await run(engine, 4, log);
  report.firstBassOnBeat = bassOnBeat(longer);
  report.firstSpread = { level: spread(longer, 'level'), bass: spread(longer, 'bass'), mid: spread(longer, 'mid'), treble: spread(longer, 'treble') };

  // Switch songs: the beat keeps climbing and picks up the new tempo.
  const beforeSwitch = engine.clock.beat;
  engine.sync({ ...settings, songId: second.id });
  report.statusDuringSwitch = engine.status.state;
  report.secondPlaying = await runUntil(engine, log, () => engine.status.state === 'playing' && engine.status.songId === second.id);
  report.beatAcrossSwitch = [beforeSwitch, engine.clock.beat];
  await run(engine, 0.5, log);
  const afterSwitch = await run(engine, 2.5, log);
  report.secondTempo = tempoOf(afterSwitch);
  report.secondBpm = second.bpm;
  const longer2 = await run(engine, 3, log);
  report.secondBassOnBeat = bassOnBeat(longer2);
  report.secondSpread = { level: spread(longer2, 'level'), bass: spread(longer2, 'bass'), mid: spread(longer2, 'mid'), treble: spread(longer2, 'treble') };

  // Mute: levels drop to zero, playback and the clock carry on.
  engine.sync({ ...settings, songId: second.id, muted: true });
  const muted = await run(engine, 1, log);
  report.mutedLevelMax = Math.max(maxOf(muted, 'level'), maxOf(muted, 'bass'));
  report.mutedTempo = tempoOf(muted);
  report.mutedStatus = engine.status.state;
  engine.sync({ ...settings, songId: second.id, muted: false });
  const unmuted = await run(engine, 1, log);
  report.unmutedLevelMax = maxOf(unmuted, 'level');

  // Rapid switching: only the last request starts.
  const marker = statuses.length;
  engine.sync({ ...settings, songId: BUILTIN_SONGS[1].id });
  engine.sync({ ...settings, songId: BUILTIN_SONGS[2].id });
  engine.sync({ ...settings, songId: BUILTIN_SONGS[3].id });
  report.rapidPlaying = await runUntil(engine, log, () => engine.status.state === 'playing' && engine.status.songId === BUILTIN_SONGS[3].id);
  const third = await run(engine, 3, log);
  report.thirdSpread = { level: spread(third, 'level'), bass: spread(third, 'bass'), mid: spread(third, 'mid'), treble: spread(third, 'treble') };
  report.rapidStarted = statuses.slice(marker).filter((s) => s.state === 'playing').map((s) => (s.state === 'playing' ? s.songId : ''));
  report.rapidFinal = engine.status;

  // A song that cannot be loaded: readable error, clock free-runs.
  engine.sync({ ...settings, songId: 'builtin:does-not-exist' });
  report.errorReached = await runUntil(engine, log, () => engine.status.state === 'error');
  report.errorStatus = engine.status;
  const failed = await run(engine, 1, log);
  report.errorTempo = freeTempoOf(failed.slice(Math.floor(failed.length / 2)));
  report.errorLevelMax = maxOf(failed.slice(Math.floor(failed.length / 2)), 'level');

  // Recover, then silence.
  engine.sync({ ...settings, songId: first.id });
  report.recovered = await runUntil(engine, log, () => engine.status.state === 'playing');
  engine.sync({ ...settings, songId: null });
  report.idleStatus = engine.status.state;
  const idle = await run(engine, 0.8, log);
  report.idleLevelMax = maxOf(idle.slice(Math.floor(idle.length / 2)), 'level');
  report.idleTempo = freeTempoOf(idle.slice(Math.floor(idle.length / 2)));

  let decreases = 0;
  let maxStep = 0;
  for (let i = 1; i < log.length; i++) {
    if (log[i].beat < log[i - 1].beat) decreases++;
    maxStep = Math.max(maxStep, log[i].beat - log[i - 1].beat);
  }
  report.beatDecreases = decreases;
  report.maxBeatStep = maxStep;
  report.frames = log.length;
  report.statuses = statuses.map((s) => (s.state === 'idle' ? 'idle' : `${s.state}:${s.songId.replace('builtin:', '')}`));
  report.defaultBpm = DEFAULT_BPM;
  engine.dispose();
  return report;
}

// ────────────────────────────────────────────────────────────── Page ──

let listenContext: AudioContext | null = null;
let listening: AudioBufferSourceNode | null = null;

function stopListening(): void {
  listening?.stop();
  listening = null;
}

function listen(buffer: AudioBuffer): void {
  listenContext ??= new AudioContext();
  void listenContext.resume();
  stopListening();
  // Rendered at the lab's rate; the context resamples if it runs at another one.
  const source = listenContext.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(listenContext.destination);
  source.start();
  listening = source;
}

async function measure(song: SongDef, row: HTMLElement): Promise<SongStats> {
  const pattern = song.pattern!;
  const expectedLength = Math.round(((pattern.bars * 4 * 60) / pattern.bpm) * SAMPLE_RATE);
  const stats: SongStats = {
    id: song.id, title: song.title, bpm: pattern.bpm, bars: pattern.bars, error: null,
    length: 0, expectedLength, channels: 0, peakDb: 0, rmsDb: 0, crestDb: 0, seam: 0, deterministic: false, checksum: '', renderMs: 0,
    bands: {}, kickOnGrid: 0, limitedDb: 0, mixMs: 0, longestFrameMs: 0, stereoCorrelation: 0,
  };
  const statsElement = row.querySelector<HTMLElement>('.stats')!;
  try {
    const t0 = performance.now();
    let report: RenderReport | null = null;
    // Watch the frame rate while rendering: the render must not freeze the page.
    let watching = true;
    let lastFrame = performance.now();
    const watch = (): void => {
      const now = performance.now();
      stats.longestFrameMs = Math.max(stats.longestFrameMs, Math.round(now - lastFrame));
      lastFrame = now;
      if (watching) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
    const buffer = await renderPattern(pattern, { sampleRate: SAMPLE_RATE, report: (r) => (report = r) });
    stats.renderMs = Math.round(performance.now() - t0);
    await nextFrame();
    watching = false;
    stats.limitedDb = (report as RenderReport | null)?.limitedDb ?? 0;
    stats.mixMs = Math.round((report as RenderReport | null)?.mixMs ?? 0);
    const again = await renderPattern(pattern, { sampleRate: SAMPLE_RATE });
    stats.deterministic = identical(buffer, again);
    stats.checksum = checksum(buffer);
    const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
    stats.length = buffer.length;
    stats.channels = buffer.numberOfChannels;
    stats.peakDb = toDb(peakOf(channels));
    stats.rmsDb = toDb(rmsOf(channels));
    stats.crestDb = stats.peakDb - stats.rmsDb;
    stats.seam = seamRatio(channels);
    stats.kickOnGrid = kickOnGrid(buffer, expandPattern(pattern).filter((e) => pattern.tracks[e.track].kind === 'kick').map((e) => e.time));
    stats.stereoCorrelation = correlation(buffer);
    const beats = pattern.bars * 4;
    const spectra = spectrogram(buffer, 1000);
    stats.bands = bandShares(spectra, SAMPLE_RATE);
    drawWaveform(row.querySelector<HTMLCanvasElement>('.wave')!, buffer, beats);
    drawSpectrogram(row.querySelector<HTMLCanvasElement>('.spec')!, spectra, SAMPLE_RATE, beats);
    row.querySelector<HTMLButtonElement>('.play')!.onclick = () => listen(buffer);
    statsElement.textContent =
      `peak ${stats.peakDb.toFixed(2)} dBFS\nrms  ${stats.rmsDb.toFixed(2)} dBFS\ncrest ${stats.crestDb.toFixed(1)} dB\n` +
      `limited ${stats.limitedDb.toFixed(1)} dB\n` +
      `seam ${stats.seam.toFixed(2)}  ${stats.deterministic ? 'deterministic' : 'NOT deterministic'}\nrender ${stats.renderMs} ms (mix ${stats.mixMs}, worst frame ${stats.longestFrameMs})\n` +
      `len ${stats.length}${stats.length === expectedLength ? '' : ' !='}\nkick on grid ${stats.kickOnGrid.toFixed(1)}  L/R corr ${stats.stereoCorrelation.toFixed(2)}\n` +
      BAND_NAMES.map((name) => `${name} ${stats.bands[name]}`).join('  ').replace('  mid', '\nmid');
  } catch (error) {
    stats.error = error instanceof Error ? error.message : String(error);
    statsElement.textContent = stats.error;
    statsElement.classList.add('bad');
  }
  return stats;
}

async function main(): Promise<void> {
  const container = document.querySelector<HTMLElement>('#songs')!;
  const only = new URLSearchParams(location.search).get('song');
  const songs = BUILTIN_SONGS.filter((song) => !only || song.id.includes(only));
  const results: SongStats[] = [];
  for (const song of songs) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML =
      `<div class="meta"><b></b><div class="vibe"></div><button class="play">play</button><button class="stop">stop</button><div class="stats">rendering…</div></div>` +
      `<div><canvas class="wave" width="1000" height="44"></canvas><canvas class="spec" width="1000" height="150"></canvas></div>`;
    row.querySelector('b')!.textContent = song.title;
    row.querySelector('.vibe')!.textContent = `${song.vibe ?? ''} · ${song.bpm ?? '?'} bpm · ${song.pattern?.bars ?? '?'} bars`;
    row.querySelector<HTMLButtonElement>('.stop')!.onclick = stopListening;
    container.append(row);
    results.push(await measure(song, row));
  }

  // Interactive engine panel.
  let engine: AudioEngine | null = null;
  const select = document.querySelector<HTMLSelectElement>('#song')!;
  const mute = document.querySelector<HTMLInputElement>('#mute')!;
  const volume = document.querySelector<HTMLInputElement>('#volume')!;
  const readout = document.querySelector<HTMLElement>('#readout')!;
  select.innerHTML = `<option value="">(silence)</option>` + BUILTIN_SONGS.map((s) => `<option value="${s.id}">${s.title}</option>`).join('');
  const push = (): void => engine?.sync({ songId: select.value || null, muted: mute.checked, volume: Number(volume.value), beatSync: true });
  select.onchange = mute.onchange = volume.oninput = push;
  document.querySelector<HTMLButtonElement>('#unlock')!.onclick = () => {
    if (!engine) {
      engine = createAudioEngine(deps);
      const loop = (): void => {
        if (!engine) return;
        const clock = engine.tick();
        const l = engine.levels();
        const bar = (v: number): string => '#'.repeat(Math.round(v * 24)).padEnd(24, '.');
        readout.textContent =
          `status ${JSON.stringify(engine.status)}\nbeat ${clock.beat.toFixed(2)}  bpm ${clock.bpm}  time ${clock.time.toFixed(1)}\n` +
          `level  ${bar(l.level)}\nbass   ${bar(l.bass)}\nmid    ${bar(l.mid)}\ntreble ${bar(l.treble)}`;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    stopListening();
    void engine.unlock();
    push();
  };

  (window as unknown as { __thunes: unknown }).__thunes = { ready: true, sampleRate: SAMPLE_RATE, songs: results, engineTest };
}

void main();
