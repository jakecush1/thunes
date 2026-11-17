/**
 * Forest plants, built in code: trunks and limbs as tapered tubes, foliage as
 * cards that show pieces of the foliage atlas. Trees come at three levels of
 * detail (hero, mid, far); undergrowth is ferns, shrubs, saplings, rocks, logs.
 *
 * Every model is one tree (or plant) in metres with its base at the origin;
 * the forest instances them.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './shared';
import type { AtlasCell, ForestAtlas } from './forest-textures';

type Rng = () => number;
type Rgb = readonly [number, number, number];

/** Accumulates an indexed mesh with position, normal, uv and colour. */
export class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  vertex(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, color: Rgb): number {
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(n.x, n.y, n.z);
    this.uvs.push(u, v);
    this.colors.push(color[0], color[1], color[2]);
    return this.positions.length / 3 - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    return geometry;
  }
}

export interface PlantModel {
  /** Trunk and limbs for the bark material (hero trees only). */
  wood: THREE.BufferGeometry | null;
  /** Leaf cards (and, for distant trees, the trunk) on the foliage atlas. */
  foliage: THREE.BufferGeometry;
  /** Clumps of foliage as [x, y, z, radius] quadruples: what the tree shades. */
  blobs: number[];
  crownRadius: number;
  height: number;
  /** Trunk radius at the ground, metres. */
  girth: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpP = new THREE.Vector3();

function randomUnit(rng: Rng, out = new THREE.Vector3()): THREE.Vector3 {
  const y = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - y * y);
  return out.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
}

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length) % items.length]!;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

interface TubeOptions {
  radial: number;
  /** Times the texture wraps around the tube. */
  wraps: number;
  /** Texture repeats per metre along the tube. */
  perMetre: number;
  /** Map into this atlas strip instead of a tiling texture. */
  strip?: AtlasCell;
  /** Brightness at ring `i`. */
  shade: (i: number) => number;
  /** Extra radius factor by angle at ring `i` (root flare). */
  flare?: (i: number, theta: number) => number;
}

/** A tapered tube along `path`. */
function addTube(b: MeshBuilder, path: readonly THREE.Vector3[], radii: readonly number[], options: TubeOptions): void {
  const rings = path.length;
  const { radial } = options;
  const first = b.vertexCount;
  let travelled = 0;
  let total = 0;
  for (let i = 1; i < rings; i++) total += path[i]!.distanceTo(path[i - 1]!);
  for (let i = 0; i < rings; i++) {
    const here = path[i]!;
    const before = path[Math.max(0, i - 1)]!;
    const after = path[Math.min(rings - 1, i + 1)]!;
    if (i > 0) travelled += here.distanceTo(before);
    const tangent = tmpA.subVectors(after, before).normalize();
    const reference = Math.abs(tangent.x) > 0.9 ? tmpB.set(0, 0, 1) : tmpB.set(1, 0, 0);
    const normal = tmpC.copy(reference).addScaledVector(tangent, -reference.dot(tangent)).normalize();
    const binormal = tmpB.crossVectors(tangent, normal);
    const span = Math.max(1e-4, after.distanceTo(before));
    const shade = options.shade(i);
    for (let j = 0; j <= radial; j++) {
      const theta = (j / radial) * Math.PI * 2;
      const flare = options.flare ? options.flare(i, theta) : 1;
      const radius = radii[i]! * flare;
      const slope =
        ((radii[Math.max(0, i - 1)]! * (options.flare ? options.flare(Math.max(0, i - 1), theta) : 1) -
          radii[Math.min(rings - 1, i + 1)]! * (options.flare ? options.flare(Math.min(rings - 1, i + 1), theta) : 1)) /
          span) *
        0.8;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      tmpN.set(0, 0, 0).addScaledVector(normal, cos).addScaledVector(binormal, sin);
      tmpP.copy(here).addScaledVector(tmpN, radius);
      tmpN.addScaledVector(tangent, slope).normalize();
      let u = (j / radial) * options.wraps;
      let v = travelled * options.perMetre;
      if (options.strip) {
        u = options.strip.u0 + (options.strip.u1 - options.strip.u0) * (j / radial);
        v = options.strip.vBase + (options.strip.vTip - options.strip.vBase) * (total > 0 ? travelled / total : 0);
      }
      b.vertex(tmpP, tmpN, u, v, [shade, shade, shade]);
    }
  }
  const row = radial + 1;
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = first + i * row + j;
      b.quad(a, a + 1, a + row + 1, a + row);
    }
  }
}

/**
 * A card of foliage along a centre line. `points` run from the stem to the
 * tip; `side` is the card's width direction. Normals are rounded toward the
 * direction away from `centre`, so a crown of cards shades like a volume.
 */
function addCard(
  b: MeshBuilder,
  points: readonly THREE.Vector3[],
  side: THREE.Vector3,
  halfWidth: number,
  cell: AtlasCell,
  centre: THREE.Vector3,
  round: number,
  colorAt: (p: THREE.Vector3, t: number) => Rgb,
): void {
  const first = b.vertexCount;
  const last = points.length - 1;
  const face = tmpA.subVectors(points[last]!, points[0]!).cross(side).normalize();
  const middle = tmpB.addVectors(points[0]!, points[last]!).multiplyScalar(0.5);
  if (face.dot(tmpC.subVectors(middle, centre)) < 0) face.negate();
  for (let k = 0; k <= last; k++) {
    const t = k / last;
    const v = cell.vBase + (cell.vTip - cell.vBase) * t;
    for (const sign of [-1, 1]) {
      tmpP.copy(points[k]!).addScaledVector(side, sign * halfWidth);
      tmpN.subVectors(tmpP, centre).normalize().multiplyScalar(round).addScaledVector(face, 1 - round).normalize();
      b.vertex(tmpP, tmpN, sign < 0 ? cell.u0 : cell.u1, v, colorAt(tmpP, t));
    }
  }
  for (let k = 0; k < last; k++) {
    const a = first + k * 2;
    b.quad(a, a + 1, a + 3, a + 2);
  }
}

// ──────────────────────────────────────────────────────── hero trees ──

/** A full broadleaf tree: flared trunk, limbs, and a crown of leafy branches. */
export function broadleafHero(seed: number, atlas: ForestAtlas): PlantModel {
  const rng = mulberry32(seed);
  const wood = new MeshBuilder();
  const leaves = new MeshBuilder();
  const blobs: number[] = [];

  const height = 14 + rng() * 2.5;
  const trunkTop = height * 0.78;
  const girth = 0.31 + rng() * 0.07;
  const leanX = (rng() - 0.5) * 0.07;
  const leanZ = (rng() - 0.5) * 0.07;
  const bendPhase = rng() * Math.PI * 2;
  const bend = 0.18 + rng() * 0.16;
  const axis = (y: number, out = new THREE.Vector3()) => {
    const t = Math.max(0, y) / height;
    return out.set(leanX * y + Math.sin(t * 4.2 + bendPhase) * bend * t, y, leanZ * y + Math.cos(t * 3.4 + bendPhase) * bend * t);
  };
  const radiusAt = (y: number) => Math.max(0.035, girth * (1 - 0.86 * Math.min(1, Math.max(0, y) / trunkTop)));

  // Trunk: rings crowd near the ground, where the roots flare.
  const ys = [-0.35, 0, 0.12, 0.28, 0.55, 1, 1.8, 3, 4.6, 6.4, 8.4, trunkTop, (trunkTop + height - 1) / 2, height - 1];
  const lobes = 4 + Math.floor(rng() * 2);
  const lobePhase = rng() * Math.PI * 2;
  addTube(
    wood,
    ys.map((y) => axis(y)),
    ys.map(radiusAt),
    {
      radial: 12,
      wraps: 3,
      perMetre: 0.42,
      shade: (i) => {
        const y = ys[i]!;
        return (0.55 + 0.45 * smoothstep(0, 1.1, y)) * (1 - 0.3 * smoothstep(trunkTop * 0.35, trunkTop, y));
      },
      flare: (i, theta) => 1 + 1.05 * Math.exp(-Math.max(-0.4, ys[i]!) / 0.3) * (0.45 + 0.55 * Math.pow(Math.max(0, Math.sin(theta * lobes + lobePhase)), 1.4)),
    },
  );

  // Limbs, lowest first: long and level low down, short and steep near the top.
  const clusters: { c: THREE.Vector3; r: number; low: boolean }[] = [];
  const limbs = 7;
  const spin = rng() * Math.PI * 2;
  for (let i = 0; i < limbs; i++) {
    const f = i / (limbs - 1);
    const y0 = 2.7 + f * (trunkTop - 3.5) + (rng() - 0.5) * 0.5;
    const azimuth = spin + i * 2.399 + (rng() - 0.5) * 0.5;
    const elevation = 0.36 + f * 0.6 + (rng() - 0.5) * 0.14;
    const length = (5.6 - f * 2.6) * (0.85 + rng() * 0.3);
    const start = axis(y0);
    const out = new THREE.Vector3(Math.sin(azimuth), 0, Math.cos(azimuth));
    const across = new THREE.Vector3(out.z, 0, -out.x);
    const r0 = radiusAt(y0) * 0.58;
    const segments = 5;
    const points: THREE.Vector3[] = [];
    const radii: number[] = [];
    for (let k = 0; k <= segments; k++) {
      const s = k / segments;
      const rise = Math.sin(elevation) * length * s + length * 0.16 * s * s * (1 - f * 0.6) - (f < 0.35 ? length * 0.15 * s * s * s : 0);
      points.push(start.clone().addScaledVector(out, Math.cos(elevation) * length * s).addScaledVector(UP, rise));
      radii.push(Math.max(0.028, r0 * (1 - 0.9 * s)));
    }
    addTube(wood, points, radii, { radial: 5, wraps: 1, perMetre: 0.6, shade: (k) => 0.74 - 0.05 * k });
    const low = f < 0.4;
    clusters.push({ c: points[segments]!.clone(), r: 1.45 + rng() * 0.35, low });
    const flip = rng() < 0.5 ? 1 : -1;
    const second = points[3]!.clone().lerp(points[4]!, 0.5).addScaledVector(across, flip * (0.9 + rng() * 0.5)).addScaledVector(UP, 0.25);
    clusters.push({ c: second, r: 1.2 + rng() * 0.3, low });
    addTube(wood, [points[3]!.clone(), second], [radii[3]! * 0.6, 0.02], { radial: 3, wraps: 1, perMetre: 0.6, shade: () => 0.7 });
    if (length > 4) {
      const third = points[2]!.clone().addScaledVector(across, -flip * (0.9 + rng() * 0.5)).addScaledVector(UP, 0.15);
      clusters.push({ c: third, r: 1.1 + rng() * 0.3, low });
      addTube(wood, [points[2]!.clone(), third], [radii[2]! * 0.5, 0.02], { radial: 3, wraps: 1, perMetre: 0.6, shade: () => 0.7 });
    }
  }
  // The top of the crown.
  clusters.push({ c: axis(height - 1.1), r: 1.6, low: false });
  for (let i = 0; i < 3; i++) {
    const angle = spin + 1 + i * 2.1 + rng() * 0.4;
    clusters.push({ c: axis(trunkTop + 0.2 + rng() * 0.8).add(tmpA.set(Math.sin(angle) * 1.5, 0, Math.cos(angle) * 1.5)), r: 1.35 + rng() * 0.3, low: false });
  }

  // Crown extent, for shading.
  const crownCentre = axis(height * 0.6);
  let crownRadius = 0;
  let lowest = Infinity;
  for (const cluster of clusters) {
    crownRadius = Math.max(crownRadius, cluster.c.distanceTo(crownCentre) + cluster.r * 0.8);
    lowest = Math.min(lowest, cluster.c.y - cluster.r);
  }
  // More boughs between the limbs fill the crown out.
  for (let i = 0; i < 7; i++) {
    const offset = randomUnit(rng);
    offset.y = Math.abs(offset.y) * 0.9 - 0.15;
    clusters.push({ c: crownCentre.clone().addScaledVector(offset.normalize(), crownRadius * (0.45 + rng() * 0.3)), r: 1.4 + rng() * 0.4, low: false });
  }
  const top = height + 0.6;

  const direction = new THREE.Vector3();
  const side = new THREE.Vector3();
  const base = new THREE.Vector3();
  const outward = new THREE.Vector3();
  const addSpray = (cluster: { c: THREE.Vector3; r: number }, dir: THREE.Vector3, length: number, jitter: number) => {
    const width = length * (0.82 + rng() * 0.18);
    base.copy(cluster.c).addScaledVector(dir, -length * 0.3).add(randomUnit(rng, tmpC).multiplyScalar(cluster.r * 0.4));
    side.crossVectors(dir, randomUnit(rng, tmpC)).normalize();
    const tip = base.clone().addScaledVector(dir, length);
    // Each bough is rounded like a ball (lit above, dim below) within the rounder crown.
    const shadeCentre = cluster.c.clone().lerp(crownCentre, 0.35);
    addCard(leaves, [base.clone(), tip], side, width / 2, pick(atlas.sprays, rng), shadeCentre, 0.75, (p) => {
      const depth = Math.min(1, p.distanceTo(crownCentre) / crownRadius);
      const ao = 0.42 + 0.58 * smoothstep(0.25, 0.95, depth);
      const lift = Math.min(1, Math.max(0, (p.y - lowest) / (top - lowest)));
      const puff = Math.min(1, Math.max(0, ((p.y - cluster.c.y) / cluster.r) * 0.5 + 0.5));
      const value = ao * (0.52 + 0.56 * lift) * (0.62 + 0.5 * puff) * jitter;
      // Upper leaves are brighter and warmer.
      return [value * (1 + 0.08 * lift), value, value * (1 - 0.2 * lift)];
    });
    blobs.push(base.x + dir.x * length * 0.55, base.y + dir.y * length * 0.55, base.z + dir.z * length * 0.55, length * 0.4);
  };
  for (const cluster of clusters) {
    outward.subVectors(cluster.c, axis(cluster.c.y, tmpA));
    if (outward.lengthSq() < 0.01) outward.set(0, 1, 0);
    outward.normalize();
    const count = 13 + Math.floor(rng() * 4);
    for (let k = 0; k < count; k++) {
      randomUnit(rng, direction).addScaledVector(outward, 0.55);
      direction.y += 0.15;
      direction.normalize();
      addSpray(cluster, direction, cluster.r * (0.78 + rng() * 0.42), 0.86 + rng() * 0.26);
    }
    if (cluster.low) {
      // Leaves hanging below the low limbs.
      for (let k = 0; k < 3; k++) {
        direction.copy(outward).multiplyScalar(0.5).add(randomUnit(rng, tmpC).multiplyScalar(0.35));
        direction.y -= 1;
        direction.normalize();
        addSpray(cluster, direction, cluster.r * (0.9 + rng() * 0.3), 0.8 + rng() * 0.2);
      }
    }
  }
  // Big dim branches inside the crown close the gaps.
  for (let k = 0; k < 12; k++) {
    randomUnit(rng, direction);
    direction.y = Math.abs(direction.y) * 0.6;
    direction.normalize();
    const inner = { c: crownCentre.clone().add(randomUnit(rng, tmpC).multiplyScalar(crownRadius * 0.35)), r: 1.2 };
    addSpray(inner, direction, 2.4 + rng() * 0.8, 0.62);
  }

  return { wood: wood.build(), foliage: leaves.build(), blobs, crownRadius, height, girth };
}

/** A full conifer: a straight trunk with whorls of drooping boughs. */
export function coniferHero(seed: number, atlas: ForestAtlas): PlantModel {
  const rng = mulberry32(seed);
  const wood = new MeshBuilder();
  const needles = new MeshBuilder();
  const blobs: number[] = [];

  const height = 16 + rng() * 4;
  const girth = 0.24 + rng() * 0.06;
  const leanX = (rng() - 0.5) * 0.04;
  const leanZ = (rng() - 0.5) * 0.04;
  const axis = (y: number, out = new THREE.Vector3()) => out.set(leanX * y, y, leanZ * y);
  const radiusAt = (y: number) => Math.max(0.03, girth * (1 - 0.93 * Math.min(1, Math.max(0, y) / height)));

  const ys = [-0.35, 0, 0.15, 0.4, 1, 2.5, 5, 8.5, 12.5, height - 0.4];
  const lobePhase = rng() * Math.PI * 2;
  addTube(
    wood,
    ys.map((y) => axis(y)),
    ys.map(radiusAt),
    {
      radial: 10,
      wraps: 1,
      perMetre: 0.55,
      shade: (i) => (0.55 + 0.45 * smoothstep(0, 1, ys[i]!)) * (1 - 0.35 * smoothstep(1.5, 6, ys[i]!)),
      flare: (i, theta) => 1 + 0.7 * Math.exp(-Math.max(-0.4, ys[i]!) / 0.25) * (0.5 + 0.5 * Math.max(0, Math.sin(theta * 5 + lobePhase))),
    },
  );

  const firstWhorl = 1.6 + rng() * 0.6;
  const reach = 3.1 + rng() * 0.6;
  const spin = rng() * Math.PI * 2;
  const out = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const flat = new THREE.Vector3();
  const hang = new THREE.Vector3();
  let whorl = 0;
  for (let y = firstWhorl; y < height - 0.7; whorl++) {
    const f = (y - firstWhorl) / (height - firstWhorl);
    const whorlLength = (reach * Math.pow(1 - f, 0.9) + 0.45) * (0.9 + rng() * 0.2);
    const count = f < 0.6 ? 5 : 4;
    const centre = axis(y - whorlLength * 0.45);
    for (let j = 0; j < count; j++) {
      const azimuth = spin + whorl * 2.399 + (j / count) * Math.PI * 2 + (rng() - 0.5) * 0.45;
      const elevation = -0.3 + f * 0.8 + (rng() - 0.5) * 0.14;
      const length = whorlLength * (0.8 + rng() * 0.4);
      out.set(Math.sin(azimuth), 0, Math.cos(azimuth));
      dir.copy(out).multiplyScalar(Math.cos(elevation)).addScaledVector(UP, Math.sin(elevation));
      const start = axis(y).addScaledVector(out, radiusAt(y) * 0.4);
      const end = start.clone().addScaledVector(dir, length).addScaledVector(UP, -length * 0.2 * (1 - f));
      const points = length > 1.4 ? [start, start.clone().addScaledVector(dir, length * 0.5), end] : [start, end];
      // One card lies along the bough, a second hangs across it: never edge-on.
      flat.crossVectors(dir, UP).normalize();
      hang.crossVectors(flat, dir).normalize();
      const roll = (rng() - 0.5) * 0.7;
      const sideA = flat.clone().multiplyScalar(Math.cos(roll)).addScaledVector(hang, Math.sin(roll));
      const sideB = hang.clone().multiplyScalar(Math.cos(roll)).addScaledVector(flat, -Math.sin(roll));
      const jitter = 0.86 + rng() * 0.24;
      const color = (_p: THREE.Vector3, t: number): Rgb => {
        const value = (0.42 + 0.6 * t) * (0.66 + 0.44 * f) * jitter;
        return [value * 0.95, value, value * 0.94];
      };
      const cell = pick(atlas.boughs, rng);
      addCard(needles, points, sideA, length * 0.25, cell, centre, 0.6, color);
      addCard(needles, points, sideB, length * 0.22, pick(atlas.boughs, rng), centre, 0.6, color);
      blobs.push(start.x + dir.x * length * 0.5, start.y + dir.y * length * 0.5, start.z + dir.z * length * 0.5, length * 0.38);
    }
    y += 0.8 - 0.32 * f + rng() * 0.1;
  }
  // The leading shoot.
  const tipBase = axis(height - 1.5);
  const tipTop = axis(height + 0.3);
  const tipColor = (): Rgb => [1, 1.06, 1];
  addCard(needles, [tipBase, tipTop], tmpA.set(1, 0, 0).clone(), 0.45, atlas.boughs[0]!, axis(height - 3), 0.5, tipColor);
  addCard(needles, [tipBase, tipTop], tmpA.set(0, 0, 1).clone(), 0.45, atlas.boughs[1]!, axis(height - 3), 0.5, tipColor);

  return { wood: wood.build(), foliage: needles.build(), blobs, crownRadius: reach + 0.6, height, girth };
}

// ───────────────────────────────────────────────── mid-distance trees ──

/** A lighter broadleaf tree: a plain trunk and a crown of large foliage cards. */
export function broadleafMid(seed: number, atlas: ForestAtlas): PlantModel {
  const rng = mulberry32(seed);
  const b = new MeshBuilder();
  const blobs: number[] = [];
  const height = 13.5 + rng() * 2;
  const girth = 0.3;
  const ys = [-0.4, 0.35, 2.6, 6, 9.6];
  const radii = [0.46, 0.3, 0.24, 0.16, 0.05];
  const lean = (rng() - 0.5) * 0.5;
  const axis = (y: number, out = new THREE.Vector3()) => out.set((lean * y * y) / 100, y, 0);
  addTube(b, ys.map((y) => axis(y)), radii, { radial: 6, wraps: 1, perMetre: 1, strip: atlas.bark[0]!, shade: (i) => (i === 0 ? 0.5 : 0.85 - i * 0.07) });

  const crownCentre = new THREE.Vector3(0, height * 0.62, 0);
  const crownRadius = 5.2;
  const centres: THREE.Vector3[] = [new THREE.Vector3(0, height - 2.2, 0)];
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + rng() * 0.8;
    centres.push(new THREE.Vector3(Math.sin(angle) * 2.6, height * 0.66 + rng() * 1.2, Math.cos(angle) * 2.6));
  }
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + rng() * 0.8;
    const y = 4.6 + rng() * 2.4;
    const centre = new THREE.Vector3(Math.sin(angle) * 3.4, y, Math.cos(angle) * 3.4);
    centres.push(centre);
    // A limb reaching to the low foliage.
    addTube(b, [axis(y - 1.6), centre.clone().multiplyScalar(0.8)], [0.1, 0.03], { radial: 3, wraps: 1, perMetre: 1, strip: atlas.bark[0]!, shade: () => 0.7 });
  }
  const lowest = 3;
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (const centre of centres) {
    for (let k = 0; k < 5; k++) {
      randomUnit(rng, dir).addScaledVector(tmpA.subVectors(centre, crownCentre).normalize(), 0.6);
      dir.y += 0.15;
      dir.normalize();
      const length = 2.9 + rng() * 1.1;
      const base = centre.clone().addScaledVector(dir, -length * 0.4).add(randomUnit(rng, tmpC).multiplyScalar(0.7));
      side.crossVectors(dir, randomUnit(rng, tmpC)).normalize();
      const jitter = 0.86 + rng() * 0.26;
      addCard(b, [base, base.clone().addScaledVector(dir, length)], side, length / 2, pick(atlas.masses, rng), crownCentre, 0.78, (p) => {
        const ao = 0.45 + 0.55 * smoothstep(0.15, 0.9, p.distanceTo(crownCentre) / crownRadius);
        const lift = Math.min(1, Math.max(0, (p.y - lowest) / (height - lowest)));
        const value = ao * (0.76 + 0.36 * lift) * jitter;
        return [value * (1 + 0.1 * lift), value, value * (1 - 0.2 * lift)];
      });
    }
    blobs.push(centre.x, centre.y, centre.z, 2.1);
  }
  return { wood: null, foliage: b.build(), blobs, crownRadius, height, girth };
}

/** Vertical cards through the trunk that show a whole tree, facing all ways. */
function addCross(b: MeshBuilder, cell: AtlasCell, height: number, width: number, cards: number, spin: number, shade: number): void {
  const centre = new THREE.Vector3(0, height * 0.45, 0);
  const side = new THREE.Vector3();
  for (let i = 0; i < cards; i++) {
    const angle = spin + (i / cards) * Math.PI;
    side.set(Math.cos(angle), 0, Math.sin(angle));
    const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, height * 0.5, 0), new THREE.Vector3(0, height, 0)];
    addCard(b, points, side, width / 2, cell, centre, 0.9, (p) => {
      const value = shade * (0.72 + 0.4 * (p.y / height));
      return [value, value, value];
    });
  }
}

/** A lighter conifer: a whole-tree picture on crossed cards plus a few level boughs. */
export function coniferMid(seed: number, atlas: ForestAtlas): PlantModel {
  const rng = mulberry32(seed);
  const b = new MeshBuilder();
  const height = 17 + rng() * 3;
  const width = height * 0.5;
  addTube(
    b,
    [-0.4, 0.5, 8, height - 1].map((y) => new THREE.Vector3(0, y, 0)),
    [0.36, 0.25, 0.13, 0.03],
    { radial: 5, wraps: 1, perMetre: 1, strip: atlas.bark[1]!, shade: (i) => (i === 0 ? 0.5 : 0.8) },
  );
  addCross(b, atlas.farConifer[seed % atlas.farConifer.length]!, height, width, 3, rng() * Math.PI, 1);
  const out = new THREE.Vector3();
  const side = new THREE.Vector3();
  const blobs: number[] = [];
  for (let i = 0; i < 9; i++) {
    const f = i / 9;
    const y = 2.2 + f * (height - 4.5);
    const angle = i * 2.399 + rng();
    const length = (1 - f) * width * 0.44 + 0.7;
    out.set(Math.sin(angle), -0.22 + f * 0.3, Math.cos(angle)).normalize();
    side.crossVectors(out, UP).normalize();
    const start = new THREE.Vector3(0, y, 0);
    addCard(b, [start, start.clone().addScaledVector(out, length)], side, length * 0.27, pick(atlas.boughs, rng), new THREE.Vector3(0, y - length * 0.5, 0), 0.6, (_p, t) => {
      const value = 0.55 + 0.45 * t;
      return [value, value, value];
    });
    blobs.push(out.x * length * 0.5, y, out.z * length * 0.5, length * 0.6);
  }
  return { wood: null, foliage: b.build(), blobs, crownRadius: width * 0.5, height, girth: 0.25 };
}

// ────────────────────────────────────────────────────────── far trees ──

export function broadleafFar(seed: number, atlas: ForestAtlas): PlantModel {
  const rng = mulberry32(seed);
  const b = new MeshBuilder();
  const height = 15;
  addCross(b, atlas.farBroadleaf[seed % atlas.farBroadleaf.length]!, height, height, 2, rng() * Math.PI, 1);
  return { wood: null, foliage: b.build(), blobs: [0, height * 0.62, 0, 4.5], crownRadius: 6, height, girth: 0.3 };
}

export function coniferFar(seed: number, atlas: ForestAtlas): PlantModel {
  const rng = mulberry32(seed);
  const b = new MeshBuilder();
  const height = 18;
  addCross(b, atlas.farConifer[seed % atlas.farConifer.length]!, height, height * 0.5, 2, rng() * Math.PI, 1);
  return { wood: null, foliage: b.build(), blobs: [0, height * 0.4, 0, 3], crownRadius: 4.5, height, girth: 0.25 };
}

// ──────────────────────────────────────────────────────── undergrowth ──

/** A fern: a rosette of arching fronds. */
export function fern(seed: number, atlas: ForestAtlas): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const b = new MeshBuilder();
  const centre = new THREE.Vector3(0, -0.5, 0);
  const out = new THREE.Vector3();
  const side = new THREE.Vector3();
  const frond = (angle: number, length: number, start: number, jitter: number) => {
    out.set(Math.sin(angle), 0, Math.cos(angle));
    side.set(out.z, 0, -out.x);
    const points = [new THREE.Vector3(out.x * 0.04, 0.02, out.z * 0.04)];
    const segments = 3;
    for (let k = 0; k < segments; k++) {
      const pitch = start - ((k + 0.5) / segments) * (start + 0.55);
      points.push(points[k]!.clone().addScaledVector(out, (Math.cos(pitch) * length) / segments).addScaledVector(UP, (Math.sin(pitch) * length) / segments));
    }
    addCard(b, points, side, length * 0.125, pick(atlas.fronds, rng), centre, 0.55, (_p, t) => {
      const value = (0.5 + 0.6 * t) * jitter;
      return [value, value, value * 0.95];
    });
  };
  const spin = rng() * Math.PI * 2;
  for (let i = 0; i < 7; i++) frond(spin + (i / 7) * Math.PI * 2 + (rng() - 0.5) * 0.5, 0.85 + rng() * 0.35, 0.95 + rng() * 0.2, 0.85 + rng() * 0.3);
  for (let i = 0; i < 4; i++) frond(spin + 0.4 + (i / 4) * Math.PI * 2 + (rng() - 0.5) * 0.6, 0.6 + rng() * 0.25, 1.25 + rng() * 0.15, 0.95 + rng() * 0.25);
  return b.build();
}

/** A shrub: leafy branches rising from one root, about 1.6 m tall. */
export function shrub(seed: number, atlas: ForestAtlas): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const b = new MeshBuilder();
  const centre = new THREE.Vector3(0, 0.25, 0);
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const branch = (angle: number, pitch: number, length: number, shade: number, offset: number) => {
    dir.set(Math.sin(angle) * Math.cos(pitch), Math.sin(pitch), Math.cos(angle) * Math.cos(pitch));
    const base = new THREE.Vector3(Math.sin(angle) * offset, 0.02 + offset * 0.5, Math.cos(angle) * offset);
    side.crossVectors(dir, randomUnit(rng, tmpC)).normalize();
    addCard(b, [base, base.clone().addScaledVector(dir, length)], side, length * 0.46, pick(atlas.shrubs, rng), centre, 0.7, (p, t) => {
      const value = shade * 0.86 * (0.42 + 0.3 * t + 0.34 * Math.min(1, p.y / 1.5));
      return [value, value, value * 0.9];
    });
  };
  const spin = rng() * Math.PI * 2;
  for (let i = 0; i < 9; i++) branch(spin + (i / 9) * Math.PI * 2 + rng() * 0.4, 0.3 + rng() * 0.5, 1.15 + rng() * 0.45, 0.9 + rng() * 0.25, 0.15 + rng() * 0.25);
  for (let i = 0; i < 6; i++) branch(spin + 0.3 + (i / 6) * Math.PI * 2 + rng() * 0.5, 0.9 + rng() * 0.5, 1.25 + rng() * 0.45, 0.95 + rng() * 0.25, rng() * 0.25);
  return b.build();
}

/** A young tree: a thin stem with tiers of leafy branches, about 4 m tall. */
export function sapling(seed: number, atlas: ForestAtlas): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const b = new MeshBuilder();
  const height = 4.2;
  const lean = (rng() - 0.5) * 0.5;
  const axis = (y: number) => new THREE.Vector3((lean * y * y) / 18, y, 0);
  addTube(b, [-0.2, 1.2, 2.8, height].map(axis), [0.07, 0.05, 0.035, 0.012], { radial: 4, wraps: 1, perMetre: 1, strip: atlas.bark[0]!, shade: () => 0.75 });
  const centre = new THREE.Vector3(0, height * 0.55, 0);
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (let i = 0; i < 13; i++) {
    const f = i / 12;
    const y = 1 + f * (height - 1.3);
    const angle = i * 2.399 + rng() * 0.6;
    const pitch = 0.1 + f * 0.9 + (rng() - 0.5) * 0.3;
    dir.set(Math.sin(angle) * Math.cos(pitch), Math.sin(pitch), Math.cos(angle) * Math.cos(pitch));
    const length = (1.75 - f * 0.7) * (0.85 + rng() * 0.3);
    const base = axis(y).addScaledVector(dir, -0.1);
    // Mostly level sprays, like the layered leaves of a young beech.
    side.crossVectors(dir, UP).normalize().addScaledVector(randomUnit(rng, tmpC), 0.45).normalize();
    const jitter = 0.88 + rng() * 0.26;
    addCard(b, [base, base.clone().addScaledVector(dir, length)], side, length * 0.48, pick(atlas.sprays, rng), centre, 0.6, (p, t) => {
      const value = (0.5 + 0.3 * t + 0.3 * (p.y / height)) * jitter;
      return [value * 1.05, value, value * 0.86];
    });
  }
  return b.build();
}

/** A boulder: a lumpy, flattened ball with moss on top. */
export function rock(seed: number): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const source = new THREE.IcosahedronGeometry(1, 3);
  source.deleteAttribute('uv');
  source.deleteAttribute('normal');
  const geometry = mergeVertices(source, 1e-4);
  source.dispose();
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  // A few random planes cut and push the ball into a faceted, natural lump.
  const cuts: { n: THREE.Vector3; d: number }[] = [];
  for (let i = 0; i < 7; i++) cuts.push({ n: randomUnit(rng), d: 0.55 + rng() * 0.3 });
  const waves = [randomUnit(rng).multiplyScalar(2.3), randomUnit(rng).multiplyScalar(3.7), randomUnit(rng).multiplyScalar(6.1)];
  const p = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    let radius = 1 + 0.16 * Math.sin(p.dot(waves[0]!) + 1) + 0.09 * Math.sin(p.dot(waves[1]!) + 2) + 0.04 * Math.sin(p.dot(waves[2]!));
    for (const cut of cuts) {
      const along = p.dot(cut.n) * radius;
      if (along > cut.d) radius *= 1 - (1 - cut.d / along) * 0.75;
    }
    p.multiplyScalar(radius);
    p.y = p.y * 0.62 + 0.2;
    position.setXYZ(i, p.x * 0.5, p.y * 0.5, p.z * 0.5);
  }
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const uv = new Float32Array(position.count * 2);
  const color = new Float32Array(position.count * 3);
  const n = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    n.fromBufferAttribute(normal, i);
    uv[i * 2] = p.x * 0.9 + p.y * 0.45;
    uv[i * 2 + 1] = p.z * 0.9 + p.y * 0.45;
    // Moss where the stone faces up, damp darkness near the ground.
    const moss = smoothstep(0.45, 0.85, n.y + 0.12 * Math.sin(p.x * 9 + p.z * 7));
    const ground = 0.5 + 0.5 * smoothstep(0, 0.16, p.y);
    color[i * 3] = ground * (1 - moss * 0.62);
    color[i * 3 + 1] = ground * (1 - moss * 0.3);
    color[i * 3 + 2] = ground * (1 - moss * 0.78);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return geometry;
}

/** A fallen log lying along x, resting on the ground. */
export function log(seed: number): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const b = new MeshBuilder();
  const length = 4.6;
  const radius = 0.26;
  const xs = [-length / 2, -length / 2 + 0.02, -1.2, 0.4, length / 2 - 0.02, length / 2];
  const sag = rng() * 0.05;
  addTube(
    b,
    xs.map((x) => new THREE.Vector3(x, radius * 0.82 - sag * Math.cos((x / length) * Math.PI), 0)),
    [0.001, radius, radius * 0.96, radius * 0.9, radius * 0.84, 0.001],
    { radial: 10, wraps: 1, perMetre: 0.5, shade: (i) => (i === 0 || i === xs.length - 1 ? 0.45 : 1) },
  );
  const geometry = b.build();
  // Moss along the top, darkness underneath.
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const color = geometry.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const lift = position.getY(i) / (radius * 1.8);
    const moss = smoothstep(0.62, 0.95, lift + 0.1 * Math.sin(position.getX(i) * 5));
    const value = color.getX(i) * (0.45 + 0.55 * smoothstep(0.05, 0.5, lift));
    color.setXYZ(i, value * (1 - moss * 0.5), value * (1 - moss * 0.12), value * (1 - moss * 0.7));
  }
  return geometry;
}
