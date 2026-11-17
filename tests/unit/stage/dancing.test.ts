import { describe, expect, it } from 'vitest';
import { advanceLoopAngle, azimuthOf, blendPose, createOrbitPose, ease, loopPose } from '../../../src/stage/cameraPath';
import {
  MIN_PROXY_RADIUS,
  PROXY_HEIGHT_PADDING,
  PROXY_RADIUS_PADDING,
  clampTarget,
  clampToStage,
  dragPlaneHeight,
  maxPolarAngle,
  pickNearest,
  rayCylinder,
  rayPlaneY,
  sizeProxy,
} from '../../../src/stage/picking';
import type { PickProxy } from '../../../src/stage/picking';
import { pickExpressiveFrame, scoreFrames } from '../../../src/stage/poseScore';
import { FREE_RUN_BPM, advanceTravel, clipTimeAt, fract, hashUnit, initialTravel, loopPhase, resolveTempo } from '../../../src/stage/timing';
import type { ClockLike, DanceTempo, LoopSettings } from '../../../src/stage/timing';

const tempo = (): DanceTempo => ({ beatDriven: false, nativeBpm: 0, loopBeats: 0, duration: 0 });
const settings = (patch: Partial<LoopSettings> = {}): LoopSettings => ({ speed: 1, offset: 0, trimStart: 0, trimEnd: 1, ...patch });
/** A clock at `time` seconds playing at `bpm`, one 60 Hz frame after the previous one. */
const clockAt = (time: number, bpm = 120, delta = 1 / 60): ClockLike => ({ time, delta, beat: (time * bpm) / 60 });

/** Run a dancer from `start` for `frames` frames, the way the dancer system does. */
function run(t: DanceTempo, s: LoopSettings, start: number, frames: number, bpm = 120): number {
  const dt = 1 / 60;
  let clock = clockAt(start, bpm, dt);
  let travel = initialTravel(t, clock, s.speed);
  for (let i = 1; i <= frames; i++) {
    const next = clockAt(start + i * dt, bpm, dt);
    travel = advanceTravel(travel, t, next, next.beat - clock.beat, s.speed);
    clock = next;
  }
  return travel;
}

describe('dance timing', () => {
  it('resolves beat-driven and free-running tempos', () => {
    const grid = { duration: 4, bpm: 100, beats: 8 };
    expect(resolveTempo(grid, true, tempo())).toEqual({ beatDriven: true, nativeBpm: 100, loopBeats: 8, duration: 4 });
    expect(resolveTempo(grid, false, tempo()).beatDriven).toBe(false);
    // No bpm: free-runs at 120 and the loop length follows from the duration.
    const loose = resolveTempo({ duration: 3, bpm: null, beats: null }, true, tempo());
    expect(loose).toEqual({ beatDriven: false, nativeBpm: FREE_RUN_BPM, loopBeats: 6, duration: 3 });
    // A bpm without a beat count is not enough for beat sync.
    const half = resolveTempo({ duration: 3, bpm: 90, beats: null }, true, tempo());
    expect(half.beatDriven).toBe(false);
    expect(half.loopBeats).toBeCloseTo(4.5, 12);
  });

  it('fract stays in [0, 1) for negative numbers', () => {
    expect(fract(2.25)).toBeCloseTo(0.25, 12);
    expect(fract(-0.25)).toBeCloseTo(0.75, 12);
    expect(fract(-1e-20)).toBeLessThan(1);
    expect(fract(3)).toBe(0);
  });

  it('keeps dancers with the same dance and speed in unison, whenever they joined', () => {
    const t = resolveTempo({ duration: 4, bpm: 120, beats: 8 }, true, tempo());
    const s = settings({ speed: 1.5 });
    const early = run(t, s, 1, 600);
    const late = run(t, s, 7.5, 210);
    expect(late).toBeCloseTo(early, 9);
    expect(clipTimeAt(late, t, s)).toBeCloseTo(clipTimeAt(early, t, s), 8);
  });

  it('beat-driven dances follow the song tempo; free-running ones ignore it', () => {
    const dance = { duration: 4, bpm: 120, beats: 8 };
    const driven = resolveTempo(dance, true, tempo());
    const free = resolveTempo(dance, false, tempo());
    const s = settings();
    // The song plays at 60 bpm: half the dance's own tempo.
    const drivenTravel = run(driven, s, 0, 120, 60);
    const freeTravel = run(free, s, 0, 120, 60);
    expect(drivenTravel).toBeCloseTo(2, 9);
    expect(freeTravel).toBeCloseTo(4, 9);
    expect(clipTimeAt(drivenTravel, driven, s)).toBeCloseTo(1, 9);
    expect(clipTimeAt(freeTravel, free, s)).toBeCloseTo(2, 9);
    // Free-running dancers are in unison too.
    expect(run(free, s, 3, 60, 60)).toBeCloseTo(initialTravel(free, clockAt(4, 60), 1), 9);
  });

  it('maps the loop into the trimmed part of the clip', () => {
    const t = resolveTempo({ duration: 4, bpm: 120, beats: 8 }, true, tempo());
    const s = settings({ trimStart: 0.25, trimEnd: 0.75 });
    for (let travel = 0; travel < 30; travel += 0.37) {
      const time = clipTimeAt(travel, t, s);
      expect(time).toBeGreaterThanOrEqual(1);
      expect(time).toBeLessThan(3);
    }
    // The trimmed loop is span × loopBeats long and plays at the normal rate.
    expect(clipTimeAt(0, t, s)).toBeCloseTo(1, 12);
    expect(clipTimeAt(2, t, s)).toBeCloseTo(2, 12);
    expect(clipTimeAt(4, t, s)).toBeCloseTo(1, 12);
    // Offset shifts the phase within the trimmed loop.
    expect(loopPhase(0, t, settings({ offset: 0.25 }))).toBeCloseTo(0.25, 12);
    expect(clipTimeAt(0, t, { ...s, offset: 0.5 })).toBeCloseTo(2, 12);
    // A degenerate trim does not divide by zero.
    expect(Number.isFinite(clipTimeAt(3, t, settings({ trimStart: 0.5, trimEnd: 0.5 })))).toBe(true);
  });

  it('speed 0 freezes the pose and speed changes do not jump', () => {
    const t = resolveTempo({ duration: 4, bpm: 120, beats: 8 }, true, tempo());
    const a = clockAt(5);
    const b = clockAt(5 + 1 / 60);
    const travel = 3.3;
    expect(advanceTravel(travel, t, b, b.beat - a.beat, 0)).toBe(travel);
    // One frame at double speed moves the counter by two frames' worth: no discontinuity.
    const step = advanceTravel(travel, t, b, b.beat - a.beat, 2) - travel;
    expect(step).toBeCloseTo((2 * 2) / 60, 9);
  });

  it('resync puts a dancer back on the grid after a speed change', () => {
    const t = resolveTempo({ duration: 4, bpm: 120, beats: 8 }, true, tempo());
    const steady = run(t, settings({ speed: 2 }), 0, 300);
    // A dancer that spent a while at speed 1 before switching to 2 is out of step…
    let clock = clockAt(0);
    let travel = initialTravel(t, clock, 1);
    for (let i = 1; i <= 300; i++) {
      const next = clockAt(i / 60);
      travel = advanceTravel(travel, t, next, next.beat - clock.beat, i <= 150 ? 1 : 2);
      clock = next;
    }
    expect(Math.abs(travel - steady)).toBeGreaterThan(1);
    // …until it is re-initialised from the clock.
    expect(initialTravel(t, clock, 2)).toBeCloseTo(steady, 9);
  });

  it('hashUnit is stable, in range and differs between dancers and salts', () => {
    const values = ['d1', 'd2', 'd3', 'd4'].map((id) => hashUnit(id));
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(new Set(values).size).toBe(4);
    expect(hashUnit('d1')).toBe(values[0]);
    expect(hashUnit('d1', 1)).not.toBe(values[0]);
  });
});

describe('picking', () => {
  const proxy = (): PickProxy => ({ x: 0, z: 0, y0: 0, y1: 0, radius: 0 });

  it('sizes proxies from height, radius and scale', () => {
    const p = sizeProxy(proxy(), 1, 0.5, -2, 1.75, 0.4, 2);
    expect(p.x).toBe(1);
    expect(p.z).toBe(-2);
    expect(p.y0).toBe(0.5);
    expect(p.y1).toBeCloseTo(0.5 + 1.75 * 2 * (1 + PROXY_HEIGHT_PADDING), 12);
    expect(p.radius).toBeCloseTo(0.4 * PROXY_RADIUS_PADDING * 2, 12);
    // Thin characters keep a comfortable minimum; a mirrored (negative) scale is treated by size.
    expect(sizeProxy(proxy(), 0, 0, 0, 1.75, 0.05, 1).radius).toBe(MIN_PROXY_RADIUS);
    expect(sizeProxy(proxy(), 0, 0, 0, 1.75, 0.05, -0.5).radius).toBe(MIN_PROXY_RADIUS * 0.5);
  });

  it('intersects rays with the proxy cylinder (side, caps, misses)', () => {
    const p = sizeProxy(proxy(), 0, 0, 0, 2, 0.5, 1);
    // From the front, level: hits the side wall.
    expect(rayCylinder(0, 1, 5, 0, 0, -1, p)).toBeCloseTo(5 - p.radius, 9);
    // Straight down from above: hits the top cap.
    expect(rayCylinder(0.1, 6, 0, 0, -1, 0, p)).toBeCloseTo(6 - p.y1, 9);
    // Beside it, above it, and pointing away.
    expect(rayCylinder(1, 1, 5, 0, 0, -1, p)).toBe(-1);
    expect(rayCylinder(0, 3, 5, 0, 0, -1, p)).toBe(-1);
    expect(rayCylinder(0, 1, 5, 0, 0, 1, p)).toBe(-1);
  });

  it('picks the nearest dancer and respects the count', () => {
    const near = sizeProxy(proxy(), 0, 0, 2, 1.75, 0.3, 1);
    const far = sizeProxy(proxy(), 0, 0, -2, 1.75, 0.3, 1);
    expect(pickNearest(0, 1, 8, 0, 0, -1, [far, near])).toBe(1);
    expect(pickNearest(0, 1, 8, 0, 0, -1, [far, near], 1)).toBe(0);
    expect(pickNearest(3, 1, 8, 0, 0, -1, [far, near])).toBe(-1);
    expect(pickNearest(0, 1, 8, 0, 0, -1, [], 0)).toBe(-1);
  });

  it('clamps drags to the stage', () => {
    const out = { x: 0, z: 0 };
    expect(clampToStage(1, -2, 6, out)).toEqual({ x: 1, z: -2 });
    clampToStage(30, 40, 6, out);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(6, 12);
    expect(out.x / out.z).toBeCloseTo(0.75, 12);
    expect(clampToStage(0, 0, 6, out)).toEqual({ x: 0, z: 0 });
  });

  it('chooses a usable drag plane and intersects it', () => {
    // Well above the grabbed point: drag on the plane through it.
    expect(dragPlaneHeight(3, 1, 0)).toBe(1);
    // Camera level with the grabbed point: the floor under the dancer is the better plane.
    expect(dragPlaneHeight(1.1, 1, 0)).toBe(0);
    expect(rayPlaneY(2, -0.5, 0)).toBeCloseTo(4, 12);
    expect(rayPlaneY(2, 0.5, 0)).toBe(-1);
    expect(rayPlaneY(2, 0, 0)).toBe(-1);
    expect(rayPlaneY(2, -0.001, 0)).toBe(-1);
  });

  it('keeps the camera above the floor and the target near the stage', () => {
    // Target 1 m up, 5 m away, at least 0.08 m above the floor.
    const polar = maxPolarAngle(1, 5, 0.08);
    expect(1 + 5 * Math.cos(polar)).toBeCloseTo(0.08, 9);
    expect(maxPolarAngle(1, 0.5, 0.08)).toBeCloseTo(Math.PI, 9);
    expect(maxPolarAngle(1, 0, 0.08)).toBeCloseTo(Math.PI / 2, 9);

    const target = { x: 9, y: 4, z: 12 };
    expect(clampTarget(target, 6, 0, 3)).toBe(true);
    expect(Math.hypot(target.x, target.z)).toBeCloseTo(6, 12);
    expect(target.y).toBe(3);
    expect(clampTarget(target, 6.001, 0, 3)).toBe(false);
    const low = { x: 0, y: -1, z: 0 };
    expect(clampTarget(low, 6, 0, 3)).toBe(true);
    expect(low.y).toBe(0);
  });
});

describe('camera loop path', () => {
  const scene = { cameraLoopDistance: 9, cameraLoopHeight: 3, cameraLoopTargetHeight: 1.2, cameraLoopPeriod: 20 };

  it('circles the stage centre at the set distance and height', () => {
    const pose = createOrbitPose();
    for (let i = 0; i < 16; i++) {
      loopPose(scene, (i / 16) * Math.PI * 2, pose);
      expect(Math.hypot(pose.px, pose.pz)).toBeCloseTo(9, 12);
      expect(pose.py).toBe(3);
      expect([pose.tx, pose.ty, pose.tz]).toEqual([0, 1.2, 0]);
    }
    loopPose(scene, 0, pose);
    expect(pose.pz).toBeCloseTo(9, 12);
    expect(azimuthOf(pose.px, pose.pz)).toBeCloseTo(0, 12);
    loopPose(scene, Math.PI / 2, pose);
    expect(pose.px).toBeCloseTo(9, 12);
  });

  it('does one lap per period, whatever the frame rate', () => {
    let angle = 0;
    for (let i = 0; i < 300; i++) angle = advanceLoopAngle(angle, 1 / 60, 20);
    expect(angle).toBeCloseTo(Math.PI / 2, 9);
    let coarse = 0;
    for (let i = 0; i < 50; i++) coarse = advanceLoopAngle(coarse, 0.1, 20);
    expect(coarse).toBeCloseTo(angle, 9);
    // The angle wraps instead of growing forever.
    let wrapped = 0;
    for (let i = 0; i < 1500; i++) wrapped = advanceLoopAngle(wrapped, 1 / 60, 20);
    expect(wrapped).toBeLessThanOrEqual(Math.PI * 2 + 1e-9);
    expect(wrapped).toBeCloseTo(Math.PI / 2, 6);
    expect(Number.isFinite(advanceLoopAngle(0, 0.016, 0))).toBe(true);
  });

  it('eases with zero slope at both ends', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5, 12);
    expect(ease(-3)).toBe(0);
    expect(ease(7)).toBe(1);
    expect(ease(0.01)).toBeLessThan(0.001);
    expect(1 - ease(0.99)).toBeLessThan(0.001);
  });

  it('blends around the stage instead of cutting through its centre', () => {
    const from = { px: 0, py: 2, pz: 8, tx: 1, ty: 1, tz: 0 };
    const to = loopPose(scene, Math.PI, createOrbitPose());
    const out = createOrbitPose();
    expect(blendPose(from, to, 0, out)).toMatchObject({ px: 0, py: 2, pz: 8, tx: 1, ty: 1, tz: 0 });
    blendPose(from, to, 1, out);
    expect(out.px).toBeCloseTo(to.px, 9);
    expect(out.pz).toBeCloseTo(to.pz, 9);
    expect(out.ty).toBeCloseTo(1.2, 12);
    // Half way to the opposite side the camera is beside the stage, not in the middle of it.
    blendPose(from, to, 0.5, out);
    expect(Math.hypot(out.px, out.pz)).toBeCloseTo(8.5, 9);
    expect(out.py).toBeCloseTo(2.5, 12);
    // The shortest way round: from just left of the back to just right of it crosses the back.
    const a = loopPose(scene, Math.PI - 0.2, createOrbitPose());
    const b = loopPose(scene, -Math.PI + 0.2, createOrbitPose());
    blendPose(a, b, 0.5, out);
    expect(out.pz).toBeCloseTo(-9, 9);
    // A camera straight above the centre has no azimuth of its own.
    blendPose({ px: 0, py: 10, pz: 0, tx: 0, ty: 0, tz: 0 }, to, 0.5, out);
    expect(Number.isFinite(out.px + out.pz)).toBe(true);
  });
});

describe('expressive frame choice', () => {
  it('prefers the pose that stands out, facing the viewer', () => {
    // Two points (hands), four frames: three at rest, one with the arms flung wide and high.
    const rest = [-0.2, 1, 0, 0.2, 1, 0];
    const wide = [-0.9, 1.9, 0, 0.9, 1.9, 0];
    const positions = [...rest, ...rest, ...wide, ...rest];
    expect(pickExpressiveFrame(positions, 4, 2, { height: 1.75 })).toBe(2);
    const scores = scoreFrames(positions, 4, 2, { height: 1.75 });
    expect(scores[0]).toBeCloseTo(scores[1]!, 12);
    expect(scores[2]).toBeGreaterThan(scores[0]! * 2);
    // The same pose seen from behind loses against a slightly smaller one seen from the front.
    const two = [...wide, ...wide.map((v) => v * 0.9)];
    expect(pickExpressiveFrame(two, 2, 2, { height: 1.75, facing: [-1, 1] })).toBe(1);
    expect(pickExpressiveFrame([], 0, 0, { height: 1.75 })).toBe(0);
  });
});
