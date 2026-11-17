/**
 * Pure sample-level helpers used after the offline render: folding effect
 * tails back onto the loop, loudness normalisation and a look-ahead limiter
 * that works around the loop seam. Plain Float32Arrays, testable in Node.
 */

/** Convert a linear amplitude to decibels (-Infinity for 0). */
export function toDb(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
}

/** Convert decibels to a linear amplitude. */
export function fromDb(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Add `source` into the looping buffer `loop`, starting at sample `offset` and
 * wrapping around the end as often as needed. With offset 0 this folds a
 * render that is longer than the loop back onto the loop: each loop sample
 * becomes the sum of source samples i, i + loop.length, i + 2·loop.length… —
 * exactly what a listener hears once the loop has gone round, so reverb and
 * delay tails carry across the seam without a click.
 */
export function addWrapped(loop: Float32Array, source: Float32Array, offset = 0): void {
  const length = loop.length;
  if (length === 0) return;
  let at = ((offset % length) + length) % length;
  for (let i = 0; i < source.length; i++) {
    loop[at] += source[i];
    if (++at === length) at = 0;
  }
}

/** A new buffer of `loopLength` samples holding `source` folded onto itself (see addWrapped). */
export function foldLoop(source: Float32Array, loopLength: number): Float32Array {
  const out = new Float32Array(loopLength);
  addWrapped(out, source, 0);
  return out;
}

/** Largest absolute sample value across the channels. */
export function peakOf(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/** Root-mean-square level over all samples of all channels. */
export function rmsOf(channels: readonly Float32Array[]): number {
  let sum = 0;
  let count = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    count += data.length;
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

/** Multiply every sample by `gain`, in place. */
export function applyGain(channels: readonly Float32Array[], gain: number): void {
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) data[i] *= gain;
  }
}

/** The limiter's passes over the audio, yielding between them so a caller can pause there. */
function* limitSteps(channels: readonly Float32Array[], ceiling: number, windowSamples: number): Generator<void, void, void> {
  const length = channels[0]?.length ?? 0;
  if (length === 0) return;
  const half = Math.max(1, Math.min(Math.floor(windowSamples / 2), Math.floor((length - 1) / 2)));
  const width = half * 2 + 1;

  // Gain needed at each sample, laid out with `half` wrapped samples either side:
  // need[j] belongs to sample (j − half) mod length.
  const need = new Float32Array(length + 2 * half);
  let any = false;
  for (let i = 0; i < length; i++) {
    let peak = 0;
    for (const data of channels) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
    if (peak > ceiling) {
      need[i + half] = ceiling / peak;
      any = true;
    } else {
      need[i + half] = 1;
    }
  }
  if (!any) return;
  need.copyWithin(0, length, length + half);
  need.copyWithin(length + half, half, 2 * half);
  yield;

  // Sliding minimum over [i − half, i + half] (monotonic queue), again with wrapped margins.
  const minimum = new Float32Array(length + 2 * half);
  const queue = new Int32Array(length + 2 * half);
  let head = 0;
  let tail = 0;
  for (let j = 0; j < length + 2 * half; j++) {
    const value = need[j];
    while (tail > head && need[queue[tail - 1]] >= value) tail--;
    queue[tail++] = j;
    const first = j - width + 1; // window is need[first … j], centred on sample first
    if (first < 0) continue;
    while (queue[head] < first) head++;
    minimum[first + half] = need[queue[head]];
  }
  minimum.copyWithin(0, length, length + half);
  minimum.copyWithin(length + half, half, 2 * half);
  yield;

  // Moving average of the minimum over the same window: smooth, and never above `need`.
  const prefix = new Float64Array(length + 2 * half + 1);
  for (let j = 0; j < length + 2 * half; j++) prefix[j + 1] = prefix[j] + minimum[j];
  yield;
  for (const data of channels) {
    for (let i = 0; i < length; i++) {
      let v = data[i] * ((prefix[i + width] - prefix[i]) / width);
      // Guard against the last ulp of rounding in the average.
      if (v > ceiling) v = ceiling;
      else if (v < -ceiling) v = -ceiling;
      data[i] = v;
    }
  }
}

/**
 * Look-ahead peak limiter for a looping buffer, in place. The gain reduction
 * is linked across channels, lasts `windowSamples` either side of each peak
 * and is computed circularly, so the result still loops seamlessly. No output
 * sample exceeds `ceiling`.
 */
export function limitLoop(channels: readonly Float32Array[], ceiling: number, windowSamples: number): void {
  const steps = limitSteps(channels, ceiling, windowSamples);
  while (!steps.next().done);
}

export interface MasterOptions {
  /** Target RMS level in dBFS. */
  targetRmsDb: number;
  /** Highest allowed sample peak in dBFS. */
  ceilingDb: number;
  /** Limiter window in samples (about 6 ms of audio). */
  windowSamples: number;
}

export interface MasterResult {
  /** Sample peak and RMS of the result, dBFS. */
  peakDb: number;
  rmsDb: number;
  /** How far the loudest peak had to be pulled down, dB (0 = the limiter did nothing). */
  limitedDb: number;
}

/** The mastering steps, yielding between the passes over the audio so a caller can pause there. */
function* masterSteps(channels: readonly Float32Array[], options: MasterOptions): Generator<void, MasterResult, void> {
  const target = fromDb(options.targetRmsDb);
  const ceiling = fromDb(options.ceilingDb);
  let limitedDb = 0;
  for (let pass = 0; pass < 3; pass++) {
    const rms = rmsOf(channels);
    if (rms <= 1e-9) break;
    const gain = target / rms;
    if (pass > 0 && Math.abs(toDb(gain)) < 0.1) break;
    yield;
    applyGain(channels, gain);
    limitedDb += Math.max(0, toDb(peakOf(channels)) - options.ceilingDb);
    yield;
    yield* limitSteps(channels, ceiling, options.windowSamples);
    yield;
  }
  return { peakDb: toDb(peakOf(channels)), rmsDb: toDb(rmsOf(channels)), limitedDb };
}

/**
 * Bring a loop to a common loudness, in place: scale to the target RMS,
 * limit the peaks, and repeat once or twice because limiting lowers the RMS a
 * little. Returns the measured result.
 */
export function masterLoop(channels: readonly Float32Array[], options: MasterOptions): MasterResult {
  const steps = masterSteps(channels, options);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/**
 * masterLoop for the main thread: the same result, but `pause` is awaited
 * between the passes over the audio so the page can draw a frame in between.
 */
export async function masterLoopAsync(
  channels: readonly Float32Array[],
  options: MasterOptions,
  pause: () => Promise<void>,
): Promise<MasterResult> {
  const steps = masterSteps(channels, options);
  let step = steps.next();
  while (!step.done) {
    await pause();
    step = steps.next();
  }
  return step.value;
}

/**
 * How abrupt the loop seam is: the sample step from the last sample to the
 * first, divided by the 99.9th-percentile step inside the buffer. Values
 * around or below 1 mean the seam is no rougher than the music itself.
 */
export function seamRatio(channels: readonly Float32Array[]): number {
  let worst = 0;
  for (const data of channels) {
    const length = data.length;
    if (length < 4) continue;
    const seam = Math.abs(data[0] - data[length - 1]);
    // Histogram of step sizes to find a high percentile without sorting millions of values.
    let max = 0;
    for (let i = 1; i < length; i++) {
      const d = Math.abs(data[i] - data[i - 1]);
      if (d > max) max = d;
    }
    if (max === 0) continue;
    const bins = new Uint32Array(2048);
    for (let i = 1; i < length; i++) {
      bins[Math.min(2047, Math.floor((Math.abs(data[i] - data[i - 1]) / max) * 2048))]++;
    }
    let remaining = Math.ceil((length - 1) * 0.001);
    let bin = 2047;
    while (bin > 0 && remaining > bins[bin]) remaining -= bins[bin--];
    const typical = ((bin + 1) / 2048) * max;
    worst = Math.max(worst, seam / typical);
  }
  return worst;
}
