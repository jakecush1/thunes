/**
 * Geometry for the desert's scenery: weathered boulders, sandstone buttes,
 * saguaro cacti and the crossed cards that carry dry grass and shrubs.
 * Every shape has its origin where it meets the sand; what lies below y = 0 is
 * buried.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './shared';

function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 1440662683) + Math.imul(seed, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1. */
function noise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const x00 = lerp(hash3(ix, iy, iz, seed), hash3(ix + 1, iy, iz, seed), ux);
  const x10 = lerp(hash3(ix, iy + 1, iz, seed), hash3(ix + 1, iy + 1, iz, seed), ux);
  const x01 = lerp(hash3(ix, iy, iz + 1, seed), hash3(ix + 1, iy, iz + 1, seed), ux);
  const x11 = lerp(hash3(ix, iy + 1, iz + 1, seed), hash3(ix + 1, iy + 1, iz + 1, seed), ux);
  return lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz);
}

function fbm3(x: number, y: number, z: number, seed: number): number {
  return noise3(x, y, z, seed) * 0.55 + noise3(x * 2.2 + 3.1, y * 2.2 + 7.3, z * 2.2 + 1.9, seed + 1) * 0.3 + noise3(x * 4.7 + 9.2, y * 4.7 + 2.6, z * 4.7 + 5.5, seed + 2) * 0.15;
}

// ─────────────────────────────────────────────────────────────── rocks ──

/**
 * A boulder about 1 m in radius: a sphere broken along a few random planes
 * (fracture faces), swollen and pitted with noise, then set a third into the
 * ground. Indexed, with smooth normals and a cavity tint in the vertex colours.
 */
export function buildRock(seed: number, detail: number, flatness = 0): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const ball = new THREE.IcosahedronGeometry(1, detail);
  ball.deleteAttribute('uv');
  ball.deleteAttribute('normal');
  const geometry = mergeVertices(ball, 1e-4);
  ball.dispose();

  const planes: { n: THREE.Vector3; d: number }[] = [];
  const cuts = 7 + Math.floor(rng() * 4);
  for (let i = 0; i < cuts; i++) {
    const y = rng() * 1.7 - 0.7;
    const a = rng() * Math.PI * 2;
    const n = new THREE.Vector3(Math.cos(a), y, Math.sin(a)).normalize();
    planes.push({ n, d: 0.5 + rng() * 0.36 });
  }
  const stretch = new THREE.Vector3(1 + rng() * 0.45, (0.66 + rng() * 0.3) * (1 - 0.45 * flatness), 0.78 + rng() * 0.4);
  const lift = 0.2 + rng() * 0.16;

  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).normalize();
    q.copy(p);
    for (const plane of planes) {
      const over = q.dot(plane.n) - plane.d;
      if (over > 0) q.addScaledVector(plane.n, -over);
    }
    const lump = fbm3(p.x * 1.4 + 11, p.y * 1.4 + 5, p.z * 1.4 + 3, seed);
    const pit = fbm3(p.x * 4.6, p.y * 4.6, p.z * 4.6, seed + 9);
    const crack = Math.abs(noise3(p.x * 3.1 + 2, p.y * 3.1, p.z * 3.1 + 8, seed + 17) - 0.5) * 2;
    q.multiplyScalar(1 + (lump - 0.5) * 0.42);
    q.addScaledVector(p, (pit - 0.5) * 0.11 - Math.max(0, 0.12 - crack) * 0.5);
    q.multiply(stretch);
    q.y += lift * stretch.y;
    position.setXYZ(i, q.x, q.y, q.z);
    // Hollows and cracks are darker, bulges lighter.
    const shade = 0.8 + (pit - 0.5) * 0.5 + (lump - 0.5) * 0.25 - Math.max(0, 0.14 - crack) * 2.2;
    const warm = 0.96 + noise3(p.x * 2.3, p.y * 2.3 + 4, p.z * 2.3, seed + 31) * 0.1;
    colors[i * 3] = Math.max(0.3, shade * warm);
    colors[i * 3 + 1] = Math.max(0.3, shade);
    colors[i * 3 + 2] = Math.max(0.3, shade * (2 - warm) * 0.98);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// ────────────────────────────────────────────────────────────── buttes ──

export interface ButteShape {
  /** Radius of the cliff at its base, metres. */
  radius: number;
  /** Height of the cap above the sand, metres. */
  height: number;
  /** Stretch along local X (a mesa is a long butte). */
  elongation: number;
  seed: number;
}

/**
 * [height fraction, radius factor, stratum] rows from the buried skirt up to the cap. A row listed twice makes a
 * crease: the two copies get their own normals and colours, so ledges and the foot of the cliff stay sharp.
 */
const BUTTE_PROFILE: readonly (readonly [number, number, number])[] = [
  [-0.1, 1.92, 0],
  [0, 1.72, 0],
  [0.08, 1.46, 0],
  [0.16, 1.25, 0],
  [0.23, 1.1, 0],
  [0.28, 1.0, 0],
  [0.28, 1.0, 1],
  [0.36, 0.992, 1],
  [0.44, 0.986, 1],
  [0.5, 0.98, 1],
  [0.5, 0.98, 2],
  [0.505, 0.925, 2],
  [0.505, 0.925, 2],
  [0.58, 0.92, 2],
  [0.66, 0.915, 2],
  [0.66, 0.915, 3],
  [0.665, 0.865, 3],
  [0.665, 0.865, 3],
  [0.74, 0.86, 3],
  [0.82, 0.855, 3],
  [0.82, 0.855, 4],
  [0.825, 0.81, 4],
  [0.825, 0.81, 4],
  [0.9, 0.805, 4],
  [0.975, 0.8, 4],
  [1.0, 0.765, 4],
  [1.0, 0.765, 5],
  [1.004, 0.4, 5],
  [1.006, 0, 5],
];

/** Tint of each stratum (multiplies the rock photograph): scree, then alternating beds, then the cap. */
const STRATA: readonly (readonly [number, number, number])[] = [
  [1.2, 1.08, 0.95],
  [0.95, 0.74, 0.66],
  [1.3, 1.14, 0.98],
  [1.0, 0.78, 0.68],
  [1.24, 1.02, 0.86],
  [1.12, 0.94, 0.82],
];

/**
 * A sandstone butte: a scree apron under a stepped cliff of horizontal beds,
 * fluted by erosion, with a level cap. Indexed, smooth normals, strata in the
 * vertex colours.
 */
export function buildButte(shape: ButteShape): THREE.BufferGeometry {
  const AROUND = 84;
  const rows = BUTTE_PROFILE.length;
  const positions = new Float32Array(rows * AROUND * 3);
  const colors = new Float32Array(rows * AROUND * 3);
  const { seed } = shape;
  for (let j = 0; j < AROUND; j++) {
    const angle = (j / AROUND) * Math.PI * 2;
    const cx = Math.cos(angle);
    const cz = Math.sin(angle);
    // Plan outline: lobes and bays.
    const outline = 1 + (fbm3(cx * 1.3 + 4, cz * 1.3 + 9, 0.5, seed) - 0.5) * 0.7 + (noise3(cx * 3.4, cz * 3.4, 2.5, seed + 5) - 0.5) * 0.2;
    // The beds are not quite level: they rise and dip a little around the butte.
    const bedding = (noise3(cx * 1.6 + 7, cz * 1.6, 3.3, seed + 41) - 0.5) * 0.07;
    for (let i = 0; i < rows; i++) {
      const [v, factor, stratum] = BUTTE_PROFILE[i]!;
      // 0 on the scree, 1 on the cliff. Relief depends on the position only, so creased rows stay welded.
      const cliff = Math.min(1, Math.max(0, (v - 0.27) / 0.02));
      // Vertical flutes and buttresses on the cliff; shallow gullies in the scree.
      const flute = Math.abs(noise3(cx * 7.5 + 20, cz * 7.5 + 3, v * 1.1, seed + 11) - 0.5) * 2;
      const fine = noise3(cx * 17, cz * 17, v * 5, seed + 13) - 0.5;
      const relief = cliff * ((flute - 0.45) * 0.12 + fine * 0.04) + (1 - cliff) * (flute - 0.5) * 0.07 * (0.3 + Math.max(0, v) * 2.5);
      // The scree fans out more evenly than the cliff above it.
      const plan = 1 + (outline - 1) * (0.45 + 0.55 * Math.min(1, Math.max(0, v) / 0.28));
      const radius = shape.radius * Math.max(0, factor * plan + (factor > 0 ? relief : 0));
      const k = (i * AROUND + j) * 3;
      positions[k] = cx * radius * shape.elongation;
      positions[k + 1] = (v + bedding * cliff * (factor > 0.7 ? 1 : 0.4)) * shape.height;
      positions[k + 2] = cz * radius;
      const tint = STRATA[stratum]!;
      // Thin darker seams and streaks inside each bed.
      const streak = 0.9 + noise3(cx * 2.2, cz * 2.2, v * 26 + stratum, seed + 29) * 0.2 - cliff * Math.max(0, 0.5 - flute) * 0.2;
      colors[k] = tint[0] * streak;
      colors[k + 1] = tint[1] * streak;
      colors[k + 2] = tint[2] * streak;
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < AROUND; j++) {
      const a = i * AROUND + j;
      const b = i * AROUND + ((j + 1) % AROUND);
      const c = a + AROUND;
      const d = b + AROUND;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// ────────────────────────────────────────────────────────────── cactus ──

const RIBS = 14;
const PER_RIB = 4;
/** Length of one repeat of the skin texture along a limb, metres. */
const SKIN_TILE = 0.14;

interface LimbSink {
  positions: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
  /** [first vertex, ring count] of each limb, for the normal seam. */
  limbs: [number, number][];
}

/** Sweeps a ribbed tube along `points` and closes it with a dome. */
function addLimb(sink: LimbSink, points: THREE.Vector3[], radii: number[], phase: number, tint: (t: number) => readonly [number, number, number]): void {
  const path = points.map((point) => point.clone());
  const size = radii.slice();
  // Dome: carry on along the last direction while the radius closes.
  const end = path[path.length - 1]!;
  const direction = end.clone().sub(path[path.length - 2]!).normalize();
  const tip = size[size.length - 1]!;
  for (const degrees of [20, 40, 58, 74, 86]) {
    const a = (degrees * Math.PI) / 180;
    path.push(end.clone().addScaledVector(direction, Math.sin(a) * tip * 0.9));
    size.push(Math.cos(a) * tip);
  }

  const around = RIBS * PER_RIB;
  const first = sink.positions.length / 3;
  const tangent = path[1]!.clone().sub(path[0]!).normalize();
  const reference = Math.abs(tangent.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3().crossVectors(tangent, reference).normalize();
  const binormal = new THREE.Vector3().crossVectors(tangent, normal);
  const next = new THREE.Vector3();
  const axis = new THREE.Vector3();
  let length = 0;
  for (let i = 0; i < path.length; i++) {
    if (i > 0) {
      // Parallel transport keeps the ribs from twisting around bends.
      next.copy(path[Math.min(path.length - 1, i + 1)]!).sub(path[i - 1]!).normalize();
      axis.crossVectors(tangent, next);
      const sine = axis.length();
      if (sine > 1e-6) normal.applyAxisAngle(axis.divideScalar(sine), Math.asin(Math.min(1, sine)));
      tangent.copy(next);
      normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
      binormal.crossVectors(tangent, normal);
      length += path[i]!.distanceTo(path[i - 1]!);
    }
    const t = i / (path.length - 1);
    const [r, g, b] = tint(t);
    for (let j = 0; j <= around; j++) {
      const theta = (j / around) * Math.PI * 2 + phase;
      const ridge = Math.abs(Math.sin((Math.PI * j) / PER_RIB));
      const radius = size[i]! * (1 - 0.2 * (1 - ridge));
      const c = Math.cos(theta) * radius;
      const s = Math.sin(theta) * radius;
      const point = path[i]!;
      sink.positions.push(point.x + normal.x * c + binormal.x * s, point.y + normal.y * c + binormal.y * s, point.z + normal.z * c + binormal.z * s);
      sink.uvs.push(j / PER_RIB, length / SKIN_TILE);
      // Grooves between the ribs sit in their own shade.
      const shade = 0.42 + 0.58 * Math.pow(ridge, 0.7);
      sink.colors.push(r * shade, g * shade, b * shade);
    }
  }
  const ring = around + 1;
  for (let i = 0; i < path.length - 1; i++) {
    for (let j = 0; j < around; j++) {
      const a = first + i * ring + j;
      const b = a + 1;
      const c = a + ring;
      const d = c + 1;
      sink.indices.push(a, b, c, b, d, c);
    }
  }
  sink.limbs.push([first, path.length]);
}

export interface CactusArm {
  /** Height on the trunk where the arm leaves, metres. */
  at: number;
  /** Compass direction of the arm, radians. */
  heading: number;
  /** How far the elbow stands off the trunk, metres. */
  reach: number;
  /** Length of the upright part, metres. */
  rise: number;
  radius: number;
}

export interface CactusShape {
  height: number;
  radius: number;
  arms: readonly CactusArm[];
  seed: number;
}

/** A saguaro: a pleated column with upturned arms. Indexed, smooth normals, UVs for the skin texture. */
export function buildCactus(shape: CactusShape): THREE.BufferGeometry {
  const rng = mulberry32(shape.seed);
  const sink: LimbSink = { positions: [], uvs: [], colors: [], indices: [], limbs: [] };
  const lean = new THREE.Vector2((rng() - 0.5) * 0.09, (rng() - 0.5) * 0.09);
  const axisAt = (y: number): THREE.Vector3 => {
    const t = y / shape.height;
    return new THREE.Vector3(lean.x * y * t, y, lean.y * y * t);
  };
  // Older skin near the ground is yellower and corky; the crown is fresher.
  const trunkTint = (t: number): readonly [number, number, number] => {
    const age = Math.max(0, 1 - t * 3.2);
    return [0.92 + 0.2 * age, 1 - 0.08 * age, 0.94 - 0.3 * age];
  };
  const trunk: THREE.Vector3[] = [];
  const trunkRadii: number[] = [];
  const STEPS = 12;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const y = -0.35 + (shape.height - shape.radius * 0.9 + 0.35) * t;
    trunk.push(axisAt(y));
    // Slightly waisted at the foot, fullest two thirds up.
    trunkRadii.push(shape.radius * (0.86 + 0.2 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.62) - 0.08 * t * t));
  }
  addLimb(sink, trunk, trunkRadii, rng() * Math.PI, trunkTint);

  for (const arm of shape.arms) {
    const out = new THREE.Vector3(Math.cos(arm.heading), 0, Math.sin(arm.heading));
    const root = axisAt(arm.at);
    const bend = arm.radius * 1.9;
    const stand = shape.radius * 0.6 + arm.reach;
    const points: THREE.Vector3[] = [];
    const radii: number[] = [];
    points.push(root.clone().addScaledVector(out, shape.radius * 0.15));
    radii.push(arm.radius * 0.82);
    points.push(root.clone().addScaledVector(out, stand * 0.55).add(new THREE.Vector3(0, 0.03, 0)));
    radii.push(arm.radius * 0.9);
    for (let k = 0; k <= 5; k++) {
      const a = (k / 5) * Math.PI * 0.5;
      points.push(
        root
          .clone()
          .addScaledVector(out, stand + Math.sin(a) * bend)
          .add(new THREE.Vector3(0, 0.06 + (1 - Math.cos(a)) * bend, 0)),
      );
      radii.push(arm.radius * (0.94 + 0.06 * k / 5));
    }
    const elbow = points[points.length - 1]!;
    const sway = new THREE.Vector3((rng() - 0.5) * 0.1, 0, (rng() - 0.5) * 0.1);
    for (let k = 1; k <= 4; k++) {
      const t = k / 4;
      points.push(elbow.clone().add(new THREE.Vector3(sway.x * t * t * arm.rise, arm.rise * t, sway.z * t * t * arm.rise)));
      radii.push(arm.radius * (1 - 0.08 * t));
    }
    addLimb(sink, points, radii, rng() * Math.PI, () => [0.95, 1, 0.92]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(sink.positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(sink.uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(sink.colors, 3));
  geometry.setIndex(sink.indices);
  geometry.computeVertexNormals();
  // The UV seam doubles one line of vertices per limb: give both copies the same normal.
  const normals = geometry.getAttribute('normal');
  const around = RIBS * PER_RIB;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (const [first, rings] of sink.limbs) {
    for (let i = 0; i < rings; i++) {
      const start = first + i * (around + 1);
      const finish = start + around;
      a.fromBufferAttribute(normals, start);
      b.fromBufferAttribute(normals, finish);
      a.add(b).normalize();
      normals.setXYZ(start, a.x, a.y, a.z);
      normals.setXYZ(finish, a.x, a.y, a.z);
    }
  }
  return geometry;
}

/**
 * Skin for the cactus: waxy green with a spine cluster on the rib's crest.
 * One tile spans a single rib (u) and SKIN_TILE metres of limb (v).
 */
export function createCactusSkin(): THREE.CanvasTexture {
  const W = 64;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const context = canvas.getContext('2d')!;
  const rng = mulberry32(77);
  context.fillStyle = '#667a5c';
  context.fillRect(0, 0, W, H);
  // Mottling: pale wax bloom and darker flecks.
  for (let i = 0; i < 260; i++) {
    const light = rng() > 0.45;
    context.fillStyle = light ? `rgba(146, 162, 130, ${0.05 + rng() * 0.1})` : `rgba(58, 74, 52, ${0.05 + rng() * 0.12})`;
    const size = 1 + rng() * 5;
    context.beginPath();
    context.ellipse(rng() * W, rng() * H, size * 0.6, size * (1 + rng() * 2), 0, 0, Math.PI * 2);
    context.fill();
  }
  // A paler line along the crest of the rib.
  const crest = context.createLinearGradient(0, 0, W, 0);
  crest.addColorStop(0.3, 'rgba(176, 186, 150, 0)');
  crest.addColorStop(0.5, 'rgba(176, 186, 150, 0.4)');
  crest.addColorStop(0.7, 'rgba(176, 186, 150, 0)');
  context.fillStyle = crest;
  context.fillRect(0, 0, W, H);
  // Areoles with their spines, drawn wrapped so the tile repeats along the limb.
  for (const y of [H * 0.25, H * 0.75]) {
    for (const wrap of [-H, 0, H]) {
      context.strokeStyle = 'rgba(232, 222, 196, 0.85)';
      context.lineWidth = 1.2;
      for (let s = 0; s < 11; s++) {
        const a = (s / 11) * Math.PI * 2 + rng() * 0.4;
        const length = 9 + rng() * 9;
        context.beginPath();
        context.moveTo(W / 2, y + wrap);
        context.lineTo(W / 2 + Math.cos(a) * length, y + wrap + Math.sin(a) * length * 1.4);
        context.stroke();
      }
      context.fillStyle = '#d9cdae';
      context.beginPath();
      context.arc(W / 2, y + wrap, 4, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#8f7f5e';
      context.beginPath();
      context.arc(W / 2, y + wrap, 1.7, 0, Math.PI * 2);
      context.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

// ─────────────────────────────────────────────────────────────── cards ──

/**
 * Three upright unit cards crossed through one stem (1 m wide, 1 m tall, foot
 * at the origin). The normals lean up and outward like a dome, so a clump is
 * lit as one soft shape rather than as separate planes.
 */
export function buildCards(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const n = new THREE.Vector3();
  for (let k = 0; k < 3; k++) {
    const angle = (k / 3) * Math.PI + 0.3;
    const dx = Math.cos(angle) * 0.5;
    const dz = Math.sin(angle) * 0.5;
    const first = positions.length / 3;
    for (const [side, y] of [
      [-1, 0],
      [1, 0],
      [1, 1],
      [-1, 1],
    ] as const) {
      positions.push(dx * side, y, dz * side);
      n.set(dx * side * 1.1, 0.75 + y * 0.5, dz * side * 1.1).normalize();
      normals.push(n.x, n.y, n.z);
      uvs.push(side * 0.5 + 0.5, y);
    }
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}
