/**
 * Camera-loop maths (pure): the circular path around the stage centre and the
 * blend between the free camera and the loop.
 */

/** A camera pose as plain numbers (no three.js types, so this stays testable in Node). */
export interface OrbitPose {
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
}

export interface LoopSettingsLike {
  cameraLoopDistance: number;
  cameraLoopHeight: number;
  cameraLoopTargetHeight: number;
  cameraLoopPeriod: number;
}

/** Seconds to ease between the free camera and the loop. */
export const LOOP_EASE_SECONDS = 1.1;

export function createOrbitPose(): OrbitPose {
  return { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 };
}

/** The loop pose at `angle` radians (0 is on +Z, the default camera side; positive turns toward +X). */
export function loopPose(settings: LoopSettingsLike, angle: number, out: OrbitPose): OrbitPose {
  out.px = Math.sin(angle) * settings.cameraLoopDistance;
  out.py = settings.cameraLoopHeight;
  out.pz = Math.cos(angle) * settings.cameraLoopDistance;
  out.tx = 0;
  out.ty = settings.cameraLoopTargetHeight;
  out.tz = 0;
  return out;
}

/** Angle after `delta` seconds: one lap per period. */
export function advanceLoopAngle(angle: number, delta: number, period: number): number {
  const next = angle + (delta / Math.max(0.001, period)) * Math.PI * 2;
  // Keep the number small; the path is periodic.
  return next > Math.PI * 2 ? next - Math.PI * 2 : next;
}

/** The loop angle at which the camera is on the same side of the stage as the given position. */
export function azimuthOf(x: number, z: number): number {
  return x === 0 && z === 0 ? 0 : Math.atan2(x, z);
}

/** Smooth 0..1 ease (zero slope at both ends). */
export function ease(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/**
 * Blend from `from` (w = 0) to `to` (w = 1). The camera position travels around
 * the vertical axis (shortest way) instead of cutting through the stage centre;
 * the target moves in a straight line.
 */
export function blendPose(from: OrbitPose, to: OrbitPose, w: number, out: OrbitPose): OrbitPose {
  const r0 = Math.hypot(from.px, from.pz);
  const r1 = Math.hypot(to.px, to.pz);
  const a0 = azimuthOf(from.px, from.pz);
  let da = azimuthOf(to.px, to.pz) - a0;
  if (r0 < 1e-6 || r1 < 1e-6) da = 0;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  const a = (r0 < 1e-6 ? azimuthOf(to.px, to.pz) : a0) + da * w;
  const r = r0 + (r1 - r0) * w;
  out.px = Math.sin(a) * r;
  out.pz = Math.cos(a) * r;
  out.py = from.py + (to.py - from.py) * w;
  out.tx = from.tx + (to.tx - from.tx) * w;
  out.ty = from.ty + (to.ty - from.ty) * w;
  out.tz = from.tz + (to.tz - from.tz) * w;
  return out;
}
