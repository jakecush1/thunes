/**
 * The desert's ground as pure maths: a dune field around a flat interdune
 * floor where the stage stands. No three.js in here, so the same function
 * shapes the mesh, plants the scenery and can be previewed offline.
 *
 * Coordinates are world metres; the stage is the origin and the default camera
 * looks from +Z toward -Z. The wind blows toward WIND (to the right and a
 * little toward the camera), so every dune has a long gentle windward slope
 * facing -WIND and a short slip face (at the angle of repose) facing +WIND:
 * from the default camera the ridges cross the view from near-left to
 * far-right and show their slip faces.
 */

/** Direction the wind blows toward, in (x, z). Dune crests run across it. */
export const WIND: readonly [number, number] = [0.8999, 0.436];
/** Direction of the crest lines, in (x, z): WIND turned a quarter turn. */
export const CREST: readonly [number, number] = [-WIND[1], WIND[0]];

/** Slope (rise over run) of a slip face: sand's angle of repose, about 32 degrees. */
const SLIP = 0.62;

/** Radius of the perfectly level disc under the stage, metres. */
export const FLAT_RADIUS = 9;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1 (quintic interpolation, so slopes stay continuous). */
export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** Three octaves of value noise, 0..1. */
export function fbm(x: number, z: number, seed: number): number {
  return (
    valueNoise(x, z, seed) * 0.57 +
    valueNoise(x * 2.1 + 5.3, z * 2.1 + 1.7, seed + 1) * 0.29 +
    valueNoise(x * 4.3 + 9.1, z * 4.3 + 4.2, seed + 2) * 0.14
  );
}

/** Polynomial smooth minimum: like min(a, b) with the corner rounded over `k` metres. */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

/** One family of parallel dune ridges. */
interface RidgeSystem {
  /** Direction the ridges migrate toward, (x, z), unit length. */
  wind: readonly [number, number];
  /** Distance between crests, metres. */
  spacing: number;
  /** Shifts the whole family along the wind, in crest spacings (0..1). */
  phase: number;
  /** Height of the biggest crests, metres. */
  height: number;
  /** Length of the windward slope of a full-size dune, metres. */
  rise: number;
  /** How far the low ends of a dune run ahead of its middle (the horns of a crescent), metres. */
  horns: number;
  /** How much the crest lines wander, metres, at two scales. */
  meander: number;
  /** Length along the crest over which a dune swells and dies, metres. */
  reach: number;
  /** 0..1: the share of each crest line that carries a dune. */
  cover: number;
  seed: number;
}

/** Height of one ridge family at a point, plus how much of that point is slip face (0..1). */
function ridges(x: number, z: number, system: RidgeSystem, out: { height: number; slip: number }): void {
  const [wx, wz] = system.wind;
  let s = x * wx + z * wz;
  const t = -x * wz + z * wx;
  const { spacing, seed } = system;
  s += system.meander * (valueNoise(t / (spacing * 1.7) + 3.1, s / (spacing * 4.2) + 7.7, seed) - 0.5) * 2;
  s += system.meander * 0.3 * (valueNoise(t / (spacing * 0.55), s / (spacing * 1.6), seed + 1) - 0.5) * 2;
  const u = s / spacing + system.phase;
  const row = Math.floor(u);
  let d = (u - row) * spacing;
  // Each crest line has its own run of dunes and gaps.
  const swell = valueNoise(t / system.reach + row * 17.31, row * 5.17 + 0.5, seed + 2);
  const amount = smoothstep(1 - system.cover - 0.16, 1 - system.cover + 0.2, swell);
  const size = 0.62 + 0.55 * valueNoise(x / (spacing * 3.1) + 5, z / (spacing * 3.1) + 9, seed + 3);
  const top = system.height * amount * size;
  if (top < 0.01) {
    out.height = 0;
    out.slip = 0;
    return;
  }
  d -= (1 - amount) * system.horns;
  const crest = spacing * 0.58;
  const rise = system.rise * (0.5 + 0.5 * amount);
  // Windward: a concave foot, then a convex shoulder that is still climbing at the brink.
  const v = Math.min(1, Math.max(0, (d - (crest - rise)) / rise)) * 0.82;
  const windward = (top * (v * v * (3 - 2 * v))) / 0.9145;
  // Lee: the slip face, a straight slope at the angle of repose.
  const lee = top - (d - crest) * SLIP;
  const height = smax(smin(windward, lee, 0.3), 0, 0.6) - 0.15;
  out.height = Math.max(0, height);
  out.slip = d > crest && lee > 0.1 ? smoothstep(0, 0.6, d - crest) * smoothstep(0.1, 0.5, lee) : 0;
}

const MAIN: RidgeSystem = { wind: WIND, spacing: 46, phase: 0.2757, height: 8.2, rise: 27, horns: 8, meander: 13, reach: 62, cover: 0.72, seed: 21 };
const SMALL: RidgeSystem = { wind: [0.9703, -0.2419], spacing: 17, phase: 0.2, height: 1.25, rise: 10, horns: 3, meander: 5, reach: 21, cover: 0.45, seed: 47 };
const FAR: RidgeSystem = { wind: [0.9336, 0.3584], spacing: 118, phase: 0.55, height: 24, rise: 64, horns: 18, meander: 30, reach: 150, cover: 0.8, seed: 83 };

const scratch = { height: 0, slip: 0 };

/** 0 on the level ground kept clear for the stage and the camera, rising to 1 in the open dunes. */
export function openness(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const disc = smoothstep(FLAT_RADIUS + 1, FLAT_RADIUS + 15, r);
  // The corridor between the default camera and the stage (see inCorridor in shared.ts), with a margin.
  const zc = Math.min(38, Math.max(2, z));
  const half = 5 + (zc - 2) * 0.6;
  const dx = Math.max(0, Math.abs(x) - half);
  const dz = Math.max(0, 2 - z, z - 38);
  const corridor = smoothstep(0, 16, Math.hypot(dx, dz));
  return Math.min(disc, corridor);
}

export interface Ground {
  /** Height of the sand, metres. */
  height: number;
  /** 0..1: how much this point is a slip face (smooth, steep, in the lee of a crest). */
  slip: number;
}

/** The ground at a point. `out` is filled and returned (pass one to avoid allocating). */
export function ground(x: number, z: number, out: Ground = { height: 0, slip: 0 }): Ground {
  const r = Math.hypot(x, z);
  if (r <= FLAT_RADIUS) {
    out.height = 0;
    out.slip = 0;
    return out;
  }
  const open = openness(x, z);
  const level = smoothstep(FLAT_RADIUS, FLAT_RADIUS + 9, r);
  let height = 0;
  let slip = 0;

  if (open > 0) {
    // The dunes proper, fading into far bigger ones toward the horizon.
    const farMix = smoothstep(70, 150, r);
    if (farMix < 1) {
      ridges(x, z, MAIN, scratch);
      height += scratch.height * (1 - farMix);
      slip = Math.max(slip, scratch.slip * (1 - farMix));
    }
    if (farMix > 0) {
      ridges(x, z, FAR, scratch);
      height += scratch.height * farMix;
      slip = Math.max(slip, scratch.slip * farMix);
    }
    // Small dunes in the flats between the big ones (never on a slip face).
    const lowland = (1 - smoothstep(0.6, 3, height)) * (1 - slip);
    if (lowland > 0) {
      ridges(x, z, SMALL, scratch);
      height += scratch.height * lowland;
    }
    // A slow swell so the flats between dunes are not one level.
    height += 2.6 * smoothstep(0.25, 0.9, fbm(x / 140 + 40, z / 140 + 11, 5));
    height *= open;
    slip *= open;
  }
  // Gentle unevenness everywhere outside the stage disc, including the camera corridor.
  height += level * 0.32 * (fbm(x / 11, z / 11, 61) - 0.42) * (1 - 0.7 * slip);
  out.height = height;
  out.slip = slip;
  return out;
}

const heightScratch: Ground = { height: 0, slip: 0 };

/** Height of the sand at a point, metres. Exactly 0 within FLAT_RADIUS of the origin. */
export function groundHeight(x: number, z: number): number {
  return ground(x, z, heightScratch).height;
}

/** Slope of the ground at a point as rise over run (0 = level). */
export function groundSlope(x: number, z: number): number {
  const e = 0.4;
  const dx = groundHeight(x + e, z) - groundHeight(x - e, z);
  const dz = groundHeight(x, z + e) - groundHeight(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}
