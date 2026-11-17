import { describe, expect, it } from 'vitest';
import { BeatClock, MAX_DELTA, PositionSmoother, loopedBeats } from '../../../src/audio/clock';
import { DEFAULT_BPM } from '../../../src/config';

/** Tick at 60 fps from wall time `from` for `seconds`; `audio` maps wall time to the audio position. */
function run(clock: BeatClock, from: number, seconds: number, audio?: (wall: number) => number): number {
  const frames = Math.round(seconds * 60);
  let wall = from;
  for (let i = 1; i <= frames; i++) {
    wall = from + i / 60;
    clock.tick(wall, audio ? { seconds: audio(wall) } : null);
  }
  return wall;
}

describe('BeatClock without a song', () => {
  it('starts at zero and reports no delta on the first tick', () => {
    const clock = new BeatClock();
    const snapshot = clock.tick(1234.5);
    expect(snapshot).toEqual({ time: 0, delta: 0, beat: 0, bpm: DEFAULT_BPM });
  });

  it('advances time and the beat at the default tempo', () => {
    const clock = new BeatClock();
    clock.tick(10);
    run(clock, 10, 2);
    expect(clock.snapshot.time).toBeCloseTo(2, 6);
    expect(clock.snapshot.beat).toBeCloseTo((2 * DEFAULT_BPM) / 60, 6);
    expect(clock.snapshot.delta).toBeCloseTo(1 / 60, 6);
    expect(clock.snapshot.bpm).toBe(DEFAULT_BPM);
  });

  it('clamps delta, so a background-tab gap moves time and beat by at most MAX_DELTA', () => {
    const clock = new BeatClock();
    clock.tick(0);
    clock.tick(0.016);
    const before = { ...clock.snapshot };
    const snapshot = clock.tick(30.016);
    expect(snapshot.delta).toBe(MAX_DELTA);
    expect(snapshot.time).toBeCloseTo(before.time + MAX_DELTA, 9);
    expect(snapshot.beat).toBeCloseTo(before.beat + (MAX_DELTA * DEFAULT_BPM) / 60, 9);
  });

  it('never runs backwards when wall time does', () => {
    const clock = new BeatClock();
    clock.tick(5);
    clock.tick(5.5);
    const before = { ...clock.snapshot };
    const snapshot = clock.tick(4);
    expect(snapshot.delta).toBe(0);
    expect(snapshot.time).toBe(before.time);
    expect(snapshot.beat).toBe(before.beat);
  });

  it('returns the same snapshot object every tick', () => {
    const clock = new BeatClock();
    expect(clock.tick(0)).toBe(clock.tick(0.016));
    expect(clock.tick(0.032)).toBe(clock.snapshot);
  });
});

describe('BeatClock following a song', () => {
  it('re-anchors to the nearest whole beat when a song starts and adopts its tempo', () => {
    const clock = new BeatClock();
    clock.tick(0);
    const wall = run(clock, 0, 1.15); // beat 2.3 at 120 bpm
    expect(clock.snapshot.beat).toBeCloseTo(2.3, 6);
    clock.startSong({ bpm: 90, loopSeconds: 32 });
    expect(clock.snapshot.bpm).toBe(90);
    // Anchor 2: the music is behind the clock, so the beat waits instead of going back…
    clock.tick(wall + 0.1, { seconds: 0.1 });
    expect(clock.snapshot.beat).toBeCloseTo(2.3, 6);
    // …and follows the audio as soon as it has caught up: 2 + 1.0 s × 90 / 60.
    clock.tick(wall + 1, { seconds: 1 });
    expect(clock.snapshot.beat).toBeCloseTo(3.5, 9);
  });

  it('rounds up when the nearest whole beat is ahead', () => {
    const clock = new BeatClock();
    clock.tick(0);
    const wall = run(clock, 0, 1.35); // beat 2.7
    clock.startSong({ bpm: 120 });
    clock.tick(wall + 0.016, { seconds: 0 });
    expect(clock.snapshot.beat).toBe(3);
    clock.tick(wall + 0.5, { seconds: 0.5 });
    expect(clock.snapshot.beat).toBeCloseTo(4, 9);
  });

  it('follows the audio position exactly, whatever the frame timing', () => {
    const clock = new BeatClock();
    clock.tick(0);
    clock.startSong({ bpm: 128, loopSeconds: 30 });
    clock.tick(0.5, { seconds: 0.25 });
    expect(clock.snapshot.beat).toBeCloseTo((0.25 * 128) / 60, 9);
    clock.tick(0.51, { seconds: 2 });
    expect(clock.snapshot.beat).toBeCloseTo((2 * 128) / 60, 9);
  });

  it('corrects for output latency', () => {
    const clock = new BeatClock();
    clock.tick(0);
    clock.startSong({ bpm: 120 });
    clock.tick(1, { seconds: 1, latency: 0.05 });
    expect(clock.snapshot.beat).toBeCloseTo(0.95 * 2, 9);
    // Before the first sample is heard the beat rests on the anchor.
    const fresh = new BeatClock();
    fresh.tick(0);
    fresh.startSong({ bpm: 120 });
    fresh.tick(0.01, { seconds: 0.01, latency: 0.05 });
    expect(fresh.snapshot.beat).toBe(0);
  });

  it('stays in sync after a background-tab jump while delta stays clamped', () => {
    const clock = new BeatClock();
    clock.tick(0);
    clock.startSong({ bpm: 100, loopSeconds: 38.4 });
    run(clock, 0, 1, (wall) => wall);
    const before = clock.snapshot.time;
    const snapshot = clock.tick(61, { seconds: 61 });
    expect(snapshot.delta).toBe(MAX_DELTA);
    expect(snapshot.time).toBeCloseTo(before + MAX_DELTA, 9);
    expect(snapshot.beat).toBeCloseTo((61 * 100) / 60, 6);
  });

  it('keeps counting through loops of a whole number of beats, absorbing sample rounding', () => {
    // 64 beats at 104 bpm, rounded to whole samples at 48 kHz.
    const loopSeconds = Math.round(((64 * 60) / 104) * 48000) / 48000;
    expect(loopedBeats(loopSeconds * 3, 104, loopSeconds)).toBeCloseTo(192, 9);
    expect(loopedBeats(loopSeconds * 1000 + 1, 104, loopSeconds)).toBeCloseTo(64000 + 104 / 60, 6);
  });

  it('re-anchors to the nearest whole beat each time a song of odd length loops', () => {
    const bpm = 120;
    const loopSeconds = 5.2; // 10.4 beats: the next pass starts on beat 10
    expect(loopedBeats(5.1, bpm, loopSeconds)).toBeCloseTo(10.2, 9);
    expect(loopedBeats(5.2 + 0.25, bpm, loopSeconds)).toBeCloseTo(10.5, 9);
    expect(loopedBeats(10.4 + 0.25, bpm, loopSeconds)).toBeCloseTo(20.5, 9);

    const clock = new BeatClock();
    clock.tick(0);
    clock.startSong({ bpm, loopSeconds });
    let previous = 0;
    let held = 0;
    for (let i = 1; i <= 60 * 12; i++) {
      const wall = i / 60;
      const beat = clock.tick(wall, { seconds: wall }).beat;
      expect(beat).toBeGreaterThanOrEqual(previous);
      if (beat === previous) held++;
      previous = beat;
    }
    // After two loops (10.4 s) plus 1.6 s the music is at beat 20 + 3.2.
    expect(previous).toBeCloseTo(23.2, 6);
    // The beat waited about 0.4 beats (0.2 s, 12 frames) at each of the two seams.
    expect(held).toBeGreaterThan(18);
    expect(held).toBeLessThan(30);

    // 10.6 beats rounds up: the beat jumps forward by 0.4 at the seam instead.
    expect(loopedBeats(5.3 + 0.25, bpm, 5.3)).toBeCloseTo(11.5, 9);
  });

  it('free-runs at the song tempo after the song stops, without a jump', () => {
    const clock = new BeatClock();
    clock.tick(0);
    clock.startSong({ bpm: 90 });
    const wall = run(clock, 0, 2, (w) => w);
    const beat = clock.snapshot.beat;
    clock.stopSong();
    expect(clock.following).toBe(false);
    run(clock, wall, 1);
    expect(clock.snapshot.bpm).toBe(90);
    expect(clock.snapshot.beat).toBeCloseTo(beat + 1.5, 6);
  });

  it('never decreases when switching to a song, and lines up on a whole beat', () => {
    const clock = new BeatClock();
    clock.tick(0);
    clock.startSong({ bpm: 104, loopSeconds: 36.9 });
    let wall = run(clock, 0, 3.3, (w) => w);
    let previous = clock.snapshot.beat;
    const switchedAt = wall;
    clock.startSong({ bpm: 138, loopSeconds: 27.8 });
    const anchor = Math.round(previous);
    for (let i = 1; i <= 120; i++) {
      wall = switchedAt + i / 60;
      const beat = clock.tick(wall, { seconds: wall - switchedAt }).beat;
      expect(beat).toBeGreaterThanOrEqual(previous);
      previous = beat;
    }
    expect(previous).toBeCloseTo(anchor + (2 * 138) / 60, 6);
  });

  it('free-runs while the audio is stalled and re-aligns the downbeat when it returns', () => {
    const clock = new BeatClock();
    clock.tick(0);
    clock.startSong({ bpm: 120, loopSeconds: 32 });
    let wall = run(clock, 0, 1, (w) => w); // beat 2
    wall = run(clock, wall, 0.8); // stalled: free-runs to beat 3.6
    expect(clock.snapshot.beat).toBeCloseTo(3.6, 6);
    // Audio returns at position 1.0 s (music beat 2): the anchor moves by a whole number of beats.
    clock.tick(wall + 0.016, { seconds: 1 });
    clock.tick(wall + 1.016, { seconds: 2 });
    const beat = clock.snapshot.beat;
    expect(beat - Math.floor(beat)).toBeCloseTo(0, 6); // music beat 4 lands on a whole beat
    expect(beat).toBeGreaterThanOrEqual(3.6);
  });

  it('setBpm changes the free-running tempo and keeps a playing song on the beat grid', () => {
    const clock = new BeatClock();
    clock.tick(0);
    clock.setBpm(60);
    run(clock, 0, 2);
    expect(clock.snapshot.beat).toBeCloseTo(2, 6);
    clock.startSong({ bpm: 60 });
    clock.tick(3, { seconds: 1 });
    clock.setBpm(120);
    clock.tick(3.5, { seconds: 1.5 }); // music beat 3 at the new tempo
    const beat = clock.snapshot.beat;
    expect(clock.snapshot.bpm).toBe(120);
    expect(beat - Math.floor(beat)).toBeCloseTo(0, 6);
  });
});

describe('PositionSmoother', () => {
  it('turns a blocky audio clock into a smooth one that tracks it', () => {
    const smoother = new PositionSmoother();
    let previous = -1;
    let worstStep = 0;
    let last = 0;
    for (let i = 0; i < 600; i++) {
      const wall = i / 60 + (i % 3) * 0.001;
      const blocky = Math.floor((wall * 48000) / 1024) * (1024 / 48000); // 21 ms blocks
      last = smoother.update(wall, blocky);
      if (previous >= 0) {
        expect(last).toBeGreaterThanOrEqual(previous);
        if (i > 60) worstStep = Math.max(worstStep, Math.abs(last - previous - 1 / 60));
      }
      previous = last;
    }
    expect(Math.abs(last - 599 / 60)).toBeLessThan(0.03);
    expect(worstStep).toBeLessThan(0.004); // the raw clock steps by up to 21 ms
  });

  it('snaps after a long gap and holds (never rewinds) when the audio clock stalls', () => {
    const smoother = new PositionSmoother();
    smoother.update(0, 0);
    smoother.update(0.016, 0.016);
    expect(smoother.update(60, 60)).toBe(60);
    const held = smoother.update(60.5, 60); // audio stalled
    expect(held).toBeGreaterThanOrEqual(60);
    expect(smoother.update(61, 60)).toBe(held);
    smoother.reset();
    expect(smoother.update(62, 5)).toBe(5);
  });
});
