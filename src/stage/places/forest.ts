/**
 * The forest: a sunlit clearing of real grass ringed by broadleaf trees and
 * conifers, with ferns, shrubs, saplings, mossy rocks and fallen logs under
 * them and wooded hills fading into the haze.
 *
 * Photographic textures (CC0, see assets/forest/CREDITS.txt) on PBR materials;
 * foliage is alpha-tested cards cut from an atlas composed at load time.
 * Everything repeated is instanced; the layout is seeded, so it is the same
 * place on every visit.
 */
import * as THREE from 'three';
import type { StageContext } from '../system';
import { bakeLightMaps, buildGrass, buildTerrain, createGroundMaterial, dimRimLight, terrainHeight } from './forest-ground';
import type { LightMapInput, LightMaps } from './forest-ground';
import { loadForestTextures } from './forest-textures';
import { broadleafFar, broadleafHero, broadleafMid, coniferFar, coniferHero, coniferMid, fern, log, rock, sapling, shrub } from './forest-trees';
import type { PlantModel } from './forest-trees';
import { createBin, inCorridor, instanced, mulberry32, smooth, spot } from './shared';
import type { Place, Spot } from './shared';

type Rng = () => number;

/** Where the scene's key light sits if it cannot be found (matches stage/lighting.ts). */
const KEY_FALLBACK = new THREE.Vector3(-5.5, 11, 7);

/** Trunks stay this far from the stage centre, metres. */
const CLEARING = 7.5;
const HERO_FAR = 26;
/** How much of the stage's rim light (meant to outline the dancers) reaches the scenery. */
const RIM_ON_SCENERY = 0.3;
const MID_FAR = 60;
const FOREST_FAR = 150;

// ───────────────────────────────────────────────────────── materials ──

/** Wind: whole plants lean with slow gusts, more the higher up; shared by bark and foliage so they move together. */
const SWAY_GLSL = /* glsl */ `
uniform float uWindTime;
vec3 forestSway( vec3 p ) {
  #ifdef USE_INSTANCING
    vec3 origin = instanceMatrix[ 3 ].xyz;
    float phase = origin.x * 0.31 + origin.z * 0.23;
    float lift = max( p.y, 0.0 );
    float amount = lift * lift * 0.0005 + lift * 0.003;
    float gust = 0.6 * sin( uWindTime * 0.8 + phase ) + 0.4 * sin( uWindTime * 1.9 + phase * 1.7 );
    p.x += gust * amount;
    p.z += ( 0.5 * gust + 0.3 * sin( uWindTime * 1.3 + phase * 2.3 ) ) * amount;
  #endif
  return p;
}
`;

function barkMaterial(map: THREE.Texture, normalMap: THREE.Texture, tint: number, wind: { value: number }): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ map, normalMap, color: tint, vertexColors: true, roughness: 0.95, metalness: 0 });
  material.normalScale.set(1.3, 1.3);
  material.envMapIntensity = 0.5;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SWAY_GLSL}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = forestSway( transformed );');
    shader.fragmentShader = dimRimLight(shader.fragmentShader, RIM_ON_SCENERY);
  };
  material.customProgramCacheKey = () => 'thunes-forest-bark';
  return material;
}

/**
 * Leaves and needles: alpha-tested cards, lit from both sides with the normal
 * they were given (rounded over the crown), glowing where the sun is behind them.
 */
function foliageMaterial(atlas: THREE.Texture, wind: { value: number }): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.42 });
  material.name = 'forest-foliage';
  material.alphaToCoverage = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SWAY_GLSL}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed = forestSway( transformed );
        #ifdef USE_INSTANCING
          // Leaves tremble a little on their own.
          float flutter = dot( position, vec3( 1.7, 2.3, 1.1 ) ) + instanceMatrix[ 3 ].x;
          transformed += normal * ( 0.018 * sin( uWindTime * 2.6 + flutter ) + 0.008 * sin( uWindTime * 4.3 + flutter * 1.6 ) );
        #endif`,
      );
    shader.fragmentShader = dimRimLight(shader.fragmentShader, RIM_ON_SCENERY)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
          // Small mip levels average the cut-outs away: thicken them again so far crowns stay full.
          vec2 atlasTexel = vMapUv * 2048.0;
          float atlasLod = max( 0.0, 0.5 * log2( max( dot( dFdx( atlasTexel ), dFdx( atlasTexel ) ), dot( dFdy( atlasTexel ), dFdy( atlasTexel ) ) ) ) );
          diffuseColor.a *= 1.0 + 0.3 * min( atlasLod, 5.0 );
        #endif`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `float faceDirection = 1.0;
        vec3 normal = normalize( vNormal );
        vec3 nonPerturbedNormal = normal;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
          // Sun shining through the leaves on the far side of the crown.
          float leafBack = saturate( - dot( normal, directionalLights[ 0 ].direction ) );
          reflectedLight.directDiffuse += directionalLights[ 0 ].color * RECIPROCAL_PI * diffuseColor.rgb * vec3( 0.95, 1.12, 0.45 ) * ( 0.32 * leafBack );
        #endif`,
      );
  };
  material.customProgramCacheKey = () => 'thunes-forest-foliage';
  return material;
}

/** Pollen and midges adrift in the clearing: a few soft specks that catch the sun. */
function buildMotes(wind: { value: number }): THREE.Points {
  const rng = mulberry32(606);
  const count = 150;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (rng() * 2 - 1) * 10;
    positions[i * 3 + 1] = 0.4 + rng() * rng() * 5.5;
    positions[i * 3 + 2] = -11 + rng() * 19;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const glow = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    glow.addColorStop(0, 'rgba(255, 255, 255, 1)');
    glow.addColorStop(0.35, 'rgba(255, 255, 255, 0.55)');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 32, 32);
  }
  const map = new THREE.CanvasTexture(canvas);
  const material = new THREE.PointsMaterial({ map, color: 0xfff1c4, size: 0.055, sizeAttenuation: true, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float moteSeed = position.x * 12.9898 + position.z * 78.233 + position.y * 37.719;
        transformed.x += 0.9 * sin( uWindTime * 0.21 + moteSeed ) + 0.25 * sin( uWindTime * 0.9 + moteSeed * 1.7 );
        transformed.y += 0.5 * sin( uWindTime * 0.17 + moteSeed * 2.3 ) + 0.12 * sin( uWindTime * 1.3 + moteSeed );
        transformed.z += 0.9 * cos( uWindTime * 0.19 + moteSeed * 1.3 ) + 0.25 * sin( uWindTime * 0.8 + moteSeed * 2.9 );`,
      );
  };
  material.customProgramCacheKey = () => 'thunes-forest-motes';
  const points = new THREE.Points(geometry, material);
  points.name = 'forest-motes';
  points.frustumCulled = false;
  points.matrixAutoUpdate = false;
  return points;
}

// ──────────────────────────────────────────────────────────── layout ──

interface Site {
  x: number;
  z: number;
  r: number;
}

/** True where trees must not stand: the default camera's corridor (with room for crowns) and the camera's path when zoomed far out. */
function keepClear(x: number, z: number, margin: number): boolean {
  if (z > 2 - margin && z < 34 && Math.abs(x) < 3.5 + (Math.max(z, 2) - 2) * 0.6 + margin) return true;
  return z >= 34 && z < 50 && Math.abs(x) < 12 - (z - 34) * 0.5 + margin;
}

/** Dart-throwing scatter in a ring around the stage, with a hash grid so thousands of sites stay cheap. */
class Scatter {
  private readonly cells = new Map<number, Site[]>();
  private static readonly CELL = 8;

  private key(cx: number, cz: number): number {
    return (cx + 512) * 1024 + (cz + 512);
  }

  add(site: Site): void {
    const key = this.key(Math.floor(site.x / Scatter.CELL), Math.floor(site.z / Scatter.CELL));
    const cell = this.cells.get(key);
    if (cell) cell.push(site);
    else this.cells.set(key, [site]);
  }

  free(x: number, z: number, gap: number): boolean {
    const cx = Math.floor(x / Scatter.CELL);
    const cz = Math.floor(z / Scatter.CELL);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const cell = this.cells.get(this.key(cx + i, cz + j));
        if (!cell) continue;
        for (const other of cell) {
          const reach = other.r + gap;
          const dx = other.x - x;
          const dz = other.z - z;
          if (dx * dx + dz * dz < reach * reach) return false;
        }
      }
    }
    return true;
  }

  ring(rng: Rng, count: number, near: number, far: number, gap: number, bias: number, allowed: (x: number, z: number) => boolean): Site[] {
    const out: Site[] = [];
    for (let attempt = 0; out.length < count && attempt < count * 30; attempt++) {
      const angle = rng() * Math.PI * 2;
      const distance = near + Math.pow(rng(), bias) * (far - near);
      const x = Math.sin(angle) * distance;
      const z = Math.cos(angle) * distance;
      if (!allowed(x, z) || !this.free(x, z, gap)) continue;
      const site = { x, z, r: gap };
      this.add(site);
      out.push(site);
    }
    return out;
  }
}

interface Tree extends Site {
  conifer: boolean;
  scale: number;
  yaw: number;
  /** Brightness and hue of the foliage. */
  tint: THREE.Color;
}

/** Conifers and broadleaves grow in loose stands, not salt-and-pepper. */
function isConifer(rng: Rng, x: number, z: number): boolean {
  return Math.sin(x * 0.047 + 1.7) + Math.sin(z * 0.055 - 0.6) + (rng() - 0.5) * 1.5 > 0.1;
}

function treeTint(rng: Rng, conifer: boolean): THREE.Color {
  const value = 0.84 + rng() * 0.26;
  return conifer ? new THREE.Color(value * (0.94 + rng() * 0.1), value, value * (0.92 + rng() * 0.12)) : new THREE.Color(value * (0.92 + rng() * 0.18), value, value * (0.8 + rng() * 0.25));
}

/** The trees nearest the clearing are placed by hand so the default view is framed, then the rings are scattered. */
const NEAR_TREES: readonly [x: number, z: number, conifer: boolean, scale: number][] = [
  [-9.4, -3.9, false, 1.06],
  [11.8, -2.9, true, 1],
  [4.8, -10.6, false, 1],
  [-3.8, -11.8, true, 1.05],
  [-10.8, 4.8, false, 1.1],
  [11.6, 6, false, 0.95],
  [-13.5, -9.5, true, 1.05],
  [11, -10, true, 1.12],
  [0.8, -16, false, 1.04],
  [-8, -15, false, 0.92],
  [15.4, -4.4, false, 1],
  [-15, -1, true, 0.96],
];

function toSpot(tree: Tree, color: THREE.Color, vary = false): Spot {
  const s = spot(tree.x, tree.z, tree.scale, tree.yaw, color);
  s.y = terrainHeight(tree.x, tree.z);
  if (vary) {
    // Distant trees share a model: stouter and slimmer ones keep the rows from looking cloned.
    const hash = Math.sin(tree.x * 12.9898 + tree.z * 78.233) * 43758.5453;
    s.sx = s.sz = tree.scale * (0.82 + 0.36 * (hash - Math.floor(hash)));
  }
  return s;
}

// ───────────────────────────────────────────────────────────── build ──

export async function build(context: StageContext): Promise<Place> {
  const textures = await loadForestTextures(context.renderer);
  const bin = createBin();
  for (const texture of textures.all) bin.add(texture);
  const group = new THREE.Group();
  group.name = 'place-forest';
  const wind = { value: 0 };
  const rng = mulberry32(20240607);

  try {
    const { atlas } = textures;

    // ── Where everything stands ──
    const scatter = new Scatter();
    const makeTree = (site: Site, conifer: boolean, scale: number): Tree => ({ ...site, conifer, scale, yaw: rng() * Math.PI * 2, tint: treeTint(rng, conifer) });
    const hero: Tree[] = NEAR_TREES.map(([x, z, conifer, scale]) => {
      const site = { x, z, r: 3.4 };
      scatter.add(site);
      return makeTree(site, conifer, scale);
    });
    const outsideClearing = (margin: number) => (x: number, z: number) => !keepClear(x, z, margin);
    for (const site of scatter.ring(rng, 44, 11.5, HERO_FAR, 4.1, 1.15, outsideClearing(2.5))) {
      // Conifers keep their low boughs: they stand further back from the stage and the camera's corridor.
      const conifer = isConifer(rng, site.x, site.z) && Math.hypot(site.x, site.z) > 13 && !keepClear(site.x, site.z, 5.5);
      hero.push(makeTree(site, conifer, 0.82 + rng() * 0.34));
    }
    const mid = scatter.ring(rng, 330, HERO_FAR, MID_FAR, 4.4, 1.1, outsideClearing(1)).map((site) => {
      const conifer = isConifer(rng, site.x, site.z);
      const size = rng();
      // Conifers of all ages; the broadleaves are more of a height.
      return makeTree(site, conifer, conifer ? 0.62 + size * 0.75 : 0.8 + size * 0.45);
    });
    const far = scatter.ring(rng, 1100, MID_FAR, FOREST_FAR, 5.4, 1.25, () => true).map((site) => makeTree(site, isConifer(rng, site.x, site.z), 0.85 + rng() * 0.6));

    // ── Tree models ──
    const heroModels: Record<'broadleaf' | 'conifer', PlantModel[]> = {
      broadleaf: [broadleafHero(11, atlas), broadleafHero(23, atlas)],
      conifer: [coniferHero(31, atlas), coniferHero(47, atlas)],
    };
    const midModels = { broadleaf: [broadleafMid(5, atlas), broadleafMid(17, atlas)], conifer: [coniferMid(7, atlas), coniferMid(19, atlas)] };
    const farModels = { broadleaf: [broadleafFar(0, atlas), broadleafFar(1, atlas)], conifer: [coniferFar(0, atlas), coniferFar(1, atlas)] };
    const heroModel = (tree: Tree, index: number) => heroModels[tree.conifer ? 'conifer' : 'broadleaf'][index % 2]!;

    // ── What the trees do to the light on the ground ──
    const key = context.scene.getObjectByName('key');
    const toSun = (key ? key.position.clone() : KEY_FALLBACK.clone()).normalize();
    const shadowX = -toSun.x / toSun.y;
    const shadowZ = -toSun.z / toSun.y;
    const light: LightMapInput = { canopy: [], trunks: [], cover: [], contact: [] };
    const castShade = (tree: Tree, model: PlantModel, darkness: number) => {
      const cos = Math.cos(tree.yaw) * tree.scale;
      const sin = Math.sin(tree.yaw) * tree.scale;
      for (let i = 0; i < model.blobs.length; i += 4) {
        const bx = model.blobs[i]!;
        const by = model.blobs[i + 1]! * tree.scale;
        const bz = model.blobs[i + 2]!;
        light.canopy.push(tree.x + bx * cos + bz * sin + shadowX * by, tree.z - bx * sin + bz * cos + shadowZ * by, model.blobs[i + 3]! * tree.scale, darkness);
      }
      const top = model.height * 0.7 * tree.scale;
      light.trunks.push(tree.x, tree.z, tree.x + shadowX * top, tree.z + shadowZ * top, model.girth * 2 * tree.scale);
      // Damp, dim ground around the foot of the trunk.
      light.contact.push(tree.x + shadowX * 0.3, tree.z + shadowZ * 0.3, 1.5 * tree.scale, 0.55);
      light.cover.push(tree.x, tree.z, model.crownRadius * tree.scale * 1.7);
    };
    hero.forEach((tree, index) => castShade(tree, heroModel(tree, index), tree.conifer ? 0.5 : 0.36));
    mid.forEach((tree, index) => castShade(tree, midModels[tree.conifer ? 'conifer' : 'broadleaf'][index % 2]!, 0.55));
    far.forEach((tree, index) => light.cover.push(tree.x, tree.z, farModels[tree.conifer ? 'conifer' : 'broadleaf'][index % 2]!.crownRadius * tree.scale * 1.7));

    // ── Undergrowth: where it stands ──
    const trunks: Site[] = hero.map((tree) => ({ x: tree.x, z: tree.z, r: 0.75 * tree.scale }));
    const solid: Site[] = [...trunks];
    const under = new Scatter();
    for (const trunk of trunks) under.add(trunk);
    for (const tree of mid) under.add({ x: tree.x, z: tree.z, r: 0.5 });
    /** Free ground for a plant that reaches `reach` metres from its root: off the stage and out of the camera's corridor. */
    const growable = (reach: number) => (x: number, z: number) => Math.hypot(x, z) > 6.6 + reach && !inCorridor(x, z) && !keepClear(x, z, reach * 0.6);
    const shade = (base: number, spread: number) => new THREE.Color().setScalar(base + rng() * spread);
    const contact = (x: number, z: number, r: number, darkness: number) => light.contact.push(x + shadowX * r * 0.35, z + shadowZ * r * 0.35, r, darkness);
    const grounded = (s: Spot, sink = 0): Spot => {
      s.y = terrainHeight(s.x, s.z) - sink;
      return s;
    };

    // Rocks first (they are solid), a big one in view behind the dancers.
    const rocks: Spot[] = [];
    const placeRock = (x: number, z: number, size: number) => {
      const s = grounded(spot(x, z, size, rng() * Math.PI * 2, shade(0.8, 0.3)), 0.04 * size);
      s.sx *= 0.85 + rng() * 0.4;
      s.sy *= 0.75 + rng() * 0.5;
      rocks.push(s);
      solid.push({ x, z, r: size * 0.55 });
      contact(x, z, size * 0.8, 0.6);
    };
    for (const [x, z, size] of [
      [6.9, -5.3, 1.9],
      [7.9, -6.4, 0.9],
      [-6.6, -7, 1.3],
      [-9.6, 0.8, 1.1],
    ] as const) {
      under.add({ x, z, r: size * 0.6 });
      placeRock(x, z, size);
    }
    for (const site of under.ring(rng, 30, 7.8, 34, 1.6, 1.4, growable(1))) placeRock(site.x, site.z, 0.45 + rng() * rng() * 1.6);

    const logs: Spot[] = [];
    for (const [x, z, yaw, size] of [
      [-5.2, -10.4, -0.5, 1],
      [10.4, -6.4, 1.1, 0.85],
      [-13.2, 3.4, 0.2, 1.15],
      [3.2, -18.5, 2.4, 1],
      [17.5, 4.5, -1, 0.9],
    ] as const) {
      logs.push(spot(x, z, size, yaw, shade(0.85, 0.2)));
      for (let k = -2; k <= 2; k++) {
        const site = { x: x + Math.cos(yaw) * k * size, z: z - Math.sin(yaw) * k * size, r: 0.5 * size };
        under.add(site);
        solid.push({ ...site, r: 0.3 * size });
        contact(site.x, site.z, 0.65 * size, 0.55);
      }
    }

    // Shrubs and saplings reach wide: they keep well back, so a camera circling the stage is not buried in leaves.
    const shrubs: Spot[] = under.ring(rng, 130, 10.2, 40, 1.9, 1.45, growable(2.6)).map((site) => {
      const s = grounded(spot(site.x, site.z, 0.6 + rng() * 0.75, rng() * Math.PI * 2, shade(0.8, 0.34)));
      s.sy *= 0.8 + rng() * 0.45;
      contact(site.x, site.z, 1.15 * s.sx, 0.55);
      return s;
    });
    const saplings: Spot[] = under.ring(rng, 64, 10.6, 44, 2.4, 1.3, growable(2.6)).map((site) => {
      const s = grounded(spot(site.x, site.z, 0.6 + rng() * 0.6, rng() * Math.PI * 2, shade(0.84, 0.3)));
      contact(site.x, site.z, 1.2 * s.sx, 0.45);
      return s;
    });
    // Ferns crowd around the feet of the trees and along the edge of the clearing.
    const ferns: Spot[] = [];
    const placeFern = (x: number, z: number) => {
      if (!growable(1.8)(x, z) || !under.free(x, z, 0.35)) return;
      under.add({ x, z, r: 0.35 });
      const s = grounded(spot(x, z, 0.7 + rng() * 0.6, rng() * Math.PI * 2, shade(0.78, 0.4)));
      ferns.push(s);
      contact(x, z, 0.65 * s.sx, 0.45);
    };
    for (const tree of [...hero, ...mid.filter((t) => Math.hypot(t.x, t.z) < 40)]) {
      const count = Math.floor(rng() * 4);
      for (let k = 0; k < count; k++) {
        const angle = rng() * Math.PI * 2;
        const distance = 0.9 + rng() * 2;
        placeFern(tree.x + Math.cos(angle) * distance, tree.z + Math.sin(angle) * distance);
      }
    }
    for (let i = 0; i < 170; i++) {
      const angle = rng() * Math.PI * 2;
      const distance = 8.4 + Math.pow(rng(), 1.6) * 16;
      placeFern(Math.sin(angle) * distance, Math.cos(angle) * distance);
    }

    // ── Light maps, then everything takes the light of the spot it stands in ──
    const maps: LightMaps = bakeLightMaps(light);
    bin.add(maps.shade);
    bin.add(maps.cover);
    bin.add(maps.noise);
    /** Share of direct sun (0..1) reaching a plant of the given footprint. */
    const sunOn = (x: number, z: number, radius: number): number => {
      let sum = 0;
      for (let k = 0; k < 5; k++) {
        const angle = k * 1.2566;
        const reach = k === 0 ? 0 : radius;
        const value = maps.canopySunAt(x + Math.cos(angle) * reach, z + Math.sin(angle) * reach);
        sum += value < 0 ? 1 - 0.8 * maps.coverAt(x, z) : value;
      }
      return sum / 5;
    };
    const lightPlants = (spots: Spot[], radius: number) => {
      for (const s of spots) s.color.multiplyScalar(0.36 + 0.64 * sunOn(s.x, s.z, radius * s.sx));
    };
    lightPlants(rocks, 0.5);
    lightPlants(logs, 1.5);
    lightPlants(shrubs, 1);
    lightPlants(saplings, 1);
    lightPlants(ferns, 0.5);

    // ── Meshes ──
    const broadleafBark = bin.add(barkMaterial(textures.barkBroadleafColor, textures.barkBroadleafNormal, 0xbdb6a8, wind));
    const coniferBark = bin.add(barkMaterial(textures.barkConiferColor, textures.barkConiferNormal, 0xb3a494, wind));
    const foliage = bin.add(foliageMaterial(atlas.texture, wind));
    const stone = bin.add(new THREE.MeshStandardMaterial({ map: textures.rockColor, normalMap: textures.rockNormal, vertexColors: true, roughness: 0.92, metalness: 0 }));
    stone.envMapIntensity = 0.5;
    stone.onBeforeCompile = (shader) => {
      shader.fragmentShader = dimRimLight(shader.fragmentShader, RIM_ON_SCENERY);
    };
    stone.customProgramCacheKey = () => 'thunes-forest-stone';

    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, spots: Spot[], name: string): void => {
      bin.add(geometry);
      if (spots.length === 0) return;
      group.add(bin.add(instanced(geometry, material, spots, name)));
    };

    // Hero trees: two models per species, bark and foliage instanced separately.
    for (const species of ['broadleaf', 'conifer'] as const) {
      heroModels[species].forEach((model, variant) => {
        const trees = hero.filter((tree, index) => tree.conifer === (species === 'conifer') && index % 2 === variant);
        // Trunks take the light at their foot (sampled a step toward the sun) and dim deeper in the wood.
        const woodSpots = trees.map((tree) => {
          const lit = sunOn(tree.x - shadowX * 1.2, tree.z - shadowZ * 1.2, 0.9);
          const depth = smooth((Math.hypot(tree.x, tree.z) - 10) / 18);
          return toSpot(tree, new THREE.Color().setScalar((0.5 + 0.5 * lit) * (1 - 0.3 * depth)));
        });
        if (model.wood) add(model.wood, species === 'conifer' ? coniferBark : broadleafBark, woodSpots, `forest-${species}-wood-${variant}`);
        add(model.foliage, foliage, trees.map((tree) => toSpot(tree, tree.tint)), `forest-${species}-leaves-${variant}`);
      });
    }
    for (const species of ['broadleaf', 'conifer'] as const) {
      midModels[species].forEach((model, variant) => {
        const trees = mid.filter((tree, index) => tree.conifer === (species === 'conifer') && index % 2 === variant);
        add(model.foliage, foliage, trees.map((tree) => toSpot(tree, tree.tint, true)), `forest-${species}-mid-${variant}`);
      });
      farModels[species].forEach((model, variant) => {
        const distant = far.filter((tree, index) => tree.conifer === (species === 'conifer') && index % 2 === variant);
        add(model.foliage, foliage, distant.map((tree) => toSpot(tree, tree.tint, true)), `forest-${species}-far-${variant}`);
      });
    }
    add(fern(3, atlas), foliage, ferns, 'forest-ferns');
    add(shrub(9, atlas), foliage, shrubs, 'forest-shrubs');
    add(sapling(13, atlas), foliage, saplings, 'forest-saplings');
    add(rock(77), stone, rocks, 'forest-rocks');
    add(log(21), coniferBark, logs, 'forest-logs');

    // ── Ground and grass ──
    const groundMaterial = bin.add(createGroundMaterial(textures, maps));
    const ground = new THREE.Mesh(bin.add(buildTerrain()), groundMaterial);
    ground.name = 'forest-ground';
    ground.receiveShadow = true;
    ground.matrixAutoUpdate = false;
    ground.frustumCulled = false;
    // Drawn after everything that stands on it, so hidden ground costs nothing.
    ground.renderOrder = 2;
    group.add(ground);

    const grass = buildGrass({
      maps,
      wind,
      blocked: (x, z) => {
        for (const site of solid) {
          const dx = site.x - x;
          const dz = site.z - z;
          if (dx * dx + dz * dz < site.r * site.r) return true;
        }
        return false;
      },
      meadow: (x, z) => keepClear(x, z, 0),
    });
    const motes = buildMotes(wind);
    bin.add(motes.geometry);
    bin.add(motes.material as THREE.PointsMaterial);
    const moteMap = (motes.material as THREE.PointsMaterial).map;
    if (moteMap) bin.add(moteMap);
    group.add(motes);

    bin.add(grass[0]!.material as THREE.Material);
    for (const mesh of grass) {
      mesh.renderOrder = 1;
      bin.add(mesh.geometry);
      bin.add(mesh);
      group.add(mesh);
    }
  } catch (error) {
    bin.dispose();
    throw error;
  }

  return {
    object: group,
    ownsGround: true,
    update(seconds) {
      wind.value = seconds % 3600;
    },
    dispose: () => bin.dispose(),
  };
}
