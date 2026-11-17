/**
 * The city's ground: asphalt roads with worn paint, raised pavements with
 * kerb stones, and a few photographed covers, drains and patches.
 * All of it is flat at y = 0 around the stage and receives the dancers' shadows.
 */
import * as THREE from 'three';
import type { CityLook } from './city-look';
import { MeshBuilder } from './city-mesh';
import { BLOCK_SPANS, EDGE, KERB, ROAD, SIDE_STREETS } from './city-plan';
import type { CityPlan, Rect } from './city-plan';
import { mulberry32 } from './shared';

export interface GroundTextures {
  asphalt: THREE.Texture;
  asphaltNormal: THREE.Texture;
  paving: THREE.Texture;
  pavingNormal: THREE.Texture;
  concrete: THREE.Texture;
  decals: THREE.Texture;
  decalsAlpha: THREE.Texture;
}

/** One repeat of the asphalt / paving photographs, metres. */
const ASPHALT_TILE = 3.1;
const PAVING_TILE = 3.5;
/** Width of the kerb stones. */
const KERB_STONE = 0.3;

/** Value noise shared by the ground shaders: `groundCloud` is 0..1 with a mean of one half. */
const GROUND_NOISE = /* glsl */ `
float groundHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float groundNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(groundHash(i), groundHash(i + vec2(1.0, 0.0)), f.x), mix(groundHash(i + vec2(0.0, 1.0)), groundHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float groundCloud(vec2 p) {
  return 0.55 * groundNoise(p) + 0.3 * groundNoise(p * 2.13 + 7.1) + 0.15 * groundNoise(p * 4.7 + 3.3);
}
`;

const ROAD_HEAD = /* glsl */ `
${GROUND_NOISE}
float roadBand(float x, float lo, float hi) {
  float w = fwidth(x) * 0.75 + 1e-5;
  return smoothstep(lo - w, lo + w, x) * (1.0 - smoothstep(hi - w, hi + w, x));
}
/** Repeating stripe: 1 on the first "duty" of every unit of x; fades to its average when too small to draw. */
float roadStripe(float x, float duty) {
  float w = fwidth(x) * 0.75 + 1e-5;
  float t = abs(fract(x - duty * 0.5) - 0.5);
  float line = 1.0 - smoothstep(duty * 0.5 - w, duty * 0.5 + w, t);
  return mix(line, duty, clamp(w * 2.5 - 0.3, 0.0, 1.0));
}
float roadTrack;
float roadOil;
float roadPaint;
float roadBlot;
`;

/**
 * Asphalt with large-scale variation, polished wheel tracks, oil under the
 * parked cars, dirt in the gutters, and the paint: centre line, parking bays,
 * stop lines and zebra crossings on the four arms of the junction.
 */
const ROAD_ALBEDO = /* glsl */ `
{
  vec2 rp = vCityPos.xz;
  vec2 ap = abs(rp);
  // The photograph's own grain, about 1 on average.
  float grain = diffuseColor.g * 5.1;
  roadBlot = groundCloud(rp * 0.37);
  float cloud = groundCloud(rp * 0.057 + 19.0);
  // Which arm of the junction this is, how far along it, and how far across (positive on the side that drives toward the junction).
  bool zArm = ap.y > ap.x;
  float along = zArm ? ap.y : ap.x;
  float lat = zArm ? rp.x * sign(rp.y) : -rp.y * sign(rp.x);
  float alat = abs(lat);
  float onRoad = 1.0 - step(${ROAD.toFixed(1)}, alat);
  // Side streets cross here: no paint.
  float clear = clamp(1.0 - step(abs(along - ${SIDE_STREETS[0]!.toFixed(1)}), 7.0) - step(abs(along - ${SIDE_STREETS[1]!.toFixed(1)}), 7.0), 0.0, 1.0);
  float arm = onRoad * clear * smoothstep(${(ROAD + 0.5).toFixed(1)}, ${(ROAD + 3).toFixed(1)}, along);

  roadTrack = arm * exp(-pow((abs(alat - 1.75) - 0.82) / 0.36, 2.0));
  float parking = arm * smoothstep(3.6, 4.2, alat) * step(13.0, along);
  roadOil = parking * smoothstep(0.6, 0.78, groundCloud(rp * 0.9 + 41.0));
  float gutter = onRoad * smoothstep(${(ROAD - 1.1).toFixed(1)}, ${ROAD.toFixed(1)}, alat);

  vec3 asphalt = diffuseColor.rgb * vec3(0.62, 0.62, 0.64) * (0.6 + 0.45 * roadBlot + 0.4 * cloud);
  asphalt *= 1.0 - 0.15 * roadTrack - 0.4 * roadOil - 0.25 * gutter;

  float paint = 0.0;
  // Zebra crossings.
  paint += roadBand(along, 7.0, 10.0) * roadBand(alat, -1.0, 5.55) * roadStripe(lat + 0.25, 0.5);
  // Stop line across the lane that approaches the junction.
  paint += roadBand(along, 11.1, 11.5) * roadBand(lat, 0.12, 3.44);
  // Centre line: solid up to the junction, dashed beyond.
  float dash = mix(1.0, roadStripe(along / 9.0, 0.34), step(32.0, along));
  paint += roadBand(alat, -1.0, 0.075) * step(11.5, along) * dash;
  // Parking lane: a broken edge line and a tick between the bays.
  paint += roadBand(alat, 3.44, 3.56) * step(13.0, along) * roadStripe(along, 0.5);
  paint += roadBand(alat, 3.56, 5.7) * step(13.0, along) * roadStripe(along / 6.0, 0.02);
  paint = clamp(paint, 0.0, 1.0) * onRoad * clear * step(${(ROAD + 0.4).toFixed(1)}, along);
  // Worn away where the stones of the asphalt show through, more so in the wheel tracks.
  float worn = smoothstep(0.35, 0.75, grain + (roadBlot - 0.5) * 0.8 - roadTrack * 0.2);
  roadPaint = paint * worn;
  vec3 line = vec3(0.74, 0.72, 0.66) * (0.75 + 0.25 * grain);
  diffuseColor.rgb = mix(asphalt, line, roadPaint);
}
`;

const ROAD_SURFACE = /* glsl */ `
roughnessFactor = clamp(0.88 - 0.22 * roadTrack - 0.3 * roadOil - 0.14 * roadPaint + (0.5 - roadBlot) * 0.22, 0.35, 1.0);
`;

const PAVING_ALBEDO = /* glsl */ `
{
  vec2 pp = vCityPos.xz;
  diffuseColor.rgb *= vec3(0.8, 0.79, 0.78) * (0.66 + 0.4 * groundCloud(pp * 0.31 + 5.0) + 0.3 * groundCloud(pp * 0.05));
}
`;

/** Kerb stones a metre long with dark joints (u runs along the kerb, in metres). */
const KERB_ALBEDO = /* glsl */ `
{
  float w = fwidth(vMapUv.x) + 1e-5;
  float joint = 1.0 - smoothstep(0.008, 0.008 + w, abs(fract(vMapUv.x) - 0.5));
  float stone = 0.85 + 0.3 * fract(sin(floor(vMapUv.x + 0.5) * 12.9898) * 43758.5453);
  diffuseColor.rgb *= vec3(1.0, 0.985, 0.95) * stone * (1.0 - 0.6 * joint * clamp(1.5 - w * 20.0, 0.0, 1.0));
}
`;

/** The kerb line of a block: a rectangle with rounded corners, going clockwise seen from above. */
function outline(rect: Rect, radius: number, insetBy: number, steps: number): [number, number][] {
  const points: [number, number][] = [];
  const r = radius - insetBy;
  const corners: [number, number, number][] = [
    [rect.x1 - radius, rect.z1 - radius, Math.PI / 2],
    [rect.x1 - radius, rect.z0 + radius, 0],
    [rect.x0 + radius, rect.z0 + radius, -Math.PI / 2],
    [rect.x0 + radius, rect.z1 - radius, -Math.PI],
  ];
  for (const [cx, cz, start] of corners) {
    for (let i = 0; i <= steps; i++) {
      const angle = start - (i / steps) * (Math.PI / 2);
      points.push([cx + Math.cos(angle) * r, cz + Math.sin(angle) * r]);
    }
  }
  return points;
}

/** Where the decals sit in the 2 x 2 atlas: [u0, v0, u1, v1]. */
const ATLAS = {
  round: [0.012, 0.512, 0.488, 0.988],
  square: [0.512, 0.512, 0.988, 0.988],
  drain: [0.012, 0.07, 0.488, 0.36],
  patch: [0.512, 0.012, 0.988, 0.488],
} as const;

export interface BuiltGroundOld {
  meshes: THREE.Mesh[];
  materials: THREE.Material[];
}

export function buildGround(plan: CityPlan, look: CityLook, textures: GroundTextures): BuiltGround {
  const rng = mulberry32(4421);

  // ── Roads: every cell of the street grid that is not a block ──
  const lines: number[] = [-EDGE];
  for (let i = BLOCK_SPANS.length - 1; i >= 0; i--) lines.push(-BLOCK_SPANS[i]![1], -BLOCK_SPANS[i]![0]);
  for (const [near, far] of BLOCK_SPANS) lines.push(near, far);
  lines.push(EDGE);
  const road = new MeshBuilder();
  for (let i = 0; i < lines.length - 1; i++) {
    for (let j = 0; j < lines.length - 1; j++) {
      if (i % 2 === 1 && j % 2 === 1) continue;
      road.flat(lines[i]!, lines[i + 1]!, lines[j]!, lines[j + 1]!, 0, 1 / ASPHALT_TILE);
    }
  }

  // ── Pavements: a slab per block, edged with kerb stones ──
  const paving = new MeshBuilder();
  const kerb = new MeshBuilder();
  for (const block of plan.blocks) {
    const steps = 6;
    const radius = 2.5;
    const outer = outline(block, radius, 0, steps);
    const inner = outline(block, radius, KERB_STONE, steps);
    const count = outer.length;
    const cx = (block.x0 + block.x1) / 2;
    const cz = (block.z0 + block.z1) / 2;
    const centre = paving.vertex(cx, KERB, cz, 0, 1, 0, cx / PAVING_TILE, -cz / PAVING_TILE);
    const first = paving.vertexCount;
    for (const [x, z] of inner) paving.vertex(x, KERB, z, 0, 1, 0, x / PAVING_TILE, -z / PAVING_TILE);
    for (let i = 0; i < count; i++) paving.triangle(centre, first + i, first + ((i + 1) % count));
    let travelled = Math.floor(rng() * 7) * 0.13;
    for (let i = 0; i < count; i++) {
      const [ax, az] = outer[i]!;
      const [bx, bz] = outer[(i + 1) % count]!;
      const [ix, iz] = inner[i]!;
      const [jx, jz] = inner[(i + 1) % count]!;
      const length = Math.hypot(bx - ax, bz - az);
      const a = kerb.vertex(ax, KERB, az, 0, 1, 0, travelled, 0);
      const b = kerb.vertex(bx, KERB, bz, 0, 1, 0, travelled + length, 0);
      const c = kerb.vertex(jx, KERB, jz, 0, 1, 0, travelled + length, KERB_STONE);
      const d = kerb.vertex(ix, KERB, iz, 0, 1, 0, travelled, KERB_STONE);
      kerb.face(a, b, c, d);
      kerb.wall(ax, az, bx, bz, -0.03, KERB, travelled, travelled + length, -0.18, 0);
      travelled += length;
    }
  }

  // ── Decals: covers, drains and patches ──
  const decals = new MeshBuilder();
  const decal = (kind: keyof typeof ATLAS, x: number, z: number, width: number, depth: number, yaw: number, shade: number): void => {
    const [u0, v0, u1, v1] = ATLAS[kind];
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const at = (lx: number, lz: number, u: number, v: number) => decals.vertex(x + lx * c + lz * s, 0.004, z - lx * s + lz * c, 0, 1, 0, u, v);
    decals.tint(shade, shade, shade);
    const hw = width / 2;
    const hd = depth / 2;
    decals.face(at(-hw, hd, u0, v0), at(hw, hd, u1, v0), at(hw, -hd, u1, v1), at(-hw, -hd, u0, v1));
  };
  // Around the stage: a cover and a mended patch in the foreground, a square cover further back.
  decal('round', -2.35, 3.3, 0.86, 0.86, 0.4, 0.8);
  decal('patch', 3.2, -3.4, 2.6, 2.2, 0.03, 0.5);
  decal('square', 1.5, -5.2, 0.72, 0.72, 0, 0.72);
  decal('round', 2.1, -14.6, 0.86, 0.86, 1.3, 0.75);
  decal('patch', -2.0, -24.5, 3.4, 2.4, 0, 0.46);
  decal('round', -14.5, 1.9, 0.86, 0.86, 2.1, 0.8);
  decal('patch', 19.0, -2.3, 3.0, 2.2, Math.PI / 2, 0.5);
  decal('square', 16.2, 2.4, 0.72, 0.72, 0, 0.7);
  for (const sign of [-1, 1]) {
    for (let d = 26; d < 150; d += 17 + rng() * 22) {
      const kind = rng() < 0.55 ? 'round' : rng() < 0.5 ? 'square' : 'patch';
      const across = (rng() - 0.5) * 6.4;
      const size = kind === 'patch' ? 2 + rng() * 1.6 : kind === 'round' ? 0.86 : 0.72;
      const shade = kind === 'patch' ? 0.42 + rng() * 0.14 : 0.7 + rng() * 0.12;
      if (rng() < 0.5) decal(kind, across, sign * d, size, kind === 'patch' ? size * 0.7 : size, rng() * 3, shade);
      else decal(kind, sign * d, across, size, kind === 'patch' ? size * 0.7 : size, rng() * 3, shade);
    }
    // Drains in the gutters of the four arms.
    for (const side of [-1, 1]) {
      for (let d = 8.6; d < 150; d += 23) {
        if (Math.abs(d - SIDE_STREETS[0]!) < 6) continue;
        decal('drain', side * (ROAD - 0.24), sign * d, 0.56, 0.36, Math.PI / 2, 0.8);
        decal('drain', sign * d, side * (ROAD - 0.24), 0.56, 0.36, 0, 0.8);
      }
    }
  }

  const meshes: THREE.Mesh[] = [];
  const materials: THREE.Material[] = [];
  const add = (builder: MeshBuilder, material: THREE.Material, name: string, color = false): THREE.Mesh => {
    const mesh = new THREE.Mesh(builder.build({ color }), material);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    meshes.push(mesh);
    materials.push(material);
    return mesh;
  };

  const roadMaterial = look.patch(new THREE.MeshStandardMaterial({ map: textures.asphalt, normalMap: textures.asphaltNormal, roughness: 1, metalness: 0 }), 0.62, {
    stageLights: 'ground',
    key: 'road',
    fragmentHead: ROAD_HEAD,
    albedo: ROAD_ALBEDO,
    surface: ROAD_SURFACE,
  });
  add(road, roadMaterial, 'city-road');

  const pavingMaterial = look.patch(new THREE.MeshStandardMaterial({ map: textures.paving, normalMap: textures.pavingNormal, roughness: 0.86, metalness: 0 }), 0.62, {
    stageLights: 'ground',
    key: 'paving',
    fragmentHead: GROUND_NOISE,
    albedo: PAVING_ALBEDO,
  });
  add(paving, pavingMaterial, 'city-pavement');

  const kerbMaterial = look.patch(new THREE.MeshStandardMaterial({ map: textures.concrete, roughness: 0.82, metalness: 0, color: 0xd0ccc4 }), 0.62, {
    stageLights: 'ground',
    key: 'kerb',
    albedo: KERB_ALBEDO,
  });
  add(kerb, kerbMaterial, 'city-kerbs');

  const decalMaterial = look.patch(
    new THREE.MeshStandardMaterial({
      map: textures.decals,
      alphaMap: textures.decalsAlpha,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      roughness: 0.72,
      metalness: 0,
    }),
    0.62,
    { stageLights: 'ground', key: 'decal' },
  );
  add(decals, decalMaterial, 'city-decals', true).renderOrder = 1;

  return { meshes, materials };
}
