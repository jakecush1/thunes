/**
 * The desert: a field of wind-shaped dunes around a level interdune floor,
 * with sandstone buttes in the haze, half-buried boulders, saguaros and dry
 * grass. Photographed CC0 textures (see assets/desert/CREDITS.txt), lit PBR
 * materials, one hard sun.
 *
 *   desert-terrain.ts    the shape of the ground (pure maths)
 *   desert-materials.ts  sand, rock, cactus and foliage materials
 *   desert-scenery.ts    boulder, butte, cactus and card geometry
 *   desert-bake.ts       the scenery's sun shadows, baked into two masks
 */
import * as THREE from 'three';
import type { StageContext } from '../system';
import foliageAlphaUrl from './assets/desert/foliage-alpha.png';
import foliageColorUrl from './assets/desert/foliage-color.jpg';
import rockColorUrl from './assets/desert/rock-color.jpg';
import rockNormalUrl from './assets/desert/rock-normal.jpg';
import sandColorUrl from './assets/desert/sand-color.jpg';
import sandNormalUrl from './assets/desert/sand-normal.jpg';
import sandSoftUrl from './assets/desert/sand-soft-normal.jpg';
import { createShadowMasks } from './desert-bake';
import type { Blob, Caster } from './desert-bake';
import { createCactusMaterial, createDesertUniforms, createFoliageMaterial, createRockMaterial, createSandMaterial } from './desert-materials';
import { buildButte, buildCactus, buildCards, buildRock, createCactusSkin } from './desert-scenery';
import { FLAT_RADIUS, fbm, ground, groundHeight, groundSlope } from './desert-terrain';
import type { Ground } from './desert-terrain';
import { createBin, inCorridor, mulberry32, smooth } from './shared';
import type { Place } from './shared';

/** Elevation of the desert sun above the horizon. Lower than the stage's key light, for longer shadows and modelled dunes. */
const SUN_ELEVATION = (34 * Math.PI) / 180;
/**
 * The sun stands this far round to the side of the key light's bearing, radians. Side light models the dunes (lit
 * windward slopes, shaded slip faces); the angle is small enough that the scenery's shadows still agree with the dancers'.
 */
const SUN_TURN = (24 * Math.PI) / 180;
/** Nothing solid stands closer to the stage centre than this, metres. */
const CLEAR_RADIUS = 6.8;
/** Half extents of the two baked shadow masks, metres. */
const MASK_NEAR = 36;
const MASK_FAR = 220;

// ───────────────────────────────────────────────────────────── terrain ──

/**
 * The ground as one mesh: rings around the stage whose spacing grows with
 * distance, so triangles stay roughly the same size on screen from the stage
 * out to the horizon.
 */
function buildTerrain(): THREE.BufferGeometry {
  const AROUND = 384;
  const radii: number[] = [0, 3, 6, FLAT_RADIUS];
  for (let r = FLAT_RADIUS; r < 440; ) {
    // Square cells near the stage; longer ones far out, where haze hides the detail.
    r *= 1 + ((Math.PI * 2) / AROUND) * (1 + 2.2 * smooth((r - 110) / 120));
    radii.push(r);
  }
  const rings = radii.length;
  const positions = new Float32Array(rings * AROUND * 3);
  const colors = new Float32Array(rings * AROUND * 3);
  const sample: Ground = { height: 0, slip: 0 };
  for (let i = 0; i < rings; i++) {
    const r = radii[i]!;
    for (let j = 0; j < AROUND; j++) {
      const angle = (j / AROUND) * Math.PI * 2;
      const x = Math.sin(angle) * r;
      const z = Math.cos(angle) * r;
      ground(x, z, sample);
      const k = (i * AROUND + j) * 3;
      positions[k] = x;
      positions[k + 1] = sample.height;
      positions[k + 2] = z;
      // Broad colour drift: paler, finer sand on the crests and fresh slip faces; warmer, coarser sand in the flats.
      const tone = 0.93 + 0.14 * fbm(x / 43, z / 43, 71);
      const warm = fbm(x / 90 + 7, z / 90 + 3, 73) - 0.5;
      const pale = 0.05 * smooth((sample.height - 1.5) / 5.5) + 0.03 * sample.slip;
      colors[k] = tone * (1 + 0.05 * warm + pale);
      colors[k + 1] = tone * (1 + pale * 0.9);
      colors[k + 2] = tone * (1 - 0.1 * warm + pale * 0.7);
    }
  }
  const indices = new Uint32Array((rings - 1) * AROUND * 6);
  let n = 0;
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < AROUND; j++) {
      const a = i * AROUND + j;
      const b = i * AROUND + ((j + 1) % AROUND);
      const c = a + AROUND;
      const d = b + AROUND;
      indices[n++] = a;
      indices[n++] = c;
      indices[n++] = b;
      indices[n++] = b;
      indices[n++] = c;
      indices[n++] = d;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

// ─────────────────────────────────────────────────────────── placement ──

/** One instance of a piece of scenery, standing on the sand. */
interface Item {
  x: number;
  z: number;
  /** Uniform size, or [x, y, z]. */
  scale: number | readonly [number, number, number];
  yaw: number;
  /** Lean, radians, about the local X and Z axes. */
  tilt?: readonly [number, number];
  /** How far the origin is lowered into the sand, metres. */
  sink?: number;
  /** Brightness and warmth of this instance. */
  tint?: readonly [number, number, number];
}

function instances(geometry: THREE.BufferGeometry, material: THREE.Material, items: readonly Item[], name: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length));
  mesh.count = items.length;
  mesh.name = name;
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  items.forEach((item, i) => {
    euler.set(item.tilt?.[0] ?? 0, item.yaw, item.tilt?.[1] ?? 0);
    rotation.setFromEuler(euler);
    if (typeof item.scale === 'number') scale.setScalar(item.scale);
    else scale.set(item.scale[0], item.scale[1], item.scale[2]);
    position.set(item.x, groundHeight(item.x, item.z) - (item.sink ?? 0), item.z);
    mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
    const tint = item.tint ?? [1, 1, 1];
    mesh.setColorAt(i, color.setRGB(tint[0], tint[1], tint[2]));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  // The scenery surrounds the camera: culling a whole batch would never succeed.
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

interface Taken {
  x: number;
  z: number;
  r: number;
}

function isFree(taken: readonly Taken[], x: number, z: number, gap: number): boolean {
  for (const other of taken) {
    const reach = other.r + gap;
    if ((other.x - x) * (other.x - x) + (other.z - z) * (other.z - z) < reach * reach) return false;
  }
  return true;
}

interface ScatterOptions {
  count: number;
  near: number;
  far: number;
  gap: number;
  /** > 1 crowds items toward `near`. */
  bias: number;
  /** Steepest ground an item may stand on, rise over run. */
  slope: number;
}

const probe: Ground = { height: 0, slip: 0 };

/** True where scenery may stand: outside the stage, off the camera corridor, off slip faces and steep sand. */
function canStand(x: number, z: number, slope: number): boolean {
  if (Math.hypot(x, z) < CLEAR_RADIUS || inCorridor(x, z)) return false;
  if (ground(x, z, probe).slip > 0.05) return false;
  return groundSlope(x, z) <= slope;
}

/** Seeded positions in a ring around the stage, on ground gentle enough to stand on. */
function scatterOnSand(rng: () => number, taken: Taken[], options: ScatterOptions): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let attempt = 0; out.length < options.count && attempt < options.count * 60; attempt++) {
    const angle = rng() * Math.PI * 2;
    const distance = options.near + Math.pow(rng(), options.bias) * (options.far - options.near);
    const x = Math.sin(angle) * distance;
    const z = Math.cos(angle) * distance;
    if (!canStand(x, z, options.slope) || !isFree(taken, x, z, options.gap)) continue;
    taken.push({ x, z, r: options.gap });
    out.push({ x, z });
  }
  return out;
}

// ──────────────────────────────────────────────────────────── textures ──

async function loadTextures(urls: readonly string[]): Promise<THREE.Texture[]> {
  const loader = new THREE.TextureLoader();
  const results = await Promise.allSettled(urls.map((url) => loader.loadAsync(url)));
  const textures: THREE.Texture[] = [];
  let failure: unknown = null;
  for (const result of results) {
    if (result.status === 'fulfilled') textures.push(result.value);
    else failure = result.reason ?? new Error('texture failed to load');
  }
  if (failure) {
    for (const texture of textures) texture.dispose();
    throw failure instanceof Error ? failure : new Error('A desert texture failed to load.');
  }
  return textures;
}

// ─────────────────────────────────────────────────────────────── build ──

export async function build(context: StageContext): Promise<Place> {
  const [sandColor, sandNormal, sandSoft, rockColor, rockNormal, foliageColor, foliageAlpha] = (await loadTextures([
    sandColorUrl,
    sandNormalUrl,
    sandSoftUrl,
    rockColorUrl,
    rockNormalUrl,
    foliageColorUrl,
    foliageAlphaUrl,
  ])) as [THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture];

  const bin = createBin();
  const rng = mulberry32(33);
  const group = new THREE.Group();
  group.name = 'place-desert';
  group.matrixAutoUpdate = false;

  const anisotropy = Math.min(8, context.renderer.capabilities.getMaxAnisotropy());
  for (const texture of [sandColor, sandNormal, sandSoft, rockColor, rockNormal]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy;
    bin.add(texture);
  }
  for (const texture of [sandColor, rockColor, foliageColor]) texture.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [foliageColor, foliageAlpha]) {
    texture.anisotropy = Math.min(4, anisotropy);
    bin.add(texture);
  }

  // ── Light: the stage's key light, lowered to a desert sun on the same bearing ──
  const uniforms = createDesertUniforms();
  const key = context.scene.getObjectByName('key');
  if (key instanceof THREE.DirectionalLight) {
    uniforms.uThKeyDir.value.copy(key.position).sub(key.target.position).normalize();
  }
  const keyDir = uniforms.uThKeyDir.value;
  const bearing = Math.hypot(keyDir.x, keyDir.z) || 1;
  const bx = (keyDir.x * Math.cos(SUN_TURN) - keyDir.z * Math.sin(SUN_TURN)) / bearing;
  const bz = (keyDir.x * Math.sin(SUN_TURN) + keyDir.z * Math.cos(SUN_TURN)) / bearing;
  const sun = uniforms.uThSunDir.value.set(bx * Math.cos(SUN_ELEVATION), Math.sin(SUN_ELEVATION), bz * Math.cos(SUN_ELEVATION));
  // Level sand gets the light the key would have given it, plus what the dimmer sky fill takes away.
  uniforms.uThSunGain.value = Math.max(1, keyDir.y / sun.y) * 1.14;
  uniforms.uThSandColor.value = sandColor;
  uniforms.uThSandNormal.value = sandNormal;
  uniforms.uThSandSoft.value = sandSoft;
  uniforms.uThRockColor.value = rockColor;
  uniforms.uThRockNormal.value = rockNormal;
  uniforms.uThMaskScale.value.set(1 / (2 * MASK_NEAR), 1 / (2 * MASK_FAR));

  // ── Ground ──
  const sand = bin.add(createSandMaterial(uniforms));
  const terrain = new THREE.Mesh(bin.add(buildTerrain()), sand);
  terrain.name = 'desert-ground';
  terrain.receiveShadow = true;
  terrain.frustumCulled = false;
  terrain.matrixAutoUpdate = false;
  group.add(terrain);

  const taken: Taken[] = [];
  const blobs: Blob[] = [];
  const casters: Caster[] = [];
  const add = (mesh: THREE.InstancedMesh, alpha?: THREE.Texture): void => {
    bin.add(mesh);
    group.add(mesh);
    casters.push(alpha ? { mesh, alpha } : { mesh });
  };
  const shade = (): readonly [number, number, number] => {
    const light = 0.86 + rng() * 0.26;
    const warm = 0.96 + rng() * 0.08;
    return [light * warm, light, light * (2 - warm)];
  };

  // ── Buttes and a mesa in the haze ──
  const butteMaterial = bin.add(createRockMaterial(uniforms, { key: 'butte', tile: 8, stretch: 0.3, bump: 1.25, gain: 1.5, foot: 2.2, topDust: 0.55, contact: 3 }));
  const butteShapes = [
    { geometry: bin.add(buildButte({ radius: 9, height: 18, elongation: 1.15, seed: 3 })), reach: 19 },
    { geometry: bin.add(buildButte({ radius: 13, height: 19, elongation: 2.0, seed: 8 })), reach: 34 },
    { geometry: bin.add(buildButte({ radius: 3.7, height: 9.5, elongation: 1.0, seed: 14 })), reach: 8 },
  ];
  const butteItems: Item[][] = [
    [
      { x: 31, z: -72, scale: 1, yaw: 0.4, sink: 0.6, tint: shade() },
      { x: 104, z: -18, scale: 1.2, yaw: 2.1, sink: 0.6, tint: shade() },
      { x: -70, z: 78, scale: 1.1, yaw: 4.0, sink: 0.6, tint: shade() },
    ],
    [
      { x: -36, z: -88, scale: 1, yaw: 0.35, sink: 0.6, tint: shade() },
      { x: -112, z: 6, scale: 1.1, yaw: 1.5, sink: 0.6, tint: shade() },
      { x: 62, z: 96, scale: 1.05, yaw: 2.6, sink: 0.6, tint: shade() },
    ],
    [
      { x: 47, z: -60, scale: 1, yaw: 1.1, sink: 0.4, tint: shade() },
      { x: -64, z: -8, scale: 1.25, yaw: 3.3, sink: 0.4, tint: shade() },
      { x: 56, z: 30, scale: 0.9, yaw: 5.0, sink: 0.4, tint: shade() },
    ],
  ];
  butteShapes.forEach((shape, i) => {
    const items = butteItems[i]!;
    add(instances(shape.geometry, butteMaterial, items, `desert-buttes-${i}`));
    for (const item of items) {
      const size = typeof item.scale === 'number' ? item.scale : 1;
      taken.push({ x: item.x, z: item.z, r: shape.reach * size });
      blobs.push({ x: item.x, z: item.z, radius: shape.reach * size * 1.25, strength: 0.3 });
    }
  });

  // ── Saguaros: a few, each with room around it ──
  const cactusSkin = bin.add(createCactusSkin());
  const cactusMaterial = bin.add(createCactusMaterial(uniforms, cactusSkin));
  const cactusShapes = [
    bin.add(
      buildCactus({
        height: 4.7,
        radius: 0.25,
        seed: 5,
        arms: [
          { at: 1.95, heading: 0.35, reach: 0.4, rise: 1.55, radius: 0.16 },
          { at: 2.55, heading: 3.3, reach: 0.34, rise: 0.95, radius: 0.15 },
        ],
      }),
    ),
    bin.add(buildCactus({ height: 3.5, radius: 0.23, seed: 9, arms: [{ at: 1.6, heading: 2.2, reach: 0.38, rise: 1.0, radius: 0.15 }] })),
    bin.add(buildCactus({ height: 2.3, radius: 0.2, seed: 12, arms: [] })),
    bin.add(
      buildCactus({
        height: 5.8,
        radius: 0.28,
        seed: 17,
        arms: [
          { at: 2.3, heading: 1.2, reach: 0.45, rise: 1.9, radius: 0.18 },
          { at: 2.9, heading: 4.1, reach: 0.42, rise: 1.5, radius: 0.17 },
          { at: 3.5, heading: 5.6, reach: 0.34, rise: 0.8, radius: 0.15 },
        ],
      }),
    ),
  ];
  const cactusItems: Item[][] = [
    [{ x: -7.6, z: -9.8, scale: 1, yaw: 0.5, tint: shade() }],
    [
      { x: -12.6, z: 3.6, scale: 1.05, yaw: 2.4, tint: shade() },
      { x: 17.5, z: 5.6, scale: 0.95, yaw: 4.4, tint: shade() },
    ],
    [
      { x: 9.5, z: -2.3, scale: 1, yaw: 1.3, tint: shade() },
      { x: -14.5, z: -17.2, scale: 0.8, yaw: 3.0, tint: shade() },
    ],
    [{ x: 12.8, z: -18.6, scale: 1, yaw: 5.2, tint: shade() }],
  ];
  for (const items of cactusItems) for (const item of items) taken.push({ x: item.x, z: item.z, r: 2.4 });
  // A handful more, farther out among the dunes.
  for (const spot of scatterOnSand(rng, taken, { count: 7, near: 24, far: 70, gap: 9, bias: 1.2, slope: 0.16 })) {
    const which = Math.floor(rng() * cactusShapes.length);
    cactusItems[which]!.push({ x: spot.x, z: spot.z, scale: 0.8 + rng() * 0.35, yaw: rng() * Math.PI * 2, tint: shade() });
  }
  cactusShapes.forEach((geometry, i) => {
    const items = cactusItems[i]!;
    add(instances(geometry, cactusMaterial, items, `desert-cacti-${i}`));
    for (const item of items) blobs.push({ x: item.x, z: item.z, radius: 0.75 * (item.scale as number), strength: 0.5 });
  });

  // ── Boulders: a few groups near the stage, strays farther out, pebbles around them ──
  const rockMaterial = bin.add(createRockMaterial(uniforms, { key: 'boulder', tile: 2.6, stretch: 1, bump: 1.25, gain: 1.45, foot: 0.22, topDust: 0.5, contact: 0.4 }));
  const rockShapes = [bin.add(buildRock(101, 7)), bin.add(buildRock(202, 7)), bin.add(buildRock(303, 6, 1))];
  const pebbleShape = bin.add(buildRock(404, 3));
  const rockItems: Item[][] = [[], [], []];
  const pebbles: Item[] = [];
  const lean = (): readonly [number, number] => [(rng() - 0.5) * 0.5, (rng() - 0.5) * 0.5];
  const addRock = (which: number, x: number, z: number, size: number): void => {
    const squash = 0.85 + rng() * 0.3;
    rockItems[which]!.push({ x, z, scale: [size, size * squash, size * (0.9 + rng() * 0.2)], yaw: rng() * Math.PI * 2, tilt: lean(), sink: size * 0.05, tint: shade() });
    taken.push({ x, z, r: size * 1.3 });
    blobs.push({ x, z, radius: size * 1.75, strength: 0.55 });
    // Fragments shed around the foot.
    const count = 2 + Math.floor(rng() * 4);
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const reach = size * (1.15 + rng() * 1.5);
      const px = x + Math.cos(angle) * reach;
      const pz = z + Math.sin(angle) * reach;
      if (Math.hypot(px, pz) < CLEAR_RADIUS || inCorridor(px, pz)) continue;
      const small = 0.07 + rng() * rng() * 0.22;
      pebbles.push({ x: px, z: pz, scale: [small, small * (0.7 + rng() * 0.4), small * (0.8 + rng() * 0.4)], yaw: rng() * Math.PI * 2, tilt: lean(), sink: small * 0.1, tint: shade() });
      blobs.push({ x: px, z: pz, radius: small * 2, strength: 0.45 });
    }
  };
  const heroRocks: readonly (readonly [number, number, number, number])[] = [
    [0, 7.4, -8.9, 1.05],
    [1, 9.3, -7.8, 0.55],
    [2, 6.1, -10.7, 0.5],
    [1, -5.4, -13.4, 0.8],
    [2, -10.9, -3.1, 0.95],
    [0, -12.3, -4.6, 0.45],
    [0, 13.6, 0.9, 0.8],
    [1, -9.6, 8.6, 0.65],
    [2, 11.6, 10.6, 0.75],
  ];
  for (const [which, x, z, size] of heroRocks) addRock(which, x, z, size);
  for (const spot of scatterOnSand(rng, taken, { count: 18, near: 15, far: 85, gap: 5, bias: 1.5, slope: 0.3 })) {
    addRock(Math.floor(rng() * 3), spot.x, spot.z, 0.45 + rng() * rng() * 1.6);
  }
  for (const spot of scatterOnSand(rng, taken, { count: 34, near: CLEAR_RADIUS + 0.4, far: 34, gap: 0.5, bias: 1.3, slope: 0.3 })) {
    const small = 0.05 + rng() * rng() * 0.16;
    pebbles.push({ x: spot.x, z: spot.z, scale: [small, small * (0.65 + rng() * 0.4), small * (0.8 + rng() * 0.4)], yaw: rng() * Math.PI * 2, tilt: lean(), sink: small * 0.1, tint: shade() });
  }
  rockShapes.forEach((geometry, i) => add(instances(geometry, rockMaterial, rockItems[i]!, `desert-rocks-${i}`)));
  add(instances(pebbleShape, rockMaterial, pebbles, 'desert-pebbles'));

  // ── Dry grass and shrubs: sparse, in loose patches ──
  const foliageMaterial = bin.add(createFoliageMaterial(uniforms, foliageColor, foliageAlpha));
  const cards = bin.add(buildCards());
  const plants: Item[] = [];
  const cells: number[] = [];
  /** `kind`: 0 dense tuft, 1 seed-head tuft, 2 dry bush, 3 olive scrub (the cells of the atlas). */
  const addPlant = (kind: number, x: number, z: number, size: number): void => {
    const light = 0.82 + rng() * 0.3;
    plants.push({ x, z, scale: [size, size * (0.85 + rng() * 0.3), size], yaw: rng() * Math.PI * 2, sink: size * 0.035, tint: [light * 1.02, light, light * 0.94] });
    cells.push(kind % 2 === 0 ? 0 : 0.5, kind < 2 ? 0.5 : 0);
    blobs.push({ x, z, radius: size * (kind < 2 ? 0.34 : 0.5), strength: kind < 2 ? 0.3 : 0.42 });
  };
  const heroPlants: readonly (readonly [number, number, number, number])[] = [
    [0, -4.5, -7.9, 0.95],
    [1, -3.4, -8.8, 0.8],
    [1, 5.2, -9.9, 0.9],
    [0, 8.5, -10.4, 0.85],
    [2, -9.1, -6.2, 1.5],
    [3, 10.6, -5.6, 1.7],
    [0, -8.3, -10.9, 0.8],
    [1, 2.4, -11.6, 0.75],
    [2, 13.2, -13.4, 1.6],
    [0, -8.0, 1.2, 0.85],
    [3, -11.4, 7.2, 1.5],
    [1, 9.8, 3.8, 0.8],
  ];
  for (const [kind, x, z, size] of heroPlants) {
    if (!isFree(taken, x, z, 0.3)) continue;
    addPlant(kind, x, z, size);
    taken.push({ x, z, r: size * 0.3 });
  }
  for (const centre of scatterOnSand(rng, taken, { count: 26, near: 9, far: 75, gap: 4, bias: 1.5, slope: 0.2 })) {
    const bush = rng() < 0.35;
    addPlant(bush ? 2 + Math.floor(rng() * 2) : Math.floor(rng() * 2), centre.x, centre.z, bush ? 1.3 + rng() * 0.8 : 0.7 + rng() * 0.45);
    // Seedlings around the parent.
    const count = Math.floor(rng() * 4);
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const reach = 0.7 + rng() * 2.2;
      const x = centre.x + Math.cos(angle) * reach;
      const z = centre.z + Math.sin(angle) * reach;
      if (!canStand(x, z, 0.25) || !isFree(taken, x, z, 0.2)) continue;
      addPlant(Math.floor(rng() * 2), x, z, 0.5 + rng() * 0.45);
      taken.push({ x, z, r: 0.3 });
    }
  }
  const plantMesh = instances(cards, foliageMaterial, plants, 'desert-plants');
  // Per-instance attributes live on the geometry, which only this mesh uses.
  cards.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(cells), 2));
  add(plantMesh, foliageAlpha);

  // ── The scenery's sun shadows, baked once ──
  const masks = bin.add(createShadowMasks(casters, blobs, sun, MASK_NEAR, MASK_FAR, 2048, 1024));
  uniforms.uThMaskNear.value = masks.near;
  uniforms.uThMaskFar.value = masks.far;
  masks.render(context.renderer);
  // Render targets do not survive a lost WebGL context: bake again on the next frame.
  let stale = false;
  const onRestored = (): void => {
    stale = true;
  };
  context.canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    object: group,
    ownsGround: true,
    update() {
      if (!stale) return;
      stale = false;
      masks.render(context.renderer);
    },
    dispose() {
      context.canvas.removeEventListener('webglcontextrestored', onRestored);
      group.removeFromParent();
      bin.dispose();
    },
  };
}
