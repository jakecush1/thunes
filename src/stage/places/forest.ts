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
import { bakeLightMaps, buildGrass, buildTerrain, createGroundMaterial, terrainHeight } from './forest-ground';
import type { LightMapInput } from './forest-ground';
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
    shader.fragmentShader = shader.fragmentShader
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
          reflectedLight.directDiffuse += directionalLights[ 0 ].color * RECIPROCAL_PI * diffuseColor.rgb * vec3( 1.05, 1.18, 0.5 ) * ( 0.5 * leafBack );
        #endif`,
      );
  };
  material.customProgramCacheKey = () => 'thunes-forest-foliage';
  return material;
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
  [-8.2, -3.4, false, 1.06],
  [8.6, -2.4, true, 1],
  [4.3, -10.2, false, 1],
  [-3.4, -11.2, true, 1.08],
  [-10.4, 4.4, false, 1.1],
  [11.2, 5.6, false, 0.95],
  [-13, -9.5, true, 1.05],
  [10.4, -9.6, true, 1.12],
  [0.6, -15.5, false, 1.04],
  [-8, -14.5, false, 0.92],
  [14.2, -3.6, false, 1],
  [-14.4, -1, true, 0.96],
];

function toSpot(tree: Tree, color: THREE.Color): Spot {
  const s = spot(tree.x, tree.z, tree.scale, tree.yaw, color);
  s.y = terrainHeight(tree.x, tree.z);
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
    for (const site of scatter.ring(rng, 44, 10.5, HERO_FAR, 4.1, 1.15, outsideClearing(2.5))) {
      hero.push(makeTree(site, isConifer(rng, site.x, site.z), 0.82 + rng() * 0.36));
    }
    const mid = scatter.ring(rng, 330, HERO_FAR, MID_FAR, 4.4, 1.1, outsideClearing(1)).map((site) => makeTree(site, isConifer(rng, site.x, site.z), 0.8 + rng() * 0.45));
    const far = scatter.ring(rng, 1100, MID_FAR, FOREST_FAR, 5.4, 1.25, () => true).map((site) => makeTree(site, isConifer(rng, site.x, site.z), 0.85 + rng() * 0.6));

    // ── Tree models ──
    const heroModels: Record<'broadleaf' | 'conifer', PlantModel[]> = {
      broadleaf: [broadleafHero(11, atlas), broadleafHero(23, atlas)],
      conifer: [coniferHero(31, atlas), coniferHero(47, atlas)],
    };
    const midModels = { broadleaf: broadleafMid(5, atlas), conifer: coniferMid(7, atlas) };
    const farModels = { broadleaf: [broadleafFar(0, atlas), broadleafFar(1, atlas)], conifer: [coniferFar(0, atlas), coniferFar(1, atlas)] };

    const broadleafBark = bin.add(barkMaterial(textures.barkBroadleafColor, textures.barkBroadleafNormal, 0xc9c2b4, wind));
    const coniferBark = bin.add(barkMaterial(textures.barkConiferColor, textures.barkConiferNormal, 0xb9aa9a, wind));
    const foliage = bin.add(foliageMaterial(atlas.texture, wind));

    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, spots: Spot[], name: string): void => {
      bin.add(geometry);
      if (spots.length === 0) return;
      const mesh = bin.add(instanced(geometry, material, spots, name));
      group.add(mesh);
    };

    // What the trees do to the light on the ground.
    const key = context.scene.getObjectByName('key');
    const toSun = (key ? key.position.clone() : KEY_FALLBACK.clone()).normalize();
    const shadowX = -toSun.x / toSun.y;
    const shadowZ = -toSun.z / toSun.y;
    const light: LightMapInput = { canopy: [], trunks: [], cover: [] };
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
      light.canopy.push(tree.x + shadowX * 0.3, tree.z + shadowZ * 0.3, 1.5 * tree.scale, 0.5);
      light.cover.push(tree.x, tree.z, model.crownRadius * tree.scale * 1.7);
    };

    // Hero trees: two models per species, bark and foliage instanced separately.
    for (const species of ['broadleaf', 'conifer'] as const) {
      heroModels[species].forEach((model, variant) => {
        const trees = hero.filter((tree, index) => tree.conifer === (species === 'conifer') && index % 2 === variant);
        for (const tree of trees) castShade(tree, model, 0.34);
        // Trunks deeper in the wood stand in less light.
        const woodSpots = trees.map((tree) => toSpot(tree, new THREE.Color().setScalar(1 - 0.34 * smooth((Math.hypot(tree.x, tree.z) - 9) / 16))));
        if (model.wood) add(model.wood, species === 'conifer' ? coniferBark : broadleafBark, woodSpots, `forest-${species}-wood-${variant}`);
        add(model.foliage, foliage, trees.map((tree) => toSpot(tree, tree.tint)), `forest-${species}-leaves-${variant}`);
      });
    }
    for (const species of ['broadleaf', 'conifer'] as const) {
      const model = midModels[species];
      const trees = mid.filter((tree) => tree.conifer === (species === 'conifer'));
      for (const tree of trees) castShade(tree, model, 0.5);
      add(model.foliage, foliage, trees.map((tree) => toSpot(tree, tree.tint)), `forest-${species}-mid`);
      farModels[species].forEach((farModel, variant) => {
        const distant = far.filter((tree, index) => tree.conifer === (species === 'conifer') && index % 2 === variant);
        for (const tree of distant) light.cover.push(tree.x, tree.z, farModel.crownRadius * tree.scale * 1.7);
        add(farModel.foliage, foliage, distant.map((tree) => toSpot(tree, tree.tint)), `forest-${species}-far-${variant}`);
      });
    }

    // ── Undergrowth ──
    const trunks: Site[] = hero.map((tree) => ({ x: tree.x, z: tree.z, r: 0.75 * tree.scale }));
    const solid: Site[] = [...trunks];
    const under = new Scatter();
    for (const trunk of trunks) under.add(trunk);
    for (const tree of mid) under.add({ x: tree.x, z: tree.z, r: 0.5 });
    const growable = (reach: number) => (x: number, z: number) => Math.hypot(x, z) > 6.6 + reach && !inCorridor(x, z) && !keepClear(x, z, reach * 0.5);
    const shade = (base: number, spread: number) => new THREE.Color().setScalar(base + rng() * spread);
    const contact = (x: number, z: number, r: number, darkness: number) => light.canopy.push(x + shadowX * r * 0.35, z + shadowZ * r * 0.35, r, darkness);

    // Rocks first (they are solid), a big one in view behind the dancers.
    const rocks: Spot[] = [];
    const placeRock = (x: number, z: number, size: number) => {
      const s = spot(x, z, size, rng() * Math.PI * 2, shade(0.8, 0.3));
      s.sx *= 0.85 + rng() * 0.4;
      s.sy *= 0.75 + rng() * 0.5;
      s.y = terrainHeight(x, z) - 0.04 * size;
      rocks.push(s);
      solid.push({ x, z, r: size * 0.55 });
      contact(x, z, size * 0.75, 0.55);
    };
    for (const [x, z, size] of [
      [6.6, -4.9, 1.9],
      [7.5, -5.9, 0.9],
      [-6.3, -6.6, 1.3],
      [-9.4, 0.6, 1.1],
    ] as const) {
      under.add({ x, z, r: size * 0.6 });
      placeRock(x, z, size);
    }
    for (const site of under.ring(rng, 30, 7.6, 34, 1.6, 1.4, growable(1))) placeRock(site.x, site.z, 0.45 + rng() * rng() * 1.6);

    const logs: Spot[] = [];
    for (const [x, z, yaw, size] of [
      [-5.2, -9.3, -0.5, 1],
      [9.8, -6.2, 1.1, 0.85],
      [-12.6, 3.4, 0.2, 1.15],
      [3.2, -17.5, 2.4, 1],
      [16.5, 4.5, -1, 0.9],
    ] as const) {
      const s = spot(x, z, size, yaw, shade(0.85, 0.2));
      logs.push(s);
      for (let k = -2; k <= 2; k++) {
        const site = { x: x + Math.cos(yaw) * k * size, z: z - Math.sin(yaw) * k * size, r: 0.5 * size };
        under.add(site);
        solid.push({ ...site, r: 0.3 * size });
        contact(site.x, site.z, 0.6 * size, 0.5);
      }
    }

    const shrubs: Spot[] = under.ring(rng, 130, 7.9, 38, 1.9, 1.45, growable(1.3)).map((site) => {
      const s = spot(site.x, site.z, 0.6 + rng() * 0.95, rng() * Math.PI * 2, shade(0.8, 0.34));
      s.sy *= 0.8 + rng() * 0.45;
      contact(site.x, site.z, 1.1 * s.sx, 0.5);
      return s;
    });
    const saplings: Spot[] = under.ring(rng, 64, 8.4, 42, 2.4, 1.3, growable(1.6)).map((site) => {
      const s = spot(site.x, site.z, 0.6 + rng() * 0.7, rng() * Math.PI * 2, shade(0.84, 0.3));
      contact(site.x, site.z, 1.2 * s.sx, 0.42);
      return s;
    });
    // Ferns crowd around the feet of the trees and along the edge of the clearing.
    const ferns: Spot[] = [];
    const placeFern = (x: number, z: number) => {
      if (!growable(0.6)(x, z) || !under.free(x, z, 0.35)) return;
      under.add({ x, z, r: 0.35 });
      const s = spot(x, z, 0.7 + rng() * 0.7, rng() * Math.PI * 2, shade(0.78, 0.4));
      s.y = terrainHeight(x, z);
      ferns.push(s);
      contact(x, z, 0.6 * s.sx, 0.4);
    };
    for (const tree of [...hero, ...mid.filter((t) => Math.hypot(t.x, t.z) < 40)]) {
      const count = Math.floor(rng() * 4);
      for (let k = 0; k < count; k++) {
        const angle = rng() * Math.PI * 2;
        const distance = 0.9 + rng() * 2;
        placeFern(tree.x + Math.cos(angle) * distance, tree.z + Math.sin(angle) * distance);
      }
    }
    for (let i = 0; i < 150; i++) {
      const angle = rng() * Math.PI * 2;
      const distance = 7.3 + Math.pow(rng(), 1.6) * 16;
      placeFern(Math.sin(angle) * distance, Math.cos(angle) * distance);
    }

    add(fern(3, atlas), foliage, ferns, 'forest-ferns');
    add(shrub(9, atlas), foliage, shrubs, 'forest-shrubs');
    add(sapling(13, atlas), foliage, saplings, 'forest-saplings');
    const stone = bin.add(new THREE.MeshStandardMaterial({ map: textures.rockColor, normalMap: textures.rockNormal, vertexColors: true, roughness: 0.92, metalness: 0 }));
    stone.envMapIntensity = 0.5;
    add(rock(77), stone, rocks, 'forest-rocks');
    add(log(21), coniferBark, logs, 'forest-logs');

    // ── Ground and grass ──
    const maps = bakeLightMaps(light);
    bin.add(maps.shade);
    bin.add(maps.cover);
    bin.add(maps.noise);
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
    grass.renderOrder = 1;
    bin.add(grass.geometry);
    bin.add(grass.material as THREE.Material);
    bin.add(grass);
    group.add(grass);
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
