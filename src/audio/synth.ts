/**
 * Renders a SongPattern to a seamless stereo loop with an OfflineAudioContext.
 *
 * Everything is synthesised from Web Audio nodes. All noise comes from a
 * seeded generator, so a pattern always renders to the same samples.
 *
 * Signal flow:  voices → track bus (gain, pan, duck) → mix → out
 *                                    ├→ delay send  → ping-pong delay → mix
 *                                    └→ reverb send → convolver       → mix
 *
 * The mix is linear, so the loop is cut into a few time slices that render in
 * parallel OfflineAudioContexts (one thread each) and are overlap-added.
 *
 * Each render runs on after its notes so reverb, delay and release tails can
 * ring out; what rings past the end of the loop is folded back onto the start,
 * which is exactly what the loop sounds like once it has gone round. The
 * ducking envelope is periodic over the loop, and the only non-linear
 * processing in the graph is per voice, so the fold is exact. Loudness
 * normalisation and limiting happen afterwards, around the seam.
 *
 * Bit-exact repeatability needs care: a browser may add the inputs of a node
 * in any order, and floating-point sums of three or more values depend on the
 * order. So no node here ever has more than two non-silent inputs: static
 * mixes are chains of two-input adders (`sumInto`), every voice is gated to
 * exact silence when it ends, and each track hands its voices to a
 * `VoiceMixer` that never lets two sounding voices share an adder. The delay
 * feedback loop is entered from a single node for the same reason.
 */

import type { DelayEffect, DrumInstrument, Instrument, ReverbEffect, SongPattern, SynthInstrument, SynthKind } from './pattern';
import { isDrum } from './pattern';
import type { SeqEvent } from './sequence';
import { createRandom, expandPattern, hashString, midiToHz, patternSeconds, stepSeconds } from './sequence';
import { addWrapped, masterLoopAsync } from './dsp';

/** Loudness every rendered song is brought to (RMS, dBFS) and the peak ceiling (dBFS). */
export const TARGET_RMS_DB = -15;
export const PEAK_CEILING_DB = -1.2;

/** Longest effect/release tail that is rendered and folded back, seconds. */
const MAX_TAIL_SECONDS = 10;
/** Voices are created this long before they sound (the render is paused to add them), seconds. */
const WINDOW_SECONDS = 2;
const WINDOW_LEAD_SECONDS = 0.05;
/** The loop is cut into this many time slices that render in parallel. */
const RENDER_SLICES = 4;
/** Control rate of the ducking envelope, Hz. */
const DUCK_RATE = 1000;
/** Everything below this frequency is filtered out of the finished mix, Hz. */
const RUMBLE_HZ = 28;
/** Level of the keep-alive signal: a normal float, about 450 dB below anything audible. */
const KEEP_ALIVE_LEVEL = 1e-30;

type SynthParams = Required<Omit<SynthInstrument, 'kind' | 'low' | 'swing' | 'humanize' | 'transpose'>> & { level: number };

const MIX_DEFAULTS = { gain: 1, pan: 0, reverb: 0, delay: 0, duck: 0 };

const SYNTH_DEFAULTS: Record<SynthKind, SynthParams> = {
  bass: {
    ...MIX_DEFAULTS, level: 0.4, wave: 'saw', voices: 1, detune: 0, width: 0, sub: 0.35,
    cutoff: 300, resonance: 2.5, envAmount: 2.5, envDecay: 0.16,
    attack: 0.004, decay: 0.25, sustain: 0.75, release: 0.06,
    fmRatio: 1, fmAmount: 2, fmDecay: 0.2, vibrato: 0, vibratoRate: 5.5,
  },
  pluck: {
    ...MIX_DEFAULTS, level: 0.34, wave: 'saw', voices: 2, detune: 8, width: 0.4, sub: 0,
    cutoff: 600, resonance: 2, envAmount: 3.2, envDecay: 0.14,
    attack: 0.002, decay: 0.2, sustain: 0.15, release: 0.14,
    fmRatio: 2, fmAmount: 2, fmDecay: 0.15, vibrato: 0, vibratoRate: 5.5,
  },
  lead: {
    ...MIX_DEFAULTS, level: 0.28, wave: 'square', voices: 2, detune: 9, width: 0.3, sub: 0,
    cutoff: 1700, resonance: 1.5, envAmount: 1.5, envDecay: 0.3,
    attack: 0.012, decay: 0.25, sustain: 0.7, release: 0.16,
    fmRatio: 2, fmAmount: 1.5, fmDecay: 0.3, vibrato: 7, vibratoRate: 5.5,
  },
  pad: {
    ...MIX_DEFAULTS, level: 0.24, wave: 'saw', voices: 3, detune: 13, width: 0.9, sub: 0,
    cutoff: 900, resonance: 0.8, envAmount: 1, envDecay: 1.5,
    attack: 0.3, decay: 1.2, sustain: 0.8, release: 0.6,
    fmRatio: 1, fmAmount: 1, fmDecay: 1, vibrato: 0, vibratoRate: 5,
  },
  keys: {
    ...MIX_DEFAULTS, level: 0.34, wave: 'fm', voices: 1, detune: 0, width: 0, sub: 0,
    cutoff: 3800, resonance: 0.5, envAmount: 0, envDecay: 0.3,
    attack: 0.003, decay: 0.9, sustain: 0.25, release: 0.22,
    fmRatio: 1, fmAmount: 2.2, fmDecay: 0.4, vibrato: 0, vibratoRate: 5,
  },
};

const WAVE_LEVEL: Record<string, number> = { sine: 1, triangle: 1, saw: 0.8, square: 0.55, fm: 1 };

function synthParams(instrument: SynthInstrument): SynthParams {
  const out: Record<string, unknown> = { ...SYNTH_DEFAULTS[instrument.kind] };
  for (const [key, value] of Object.entries(instrument)) {
    if (value !== undefined && key in out) out[key] = value;
  }
  // Built from a complete defaults record plus same-typed overrides.
  return out as unknown as SynthParams;
}

/** Seconds a voice of this instrument keeps sounding after its note ends. */
function releaseTail(instrument: Instrument): number {
  if (isDrum(instrument)) return 0.9 * (instrument.decay ?? 1) + 0.2;
  return synthParams(instrument).release * 3 + 0.05;
}

interface TrackBus {
  instrument: Instrument;
  params: SynthParams | null;
  mixer: VoiceMixer;
  /** Picks where in the noise buffer each hit of this track starts. */
  random: () => number;
}

/** Everything a voice function needs. */
interface Kit {
  ctx: OfflineAudioContext;
  noise: AudioBuffer;
  shaper: Float32Array<ArrayBuffer>;
}

/**
 * Give the page a turn (a frame can be drawn, input handled) before carrying
 * on. Unlike a timer this is not slowed down in background tabs.
 */
function breathe(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

// ───────────────────────────────────────────────── Deterministic sums ──

/**
 * Connect `sources` to `destination` through a chain of two-input adders, so
 * the result does not depend on the order in which the browser sums inputs.
 * `destination` must have no other inputs.
 */
function sumInto(ctx: BaseAudioContext, sources: readonly AudioNode[], destination: AudioNode): void {
  if (sources.length === 0) return;
  let sum = sources[0];
  for (let i = 1; i < sources.length - 1; i++) {
    const adder = ctx.createGain();
    sum.connect(adder);
    sources[i].connect(adder);
    sum = adder;
  }
  sum.connect(destination);
  if (sources.length > 1) sources[sources.length - 1].connect(destination);
}

/**
 * Mixes the voices of one track. Each voice is exactly silent outside
 * [start, end), and voices that overlap in time are given different adders in
 * a chain, so every adder sums at most two non-silent signals.
 */
class VoiceMixer {
  private readonly slots: { adder: GainNode; freeAt: number }[] = [];
  private readonly head: GainNode;

  /** @param keepAlive the never-ending, inaudible source that stops the track's bus from ever being parked */
  constructor(private readonly ctx: BaseAudioContext, destination: AudioNode, keepAlive: AudioNode) {
    this.head = ctx.createGain();
    keepAlive.connect(this.head);
    this.head.connect(destination);
  }

  /** Add a voice that sounds from `start` and is exactly silent from `end` (context seconds). */
  add(voice: AudioNode, start: number, end: number): void {
    let slot = this.slots.find((candidate) => candidate.freeAt <= start);
    if (!slot) {
      const adder = this.ctx.createGain();
      adder.connect(this.slots.length > 0 ? this.slots[this.slots.length - 1].adder : this.head);
      slot = { adder, freeAt: 0 };
      this.slots.push(slot);
    }
    // A margin of a few samples keeps neighbours apart whatever the rounding of event times.
    slot.freeAt = end + 0.0005;
    voice.connect(slot.adder);
  }
}

// ────────────────────────────────────────────────────────── Building ──

/** Two seconds of white noise from the seeded generator. */
function makeNoise(sampleRate: number, random: () => number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(Math.floor(sampleRate * 2));
  for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
  return data;
}

/**
 * A stereo reverb impulse response: decaying noise that gets darker as it
 * fades, with unit energy per channel so send levels behave the same for any length.
 */
function makeImpulse(rate: number, seconds: number, tone: number, random: () => number): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const length = Math.max(64, Math.floor(seconds * rate));
  const make = (): Float32Array<ArrayBuffer> => {
    const data = new Float32Array(length);
    let low = 0;
    let energy = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      // One-pole low-pass whose cutoff falls from `tone` to a third of it.
      const cutoff = tone * (1 - 0.67 * (i / length));
      const k = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
      low += k * (random() * 2 - 1 - low);
      const value = low * Math.min(1, t / 0.006) * Math.exp((-6.9 * t) / seconds);
      data[i] = value;
      energy += value * value;
    }
    const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
    for (let i = 0; i < length; i++) data[i] *= scale;
    return data;
  };
  return [make(), make()];
}

/** Two-pole Butterworth high-pass, in place. */
function highpass(data: Float32Array, hz: number, sampleRate: number): void {
  const w = (2 * Math.PI * hz) / sampleRate;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0;
  const b1 = -(1 + cos) / a0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    data[i] = y;
  }
}

function makeShaperCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1025);
  const drive = 1.6;
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return curve;
}

/**
 * The periodic ducking envelope (0 = untouched … 1 = fully ducked), sampled at
 * DUCK_RATE over the whole render. Hits repeat every loop, so the envelope is
 * the same on every pass.
 */
export function duckEnvelope(hitTimes: readonly number[], loopSeconds: number, totalSeconds: number, releaseSeconds: number): Float32Array<ArrayBuffer> {
  const length = Math.max(2, Math.ceil(totalSeconds * DUCK_RATE) + 1);
  const env = new Float32Array(length);
  const attack = 0.006;
  const loops = Math.ceil(totalSeconds / loopSeconds) + 1;
  for (const hit of hitTimes) {
    for (let k = -1; k < loops; k++) {
      const start = hit + k * loopSeconds;
      const first = Math.max(0, Math.ceil(start * DUCK_RATE));
      const last = Math.min(length - 1, Math.floor((start + attack + releaseSeconds) * DUCK_RATE));
      for (let i = first; i <= last; i++) {
        const t = i / DUCK_RATE - start;
        let value: number;
        if (t < attack) value = t / attack;
        else {
          const x = 1 - (t - attack) / releaseSeconds;
          value = x <= 0 ? 0 : x * Math.sqrt(x);
        }
        if (value > env[i]) env[i] = value;
      }
    }
  }
  return env;
}

// ───────────────────────────────────────────────────────────── Voices ──

function noiseSource(kit: Kit, random: () => number, time: number, stop: number): AudioBufferSourceNode {
  const source = kit.ctx.createBufferSource();
  source.buffer = kit.noise;
  source.loop = true;
  source.start(time, random() * 1.5);
  source.stop(stop);
  return source;
}

/** Gain node with a percussive envelope: fast linear attack, exponential decay with time constant `tau`. */
function percEnvelope(ctx: BaseAudioContext, time: number, peak: number, attack: number, tau: number, hold = 0): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(peak, time + attack);
  gain.gain.setTargetAtTime(0, time + attack + hold, tau);
  return gain;
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number, q = 0.707): BiquadFilterNode {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = Math.min(frequency, ctx.sampleRate * 0.45);
  node.Q.value = q;
  return node;
}

function tone(kit: Kit, type: OscillatorType, time: number, stop: number, frequency: number): OscillatorNode {
  const osc = kit.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, time);
  osc.start(time);
  osc.stop(stop);
  return osc;
}

function playDrum(kit: Kit, bus: TrackBus, time: number, velocity: number): void {
  const { ctx } = kit;
  const { mixer, random } = bus;
  const drum = bus.instrument as DrumInstrument;
  const amp = Math.pow(velocity, 1.3);
  const tune = Math.pow(2, (drum.tune ?? 0) / 12);
  const decay = drum.decay ?? 1;
  const bright = drum.tone ?? 0.5;
  const out = ctx.createGain();
  let end: number;

  switch (drum.kind) {
    case 'kick': {
      const tau = 0.085 * decay;
      end = time + 0.05 + tau * 8;
      const base = 52 * tune;
      const osc = tone(kit, 'sine', time, end, base * (2.6 + 3 * bright));
      osc.frequency.setTargetAtTime(base, time, 0.026);
      const env = percEnvelope(ctx, time, 1, 0.0015, tau, 0.035);
      const shaper = ctx.createWaveShaper();
      shaper.curve = kit.shaper;
      const level = ctx.createGain();
      level.gain.value = 0.74 * amp;
      osc.connect(env).connect(shaper).connect(level).connect(out);
      // Beater click.
      const click = noiseSource(kit, random, time, time + 0.04);
      const clickEnv = percEnvelope(ctx, time, (0.08 + 0.3 * bright) * amp, 0.0005, 0.004);
      click.connect(filter(ctx, 'bandpass', 2800, 0.8)).connect(clickEnv).connect(out);
      break;
    }
    case 'snare': {
      const tau = 0.06 * decay;
      end = time + 0.05 + tau * 8;
      const body = tone(kit, 'triangle', time, end, 190 * tune * 1.5);
      body.frequency.setTargetAtTime(190 * tune, time, 0.012);
      body.connect(percEnvelope(ctx, time, 0.5 * amp, 0.001, tau * 0.7)).connect(out);
      const noise = noiseSource(kit, random, time, end);
      noise
        .connect(filter(ctx, 'highpass', 1400))
        .connect(filter(ctx, 'lowpass', 5500 + 5000 * bright, 0.6))
        .connect(percEnvelope(ctx, time, 0.55 * amp, 0.001, tau))
        .connect(out);
      break;
    }
    case 'clap': {
      const tau = 0.065 * decay;
      end = time + 0.08 + tau * 8;
      const env = ctx.createGain();
      const peak = 0.65 * amp;
      env.gain.setValueAtTime(0, time);
      for (let i = 0; i < 3; i++) {
        const t = time + i * 0.0105;
        env.gain.linearRampToValueAtTime(peak * (0.7 + 0.1 * i), t + 0.001);
        env.gain.setTargetAtTime(peak * 0.15, t + 0.001, 0.003);
        env.gain.setValueAtTime(peak * 0.17, t + 0.0095);
      }
      const t3 = time + 0.0315;
      env.gain.linearRampToValueAtTime(peak, t3 + 0.001);
      env.gain.setTargetAtTime(0, t3 + 0.001, tau);
      noiseSource(kit, random, time, end)
        .connect(filter(ctx, 'bandpass', 1150 * tune, 1.3))
        .connect(filter(ctx, 'lowpass', 5000 + 5000 * bright, 0.6))
        .connect(env)
        .connect(out);
      break;
    }
    case 'hat':
    case 'openhat': {
      const open = drum.kind === 'openhat';
      const tau = (open ? 0.1 : 0.017) * decay;
      end = time + 0.03 + tau * 8;
      noiseSource(kit, random, time, end)
        .connect(filter(ctx, 'highpass', (6000 + 3000 * bright) * tune, 0.9))
        .connect(filter(ctx, 'lowpass', 10500 + 3000 * bright, 0.5))
        .connect(percEnvelope(ctx, time, (open ? 0.34 : 0.4) * amp, 0.0008, tau))
        .connect(out);
      break;
    }
    case 'perc': {
      const variant = drum.variant ?? 'rim';
      if (variant === 'rim') {
        end = time + 0.15;
        const env = percEnvelope(ctx, time, 0.4 * amp, 0.0005, 0.011 * decay);
        tone(kit, 'triangle', time, end, 470 * tune).connect(env);
        const snap = ctx.createGain();
        snap.gain.value = 0.5;
        tone(kit, 'square', time, end, 1730 * tune).connect(filter(ctx, 'bandpass', 1730 * tune, 3)).connect(snap).connect(env);
        env.connect(out);
      } else if (variant === 'tom' || variant === 'conga') {
        const tom = variant === 'tom';
        const base = (tom ? 105 : 235) * tune;
        const tau = (tom ? 0.11 : 0.055) * decay;
        end = time + 0.05 + tau * 8;
        const osc = tone(kit, 'sine', time, end, base * (tom ? 1.7 : 1.25));
        osc.frequency.setTargetAtTime(base, time, tom ? 0.03 : 0.008);
        osc.connect(percEnvelope(ctx, time, (tom ? 0.6 : 0.45) * amp, 0.001, tau)).connect(out);
        if (!tom) {
          noiseSource(kit, random, time, time + 0.05)
            .connect(filter(ctx, 'bandpass', 2200, 1))
            .connect(percEnvelope(ctx, time, 0.12 * bright * amp, 0.0005, 0.005))
            .connect(out);
        }
      } else if (variant === 'cowbell') {
        const tau = 0.05 * decay;
        end = time + 0.05 + tau * 8;
        const env = percEnvelope(ctx, time, 0.3 * amp, 0.0005, tau);
        const band = filter(ctx, 'bandpass', 845 * tune, 2.5);
        tone(kit, 'square', time, end, 562 * tune).connect(band);
        tone(kit, 'square', time, end, 845 * tune).connect(band);
        band.connect(env).connect(out);
      } else {
        // shaker / tamb
        const shaker = variant === 'shaker';
        const tau = (shaker ? 0.022 : 0.05) * decay;
        end = time + 0.05 + tau * 8;
        noiseSource(kit, random, time, end)
          .connect(filter(ctx, shaker ? 'bandpass' : 'highpass', (shaker ? 5200 : 6800) * tune, shaker ? 1.1 : 0.9))
          .connect(filter(ctx, 'lowpass', 9500 + 3000 * bright, 0.5))
          .connect(percEnvelope(ctx, time, (shaker ? 0.3 : 0.26) * amp, shaker ? 0.007 : 0.001, tau))
          .connect(out);
      }
      break;
    }
  }

  // Exact silence once the sources have stopped (filters would otherwise ring on at a whisper).
  out.gain.setValueAtTime(1, time);
  out.gain.setValueAtTime(0, end);
  mixer.add(out, time, end);
}

function playSynth(kit: Kit, p: SynthParams, mixer: VoiceMixer, event: SeqEvent): void {
  const { ctx } = kit;
  const count = event.notes.length;
  if (count === 0) return;
  const t0 = event.time;
  const velocity = event.velocity;
  const peak = (p.level * Math.pow(velocity, 1.2)) / Math.sqrt(count);
  const releaseAt = t0 + Math.max(event.duration, p.attack + 0.005);
  const stop = releaseAt + p.release * 3 + 0.02;

  // Amplitude envelope. The value at release is computed here so no cancel/hold call is needed.
  const amp = ctx.createGain();
  const decayTau = Math.max(0.005, p.decay / 3);
  const held = releaseAt - (t0 + p.attack);
  const atRelease = peak * (p.sustain + (1 - p.sustain) * Math.exp(-held / decayTau));
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(peak, t0 + p.attack);
  amp.gain.setTargetAtTime(peak * p.sustain, t0 + p.attack, decayTau);
  amp.gain.setValueAtTime(atRelease, releaseAt);
  amp.gain.setTargetAtTime(0, releaseAt, Math.max(0.004, p.release / 3));
  amp.gain.setValueAtTime(0, stop);

  // Filter with its own envelope (updated once per render block, which is plenty for an envelope).
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.Q.value = p.resonance;
  lowpass.frequency.automationRate = 'k-rate';
  const ceiling = Math.min(18000, ctx.sampleRate * 0.45);
  const rest = Math.min(ceiling, Math.max(30, p.cutoff));
  const open = Math.min(ceiling, rest * Math.pow(2, p.envAmount * (0.45 + 0.55 * velocity)));
  if (p.attack < 0.03) {
    lowpass.frequency.setValueAtTime(open, t0);
    lowpass.frequency.setTargetAtTime(rest, t0, Math.max(0.005, p.envDecay / 3));
  } else {
    lowpass.frequency.setValueAtTime(rest, t0);
    lowpass.frequency.exponentialRampToValueAtTime(open, t0 + p.attack);
    lowpass.frequency.setTargetAtTime(rest, t0 + p.attack, Math.max(0.005, p.envDecay / 3));
  }

  const voices = Math.max(1, Math.min(5, Math.round(p.voices)));
  const mix = ctx.createGain();
  mix.gain.value = (WAVE_LEVEL[p.wave] ?? 1) / Math.sqrt(voices);
  mix.connect(lowpass);

  let vibrato: GainNode | null = null;
  if (p.vibrato > 0) {
    const lfo = tone(kit, 'sine', t0, stop, p.vibratoRate);
    vibrato = ctx.createGain();
    vibrato.gain.setValueAtTime(0, t0);
    vibrato.gain.linearRampToValueAtTime(p.vibrato, t0 + 0.25);
    lfo.connect(vibrato);
  }

  const fm = p.wave === 'fm';
  const type: OscillatorType = p.wave === 'saw' ? 'sawtooth' : p.wave === 'fm' ? 'sine' : p.wave;
  const oscillators: AudioNode[] = [];
  const afterFilter: AudioNode[] = [lowpass];

  for (const midi of event.notes) {
    const hz = midiToHz(midi);
    let modulation: GainNode | null = null;
    if (fm) {
      const modulator = tone(kit, 'sine', t0, stop, hz * p.fmRatio);
      modulation = ctx.createGain();
      const index = p.fmAmount * (0.4 + 0.6 * velocity) * hz;
      modulation.gain.setValueAtTime(index, t0);
      modulation.gain.setTargetAtTime(index * 0.2, t0, Math.max(0.005, p.fmDecay / 3));
      modulator.connect(modulation);
    }
    for (let v = 0; v < voices; v++) {
      const position = voices === 1 ? 0 : (v / (voices - 1)) * 2 - 1; // -1 … 1
      const osc = tone(kit, type, t0, stop, hz);
      osc.detune.value = position * p.detune;
      if (vibrato) vibrato.connect(osc.detune);
      if (modulation) modulation.connect(osc.frequency);
      if (p.width > 0 && voices > 1) {
        const pan = ctx.createStereoPanner();
        // Alternate sides so neighbouring detunes end up apart.
        pan.pan.value = position * p.width * (v % 2 === 0 ? 1 : -1);
        oscillators.push(osc.connect(pan));
      } else {
        oscillators.push(osc);
      }
    }
    if (p.sub > 0) {
      const sub = tone(kit, 'sine', t0, stop, hz / 2);
      const level = ctx.createGain();
      level.gain.value = p.sub;
      // The sub skips the filter so the low end stays steady while the filter moves.
      afterFilter.push(sub.connect(level));
    }
  }
  sumInto(ctx, oscillators, mix);
  sumInto(ctx, afterFilter, amp);
  mixer.add(amp, t0, stop);
}

// ───────────────────────────────────────────────────────────── Render ──

/** Measurements of a finished render (for the lab page and tests). */
export interface RenderReport {
  /** Sample peak and RMS of the result, dBFS. */
  peakDb: number;
  rmsDb: number;
  /** How far the limiter pulled the loudest peak down, dB. */
  limitedDb: number;
  /** Number of parallel time slices and of notes rendered. */
  slices: number;
  voices: number;
  /** Milliseconds from the end of the parallel renders to the finished buffer (mixing and mastering, done in short main-thread bursts). */
  mixMs: number;
}

export interface RenderOptions {
  /** Sample rate of the result, Hz. */
  sampleRate: number;
  /** Called once with measurements of the finished render. */
  report?: (report: RenderReport) => void;
}

/** Everything the parallel renders share: plain data computed once. */
interface Shared {
  pattern: SongPattern;
  sampleRate: number;
  noise: Float32Array<ArrayBuffer>;
  impulse: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] | null;
  shaper: Float32Array<ArrayBuffer>;
  loopLatencyFrames: number;
  delaySeconds: number;
  feedback: number;
  delayFx: Required<DelayEffect>;
  reverbFx: Required<ReverbEffect>;
}

let loopLatency: Promise<number> | null = null;

/**
 * Frames of extra delay the browser adds to a DelayNode inside a feedback
 * loop (the Web Audio spec says none; Chrome adds one 128-frame block).
 * Measured once with a tiny offline render so echoes land on the grid everywhere.
 */
function measureLoopLatency(): Promise<number> {
  loopLatency ??= (async () => {
    const rate = 48000;
    const wanted = 512;
    const ctx = new OfflineAudioContext(1, 2048, rate);
    const click = ctx.createBuffer(1, 8, rate);
    click.getChannelData(0)[0] = 1;
    const source = ctx.createBufferSource();
    source.buffer = click;
    const sum = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = wanted / rate;
    source.connect(sum);
    sum.connect(delay).connect(sum);
    sum.connect(ctx.destination);
    source.start(0);
    const data = (await ctx.startRendering()).getChannelData(0);
    let at = wanted;
    let best = 0;
    for (let i = 64; i < data.length; i++) {
      if (Math.abs(data[i]) > best) {
        best = Math.abs(data[i]);
        at = i;
      }
    }
    const extra = at - wanted;
    return extra >= 0 && extra <= 512 ? extra : 0;
  })().catch(() => 0);
  return loopLatency;
}

/** One time slice of the song to render. */
interface Slice {
  /** The notes that start in this slice, with times counted from the slice start. */
  events: SeqEvent[];
  /** Seconds of the slice in which notes start. */
  seconds: number;
  /** Frames to render: the slice plus the tail of its notes and effects. */
  length: number;
  /** Ducking control curve for exactly `length` frames (scaled to −depth … 0), or null. */
  duck: Float32Array<ArrayBuffer> | null;
}

/** Render one slice: its notes through the full mixer and effects, until everything has rung out. */
async function renderSlice(shared: Shared, slice: Slice): Promise<AudioBuffer> {
  const { pattern, sampleRate, delayFx, reverbFx, delaySeconds, feedback } = shared;
  const { events } = slice;
  const trackIds = Object.keys(pattern.tracks);
  const ctx = new OfflineAudioContext(2, slice.length, sampleRate);
  const noise = ctx.createBuffer(1, shared.noise.length, sampleRate);
  noise.copyToChannel(shared.noise, 0);
  // A source that never stops, far too quiet to hear or to change any sample it
  // is added to. It keeps every bus "non-silent": a browser may otherwise stop
  // processing a filter whose input has gone silent, cutting its ringing off
  // at a moment that depends on thread timing.
  const keepAlive = ctx.createConstantSource();
  keepAlive.offset.value = KEEP_ALIVE_LEVEL;
  keepAlive.start(0);
  const kit: Kit = { ctx, noise, shaper: shared.shaper };

  // Everything that reaches the output; summed in a fixed order at the end.
  const outputs: AudioNode[] = [];
  const delaySends: AudioNode[] = [];
  const reverbSends: AudioNode[] = [];

  // Sidechain-style ducking keyed to the kick: one control signal, scaled per track.
  let duckSignal: GainNode | null = null;
  if (slice.duck) {
    const one = ctx.createConstantSource();
    one.offset.value = 1;
    duckSignal = ctx.createGain();
    duckSignal.gain.setValueCurveAtTime(slice.duck, 0, (slice.duck.length - 1) / DUCK_RATE);
    one.connect(duckSignal);
    one.start(0);
  }

  // Track buses: voices → level → pan → duck → (output, sends).
  const buses = new Map<string, TrackBus>();
  for (const id of trackIds) {
    const instrument = pattern.tracks[id];
    const input = ctx.createGain();
    input.gain.value = instrument.gain ?? 1;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.min(1, Math.max(-1, instrument.pan ?? 0));
    const duck = ctx.createGain();
    input.connect(pan).connect(duck);
    outputs.push(duck);
    const amount = instrument.duck ?? 0;
    if (duckSignal && amount > 0) {
      const scale = ctx.createGain();
      scale.gain.value = Math.min(1, amount);
      duckSignal.connect(scale).connect(duck.gain);
    }
    if ((instrument.delay ?? 0) > 0) {
      // The delay is fed in mono. Each send folds its own stereo signal down, because a
      // node that down-mixes several inputs at once adds four terms in an order of its choosing.
      const send = ctx.createGain();
      send.channelCount = 1;
      send.channelCountMode = 'explicit';
      send.gain.value = instrument.delay ?? 0;
      delaySends.push(duck.connect(send));
    }
    if ((instrument.reverb ?? 0) > 0) {
      const send = ctx.createGain();
      send.gain.value = instrument.reverb ?? 0;
      reverbSends.push(duck.connect(send));
    }
    buses.set(id, {
      instrument,
      params: isDrum(instrument) ? null : synthParams(instrument),
      mixer: new VoiceMixer(ctx, input, keepAlive),
      random: createRandom((pattern.seed ^ hashString(`noise:${id}`)) >>> 0),
    });
  }

  // Feedback delay. Left repeats come from a loop two delay times long; the
  // right repeats are a delayed copy of the left ones, taken outside the loop,
  // so the loop is only ever reached through `loopSum`.
  if (delaySends.length > 0) {
    const delayIn = ctx.createGain();
    sumInto(ctx, delaySends, delayIn);
    const first = ctx.createDelay(delaySeconds + 0.05);
    first.delayTime.value = delaySeconds;
    const loopSum = ctx.createGain();
    const loopDelay = ctx.createDelay(delaySeconds * 2 + 0.05);
    loopDelay.delayTime.value = Math.max(128 / sampleRate, delaySeconds * 2 - shared.loopLatencyFrames / sampleRate);
    const loopGain = ctx.createGain();
    loopGain.gain.value = feedback * feedback;
    delayIn.connect(filter(ctx, 'highpass', 250)).connect(first).connect(filter(ctx, 'lowpass', delayFx.tone, 0.5)).connect(loopSum);
    loopSum.connect(loopDelay).connect(filter(ctx, 'lowpass', delayFx.tone * 0.8, 0.5)).connect(loopGain).connect(loopSum);
    const second = ctx.createDelay(delaySeconds + 0.05);
    second.delayTime.value = delaySeconds;
    const secondGain = ctx.createGain();
    secondGain.gain.value = feedback;
    const panLeft = ctx.createStereoPanner();
    const panRight = ctx.createStereoPanner();
    panLeft.pan.value = -delayFx.spread;
    panRight.pan.value = delayFx.spread;
    const back = ctx.createGain();
    back.gain.value = delayFx.level;
    loopSum.connect(panLeft).connect(back);
    loopSum.connect(second).connect(filter(ctx, 'lowpass', delayFx.tone * 0.9, 0.5)).connect(secondGain).connect(panRight).connect(back);
    outputs.push(back);
  }

  // Convolution reverb from the generated impulse response.
  if (reverbSends.length > 0 && shared.impulse) {
    const reverbIn = ctx.createGain();
    sumInto(ctx, reverbSends, reverbIn);
    const impulse = ctx.createBuffer(2, shared.impulse[0].length, sampleRate);
    impulse.copyToChannel(shared.impulse[0], 0);
    impulse.copyToChannel(shared.impulse[1], 1);
    const convolver = ctx.createConvolver();
    convolver.normalize = false;
    convolver.buffer = impulse;
    const predelay = ctx.createDelay(1);
    predelay.delayTime.value = Math.min(0.9, Math.max(0, reverbFx.predelay));
    const back = ctx.createGain();
    back.gain.value = reverbFx.level * 0.8;
    reverbIn.connect(filter(ctx, 'highpass', 220)).connect(predelay).connect(convolver).connect(back);
    outputs.push(back);
  }

  sumInto(ctx, outputs, ctx.destination);

  // Voices are added a window at a time (the offline render pauses for it), so
  // the graph only ever holds the notes that are about to sound.
  let cursor = 0;
  let failure: unknown = null;
  const scheduleUntil = (limit: number): void => {
    while (cursor < events.length && events[cursor].time < limit) {
      const event = events[cursor++];
      const bus = buses.get(event.track);
      if (!bus) continue;
      if (bus.params) playSynth(kit, bus.params, bus.mixer, event);
      else playDrum(kit, bus, event.time, event.velocity);
    }
  };
  if (typeof ctx.suspend !== 'function') {
    // No pausable offline rendering in this browser: build every voice up front (slower, same result).
    scheduleUntil(Infinity);
  } else {
    scheduleUntil(WINDOW_SECONDS);
    for (let start = WINDOW_SECONDS; start < slice.seconds; start += WINDOW_SECONDS) {
      const windowEnd = start + WINDOW_SECONDS;
      ctx.suspend(start - WINDOW_LEAD_SECONDS).then(
        () => {
          try {
            scheduleUntil(windowEnd);
          } catch (error) {
            failure = error;
          }
          return ctx.resume();
        },
        (error: unknown) => {
          failure = error;
        },
      );
    }
  }

  const rendered = await ctx.startRendering();
  if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
  return rendered;
}

/**
 * Render a pattern to a stereo AudioBuffer that is exactly `bars × 4` beats
 * long (rounded to the nearest sample at `sampleRate`, in Hz) and loops
 * without a click. Deterministic for a given pattern and sample rate. The
 * result peaks at or below PEAK_CEILING_DB and sits at about TARGET_RMS_DB RMS.
 * Rejects with a readable Error if the pattern is malformed.
 */
export async function renderPattern(pattern: SongPattern, options: RenderOptions): Promise<AudioBuffer> {
  const sampleRate = options.sampleRate;
  const events = expandPattern(pattern);
  const loopSeconds = patternSeconds(pattern);
  const loopLength = Math.round(loopSeconds * sampleRate);

  const delayFx = { steps: 3, feedback: 0.4, tone: 3500, spread: 0.7, level: 1, ...pattern.effects?.delay };
  const reverbFx = { seconds: 1.8, tone: 6000, predelay: 0.015, level: 1, ...pattern.effects?.reverb };
  const duckFx = { depth: 0.6, release: 0.75, ...pattern.effects?.duck };
  const feedback = Math.min(0.85, Math.max(0, delayFx.feedback));
  const delaySeconds = Math.max(0.01, delayFx.steps * stepSeconds(pattern.bpm));

  const tracks = Object.entries(pattern.tracks);
  const usesDelay = tracks.some(([, t]) => (t.delay ?? 0) > 0);
  const usesReverb = tracks.some(([, t]) => (t.reverb ?? 0) > 0);

  const delayTail = usesDelay && feedback > 0 ? delaySeconds * (Math.log(0.004) / Math.log(feedback) + 1) : usesDelay ? delaySeconds : 0;
  const reverbTail = usesReverb ? reverbFx.seconds + reverbFx.predelay : 0;
  const effectTail = delayTail + reverbTail + 0.1;

  const shared: Shared = {
    pattern,
    sampleRate,
    noise: makeNoise(sampleRate, createRandom(pattern.seed)),
    impulse: usesReverb ? makeImpulse(sampleRate, reverbFx.seconds, reverbFx.tone, createRandom((pattern.seed ^ 0x5eedfade) >>> 0)) : null,
    shaper: makeShaperCurve(),
    loopLatencyFrames: usesDelay ? await measureLoopLatency() : 0,
    delaySeconds,
    feedback,
    delayFx,
    reverbFx,
  };

  // Ducking is keyed to the kick and repeats with the loop.
  const keyTrack = duckFx.key ?? tracks.find(([, t]) => t.kind === 'kick')?.[0];
  const ducks = keyTrack !== undefined && tracks.some(([, t]) => (t.duck ?? 0) > 0);
  const duckHits = ducks ? events.filter((e) => e.track === keyTrack).map((e) => e.time) : [];
  const duckRelease = Math.max(0.03, (duckFx.release * 60) / pattern.bpm);
  const duckDepth = Math.min(1, Math.max(0, duckFx.depth));

  // Cut the loop into time slices that render in parallel (one thread per
  // OfflineAudioContext). Each slice plays the notes that start in it and runs
  // on until they and the effects have died away; everything is linear, so
  // overlap-adding the slices (wrapped around the loop) gives the full mix.
  const sliceFrames = Math.ceil(loopLength / RENDER_SLICES / 128) * 128;
  const jobs: Promise<AudioBuffer>[] = [];
  const offsets: number[] = [];
  for (let offset = 0; offset < loopLength; offset += sliceFrames) {
    const from = offset / sampleRate;
    const to = Math.min(loopSeconds, (offset + sliceFrames) / sampleRate);
    const own: SeqEvent[] = [];
    let musicEnd = to - from;
    for (const event of events) {
      if (event.time < from || event.time >= to) continue;
      const time = event.time - from;
      own.push({ ...event, time });
      musicEnd = Math.max(musicEnd, time + event.duration + releaseTail(pattern.tracks[event.track]));
    }
    const seconds = Math.min(musicEnd + effectTail, to - from + MAX_TAIL_SECONDS);
    const length = Math.ceil(seconds * sampleRate);
    let duck: Float32Array<ArrayBuffer> | null = null;
    if (ducks) {
      duck = duckEnvelope(duckHits.map((hit) => hit - from), loopSeconds, length / sampleRate, duckRelease);
      for (let i = 0; i < duck.length; i++) duck[i] *= -duckDepth;
    }
    // Setting a slice up takes a few milliseconds of main-thread time; let a frame through in between.
    if (jobs.length > 0) await breathe();
    jobs.push(renderSlice(shared, { events: own, seconds: to - from, length, duck }));
    offsets.push(offset);
  }
  const renders = await Promise.all(jobs);

  // Rumble filter, fade the very end of each tail, and overlap-add around the loop.
  const mixStart = performance.now();
  const channels: Float32Array[] = [new Float32Array(loopLength), new Float32Array(loopLength)];
  for (let r = 0; r < renders.length; r++) {
    for (let channel = 0; channel < 2; channel++) {
      const data = renders[r].getChannelData(channel);
      highpass(data, RUMBLE_HZ, sampleRate);
      const fade = Math.min(2048, data.length);
      for (let i = 0; i < fade; i++) data[data.length - 1 - i] *= i / fade;
      addWrapped(channels[channel], data, offsets[r]);
      await breathe();
    }
  }
  const mastered = await masterLoopAsync(
    channels,
    { targetRmsDb: TARGET_RMS_DB, ceilingDb: PEAK_CEILING_DB, windowSamples: Math.round(sampleRate * 0.006) },
    breathe,
  );
  options.report?.({ ...mastered, slices: renders.length, voices: events.length, mixMs: performance.now() - mixStart });

  const buffer = new AudioBuffer({ length: loopLength, numberOfChannels: 2, sampleRate });
  for (let channel = 0; channel < 2; channel++) buffer.getChannelData(channel).set(channels[channel]);
  return buffer;
}
