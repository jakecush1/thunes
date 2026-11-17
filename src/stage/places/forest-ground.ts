/**
 * Forest ground: the terrain with its photographic, sun-dappled material, the
 * light maps baked from where the trees stand, and the instanced grass blades.
 */
import * as THREE from 'three';
import { mulberry32, smooth } from './shared';
import type { ForestTextures } from './forest-textures';

type Rng = () => number;

/** Edge length (metres) of the square around the stage covered by the baked shade map. */
export const SHADE_SPAN = 60;
/** Edge length (metres) of the square covered by the tree-cover map. */
export const COVER_SPAN = 340;
const SHADE_SIZE = 1024;
const COVER_SIZE = 256;
/** Ground is level out to here; beyond, it rises into wooded hills. */
const LEVEL_RADIUS = 46;

/** Height of the ground at (x, z), metres. Zero anywhere the camera can go. */
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r <= LEVEL_RADIUS) return 0;
  const t = smooth((r - LEVEL_RADIUS) / 115);
  const a = Math.atan2(x, z);
  return t * (6 + 3.4 * Math.sin(a * 3 + 1.3) + 2.2 * Math.sin(a * 7 + 0.4) + 1.3 * Math.sin(r * 0.05 + a * 2));
}

/** The ground: a disc of rings, fine near the stage and reaching past the fog. */
export function buildTerrain(): THREE.BufferGeometry {
  const radii = [0, 3, 6, 9, 12, 16, 21, 27, 34, 42, LEVEL_RADIUS, 52, 60, 70, 82, 96, 112, 130, 156, 190, 240, 330];
  const segments = 72;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const radius of radii) {
    for (let j = 0; j <= segments; j++) {
      const angle = (j / segments) * Math.PI * 2;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      positions.push(x, terrainHeight(x, z), z);
    }
  }
  const row = segments + 1;
  for (let i = 0; i < radii.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * row + j;
      if (i > 0) indices.push(a, a + row + 1, a + 1);
      indices.push(a, a + row, a + row + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// ───────────────────────────────────────────────────────── light maps ──

export interface LightMapInput {
  /** Foliage shadows on the ground: x, z, radius, darkness (0..1), four numbers each. */
  canopy: number[];
  /** Trunk shadows: x0, z0, x1, z1, width, five numbers each. */
  trunks: number[];
  /** Tree crowns seen from above: x, z, radius, three numbers each. */
  cover: number[];
  /** Dim ground under and beside low things (rocks, shrubs, trunks): x, z, radius, darkness. */
  contact: number[];
}

export interface LightMaps {
  /** R: how much direct sun reaches the ground near the stage (1 = full sun). */
  shade: THREE.DataTexture;
  /** R: 1 = open sky above, 0 = under the trees. */
  cover: THREE.DataTexture;
  /** Tiling noise: R dapple, G and B slow colour variation. */
  noise: THREE.DataTexture;
  /** Direct sun (0..1) at a point of the ground. */
  sunAt(x: number, z: number): number;
  /** Direct sun (0..1) under the tree crowns alone, ignoring what low plants and rocks shade: the light a plant standing there gets. */
  canopySunAt(x: number, z: number): number;
  /** Tree cover (0..1) at a point of the ground. */
  coverAt(x: number, z: number): number;
}

function softDisc(inner: number, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, `rgba(${color}, 1)`);
  gradient.addColorStop(inner, `rgba(${color}, 1)`);
  gradient.addColorStop(1, `rgba(${color}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return canvas;
}

function redChannel(ctx: CanvasRenderingContext2D, size: number): Uint8Array {
  const data = ctx.getImageData(0, 0, size, size).data;
  const out = new Uint8Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4]!;
  return out;
}

function dataTexture(data: Uint8Array, size: number, format: THREE.PixelFormat, repeat: boolean): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, size, size, format, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Smooth noise that tiles: random values on a `period` × `period` lattice, blended. */
function tilingNoise(size: number, period: number, rng: Rng): Float32Array {
  const lattice = new Float32Array(period * period);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * period;
    const y0 = Math.floor(fy);
    const ty = smooth(fy - y0);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period;
      const x0 = Math.floor(fx);
      const tx = smooth(fx - x0);
      const a = lattice[(y0 % period) * period + (x0 % period)]!;
      const b = lattice[(y0 % period) * period + ((x0 + 1) % period)]!;
      const c = lattice[((y0 + 1) % period) * period + (x0 % period)]!;
      const d = lattice[((y0 + 1) % period) * period + ((x0 + 1) % period)]!;
      out[y * size + x] = a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * ty;
    }
  }
  return out;
}

/** Bakes where the trees shade the ground and where they cover it. */
export function bakeLightMaps(input: LightMapInput): LightMaps {
  const rng = mulberry32(90210);

  // Shade: white = sun. Each clump of leaves stamps a soft dark disc; overlaps deepen.
  const shadeCanvas = document.createElement('canvas');
  shadeCanvas.width = shadeCanvas.height = SHADE_SIZE;
  const sctx = shadeCanvas.getContext('2d', { willReadFrequently: true });
  const coverCanvas = document.createElement('canvas');
  coverCanvas.width = coverCanvas.height = COVER_SIZE;
  const cctx = coverCanvas.getContext('2d', { willReadFrequently: true });
  if (!sctx || !cctx) throw new Error('The forest needs a 2D canvas to bake its light.');
  const dark = softDisc(0.45, '0, 0, 0');
  const bright = softDisc(0.3, '255, 255, 255');
  const toShade = SHADE_SIZE / SHADE_SPAN;
  sctx.fillStyle = '#fff';
  sctx.fillRect(0, 0, SHADE_SIZE, SHADE_SIZE);
  sctx.strokeStyle = '#000';
  sctx.lineCap = 'round';
  sctx.globalAlpha = 0.78;
  for (let i = 0; i < input.trunks.length; i += 5) {
    sctx.lineWidth = Math.max(2, input.trunks[i + 4]! * toShade);
    sctx.beginPath();
    sctx.moveTo((input.trunks[i]! / SHADE_SPAN + 0.5) * SHADE_SIZE, (input.trunks[i + 1]! / SHADE_SPAN + 0.5) * SHADE_SIZE);
    sctx.lineTo((input.trunks[i + 2]! / SHADE_SPAN + 0.5) * SHADE_SIZE, (input.trunks[i + 3]! / SHADE_SPAN + 0.5) * SHADE_SIZE);
    sctx.stroke();
  }
  const stamp = (list: number[]) => {
    for (let i = 0; i < list.length; i += 4) {
      const r = list[i + 2]! * toShade;
      const x = (list[i]! / SHADE_SPAN + 0.5) * SHADE_SIZE;
      const y = (list[i + 1]! / SHADE_SPAN + 0.5) * SHADE_SIZE;
      if (x < -r || y < -r || x > SHADE_SIZE + r || y > SHADE_SIZE + r) continue;
      sctx.globalAlpha = list[i + 3]!;
      sctx.drawImage(dark, x - r, y - r, r * 2, r * 2);
    }
  };
  stamp(input.canopy);
  // Flecks of sun that find their way through the leaves.
  for (let i = 0; i < 4200; i++) {
    const r = (0.06 + rng() * rng() * 0.26) * toShade;
    sctx.globalAlpha = 0.25 + rng() * 0.6;
    sctx.drawImage(bright, rng() * SHADE_SIZE - r, rng() * SHADE_SIZE - r, r * 2, r * 2);
  }
  const canopyData = redChannel(sctx, SHADE_SIZE);
  stamp(input.contact);
  sctx.globalAlpha = 1;
  const shadeData = redChannel(sctx, SHADE_SIZE);

  // Cover: white = open sky.
  const toCover = COVER_SIZE / COVER_SPAN;
  cctx.fillStyle = '#fff';
  cctx.fillRect(0, 0, COVER_SIZE, COVER_SIZE);
  cctx.globalAlpha = 0.6;
  for (let i = 0; i < input.cover.length; i += 3) {
    const r = Math.max(2.5, input.cover[i + 2]! * toCover);
    cctx.drawImage(dark, (input.cover[i]! / COVER_SPAN + 0.5) * COVER_SIZE - r, (input.cover[i + 1]! / COVER_SPAN + 0.5) * COVER_SIZE - r, r * 2, r * 2);
  }
  cctx.globalAlpha = 1;
  const coverData = redChannel(cctx, COVER_SIZE);

  const noiseSize = 256;
  const layers = [8, 17, 4, 9, 6, 13].map((period) => tilingNoise(noiseSize, period, rng));
  const noiseData = new Uint8Array(noiseSize * noiseSize * 4);
  for (let i = 0; i < noiseSize * noiseSize; i++) {
    noiseData[i * 4] = Math.round(255 * (layers[0]![i]! * 0.6 + layers[1]![i]! * 0.4));
    noiseData[i * 4 + 1] = Math.round(255 * (layers[2]![i]! * 0.6 + layers[3]![i]! * 0.4));
    noiseData[i * 4 + 2] = Math.round(255 * (layers[4]![i]! * 0.55 + layers[5]![i]! * 0.45));
    noiseData[i * 4 + 3] = 255;
  }

  const sample = (data: Uint8Array, size: number, span: number, x: number, z: number, outside: number) => {
    const px = Math.floor((x / span + 0.5) * size);
    const py = Math.floor((z / span + 0.5) * size);
    if (px < 0 || py < 0 || px >= size || py >= size) return outside;
    return data[py * size + px]! / 255;
  };
  return {
    shade: dataTexture(shadeData, SHADE_SIZE, THREE.RedFormat, false),
    cover: dataTexture(coverData, COVER_SIZE, THREE.RedFormat, false),
    noise: dataTexture(noiseData, noiseSize, THREE.RGBAFormat, true),
    sunAt: (x, z) => sample(shadeData, SHADE_SIZE, SHADE_SPAN, x, z, 0.4),
    canopySunAt: (x, z) => sample(canopyData, SHADE_SIZE, SHADE_SPAN, x, z, -1),
    coverAt: (x, z) => 1 - sample(coverData, COVER_SIZE, COVER_SPAN, x, z, 0),
  };
}

// ──────────────────────────────────────────────────── ground material ──

/**
 * Scales every directional light but the first (the sun-like key light) in a
 * built-in material's fragment shader. The stage's rim light outlines the
 * dancers; on scenery it would only flatten the sun and shade.
 */
export function dimRimLight(fragmentShader: string, scale: number): string {
  const chunk = THREE.ShaderChunk.lights_fragment_begin.replace(
    'getDirectionalLightInfo( directionalLight, directLight );',
    `getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= ( UNROLLED_LOOP_INDEX == 0 ) ? 1.0 : ${scale.toFixed(3)};`,
  );
  return fragmentShader.replace('#include <lights_fragment_begin>', chunk);
}

/**
 * The ground: grass in the open, mossy forest floor under the trees, each
 * sampled at two scales so the tiling does not show, lit by the baked sun map.
 */
export function createGroundMaterial(textures: ForestTextures, maps: LightMaps): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  material.name = 'forest-ground';
  material.envMapIntensity = 0.5;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrassMap = { value: textures.grassColor };
    shader.uniforms.uGrassNormal = { value: textures.grassNormal };
    shader.uniforms.uFloorMap = { value: textures.floorColor };
    shader.uniforms.uFloorNormal = { value: textures.floorNormal };
    shader.uniforms.uShade = { value: maps.shade };
    shader.uniforms.uCover = { value: maps.cover };
    shader.uniforms.uNoise = { value: maps.noise };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vForestPos;\nvarying vec3 vForestNormal;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vForestPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        vForestNormal = normalize( mat3( modelMatrix ) * objectNormal );`,
      );
    shader.fragmentShader = dimRimLight(shader.fragmentShader, 0.1)
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uGrassMap;
        uniform sampler2D uGrassNormal;
        uniform sampler2D uFloorMap;
        uniform sampler2D uFloorNormal;
        uniform sampler2D uShade;
        uniform sampler2D uCover;
        uniform sampler2D uNoise;
        varying vec3 vForestPos;
        varying vec3 vForestNormal;`,
      )
      .replace(
        '#include <map_fragment>',
        `vec2 gp = vForestPos.xz;
        vec2 gq = mat2( 0.819, -0.574, 0.574, 0.819 ) * gp;
        float gDist = length( vViewPosition );
        vec3 gSlow = texture2D( uNoise, gp * 0.0113 ).rgb;
        vec3 gPatch = texture2D( uNoise, gq * 0.049 + 0.31 ).rgb;
        float gCover = 1.0 - texture2D( uCover, gp / ${COVER_SPAN.toFixed(1)} + 0.5 ).r;
        // Grass gives way to moss, soil and litter under the trees, in ragged patches.
        float gFloor = smoothstep( 0.3, 0.62, gCover + ( gPatch.g - 0.5 ) * 0.5 );
        float gFar = smoothstep( 6.0, 30.0, gDist );
        vec3 gGrass = mix( texture2D( uGrassMap, gp * 0.61 ).rgb, texture2D( uGrassMap, gq * 0.139 ).rgb, 0.12 + 0.62 * gFar );
        vec3 gSoil = mix( texture2D( uFloorMap, gq * 0.33 ).rgb, texture2D( uFloorMap, gp * 0.079 ).rgb, 0.12 + 0.6 * gFar );
        // Slow drifts of colour and half-metre mottling: lusher and drier patches, clover, thin spots.
        float gMottle = texture2D( uNoise, gp * 0.41 + 0.7 ).r;
        gGrass *= mix( vec3( 0.6, 0.78, 0.52 ), vec3( 1.0, 1.1, 0.8 ), gSlow.g ) * ( 0.8 + 0.42 * gMottle );
        gGrass = mix( gGrass, gGrass * vec3( 1.25, 1.08, 0.7 ), smoothstep( 0.56, 0.8, gPatch.b ) * 0.45 );
        gSoil *= mix( vec3( 0.42, 0.45, 0.36 ), vec3( 0.74, 0.74, 0.6 ), gSlow.b ) * ( 0.84 + 0.3 * gMottle );
        diffuseColor.rgb *= mix( gGrass, gSoil, gFloor );
        // Sun: the baked map near the stage, a generic dapple under the trees beyond it.
        vec2 gShadeUv = gp / ${SHADE_SPAN.toFixed(1)} + 0.5;
        float gBaked = 1.0 - smoothstep( 0.43, 0.5, max( abs( gShadeUv.x - 0.5 ), abs( gShadeUv.y - 0.5 ) ) );
        float gDapple = smoothstep( 0.42, 0.6, texture2D( uNoise, gp * 0.083 ).r * 0.6 + texture2D( uNoise, gq * 0.23 ).r * 0.4 );
        float gGeneric = mix( 1.0, gDapple * 0.85, smoothstep( 0.12, 0.55, gCover ) );
        float gSun = mix( gGeneric, texture2D( uShade, gShadeUv ).r, gBaked );
        // Where the crowns block the sun they block much of the sky too.
        float gSky = ( 1.0 - 0.4 * gCover ) * mix( 0.6, 1.0, gSun );`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `vec3 gBump = mix( texture2D( uGrassNormal, gp * 0.57 ).xyz, texture2D( uFloorNormal, gq * 0.31 ).xyz, gFloor ) * 2.0 - 1.0;
        float gBumpScale = 1.2 * ( 1.0 - smoothstep( 10.0, 38.0, gDist ) );
        normal = normalize( ( viewMatrix * vec4( normalize( vForestNormal + vec3( gBump.x, 0.0, -gBump.y ) * gBumpScale ), 0.0 ) ).xyz );`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        reflectedLight.directDiffuse *= gSun;
        reflectedLight.directSpecular *= gSun;
        reflectedLight.indirectDiffuse *= gSky;
        reflectedLight.indirectSpecular *= gSky * 0.5;`,
      );
  };
  material.customProgramCacheKey = () => 'thunes-forest-ground';
  return material;
}

// ───────────────────────────────────────────────────────────── grass ──

export interface GrassOptions {
  maps: LightMaps;
  /** Shared clock uniform, seconds. */
  wind: { value: number };
  /** True where a blade must not grow (trunks, rocks). */
  blocked(x: number, z: number): boolean;
  /** True in the corridor between the default camera and the stage (open meadow). */
  meadow(x: number, z: number): boolean;
}

/** One blade: a tapered, curved strip one unit tall and one unit wide. */
function bladeGeometry(): THREE.BufferGeometry {
  const rows = [
    [0, 0.5],
    [0.36, 0.43],
    [0.7, 0.27],
  ] as const;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const curve = (t: number) => 0.42 * t * t;
  for (const [t, half] of rows) {
    for (const sign of [-1, 1]) {
      positions.push(sign * half, t, curve(t));
      // Mostly upward normals, so the blades take the light as the ground does; rounded across the width.
      normals.push(sign * 0.35, 0.9, 0.25);
      uvs.push(sign < 0 ? 0 : 1, t);
    }
  }
  positions.push(0, 1, curve(1));
  normals.push(0, 0.92, 0.38);
  uvs.push(0.5, 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 4, 5, 6]);
  return geometry;
}

function grassMaterial(wind: { value: number }): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  material.name = 'forest-grass';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = wind;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uWindTime;
        attribute float aSun;
        varying vec2 vBlade;`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 bladeWorld = instanceMatrix * vec4( transformed, 1.0 );
        vec3 bladeRoot = instanceMatrix[ 3 ].xyz;
        float bladeHeight = length( instanceMatrix[ 1 ].xyz );
        // Gusts roll across the clearing; roots stay put, tips swing most.
        float gust = 0.3 + 0.6 * sin( uWindTime * 1.3 + bladeRoot.x * 0.45 + bladeRoot.z * 0.31 ) + 0.25 * sin( uWindTime * 2.9 + bladeRoot.x * 1.3 - bladeRoot.z * 0.9 );
        float flutter = 0.12 * sin( uWindTime * 6.1 + bladeRoot.x * 7.0 + bladeRoot.z * 5.0 );
        float bendAmount = uv.y * uv.y * bladeHeight * 0.3;
        bladeWorld.x += ( gust + flutter ) * bendAmount;
        bladeWorld.z += ( gust * 0.55 - flutter ) * bendAmount;
        bladeWorld.y -= abs( gust ) * bendAmount * 0.3;
        vBlade = vec2( uv.y, aSun );
        vec4 mvPosition = modelViewMatrix * bladeWorld;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBlade;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Dark at the root, where the blades shade each other; bright at the tip.
        diffuseColor.rgb *= mix( vec3( 0.2, 0.26, 0.13 ), vec3( 1.0 ), smoothstep( 0.0, 0.85, vBlade.x ) );`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        reflectedLight.directDiffuse *= vBlade.y;
        #if NUM_DIR_LIGHTS > 0
          // Sunlight glowing through the upper blade.
          reflectedLight.directDiffuse += directionalLights[ 0 ].color * RECIPROCAL_PI * diffuseColor.rgb * vec3( 1.0, 1.1, 0.5 ) * ( 0.22 * vBlade.x * vBlade.y );
        #endif`,
      );
  };
  material.customProgramCacheKey = () => 'thunes-forest-grass';
  return material;
}

/** Tens of thousands of blades: a short lawn where the dancers stand, taller tufts around it. */
export function buildGrass(options: GrassOptions): THREE.InstancedMesh {
  const rng = mulberry32(1234);
  const { maps } = options;
  const blades: number[] = []; // x, z, height, width, yaw, tilt, tone
  const add = (x: number, z: number, height: number, width: number, tone: number) => {
    if (options.blocked(x, z)) return;
    blades.push(x, z, height, width, rng() * Math.PI * 2, (rng() - 0.5) * 0.9, tone);
  };

  // The lawn: short enough everywhere on the stage that feet stay in view.
  const LAWN = 7.8;
  for (let i = 0; i < 19000; i++) {
    const r = Math.sqrt(rng()) * LAWN;
    const angle = rng() * Math.PI * 2;
    const x = Math.sin(angle) * r;
    const z = Math.cos(angle) * r;
    const edge = smooth((r - 5.6) / 2.2);
    add(x, z, (0.05 + rng() * 0.07) * (1 + edge * 0.8), 0.014 + rng() * 0.012, rng());
  }
  // Tufts: taller grass in clumps around the lawn, thinning under the trees and with distance.
  const tufts = (count: number, near: number, far: number, bias: number, minHeight: number, maxHeight: number, perTuft: number) => {
    for (let i = 0; i < count; i++) {
      const r = near + Math.pow(rng(), bias) * (far - near);
      const angle = rng() * Math.PI * 2;
      const cx = Math.sin(angle) * r;
      const cz = Math.cos(angle) * r;
      const open = options.meadow(cx, cz) ? 1 : 1 - maps.coverAt(cx, cz) * 0.85;
      if (rng() > open) continue;
      const grow = smooth((r - LAWN) / 3.5);
      const tall = minHeight + (maxHeight - minHeight) * grow * (0.5 + rng() * 0.5);
      const n = Math.round(perTuft * (0.6 + rng() * 0.8));
      const tone = rng();
      for (let k = 0; k < n; k++) {
        const spread = 0.05 + rng() * 0.16;
        const a = rng() * Math.PI * 2;
        add(cx + Math.cos(a) * spread, cz + Math.sin(a) * spread, tall * (0.55 + rng() * 0.6), 0.02 + rng() * 0.02, Math.min(1, Math.max(0, tone + (rng() - 0.5) * 0.3)));
      }
    }
  };
  tufts(2300, LAWN - 0.4, 17, 1.35, 0.14, 0.5, 7);
  tufts(900, 17, 32, 1.2, 0.3, 0.62, 6);

  const count = blades.length / 7;
  const geometry = bladeGeometry();
  const sun = new Float32Array(count);
  const mesh = new THREE.InstancedMesh(geometry, grassMaterial(options.wind), count);
  mesh.name = 'forest-grass';
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const color = new THREE.Color();
  const lush = new THREE.Color().setRGB(0.36, 0.52, 0.17, THREE.SRGBColorSpace);
  const olive = new THREE.Color().setRGB(0.53, 0.6, 0.25, THREE.SRGBColorSpace);
  const straw = new THREE.Color().setRGB(0.72, 0.68, 0.36, THREE.SRGBColorSpace);
  for (let i = 0; i < count; i++) {
    const o = i * 7;
    const x = blades[o]!;
    const z = blades[o + 1]!;
    const height = blades[o + 2]!;
    const tone = blades[o + 6]!;
    euler.set(blades[o + 5]!, blades[o + 4]!, 0);
    rotation.setFromEuler(euler);
    matrix.compose(position.set(x, -0.005, z), rotation, scale.set(blades[o + 3]!, height, height));
    mesh.setMatrixAt(i, matrix);
    color.copy(lush).lerp(olive, tone);
    if (tone > 0.9) color.lerp(straw, (tone - 0.9) * 6);
    mesh.setColorAt(i, color);
    sun[i] = maps.sunAt(x, z);
  }
  geometry.setAttribute('aSun', new THREE.InstancedBufferAttribute(sun, 1));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.receiveShadow = true;
  return mesh;
}
