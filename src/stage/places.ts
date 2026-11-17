/**
 * Places: the 3D scenery that surrounds the stage for the 'place' backdrops.
 *
 *   forest — conifers, broadleaf trees, shrubs and rocks around a clearing
 *   city   — blocks of concrete buildings with lit windows, parked cars, streetlights
 *   desert — sand dunes, cacti, boulders and distant mesas
 *   ocean  — a sailboat (the dancers stand on its deck) on reflective water
 *
 * Everything is built in code from a fixed seed, so a place looks the same on
 * every visit. Scenery stays outside the stage (dancers can stand anywhere
 * within STAGE_RADIUS) and out of the corridor between the default camera and
 * the stage. Places are built on first use and kept, so switching is instant.
 */
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import logoUrl from '../ui/brand/thunes-logo.webp';
import { resolveBackground } from './backgrounds';
import type { PlaceKind } from './backgrounds';
import { SAND_MID } from './floor';
import { exposureGain } from './lighting';
import type { StageContext, StageSystem } from './system';
import waterNormalsUrl from './textures/waternormals.jpg';

interface Place {
  object: THREE.Object3D;
  /** Per-frame animation. `time` is seconds since the app started. */
  update?(time: number): void;
  /** Follow the exposure slider for parts drawn without tone mapping. */
  setGain?(gain: number): void;
  dispose(): void;
}

/** Direction to the sun of the daytime ('clouds') sky. */
const DAY_SUN = new THREE.Vector3(-0.45, 0.62, -0.64).normalize();

// ───────────────────────────────────────────────────────────── helpers ──

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** True inside the wedge that must stay clear between the default camera (on +Z) and the stage. */
function inCorridor(x: number, z: number): boolean {
  return z > 2 && z < 34 && Math.abs(x) < 3.5 + (z - 2) * 0.6;
}

/** A non-indexed copy of `geometry` with one vertex colour; the original is disposed. */
function tinted(geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  const color = new THREE.Color(hex);
  const count = flat.getAttribute('position').count;
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    data[i * 3] = color.r;
    data[i * 3 + 1] = color.g;
    data[i * 3 + 2] = color.b;
  }
  flat.setAttribute('color', new THREE.BufferAttribute(data, 3));
  return flat;
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geometry = mergeGeometries(parts, false);
  if (!geometry) throw new Error('Scenery geometry could not be merged.');
  for (const part of parts) part.dispose();
  return geometry;
}

interface Spot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
  /** Brightness/tint multiplier. */
  color: THREE.Color;
}

function spot(x: number, z: number, scale: number, yaw = 0, color = new THREE.Color(1, 1, 1)): Spot {
  return { x, y: 0, z, yaw, sx: scale, sy: scale, sz: scale, color };
}

const UP = new THREE.Vector3(0, 1, 0);

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, spots: readonly Spot[], name: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
  mesh.name = name;
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  spots.forEach((s, i) => {
    rotation.setFromAxisAngle(UP, s.yaw);
    matrix.compose(position.set(s.x, s.y, s.z), rotation, scale.set(s.sx, s.sy, s.sz));
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, s.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  // Scenery surrounds the camera: culling the whole batch would never succeed.
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

interface ScatterOptions {
  count: number;
  /** Distance from the stage centre, metres. */
  near: number;
  far: number;
  /** Minimum distance between two items. */
  gap: number;
  /** > 1 crowds items toward `near`. */
  bias?: number;
}

/** Random positions in a ring around the stage, keeping the camera corridor and earlier items clear. */
function scatter(rng: () => number, occupied: { x: number; z: number; r: number }[], options: ScatterOptions): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const bias = options.bias ?? 1.6;
  for (let attempt = 0; out.length < options.count && attempt < options.count * 40; attempt++) {
    const angle = rng() * Math.PI * 2;
    const distance = options.near + Math.pow(rng(), bias) * (options.far - options.near);
    const x = Math.sin(angle) * distance;
    const z = Math.cos(angle) * distance;
    if (inCorridor(x, z)) continue;
    let free = true;
    for (const other of occupied) {
      const dx = other.x - x;
      const dz = other.z - z;
      const reach = other.r + options.gap;
      if (dx * dx + dz * dz < reach * reach) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    occupied.push({ x, z, r: options.gap });
    out.push({ x, z });
  }
  return out;
}

/** Collects everything a place must free. */
function createBin() {
  const items: { dispose(): void }[] = [];
  return {
    add<T extends { dispose(): void }>(item: T): T {
      items.push(item);
      return item;
    },
    dispose(): void {
      for (const item of items) item.dispose();
      items.length = 0;
    },
  };
}

/** Lambert material for instanced, vertex-coloured, flat-shaded scenery. */
function sceneryMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
}

/** Adds a gentle wind sway to an instanced material (each instance gets its own phase). */
function addSway(material: THREE.Material, time: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSwayTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uSwayTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float swayPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
          float swayAmount = position.y * position.y * 0.03;
          transformed.x += sin(uSwayTime * 1.1 + swayPhase) * swayAmount;
          transformed.z += cos(uSwayTime * 0.83 + swayPhase * 1.7) * swayAmount * 0.6;
        #endif`,
      );
  };
  material.customProgramCacheKey = () => 'thunes-sway';
}

// ────────────────────────────────────────────────────────────── forest ──

function buildForest(): Place {
  const rng = mulberry32(7);
  const bin = createBin();
  const group = new THREE.Group();
  group.name = 'place-forest';
  const time = { value: 0 };

  const foliage = bin.add(sceneryMaterial());
  addSway(foliage, time);
  const stone = bin.add(sceneryMaterial());

  // Unit-height trees (scaled per instance).
  const conifer = bin.add(
    merged([
      tinted(new THREE.CylinderGeometry(0.035, 0.05, 0.3, 6).translate(0, 0.15, 0), 0x5b4026),
      tinted(new THREE.ConeGeometry(0.27, 0.46, 7).translate(0, 0.45, 0), 0x245a2a),
      tinted(new THREE.ConeGeometry(0.21, 0.4, 7).translate(0, 0.7, 0), 0x2b6a31),
      tinted(new THREE.ConeGeometry(0.14, 0.34, 7).translate(0, 0.93, 0), 0x347a38),
    ]),
  );
  const broadleaf = bin.add(
    merged([
      tinted(new THREE.CylinderGeometry(0.04, 0.06, 0.5, 6).translate(0, 0.25, 0), 0x6a4a2c),
      tinted(new THREE.IcosahedronGeometry(0.3, 1).translate(0, 0.72, 0), 0x3f8a36),
      tinted(new THREE.IcosahedronGeometry(0.22, 1).translate(0.2, 0.56, 0.08), 0x357a30),
      tinted(new THREE.IcosahedronGeometry(0.2, 1).translate(-0.17, 0.6, -0.1), 0x4a9a3c),
    ]),
  );
  const shrub = bin.add(
    merged([
      tinted(new THREE.IcosahedronGeometry(0.5, 1).scale(1, 0.7, 1).translate(0, 0.3, 0), 0x3c7d33),
      tinted(new THREE.IcosahedronGeometry(0.32, 1).scale(1, 0.75, 1).translate(0.36, 0.22, 0.1), 0x4c9040),
    ]),
  );
  const rock = bin.add(tinted(new THREE.IcosahedronGeometry(0.5, 0).scale(1, 0.6, 0.85).translate(0, 0.2, 0), 0x8c8b85));

  const occupied: { x: number; z: number; r: number }[] = [];
  const shade = (base: number, spread: number) => new THREE.Color().setScalar(base + rng() * spread);

  const conifers: Spot[] = scatter(rng, occupied, { count: 170, near: 11, far: 85, gap: 2.4 }).map((p) => {
    const height = 8 + rng() * 7;
    const s = spot(p.x, p.z, height, rng() * Math.PI * 2, shade(0.75, 0.5));
    s.sx = s.sz = height * (0.9 + rng() * 0.3);
    return s;
  });
  const broadleaves: Spot[] = scatter(rng, occupied, { count: 120, near: 10.5, far: 75, gap: 2.8 }).map((p) => {
    const height = 5.5 + rng() * 4.5;
    const s = spot(p.x, p.z, height, rng() * Math.PI * 2, shade(0.8, 0.45));
    s.sx = s.sz = height * (1.1 + rng() * 0.4);
    return s;
  });
  const shrubs: Spot[] = scatter(rng, occupied, { count: 260, near: 7.2, far: 62, gap: 0.9 }).map((p) => {
    const s = spot(p.x, p.z, 0.7 + rng() * 1.3, rng() * Math.PI * 2, shade(0.75, 0.5));
    s.sy *= 0.8 + rng() * 0.5;
    return s;
  });
  const rocks: Spot[] = scatter(rng, occupied, { count: 45, near: 7.4, far: 50, gap: 0.8 }).map((p) =>
    spot(p.x, p.z, 0.5 + rng() * 1.4, rng() * Math.PI * 2, shade(0.8, 0.35)),
  );

  // Soft dark discs under the trees stand in for their shadows.
  const discGeometry = bin.add(new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2));
  const discMaterial = bin.add(new THREE.MeshBasicMaterial({ color: 0x0b1a08, transparent: true, opacity: 0.26, depthWrite: false }));
  const discs: Spot[] = [...conifers, ...broadleaves].map((tree) => {
    const s = spot(tree.x, tree.z, tree.sx * 0.3);
    s.y = 0.03;
    return s;
  });
  const discMesh = instanced(discGeometry, discMaterial, discs, 'forest-shade');
  discMesh.renderOrder = -18;

  const meshes = [
    discMesh,
    instanced(conifer, foliage, conifers, 'forest-conifers'),
    instanced(broadleaf, foliage, broadleaves, 'forest-broadleaves'),
    instanced(shrub, foliage, shrubs, 'forest-shrubs'),
    instanced(rock, stone, rocks, 'forest-rocks'),
  ];
  for (const mesh of meshes) {
    bin.add(mesh);
    group.add(mesh);
  }

  return {
    object: group,
    update(seconds) {
      time.value = seconds % 3600;
    },
    dispose: () => bin.dispose(),
  };
}

// ──────────────────────────────────────────────────────────────── city ──

/** Half-width of the two streets that cross at the stage, metres. */
const STREET = 8.5;

const BUILDING_VERTEX_HEAD = /* glsl */ `
varying vec3 vBWorld;
varying vec3 vBNormal;
varying float vBHeight;
varying float vBSeed;
`;
const BUILDING_VERTEX_BODY = /* glsl */ `
#ifdef USE_INSTANCING
  vBWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  vBHeight = length(instanceMatrix[1].xyz);
  vBSeed = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.91;
#else
  vBWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vBHeight = 10.0;
  vBSeed = 0.0;
#endif
vBNormal = normal;
`;
const BUILDING_FRAGMENT_HEAD = /* glsl */ `
varying vec3 vBWorld;
varying vec3 vBNormal;
varying float vBHeight;
varying float vBSeed;
float bHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;
/** Rows of windows on the walls: dark glass, a share of them lit warm. Far away they blend into their average. */
const BUILDING_FRAGMENT_BODY = /* glsl */ `
vec3 windowGlow = vec3(0.0);
{
  vec3 bn = abs(vBNormal);
  if (bn.y < 0.5) {
    float along = bn.x > 0.5 ? vBWorld.z : vBWorld.x;
    vec2 cell = vec2(along / 2.6, vBWorld.y / 3.2);
    vec2 id = floor(cell);
    vec2 f = fract(cell);
    vec2 w = fwidth(cell) * 1.2;
    vec2 pane = smoothstep(vec2(0.2, 0.3) - w, vec2(0.2, 0.3) + w, f) * (1.0 - smoothstep(vec2(0.8, 0.84) - w, vec2(0.8, 0.84) + w, f));
    float blur = clamp(max(w.x, w.y) * 2.5 - 0.35, 0.0, 1.0);
    float win = mix(pane.x * pane.y, 0.32, blur);
    // No windows on the ground floor or the parapet.
    win *= step(3.2, vBWorld.y) * step(1.6, vBHeight - vBWorld.y);
    float lit = mix(step(0.56, bHash(id + vBSeed)), 0.44, blur);
    vec3 glass = mix(vec3(0.05, 0.07, 0.11), vec3(0.14, 0.18, 0.26), bHash(id * 1.7 + vBSeed + 3.0));
    diffuseColor.rgb *= mix(0.7, 1.0, step(3.2, vBWorld.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, glass, win);
    windowGlow = win * lit * mix(vec3(1.0, 0.72, 0.36), vec3(1.0, 0.88, 0.66), bHash(id + vBSeed + 9.0)) * 0.95;
  }
}
`;

function buildCity(): Place {
  const rng = mulberry32(21);
  const bin = createBin();
  const group = new THREE.Group();
  group.name = 'place-city';

  // ── Buildings: six rings of lots in each quadrant, lower near the stage ──
  const walls = bin.add(new THREE.MeshLambertMaterial());
  walls.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${BUILDING_VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${BUILDING_VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${BUILDING_FRAGMENT_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${BUILDING_FRAGMENT_BODY}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += windowGlow;');
  };
  walls.customProgramCacheKey = () => 'thunes-building';

  const box = bin.add(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const wallColors = [0x8d8a84, 0x9a948a, 0x7f7c78, 0xa39a8c, 0x8a6f62, 0x6f7880, 0x938b80];
  const buildings: Spot[] = [];
  const roofUnits: Spot[] = [];
  const PITCH = 15;
  for (let ix = 0; ix < 6; ix++) {
    for (let iz = 0; iz < 6; iz++) {
      for (const sideX of [-1, 1]) {
        for (const sideZ of [-1, 1]) {
          const width = 9 + rng() * 4.5;
          const depth = 9 + rng() * 4.5;
          const ring = Math.max(ix, iz);
          let height = 8 + rng() * 9 + ring * 2.5;
          if (ring > 0 && rng() < 0.28) height += 14 + rng() * 24;
          const x = sideX * (STREET + 1 + PITCH * ix + width / 2);
          const z = sideZ * (STREET + 1 + PITCH * iz + depth / 2);
          const color = new THREE.Color(wallColors[Math.floor(rng() * wallColors.length)]!).multiplyScalar(0.85 + rng() * 0.3);
          buildings.push({ x, y: 0, z, yaw: 0, sx: width, sy: height, sz: depth, color });
          if (rng() < 0.5) {
            roofUnits.push({
              x: x + (rng() - 0.5) * width * 0.4,
              y: height,
              z: z + (rng() - 0.5) * depth * 0.4,
              yaw: 0,
              sx: width * (0.2 + rng() * 0.2),
              sy: 1 + rng() * 1.8,
              sz: depth * (0.2 + rng() * 0.2),
              color: new THREE.Color(0x5d5a58).multiplyScalar(0.8 + rng() * 0.4),
            });
          }
        }
      }
    }
  }
  const plain = bin.add(new THREE.MeshLambertMaterial());

  // ── Cars parked along the kerbs of both streets ──
  const carGeometry = bin.add(
    merged([
      tinted(new THREE.BoxGeometry(1.8, 0.55, 4.2).translate(0, 0.58, 0), 0xffffff),
      tinted(new THREE.BoxGeometry(1.56, 0.5, 2.1).translate(0, 1.08, -0.2), 0x161b22),
      ...[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => tinted(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10).rotateZ(Math.PI / 2).translate(sx * 0.86, 0.33, sz * 1.32), 0x101012)),
      ),
      tinted(new THREE.BoxGeometry(1.5, 0.12, 0.06).translate(0, 0.62, 2.11), 0xfff3cf),
      tinted(new THREE.BoxGeometry(1.5, 0.1, 0.06).translate(0, 0.64, -2.11), 0x8a1c14),
    ]),
  );
  const carMaterial = bin.add(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const carColors = [0xd9553b, 0xf28a2e, 0xe9b949, 0x6aa6d8, 0xf3e9d2, 0x2f3a44, 0x9cb15a, 0x8a8f96];
  const cars: Spot[] = [];
  const park = (x: number, z: number, yaw: number) => {
    if (inCorridor(x, z) || rng() < 0.3) return;
    const s = spot(x, z, 1, yaw + (rng() - 0.5) * 0.05, new THREE.Color(carColors[Math.floor(rng() * carColors.length)]!));
    cars.push(s);
  };
  const KERB = STREET - 1.6;
  for (const side of [-1, 1]) {
    for (let d = 11; d < 76; d += 5.4 + rng() * 2.2) {
      park(side * KERB, -d, side > 0 ? 0 : Math.PI);
      park(side * KERB, d, side > 0 ? 0 : Math.PI);
      park(-d, side * KERB, Math.PI / 2);
      park(d, side * KERB, -Math.PI / 2);
    }
  }

  // ── Streetlights at the corners and down the streets ──
  const poleGeometry = bin.add(
    merged([
      tinted(new THREE.CylinderGeometry(0.07, 0.1, 5.6, 6).translate(0, 2.8, 0), 0x3a3d42),
      tinted(new THREE.BoxGeometry(1.5, 0.09, 0.09).translate(0.7, 5.56, 0), 0x3a3d42),
    ]),
  );
  const lampGeometry = bin.add(new THREE.SphereGeometry(0.2, 10, 8));
  const lampMaterial = bin.add(new THREE.MeshBasicMaterial({ color: 0xffdf9c }));
  const poles: Spot[] = [];
  const lamps: Spot[] = [];
  const light = (x: number, z: number, yaw: number) => {
    if (inCorridor(x, z)) return;
    poles.push(spot(x, z, 1, yaw));
    const lamp = spot(x + Math.cos(yaw) * 1.4, z - Math.sin(yaw) * 1.4, 1);
    lamp.y = 5.45;
    lamps.push(lamp);
  };
  const EDGE = STREET - 0.4;
  for (const side of [-1, 1]) {
    for (let d = EDGE; d < 80; d += 18) {
      light(side * EDGE, -d, side > 0 ? Math.PI : 0);
      if (d > EDGE) light(side * EDGE, d, side > 0 ? Math.PI : 0);
      if (d > EDGE) light(-d, side * EDGE, side > 0 ? Math.PI / 2 : -Math.PI / 2);
      if (d > EDGE) light(d, side * EDGE, side > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
  }

  const meshes = [
    instanced(box, walls, buildings, 'city-buildings'),
    instanced(box, plain, roofUnits, 'city-roof-units'),
    instanced(carGeometry, carMaterial, cars, 'city-cars'),
    instanced(poleGeometry, carMaterial, poles, 'city-poles'),
    instanced(lampGeometry, lampMaterial, lamps, 'city-lamps'),
  ];
  for (const mesh of meshes) {
    bin.add(mesh);
    group.add(mesh);
  }
  return { object: group, dispose: () => bin.dispose() };
}

// ────────────────────────────────────────────────────────────── desert ──

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const ux = smooth(x - ix);
  const uz = smooth(z - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function fbm2(x: number, z: number, seed: number): number {
  return valueNoise(x, z, seed) * 0.57 + valueNoise(x * 2.1 + 5.3, z * 2.1 + 1.7, seed + 1) * 0.29 + valueNoise(x * 4.3 + 9.1, z * 4.3 + 4.2, seed + 2) * 0.14;
}

/** Height of the dunes at a point, metres. Flat (0) around the stage, rising to long crests. */
export function duneHeight(x: number, z: number): number {
  const ramp = smooth((Math.hypot(x, z) - 11) / 27);
  if (ramp === 0) return 0;
  const warp = fbm2(x * 0.012, z * 0.012, 3) * 7;
  const crest = Math.pow(1 - Math.abs(Math.sin(x * 0.05 + z * 0.018 + warp)), 1.7);
  const swell = fbm2(x * 0.02 + 40, z * 0.02, 5);
  return ramp * (0.6 + crest * (3.5 + 4.5 * swell) + swell * 3) * (1 + Math.hypot(x, z) / 300);
}

function buildDesert(): Place {
  const rng = mulberry32(33);
  const bin = createBin();
  const group = new THREE.Group();
  group.name = 'place-desert';

  // ── Dunes: a height field whose flat middle lies just under the sand floor ──
  const EXTENT = 280;
  const SEGMENTS = 140;
  const dunes = bin.add(new THREE.PlaneGeometry(EXTENT * 2, EXTENT * 2, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2));
  const positions = dunes.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const height = duneHeight(positions.getX(i), positions.getZ(i));
    positions.setY(i, height > 0 ? height : -0.05);
  }
  dunes.computeVertexNormals();
  // Light is baked into vertex colours and the material is unlit, like the floor,
  // so level sand has exactly the floor's colour and the two meet without a seam.
  const normals = dunes.getAttribute('normal');
  const colors = new Float32Array(positions.count * 3);
  const normal = new THREE.Vector3();
  const color = new THREE.Color();
  const levelLight = 0.5 + 0.62 * DAY_SUN.y;
  for (let i = 0; i < positions.count; i++) {
    normal.fromBufferAttribute(normals, i);
    const light = (0.5 + 0.62 * Math.max(0, normal.dot(DAY_SUN))) / levelLight;
    const warm = 0.97 + 0.06 * valueNoise(positions.getX(i) * 0.03, positions.getZ(i) * 0.03, 9);
    color.setRGB(Math.min(1, SAND_MID[0] * light * warm), Math.min(1, SAND_MID[1] * light * warm), Math.min(1, SAND_MID[2] * light), THREE.SRGBColorSpace);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  dunes.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const sand = bin.add(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  const duneMesh = new THREE.Mesh(dunes, sand);
  duneMesh.name = 'desert-dunes';
  duneMesh.matrixAutoUpdate = false;
  group.add(duneMesh);

  // ── Cacti, dry shrubs, boulders, and mesas on the horizon ──
  const material = bin.add(sceneryMaterial());
  const cactus = bin.add(
    merged([
      tinted(new THREE.CylinderGeometry(0.17, 0.2, 2.6, 8).translate(0, 1.3, 0), 0x3f6b38),
      tinted(new THREE.SphereGeometry(0.17, 8, 5).translate(0, 2.6, 0), 0x3f6b38),
      tinted(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 6).rotateZ(Math.PI / 2).translate(0.42, 1.3, 0), 0x386332),
      tinted(new THREE.CylinderGeometry(0.1, 0.11, 0.9, 6).translate(0.72, 1.7, 0), 0x386332),
      tinted(new THREE.CylinderGeometry(0.09, 0.09, 0.55, 6).rotateZ(Math.PI / 2).translate(-0.36, 1.75, 0), 0x386332),
      tinted(new THREE.CylinderGeometry(0.09, 0.1, 0.6, 6).translate(-0.6, 2.0, 0), 0x386332),
    ]),
  );
  const bush = bin.add(tinted(new THREE.IcosahedronGeometry(0.5, 1).scale(1, 0.6, 1).translate(0, 0.22, 0), 0x77733f));
  const boulder = bin.add(tinted(new THREE.IcosahedronGeometry(0.5, 0).scale(1, 0.65, 0.85).translate(0, 0.2, 0), 0xa9764f));
  const mesa = bin.add(tinted(new THREE.CylinderGeometry(0.72, 1, 1, 9).translate(0, 0.5, 0), 0xb5623c));

  const occupied: { x: number; z: number; r: number }[] = [];
  const onSand = (p: { x: number; z: number }, scale: number, sink = 0.04): Spot => {
    const s = spot(p.x, p.z, scale, rng() * Math.PI * 2, new THREE.Color().setScalar(0.8 + rng() * 0.4));
    s.y = Math.max(0, duneHeight(p.x, p.z)) - sink * scale;
    return s;
  };
  const cacti = scatter(rng, occupied, { count: 26, near: 8.5, far: 70, gap: 3, bias: 1.3 }).map((p) => onSand(p, 0.7 + rng() * 0.9));
  const bushes = scatter(rng, occupied, { count: 70, near: 7.5, far: 80, gap: 1.2, bias: 1.4 }).map((p) => onSand(p, 0.6 + rng() * 1.1));
  const boulders = scatter(rng, occupied, { count: 34, near: 8, far: 90, gap: 1.5, bias: 1.3 }).map((p) => onSand(p, 0.6 + rng() * 2.4, 0.1));
  const mesas: Spot[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + rng() * 0.5;
    const distance = 175 + rng() * 70;
    const s = spot(Math.sin(angle) * distance, Math.cos(angle) * distance, 1, rng() * Math.PI, new THREE.Color().setScalar(0.85 + rng() * 0.3));
    s.sx = 24 + rng() * 22;
    s.sz = 20 + rng() * 20;
    s.sy = 16 + rng() * 16;
    s.y = duneHeight(s.x, s.z) - 3;
    mesas.push(s);
  }

  for (const mesh of [
    instanced(cactus, material, cacti, 'desert-cacti'),
    instanced(bush, material, bushes, 'desert-bushes'),
    instanced(boulder, material, boulders, 'desert-boulders'),
    instanced(mesa, material, mesas, 'desert-mesas'),
  ]) {
    bin.add(mesh);
    group.add(mesh);
  }

  return {
    object: group,
    setGain(gain) {
      // The material colour multiplies in linear light; the gain is a display-space factor.
      sand.color.setScalar(Math.pow(gain, 2.2));
    },
    dispose: () => bin.dispose(),
  };
}

// ─────────────────────────────────────────────────────────────── ocean ──

/** Boat dimensions, metres. The deck is the stage floor (y = 0); the bow points away from the default camera. */
const STERN_Z = 9.5;
const BOW_Z = -17;
const MAST_Z = -5.5;
const WATER_Y = -1.45;
/** How far the top of the bow reaches forward of its keel. */
const BOW_RAKE = 2;
const HULL_TOP = 0.42;
const HULL_BOTTOM = -2.5;

/** Half the hull's width at `t` (0 = stern, 1 = bow). */
function halfBeam(t: number): number {
  if (t < 0.36) return 3.8 * (0.78 + 0.22 * smooth(t / 0.36));
  const u = (t - 0.36) / 0.64;
  return 3.8 * Math.pow(Math.max(0, 1 - Math.pow(u, 2.3)), 0.8);
}
/** Forward shift of a hull point at height `y`, growing toward the bow (a raked stem). */
function rake(t: number, y: number): number {
  return smooth((t - 0.7) / 0.3) * BOW_RAKE * ((y - HULL_BOTTOM) / (HULL_TOP - HULL_BOTTOM));
}

function buildHull(): THREE.BufferGeometry {
  const STATIONS = 30;
  // One side, gunwale to keel: height, width factor, colour. Doubled rows give crisp paint lines.
  const cream = new THREE.Color(0xf3e9d2);
  const red = new THREE.Color(0xb8452f);
  const navy = new THREE.Color(0x1c2630);
  const rows: [number, number, THREE.Color][] = [
    [HULL_TOP, 1.02, cream],
    [0.14, 1, cream],
    [0.13, 1, red],
    [-1.25, 0.9, red],
    [-1.26, 0.9, navy],
    [-2.0, 0.55, navy],
    [HULL_BOTTOM, 0, navy],
  ];
  // Around the ring: port side top → keel → starboard side top.
  const ring: [number, number, THREE.Color, number][] = [
    ...rows.map(([y, f, c]) => [y, f, c, -1] as [number, number, THREE.Color, number]),
    ...rows
      .slice(0, -1)
      .reverse()
      .map(([y, f, c]) => [y, f, c, 1] as [number, number, THREE.Color, number]),
  ];
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const z = STERN_Z + (BOW_Z - STERN_Z) * t;
    const half = halfBeam(t);
    for (const [y, factor, color, side] of ring) {
      positions.push(side * half * factor, y, z - rake(t, y));
      colors.push(color.r, color.g, color.b);
    }
  }
  const per = ring.length;
  for (let i = 0; i < STATIONS; i++) {
    for (let k = 0; k < per - 1; k++) {
      const a = i * per + k;
      const b = a + 1;
      const c = a + per;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  // Transom: close the stern, including the low wall above the deck.
  const centre = positions.length / 3;
  positions.push(0, -0.8, STERN_Z);
  colors.push(red.r, red.g, red.b);
  for (let k = 0; k < per; k++) indices.push(k, (k + 1) % per, centre);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildDeck(): THREE.BufferGeometry {
  const STATIONS = 30;
  const shape = new THREE.Shape();
  const edge: [number, number][] = [];
  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const z = STERN_Z + (BOW_Z - STERN_Z) * t - rake(t, 0);
    edge.push([halfBeam(t) * 0.985, z]);
  }
  // Shape y is -z, so that laying the shape flat (rotate -90° about X) restores z.
  shape.moveTo(edge[0]![0], -edge[0]![1]);
  for (let i = 1; i < edge.length; i++) shape.lineTo(edge[i]![0], -edge[i]![1]);
  for (let i = edge.length - 2; i >= 0; i--) shape.lineTo(-edge[i]![0], -edge[i]![1]);
  shape.closePath();
  return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
}

/** Wooden planks running fore and aft; one tile covers 2 m × 2 m. */
function plankTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const rng = mulberry32(5);
  const planks = 10;
  const width = size / planks;
  for (let i = 0; i < planks; i++) {
    const tone = 0.86 + rng() * 0.28;
    ctx.fillStyle = `rgb(${Math.round(176 * tone)}, ${Math.round(137 * tone)}, ${Math.round(92 * tone)})`;
    ctx.fillRect(i * width, 0, width, size);
    // Grain.
    for (let g = 0; g < 9; g++) {
      ctx.fillStyle = `rgba(${rng() < 0.5 ? '70, 45, 22' : '230, 200, 150'}, ${0.05 + rng() * 0.07})`;
      ctx.fillRect(i * width + rng() * width, 0, 1 + rng() * 1.5, size);
    }
    // A butt joint somewhere along the plank.
    ctx.fillStyle = 'rgba(40, 26, 14, 0.75)';
    ctx.fillRect(i * width, Math.floor(rng() * size), width, 2);
    // Seam.
    ctx.fillRect(i * width, 0, 2, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(0.5, 0.5);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * A triangular sail between three corners, with a belly. UVs: u runs from
 * `tack` to `clew`, v from `tack` to `head`.
 */
function buildSail(tack: THREE.Vector3, clew: THREE.Vector3, head: THREE.Vector3, belly: number, toward: THREE.Vector3): THREE.BufferGeometry {
  const N = 10;
  const normal = new THREE.Vector3().subVectors(clew, tack).cross(new THREE.Vector3().subVectors(head, tack)).normalize();
  if (normal.dot(toward) < 0) normal.negate();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const index: number[][] = [];
  const point = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    index.push([]);
    for (let j = 0; j <= N - i; j++) {
      const b = i / N;
      const c = j / N;
      const a = 1 - b - c;
      point.set(0, 0, 0).addScaledVector(tack, a).addScaledVector(clew, b).addScaledVector(head, c);
      point.addScaledVector(normal, belly * Math.pow(Math.max(0, 27 * a * b * c), 0.75));
      index[i]!.push(positions.length / 3);
      positions.push(point.x, point.y, point.z);
      uvs.push(b, c);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N - i; j++) {
      indices.push(index[i]![j]!, index[i + 1]![j]!, index[i]![j + 1]!);
      if (j < N - i - 1) indices.push(index[i + 1]![j]!, index[i + 1]![j + 1]!, index[i]![j + 1]!);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Cream sailcloth with The Thunes' logo painted on it in red (drawn once the logo image has loaded). */
function mainsailTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 2048;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#f3e9d2';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Seams across the cloth.
  ctx.fillStyle = 'rgba(120, 100, 70, 0.16)';
  for (let y = 0; y < canvas.height; y += 128) ctx.fillRect(0, y, canvas.width, 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const image = new Image();
  image.onload = () => {
    // The logo is white on transparent: tint it, then paint it low on the sail near the mast.
    const stamp = document.createElement('canvas');
    stamp.width = image.naturalWidth;
    stamp.height = image.naturalHeight;
    const sctx = stamp.getContext('2d');
    if (!sctx) return;
    sctx.drawImage(image, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = '#c2452d';
    sctx.fillRect(0, 0, stamp.width, stamp.height);
    // About 1.1 m wide and 1.5 m tall, just above the boom: in view from the default camera.
    const u0 = 0.14;
    const u1 = 0.32;
    const v0 = 0.02;
    const v1 = 0.13;
    ctx.drawImage(stamp, u0 * canvas.width, (1 - v1) * canvas.height, (u1 - u0) * canvas.width, (v1 - v0) * canvas.height);
    texture.needsUpdate = true;
  };
  image.src = logoUrl;
  return texture;
}

function buildOcean(): Place {
  const rng = mulberry32(55);
  const bin = createBin();
  const group = new THREE.Group();
  group.name = 'place-ocean';

  // ── Water: three.js' reflective ocean ──
  const waterNormals = bin.add(new THREE.TextureLoader().load(waterNormalsUrl));
  waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;
  const waterGeometry = bin.add(new THREE.PlaneGeometry(6000, 6000));
  const water = new Water(waterGeometry, {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals,
    sunDirection: DAY_SUN.clone(),
    sunColor: 0xfff2d8,
    waterColor: 0x0a5878,
    distortionScale: 2.2,
    fog: true,
  });
  water.name = 'ocean-water';
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  bin.add(water.material);
  group.add(water);

  // ── The boat ──
  const boat = new THREE.Group();
  boat.name = 'ocean-boat';
  group.add(boat);
  const add = (mesh: THREE.Object3D, shadow = true) => {
    mesh.castShadow = shadow;
    boat.add(mesh);
    return mesh;
  };

  const hullMaterial = bin.add(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  add(new THREE.Mesh(bin.add(buildHull()), hullMaterial), false).name = 'boat-hull';

  const planks = plankTexture();
  if (planks) bin.add(planks);
  const deckMaterial = bin.add(new THREE.MeshStandardMaterial({ map: planks, color: planks ? 0xffffff : 0xb08a5a, roughness: 0.82, metalness: 0 }));
  const deck = new THREE.Mesh(bin.add(buildDeck()), deckMaterial);
  deck.name = 'boat-deck';
  deck.receiveShadow = true;
  boat.add(deck);

  const wood = bin.add(new THREE.MeshLambertMaterial({ color: 0x7a5533 }));
  const paint = bin.add(new THREE.MeshLambertMaterial({ color: 0xeadfc6 }));
  const mastTop = 17.4;
  add(new THREE.Mesh(bin.add(new THREE.CylinderGeometry(0.1, 0.15, mastTop, 10).translate(0, mastTop / 2, MAST_Z)), wood)).name = 'boat-mast';

  // The boom is let out to starboard so it clears the dancers.
  const BOOM_ANGLE = 0.5;
  const BOOM_Y = 3.25;
  const BOOM_LENGTH = 6;
  const along = new THREE.Vector3(Math.sin(BOOM_ANGLE), 0, Math.cos(BOOM_ANGLE));
  const boom = new THREE.Mesh(bin.add(new THREE.CylinderGeometry(0.07, 0.07, BOOM_LENGTH + 0.3, 8).rotateX(Math.PI / 2)), wood);
  boom.position.set(0, BOOM_Y - 0.12, MAST_Z).addScaledVector(along, BOOM_LENGTH / 2 + 0.1);
  boom.rotation.y = BOOM_ANGLE;
  add(boom).name = 'boat-boom';

  const leeward = new THREE.Vector3(Math.cos(BOOM_ANGLE), 0, -Math.sin(BOOM_ANGLE));
  const tack = new THREE.Vector3(0, BOOM_Y, MAST_Z).addScaledVector(along, 0.15);
  const clew = tack.clone().addScaledVector(along, BOOM_LENGTH);
  const head = new THREE.Vector3(0, mastTop - 0.5, MAST_Z);
  const sailCloth = mainsailTexture();
  if (sailCloth) bin.add(sailCloth);
  const mainMaterial = bin.add(new THREE.MeshLambertMaterial({ map: sailCloth, color: sailCloth ? 0xffffff : 0xf3e9d2, side: THREE.DoubleSide }));
  add(new THREE.Mesh(bin.add(buildSail(tack, clew, head, 0.55, leeward)), mainMaterial)).name = 'boat-mainsail';

  const bowTip = BOW_Z - rake(1, 0);
  const jibMaterial = bin.add(new THREE.MeshLambertMaterial({ color: 0xf3e9d2, side: THREE.DoubleSide }));
  const jib = buildSail(new THREE.Vector3(0, 0.8, bowTip + 1), new THREE.Vector3(1.7, 1.7, MAST_Z + 0.5), new THREE.Vector3(0, mastTop - 2, MAST_Z - 0.25), 0.5, leeward);
  add(new THREE.Mesh(bin.add(jib), jibMaterial)).name = 'boat-jib';

  const cabin = new THREE.Mesh(bin.add(new THREE.BoxGeometry(2.7, 0.9, 4.4).translate(0, 0.45, -10.8)), paint);
  cabin.receiveShadow = true;
  add(cabin).name = 'boat-cabin';

  // Standing rigging.
  const mastBeam = halfBeam((STERN_Z - MAST_Z) / (STERN_Z - BOW_Z)) * 0.98;
  const top = [0, mastTop, MAST_Z];
  const stays = [
    [0, 0.55, bowTip + 0.3],
    [0, 0.5, STERN_Z - 0.15],
    [mastBeam, HULL_TOP, MAST_Z],
    [-mastBeam, HULL_TOP, MAST_Z],
  ];
  const rigging = bin.add(new THREE.BufferGeometry());
  rigging.setAttribute('position', new THREE.Float32BufferAttribute(stays.flatMap((end) => [...top, ...end]), 3));
  const rope = bin.add(new THREE.LineBasicMaterial({ color: 0x2a2622 }));
  boat.add(new THREE.LineSegments(rigging, rope));

  // ── Islets on the horizon ──
  const islet = bin.add(tinted(new THREE.IcosahedronGeometry(1, 1), 0x4a6350));
  const isletMaterial = bin.add(sceneryMaterial());
  const islets: Spot[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI + (i - 2.5) * 0.55 + (rng() - 0.5) * 0.3;
    const distance = 210 + rng() * 150;
    const s = spot(Math.sin(angle) * distance, Math.cos(angle) * distance, 1, rng() * Math.PI, new THREE.Color().setScalar(0.8 + rng() * 0.4));
    s.sx = 22 + rng() * 30;
    s.sz = 16 + rng() * 20;
    s.sy = 5 + rng() * 9;
    s.y = WATER_Y - 1;
    islets.push(s);
  }
  const isletMesh = bin.add(instanced(islet, isletMaterial, islets, 'ocean-islets'));
  group.add(isletMesh);

  return {
    object: group,
    update(seconds) {
      water.material.uniforms.time!.value = (seconds % 3600) * 0.6;
    },
    dispose: () => bin.dispose(),
  };
}

// ────────────────────────────────────────────────────────────── system ──

const BUILDERS: Record<PlaceKind, () => Place> = { forest: buildForest, city: buildCity, desert: buildDesert, ocean: buildOcean };

/** Shows the scenery of the active 'place' backdrop (and none for the other backdrops). */
export function createPlacesSystem(context: StageContext): StageSystem {
  const built = new Map<PlaceKind, Place>();
  let active: PlaceKind | null = null;
  let gain = 1;

  function show(kind: PlaceKind | null): void {
    if (kind === active) return;
    if (active) built.get(active)?.object.removeFromParent();
    active = kind;
    if (!kind) return;
    let place = built.get(kind);
    if (!place) {
      place = BUILDERS[kind]();
      built.set(kind, place);
    }
    place.setGain?.(gain);
    context.scene.add(place.object);
  }

  return {
    sync(state, previous) {
      if (previous && state.scene === previous.scene) return;
      gain = exposureGain(state.scene.exposure);
      show(resolveBackground(state.scene).place ?? null);
      if (active) built.get(active)?.setGain?.(gain);
    },
    update(frame) {
      if (active) built.get(active)?.update?.(frame.clock.time);
    },
    dispose() {
      for (const place of built.values()) {
        place.object.removeFromParent();
        place.dispose();
      }
      built.clear();
      active = null;
    },
  };
}
