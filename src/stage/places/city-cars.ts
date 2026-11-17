/**
 * Generic parked cars, lofted from a handful of measurements: a body skin
 * with wheel arches, a glazed cabin, wheels, lamps, grille and plates.
 * No real make or model. Three body shapes, instanced, with clear-coat paint.
 */
import * as THREE from 'three';
import type { CityLook } from './city-look';
import { MeshBuilder } from './city-mesh';
import type { CityPart } from './city-mesh';
import { ROAD, SIDE_STREETS } from './city-plan';
import { inCorridor, mulberry32, smooth } from './shared';

export interface CarLight {
  x: number;
  y: number;
  z: number;
  size: number;
  color: [number, number, number];
}

interface CarSpec {
  length: number;
  width: number;
  /** Height of the roof. */
  height: number;
  wheelRadius: number;
  /** Axle positions along the car (front is +z). */
  axleFront: number;
  axleRear: number;
  /** Height of the sills. */
  clearance: number;
  /** Height of the body's shoulder line at the nose, along the cabin and at the tail. */
  beltFront: number;
  belt: number;
  beltRear: number;
  /** How much of each end is rounded off in plan. */
  noseRadius: number;
  tailRadius: number;
  /** Base of the windscreen, front and rear edge of the roof, base of the rear window. */
  cowl: number;
  roofFront: number;
  roofRear: number;
  deck: number;
  /** How far the side glass leans in. */
  tumble: number;
}

const SEDAN: CarSpec = { length: 4.66, width: 1.82, height: 1.44, wheelRadius: 0.33, axleFront: 1.41, axleRear: -1.32, clearance: 0.2, beltFront: 0.69, belt: 0.95, beltRear: 0.93, noseRadius: 0.44, tailRadius: 0.36, cowl: 0.98, roofFront: 0.2, roofRear: -0.92, deck: -1.62, tumble: 0.19 };
const HATCH: CarSpec = { length: 4.12, width: 1.78, height: 1.49, wheelRadius: 0.32, axleFront: 1.22, axleRear: -1.3, clearance: 0.2, beltFront: 0.72, belt: 0.97, beltRear: 0.99, noseRadius: 0.42, tailRadius: 0.3, cowl: 0.86, roofFront: 0.12, roofRear: -1.42, deck: -1.86, tumble: 0.18 };
const SUV: CarSpec = { length: 4.62, width: 1.9, height: 1.7, wheelRadius: 0.37, axleFront: 1.4, axleRear: -1.36, clearance: 0.27, beltFront: 0.88, belt: 1.09, beltRear: 1.1, noseRadius: 0.4, tailRadius: 0.3, cowl: 1.02, roofFront: 0.4, roofRear: -1.78, deck: -2.08, tumble: 0.15 };

const ROUND = 2.4;
function endRound(d: number, r: number): number {
  if (d >= r) return 1;
  return Math.pow(Math.max(0, 1 - Math.pow(1 - Math.max(0, d) / r, ROUND)), 1 / ROUND);
}

/** The body's surface as functions; `grow` puffs it out a few millimetres (for parts laid on the skin). */
function bodyShape(spec: CarSpec, grow = 0) {
  const half = spec.length / 2 + grow;
  const wide = spec.width / 2 + grow;
  const arch = spec.wheelRadius + 0.055;
  const bumper = spec.clearance + 0.36 * (spec.belt - spec.clearance);
  const halfWidth = (z: number): number => {
    const s = z / half;
    return wide * endRound(half - z, spec.noseRadius) * endRound(z + half, spec.tailRadius) * (1 - 0.035 * s * s);
  };
  const shoulder = (z: number): number => {
    if (z > spec.cowl) return spec.belt - (spec.belt - spec.beltFront) * Math.pow(Math.min(1, (z - spec.cowl) / (half - spec.cowl)), 1.6);
    if (z < spec.deck) return spec.belt - (spec.belt - spec.beltRear) * Math.pow(Math.min(1, (spec.deck - z) / (spec.deck + half)), 1.6);
    return spec.belt;
  };
  const crown = (z: number): number => shoulder(z) + 0.05;
  const bottom = (z: number): number => {
    let y = spec.clearance + 0.07 * Math.pow(Math.max(0, 1 - (half - z) / spec.noseRadius), 2) + 0.09 * Math.pow(Math.max(0, 1 - (z + half) / spec.tailRadius), 2);
    for (const axle of [spec.axleFront, spec.axleRear]) {
      const dz = z - axle;
      if (Math.abs(dz) <= arch) y = Math.max(y, spec.wheelRadius + Math.sqrt(arch * arch - dz * dz));
    }
    return y;
  };
  /** Width factor at height y: fullest at mid-height, tucked in under the sills. */
  const sideX = (y: number): number => {
    const span = spec.belt - spec.clearance;
    const k = (y - (spec.clearance + 0.5 * span)) / (span * 0.6);
    return 1 - 0.05 * k * k - 0.07 * smooth((spec.clearance + 0.15 - y) / 0.16);
  };
  /** The ends lean back above and below the bumper line. */
  const lean = (z: number, y: number): number => {
    const k = Math.min(1.4, Math.abs(y - bumper) / 0.3);
    const amount = 0.1 * k * k;
    return amount * (Math.max(0, 1 - (z + half) / spec.tailRadius) * 0.8 - Math.max(0, 1 - (half - z) / spec.noseRadius));
  };
  /** Point on the side at (z, y); side = -1 left, +1 right. */
  const side = (z: number, y: number, sign: number): [number, number, number] => [sign * halfWidth(z) * sideX(y), y, z + lean(z, y)];
  /** Point on the nose (end = 1) or tail (end = -1) at lateral position x and height y. */
  const end = (x: number, y: number, which: number): [number, number, number] => {
    const radius = which > 0 ? spec.noseRadius : spec.tailRadius;
    const q = Math.min(0.9995, Math.abs(x) / (wide * 0.966 * sideX(y)));
    const d = radius * (1 - Math.pow(1 - Math.pow(q, ROUND), 1 / ROUND));
    const z = which * (half - d);
    return [x, y, z + lean(z, y)];
  };
  return { half, wide, arch, halfWidth, shoulder, crown, bottom, sideX, side, end };
}

/** Grid helper: emits shared vertices into whichever builder a cell belongs to. */
function gridEmitter(points: [number, number, number][][]) {
  const maps = new Map<MeshBuilder, Map<number, number>>();
  const columns = points[0]!.length;
  const index = (builder: MeshBuilder, i: number, j: number): number => {
    let map = maps.get(builder);
    if (!map) maps.set(builder, (map = new Map()));
    const key = i * columns + j;
    let v = map.get(key);
    if (v === undefined) {
      const p = points[i]![j]!;
      v = builder.vertex(p[0], p[1], p[2], 0, 1, 0);
      map.set(key, v);
    }
    return v;
  };
  /**
   * Cell between rows i, i+1 and columns j, j+1 (j wraps when `closed`).
   * Its front faces cross(d/di, d/dj), or the other way when `flip` is set.
   */
  return (builder: MeshBuilder, i: number, j: number, closed = false, flip = false): void => {
    const j1 = closed ? (j + 1) % columns : j + 1;
    if (flip) builder.face(index(builder, i, j), index(builder, i, j1), index(builder, i + 1, j1), index(builder, i + 1, j));
    else builder.face(index(builder, i, j), index(builder, i + 1, j), index(builder, i + 1, j1), index(builder, i, j1));
  };
}

const TYRE: [number, number, number] = [0.012, 0.012, 0.013];
const GLASS: [number, number, number] = [0.01, 0.012, 0.015];

/** One wheel, its axis along x and its outer face toward +x, centred on the origin. */
function wheel(radius: number): MeshBuilder {
  const b = new MeshBuilder();
  const hw = 0.105;
  const segments = 14;
  const R = radius;
  // Profile from the inner edge of the tread, over the tread and down the outer face to the hub.
  const bands: { x0: number; r0: number; x1: number; r1: number; kind: 'tyre' | 'lip' | 'spoke' | 'hub' }[] = [
    { x0: -hw, r0: R * 0.93, x1: -hw * 0.6, r1: R, kind: 'tyre' },
    { x0: -hw * 0.6, r0: R, x1: hw * 0.6, r1: R, kind: 'tyre' },
    { x0: hw * 0.6, r0: R, x1: hw, r1: R * 0.93, kind: 'tyre' },
    { x0: hw, r0: R * 0.93, x1: hw * 0.9, r1: R * 0.66, kind: 'tyre' },
    { x0: hw * 0.9, r0: R * 0.66, x1: hw * 0.74, r1: R * 0.6, kind: 'lip' },
    { x0: hw * 0.74, r0: R * 0.6, x1: hw * 0.6, r1: R * 0.17, kind: 'spoke' },
    { x0: hw * 0.6, r0: R * 0.17, x1: hw * 0.7, r1: 0.001, kind: 'hub' },
  ];
  for (const band of bands) {
    for (let s = 0; s < segments; s++) {
      const a0 = (s / segments) * Math.PI * 2;
      const a1 = ((s + 1) / segments) * Math.PI * 2;
      if (band.kind === 'tyre') b.tint(...TYRE).surface(0.85, 0, 0);
      else if (band.kind === 'spoke' && s % 2 === 1) b.tint(0.015, 0.015, 0.017).surface(0.7, 0.2, 0);
      else b.tint(0.5, 0.51, 0.53).surface(0.32, 0.9, 0);
      const p = (x: number, r: number, a: number) => b.vertex(x, r * Math.cos(a), r * Math.sin(a), 0, 1, 0);
      b.face(p(band.x0, band.r0, a0), p(band.x0, band.r0, a1), p(band.x1, band.r1, a1), p(band.x1, band.r1, a0));
    }
  }
  return b;
}

function buildCar(spec: CarSpec): { paint: THREE.BufferGeometry; trim: THREE.BufferGeometry } {
  const paint = new MeshBuilder();
  const trim = new MeshBuilder();
  const body = bodyShape(spec);
  const half = body.half;

  // ── Stations along the body: dense at the ends and around the wheel arches ──
  const stations: number[] = [];
  const pushStation = (z: number): void => {
    for (const other of stations) if (Math.abs(other - z) < 0.004) return;
    stations.push(z);
  };
  for (let k = 0; k <= 5; k++) {
    const t = 1 - Math.cos((k / 5) * (Math.PI / 2));
    pushStation(half - spec.noseRadius * t);
    pushStation(-half + spec.tailRadius * t);
  }
  for (const axle of [spec.axleFront, spec.axleRear]) {
    pushStation(axle - body.arch - 0.006);
    pushStation(axle + body.arch + 0.006);
    for (let k = 0; k <= 8; k++) pushStation(axle + body.arch * Math.cos((k / 8) * Math.PI));
  }
  stations.sort((a, b) => a - b);
  for (let i = stations.length - 1; i > 0; i--) {
    const gap = stations[i]! - stations[i - 1]!;
    const extra = Math.ceil(gap / 0.26) - 1;
    for (let k = 1; k <= extra; k++) stations.push(stations[i - 1]! + (gap * k) / (extra + 1));
  }
  stations.sort((a, b) => a - b);

  // ── Body skin: left sill, up the side, over the top, down the right side ──
  const sideRows = [0, 0.14, 0.38, 0.64, 0.86, 1];
  const topAngles = [25, 52];
  const skin: [number, number, number][][] = stations.map((z) => {
    const yb = body.bottom(z);
    const ys = Math.max(yb + 0.02, body.shoulder(z));
    const yc = body.crown(z);
    const ring: [number, number, number][] = [];
    const leftSide = sideRows.map((a) => body.side(z, yb + (ys - yb) * a, -1));
    const top = topAngles.map((deg): [number, number, number] => {
      const phi = (deg * Math.PI) / 180;
      const y = ys + (yc - ys) * Math.pow(Math.sin(phi), 2 / 2.6);
      const p = body.side(z, ys, -1);
      return [p[0] * Math.pow(Math.cos(phi), 2 / 2.6), y, p[2]];
    });
    ring.push(...leftSide, ...top, [0, yc, body.side(z, ys, 1)[2]]);
    for (let j = top.length - 1; j >= 0; j--) ring.push([-top[j]![0], top[j]![1], top[j]![2]]);
    for (let j = leftSide.length - 1; j >= 0; j--) ring.push([-leftSide[j]![0], leftSide[j]![1], leftSide[j]![2]]);
    return ring;
  });
  const skinCell = gridEmitter(skin);
  const columns = skin[0]!.length;
  paint.tint(1, 1, 1);
  trim.tint(0.022, 0.022, 0.024).surface(0.6, 0, 0);
  for (let i = 0; i < stations.length - 1; i++) {
    for (let j = 0; j < columns - 1; j++) skinCell(j === 0 || j === columns - 2 ? trim : paint, i, j);
  }

  // ── Cabin: slices from the belt to the roof, glass below, painted roof and corner pillars ──
  const around = 32;
  const roofY = spec.height;
  const slices: { h: number; scale: number; lift: number }[] = [
    { h: 0, scale: 1, lift: -0.04 },
    { h: 0.3, scale: 1, lift: 0 },
    { h: 0.6, scale: 1, lift: 0 },
    { h: 0.88, scale: 1, lift: 0 },
    { h: 0.97, scale: 0.975, lift: 0 },
    { h: 1, scale: 0.9, lift: 0 },
    { h: 1, scale: 0.55, lift: 0.014 },
    { h: 1, scale: 0.0, lift: 0.02 },
  ];
  const cabin: [number, number, number][][] = slices.map(({ h, scale, lift }) => {
    const front = spec.cowl + (spec.roofFront - spec.cowl) * h;
    const rear = spec.deck + (spec.roofRear - spec.deck) * h;
    const centre = (front + rear) / 2;
    const length = (front - rear) / 2;
    const width = spec.width / 2 - 0.045 - spec.tumble * h;
    const y = spec.belt + (roofY - spec.belt) * h + lift;
    const ring: [number, number, number][] = [];
    for (let m = 0; m < around; m++) {
      const t = (m / around) * Math.PI * 2;
      const sx = Math.sign(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), 2 / 4.2);
      const sz = Math.sign(Math.cos(t)) * Math.pow(Math.abs(Math.cos(t)), 2 / 4.2);
      ring.push([width * sx * scale, y, centre + length * sz * scale]);
    }
    return ring;
  });
  const cabinCell = gridEmitter(cabin);
  for (let k = 0; k < slices.length - 1; k++) {
    for (let m = 0; m < around; m++) {
      // The ring runs front, right, back, left: the corners of the plan are the pillars.
      const t = ((m + 0.5) / around) * Math.PI * 2;
      const pillar = Math.abs((t % (Math.PI / 2)) - Math.PI / 4) < 0.11;
      if (k >= 3 || pillar) {
        paint.tint(1, 1, 1);
        cabinCell(paint, k, m, true, true);
      } else {
        trim.tint(...GLASS).surface(0.04, 0, 0);
        cabinCell(trim, k, m, true, true);
      }
    }
  }

  // ── Dark underbody and wheel-arch liners ──
  trim.tint(0.008, 0.008, 0.009).surface(0.9, 0, 0);
  trim.box(-(spec.width / 2 - 0.1), spec.width / 2 - 0.1, spec.clearance - 0.01, spec.clearance + 0.3, -half + 0.3, half - 0.3, 1, true);
  for (const axle of [spec.axleFront, spec.axleRear]) {
    const top = Math.min(body.shoulder(axle + body.arch), body.shoulder(axle - body.arch)) - 0.07;
    trim.box(-(spec.width / 2 - 0.11), spec.width / 2 - 0.11, spec.clearance + 0.2, top, axle - body.arch - 0.05, axle + body.arch + 0.05, 1);
  }

  // ── Wheels ──
  const oneWheel = wheel(spec.wheelRadius);
  const track = spec.width / 2 - 0.105 - 0.035;
  for (const axle of [spec.axleFront, spec.axleRear]) {
    trim.append(oneWheel, track, spec.wheelRadius, axle, 0);
    trim.append(oneWheel, -track, spec.wheelRadius, axle, Math.PI);
  }

  // ── Parts laid on the skin: lamps, grille, plates, door shuts ──
  const skinOut = bodyShape(spec, 0.009);
  const endPatch = (which: number, x0: number, x1: number, y0: number, y1: number, nx: number): void => {
    const grid: number[][] = [];
    const xa = Math.min(x0, x1);
    const xb = Math.max(x0, x1);
    for (let j = 0; j <= 1; j++) {
      const row: number[] = [];
      for (let i = 0; i <= nx; i++) {
        const p = skinOut.end(xa + ((xb - xa) * i) / nx, y0 + (y1 - y0) * j, which);
        row.push(trim.vertex(p[0], p[1], p[2], 0, 0, which));
      }
      grid.push(row);
    }
    for (let i = 0; i < nx; i++) {
      const a = grid[0]![i]!;
      const b = grid[0]![i + 1]!;
      const c = grid[1]![i + 1]!;
      const d = grid[1]![i]!;
      if (which > 0) trim.face(a, b, c, d);
      else trim.face(b, a, d, c);
    }
  };
  const reach = spec.width / 2;
  const yf = spec.beltFront;
  const yr = spec.beltRear;
  for (const sign of [-1, 1]) {
    // Headlamps wrap round the corners of the nose; tail lamps round the tail.
    trim.tint(0.62, 0.64, 0.68).surface(0.12, 0.6, -1);
    endPatch(1, sign * reach * 0.5, sign * reach * 0.955, yf - 0.17, yf - 0.045, 7);
    trim.tint(0.42, 0.012, 0.01).surface(0.2, 0, -0.75);
    endPatch(-1, sign * reach * 0.46, sign * reach * 0.955, yr - 0.2, yr - 0.05, 7);
  }
  trim.tint(0.012, 0.012, 0.014).surface(0.5, 0.3, 0);
  endPatch(1, -reach * 0.44, reach * 0.44, yf - 0.16, yf - 0.05, 6);
  endPatch(1, -reach * 0.72, reach * 0.72, spec.clearance + 0.05, spec.clearance + 0.19, 8);
  endPatch(-1, -reach * 0.76, reach * 0.76, spec.clearance + 0.04, spec.clearance + 0.2, 8);
  trim.tint(0.6, 0.6, 0.56).surface(0.5, 0, 0);
  const plates = bodyShape(spec, 0.016);
  const plate = (which: number, y0: number): void => {
    const p0 = plates.end(-0.26, y0, which);
    const p1 = plates.end(0.26, y0 + 0.11, which);
    const z = which * Math.max(which * p0[2], which * p1[2]);
    const a = trim.vertex(-0.26, y0, z, 0, 0, which);
    const b = trim.vertex(0.26, y0, z, 0, 0, which);
    const c = trim.vertex(0.26, y0 + 0.11, z, 0, 0, which);
    const d = trim.vertex(-0.26, y0 + 0.11, z, 0, 0, which);
    if (which > 0) trim.face(a, b, c, d);
    else trim.face(b, a, d, c);
  };
  plate(1, spec.clearance + 0.22);
  plate(-1, yr - 0.36);
  // Door shuts: thin dark lines down the sides.
  trim.tint(0.01, 0.01, 0.011).surface(0.6, 0, 0);
  const shuts = [spec.cowl - 0.06, (spec.cowl + spec.deck) / 2 + 0.12, spec.deck + (spec === SEDAN ? 0.42 : 0.2)];
  for (const z of shuts) {
    for (const sign of [-1, 1]) {
      const y0 = spec.clearance + 0.12;
      const y1 = spec.belt - 0.02;
      const steps = 4;
      for (let k = 0; k < steps; k++) {
        const ya = y0 + ((y1 - y0) * k) / steps;
        const yb = y0 + ((y1 - y0) * (k + 1)) / steps;
        const lo = (y: number) => skinOut.side(z - 0.007, y, sign);
        const hi = (y: number) => skinOut.side(z + 0.007, y, sign);
        const v = (p: [number, number, number]) => trim.vertex(p[0], p[1], p[2], sign, 0, 0);
        if (sign > 0) trim.face(v(hi(ya)), v(lo(ya)), v(lo(yb)), v(hi(yb)));
        else trim.face(v(lo(ya)), v(hi(ya)), v(hi(yb)), v(lo(yb)));
      }
    }
  }
  // Door mirrors, in body colour.
  paint.tint(1, 1, 1);
  for (const sign of [-1, 1]) {
    const x = sign * (spec.width / 2 - 0.03);
    paint.box(Math.min(x, x + sign * 0.17), Math.max(x, x + sign * 0.17), spec.belt + 0.02, spec.belt + 0.15, spec.cowl - 0.32, spec.cowl - 0.2, 1, true);
  }

  return { paint: paint.build({ smooth: true }), trim: trim.build({ color: true, surface: true, smooth: true }) };
}

/** Soft dark patch under a car. */
function blobTexture(): THREE.DataTexture {
  const w = 32;
  const h = 64;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = Math.abs(((x + 0.5) / w) * 2 - 1);
      const v = Math.abs(((y + 0.5) / h) * 2 - 1);
      const d = Math.pow(Math.pow(u, 3.2) + Math.pow(v, 3.2), 1 / 3.2);
      const a = Math.round(255 * smooth((1 - d) / 0.42));
      const i = (y * w + x) * 4;
      data[i] = a;
      data[i + 1] = a;
      data[i + 2] = a;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const PAINTS: readonly (readonly [number, number])[] = [
  [0xdfdfda, 3],
  [0x0b0b0d, 3],
  [0x9c9fa4, 3],
  [0x4c4f54, 3],
  [0x1a2a44, 1.5],
  [0x741714, 1],
  [0x1d3528, 0.5],
  [0xa8997c, 0.5],
  [0x62809a, 0.6],
];

interface Parked {
  x: number;
  z: number;
  yaw: number;
  kind: number;
  paint: number;
  lit: number;
}

/** The detail material's fragment hooks: per-vertex roughness, metalness and glow. */
export const DETAIL_VERTEX_HEAD = /* glsl */ `
attribute vec3 surf;
varying vec3 vSurf;
#ifdef USE_INSTANCING
  attribute float aLit;
#endif
varying float vLit;
`;
export const DETAIL_VERTEX_BODY = /* glsl */ `
vSurf = surf;
#ifdef USE_INSTANCING
  vLit = aLit;
#else
  vLit = 1.0;
#endif
`;
export const DETAIL_FRAGMENT_HEAD = /* glsl */ `
varying vec3 vSurf;
varying float vLit;
`;
export const DETAIL_SURFACE = /* glsl */ `
roughnessFactor = vSurf.x;
metalnessFactor = vSurf.y;
`;
export const DETAIL_EMISSIVE = /* glsl */ `
totalEmissiveRadiance += diffuseColor.rgb * ((vSurf.z >= 0.0 ? vSurf.z : -vSurf.z * vLit) * 9.0);
`;

export function createDetailMaterial(look: CityLook): THREE.MeshStandardMaterial {
  return look.patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }), 1, {
    stageLights: 'none',
    key: 'detail',
    vertexHead: DETAIL_VERTEX_HEAD,
    vertexBody: DETAIL_VERTEX_BODY,
    fragmentHead: DETAIL_FRAGMENT_HEAD,
    surface: DETAIL_SURFACE,
    emissive: DETAIL_EMISSIVE,
  });
}

export function buildCars(look: CityLook, detail: THREE.MeshStandardMaterial): CityPart & { lights: CarLight[] } {
  const rng = mulberry32(5150);
  const specs = [SEDAN, HATCH, SUV];
  const parked: Parked[] = [];
  const pickPaint = (): number => {
    let total = 0;
    for (const [, weight] of PAINTS) total += weight;
    let roll = rng() * total;
    for (const [hex, weight] of PAINTS) {
      roll -= weight;
      if (roll <= 0) return hex;
    }
    return PAINTS[0]![0];
  };
  const pickKind = (): number => (rng() < 0.45 ? 0 : rng() < 0.55 ? 1 : 2);

  // Parked along the kerbs of the four arms, one per six-metre bay, facing the way their side drives.
  const kerbside = ROAD - 1.13;
  for (let along = 15; along <= 93; along += 6) {
    const chance = along < 50 ? 0.8 : 0.55;
    if (SIDE_STREETS.some((street) => Math.abs(along - street) < 9)) continue;
    for (const end of [-1, 1]) {
      for (const side of [-1, 1]) {
        for (const axis of [0, 1]) {
          const jitterAlong = (rng() - 0.5) * 0.7;
          const jitterSide = (rng() - 0.5) * 0.12;
          const turn = (rng() - 0.5) * 0.04;
          const kind = pickKind();
          const paint = pickPaint();
          if (rng() > chance) continue;
          const a = end * (along + jitterAlong);
          const s = side * (kerbside + jitterSide);
          const x = axis === 0 ? s : a;
          const z = axis === 0 ? a : s;
          if (inCorridor(x, z)) continue;
          const yaw = axis === 0 ? (side < 0 ? 0 : Math.PI) : side < 0 ? -Math.PI / 2 : Math.PI / 2;
          parked.push({ x, z, yaw: yaw + turn, kind, paint, lit: 0 });
        }
      }
    }
  }
  // A few with their lights on: waiting at the stop lines and driving off into the sun.
  parked.push({ x: -1.78, z: -14.6, yaw: 0, kind: 0, paint: 0x9c9fa4, lit: 1 });
  parked.push({ x: 1.72, z: -37, yaw: Math.PI, kind: 2, paint: 0x0b0b0d, lit: 1 });
  parked.push({ x: 1.8, z: -66, yaw: Math.PI, kind: 1, paint: 0x741714, lit: 1 });
  parked.push({ x: 14.8, z: -1.76, yaw: -Math.PI / 2, kind: 1, paint: 0xdfdfda, lit: 1 });
  parked.push({ x: -31, z: -1.7, yaw: -Math.PI / 2, kind: 0, paint: 0x1a2a44, lit: 1 });

  const paintMaterial = look.patch(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.07 }), 1, { stageLights: 'none', key: 'paint' });
  const blob = blobTexture();
  const blobMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: blob, transparent: true, opacity: 0.78, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const blobGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  const meshes: THREE.Mesh[] = [];
  const lights: CarLight[] = [];
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();

  const shadows = new THREE.InstancedMesh(blobGeometry, blobMaterial, parked.length);
  shadows.name = 'city-car-shadows';
  shadows.frustumCulled = false;
  shadows.matrixAutoUpdate = false;
  shadows.renderOrder = 2;
  parked.forEach((car, i) => {
    const spec = specs[car.kind]!;
    rotation.setFromAxisAngle(up, car.yaw);
    matrix.compose(position.set(car.x, 0.012, car.z), rotation, scale.set(spec.width + 0.55, 1, spec.length + 0.5));
    shadows.setMatrixAt(i, matrix);
  });
  shadows.instanceMatrix.needsUpdate = true;
  meshes.push(shadows);

  specs.forEach((spec, kind) => {
    const cars = parked.filter((car) => car.kind === kind);
    if (cars.length === 0) return;
    const geometry = buildCar(spec);
    const lit = new Float32Array(cars.length);
    const paintMesh = new THREE.InstancedMesh(geometry.paint, paintMaterial, cars.length);
    const trimMesh = new THREE.InstancedMesh(geometry.trim, detail, cars.length);
    cars.forEach((car, i) => {
      rotation.setFromAxisAngle(up, car.yaw);
      matrix.compose(position.set(car.x, 0, car.z), rotation, scale.set(1, 1, 1));
      paintMesh.setMatrixAt(i, matrix);
      trimMesh.setMatrixAt(i, matrix);
      paintMesh.setColorAt(i, color.setHex(car.paint));
      lit[i] = car.lit;
      if (car.lit > 0) {
        const c = Math.cos(car.yaw);
        const s = Math.sin(car.yaw);
        for (const side of [-1, 1]) {
          const lx = side * spec.width * 0.36;
          const front = spec.length / 2 - 0.05;
          lights.push({ x: car.x + lx * c + front * s, y: spec.beltFront - 0.1, z: car.z - lx * s + front * c, size: 1.5, color: [1.0, 0.86, 0.66] });
          lights.push({ x: car.x + lx * c - front * s, y: spec.beltRear - 0.12, z: car.z - lx * s - front * c, size: 0.95, color: [1.0, 0.08, 0.04] });
        }
      }
    });
    geometry.trim.setAttribute('aLit', new THREE.InstancedBufferAttribute(lit, 1));
    for (const mesh of [paintMesh, trimMesh]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      meshes.push(mesh);
    }
    if (paintMesh.instanceColor) paintMesh.instanceColor.needsUpdate = true;
    paintMesh.name = `city-car-paint-${kind}`;
    trimMesh.name = `city-car-trim-${kind}`;
  });

  return { meshes, materials: [paintMaterial, blobMaterial], textures: [blob], lights };
}
