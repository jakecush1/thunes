/**
 * The city's buildings: box volumes skinned with photographed facades.
 *
 * Every wall is mapped so that it starts and ends between windows and holds a
 * whole number of storeys; party walls (against a neighbour) are blank. Each
 * building stands on a glazed ground floor of shop fronts, carries a parapet
 * and some roof clutter, and tall ones step back above a podium.
 */
import * as THREE from 'three';
import type { CityLook } from './city-look';
import { MeshBuilder } from './city-mesh';
import type { CityPart } from './city-mesh';
import { GROUND_FLOOR, STOREY } from './city-plan';
import type { Building, CityPlan, FacadeKind, Tier } from './city-plan';
import { mulberry32 } from './shared';

export interface FacadeTextures {
  map: THREE.Texture;
  normal: THREE.Texture;
  metal: THREE.Texture;
}

export interface BuildingTextures {
  facades: Record<FacadeKind, FacadeTextures>;
  concrete: THREE.Texture;
}

interface FacadeSpec {
  /** Window bays and storeys in one repeat of the photograph. */
  cols: number;
  rows: number;
  /** Where a wall may start, in cells: 0.5 when the windows sit on the cell corners of the photograph. */
  shift: number;
  /** Share of windows that are lit. */
  lit: number;
  /** Colour of parapets, pilasters and party walls. */
  trim: number;
}

const FACADES: Record<FacadeKind, FacadeSpec> = {
  brick: { cols: 6, rows: 6, shift: 0.5, lit: 0.2, trim: 0x8f7466 },
  stone: { cols: 6, rows: 6, shift: 0.5, lit: 0.22, trim: 0x807b76 },
  pier: { cols: 6, rows: 6, shift: 0.5, lit: 0.2, trim: 0x7d5e52 },
  band: { cols: 14, rows: 8, shift: 0, lit: 0.15, trim: 0xc9c9c4 },
  glass: { cols: 16, rows: 10, shift: 0, lit: 0.1, trim: 0x4b5058 },
};

/** Shop fronts reuse the curtain-wall photograph: one row of its panes, three panes to a shop. */
const SHOP_COLS = 16;
const SHOP_ROWS = 10;
const SHOP_PANES = 3;
const SHOP_TOP = 3.75;
const PLINTH = 0.45;

const SIGN_COLORS = [0x1c1d20, 0x2a2623, 0x1a2526, 0x33201d, 0x20242e, 0x34332f, 0x3f382a, 0x1f2a22, 0x161617, 0x4a4640];
const AWNING_COLORS = [0x7a2e24, 0x24503c, 0x26406a, 0x8a6a2a, 0x3a3a3a, 0x6e2f45, 0xb8ad98];

const HASH = /* glsl */ `
float cityHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

/** Glass is smooth and mirror-like, masonry rough (the metalness map marks the glass). */
const GLASS_SURFACE = /* glsl */ `
roughnessFactor = mix(0.9, 0.07, metalnessFactor);
`;

/** Some windows are lit: warm for the most part, a few cool offices, brighter toward the ceiling. */
const WINDOW_GLOW = /* glsl */ `
{
  vec2 cellUv = vMapUv * uCells.xy + uCells.z;
  vec2 cell = floor(cellUv);
  float lit = step(cityHash(cell), uLit.x);
  vec3 lamp = mix(vec3(1.0, 0.58, 0.26), vec3(1.0, 0.82, 0.56), cityHash(cell + 17.3));
  lamp = mix(lamp, vec3(0.7, 0.86, 1.0), step(0.86, cityHash(cell + 4.1)));
  float level = mix(0.3, 1.0, cityHash(cell + 9.7));
  float inside = mix(0.5, 1.0, smoothstep(0.15, 0.85, fract(cellUv.y)));
  totalEmissiveRadiance += lamp * (lit * level * inside * metalnessFactor * uLit.y * (0.25 + 2.2 * dot(diffuseColor.rgb, vec3(0.333))));
}
`;

/** Shops: most are open, lit from the ceiling, with uneven rows of stock in the lower half. */
const SHOP_GLOW = /* glsl */ `
{
  vec2 pane = vMapUv * vec2(${SHOP_COLS}.0, ${SHOP_ROWS}.0);
  vec2 shop = vec2(floor(pane.x / ${SHOP_PANES}.0), floor(pane.y));
  float open = step(cityHash(shop), uLit.x);
  vec3 lamp = mix(vec3(1.0, 0.7, 0.4), vec3(1.0, 0.9, 0.74), cityHash(shop + 7.7));
  float height = fract(pane.y);
  float column = 0.72 + 0.28 * sin(pane.x * 7.0 + cityHash(shop) * 40.0) * sin(pane.x * 2.3 + 1.7);
  float shelf = 0.84 + 0.16 * smoothstep(0.3, 0.5, abs(fract(height * 6.0) - 0.5) * 2.0);
  float interior = mix(0.2, 1.0, smoothstep(0.0, 0.9, height)) * mix(column * shelf, 1.0, smoothstep(0.45, 0.7, height));
  totalEmissiveRadiance += lamp * (open * interior * metalnessFactor * uLit.y);
}
`;

/** Wall from A to B (A on the left seen from outside) plus its outward normal. */
interface Side {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  nx: number;
  nz: number;
  length: number;
}

function sides(rect: { x0: number; x1: number; z0: number; z1: number }): [Side, Side, Side, Side] {
  const { x0, x1, z0, z1 } = rect;
  return [
    { ax: x1, az: z1, bx: x1, bz: z0, nx: 1, nz: 0, length: z1 - z0 },
    { ax: x0, az: z0, bx: x0, bz: z1, nx: -1, nz: 0, length: z1 - z0 },
    { ax: x0, az: z1, bx: x1, bz: z1, nx: 0, nz: 1, length: x1 - x0 },
    { ax: x1, az: z0, bx: x0, bz: z0, nx: 0, nz: -1, length: x1 - x0 },
  ];
}

/** A box given in wall coordinates: `a` along the wall from A, `out` away from it. */
function wallBox(builder: MeshBuilder, side: Side, a0: number, a1: number, y0: number, y1: number, out0: number, out1: number, bottom = false): void {
  const dx = (side.bx - side.ax) / side.length;
  const dz = (side.bz - side.az) / side.length;
  const px = side.ax + dx * a0 + side.nx * out0;
  const pz = side.az + dz * a0 + side.nz * out0;
  const qx = side.ax + dx * a1 + side.nx * out1;
  const qz = side.az + dz * a1 + side.nz * out1;
  builder.box(Math.min(px, qx), Math.max(px, qx), y0, y1, Math.min(pz, qz), Math.max(pz, qz), 0.25, bottom);
}

export interface BuiltBuildings extends CityPart {
  /** Tops of the tall buildings (for aviation lights). */
  masts: { x: number; y: number; z: number }[];
}

export function buildBuildings(plan: CityPlan, look: CityLook, textures: BuildingTextures): BuiltBuildings {
  const rng = mulberry32(977);
  const walls: Record<FacadeKind, MeshBuilder> = { brick: new MeshBuilder(), stone: new MeshBuilder(), pier: new MeshBuilder(), band: new MeshBuilder(), glass: new MeshBuilder() };
  const shops = new MeshBuilder();
  const plain = new MeshBuilder();
  const masts: BuiltBuildings['masts'] = [];

  const facadeWall = (kind: FacadeKind, side: Side, y0: number, y1: number): void => {
    const spec = FACADES[kind];
    const storey = STOREY[kind];
    // The photograph is square: a bay is as wide as a storey is tall, times rows / cols.
    const bay = (storey * spec.rows) / spec.cols;
    const bays = Math.max(1, Math.round(side.length / bay));
    const floors = Math.max(1, Math.round((y1 - y0) / storey));
    const u0 = (spec.shift + Math.floor(rng() * spec.cols)) / spec.cols + Math.floor(rng() * 40);
    const v0 = (spec.shift + Math.floor(rng() * spec.rows)) / spec.rows + Math.floor(rng() * 40);
    walls[kind].wall(side.ax, side.az, side.bx, side.bz, y0, y1, u0, u0 + bays / spec.cols, v0, v0 + floors / spec.rows);
  };

  const groundFloor = (side: Side, trim: THREE.Color, detailed: boolean): void => {
    const shopCount = Math.max(1, Math.round(side.length / 6.2));
    const panes = shopCount * SHOP_PANES;
    const u0 = (Math.floor(rng() * 5) * SHOP_PANES) / SHOP_COLS + Math.floor(rng() * 40);
    const v0 = Math.floor(rng() * SHOP_ROWS) / SHOP_ROWS + Math.floor(rng() * 40);
    shops.wall(side.ax, side.az, side.bx, side.bz, PLINTH, SHOP_TOP, u0, u0 + panes / SHOP_COLS, v0, v0 + 1 / SHOP_ROWS);
    plain.tint(0.2, 0.19, 0.185);
    wallBox(plain, side, 0, side.length, 0, PLINTH, 0, 0.06);
    const width = side.length / shopCount;
    for (let i = 0; i < shopCount; i++) {
      // Sign band over each shop.
      plain.paint(SIGN_COLORS[Math.floor(rng() * SIGN_COLORS.length)]!, 0.7 + rng() * 0.5);
      wallBox(plain, side, i * width, (i + 1) * width, SHOP_TOP, GROUND_FLOOR, 0, 0.14, true);
      const awning = rng() < 0.24;
      const color = AWNING_COLORS[Math.floor(rng() * AWNING_COLORS.length)]!;
      if (detailed && awning) {
        plain.paint(color, 0.8);
        const a0 = i * width + 0.35;
        const a1 = (i + 1) * width - 0.35;
        const dx = (side.bx - side.ax) / side.length;
        const dz = (side.bz - side.az) / side.length;
        const at = (a: number, out: number): [number, number] => [side.ax + dx * a + side.nx * out, side.az + dz * a + side.nz * out];
        const [x0, z0] = at(a0, 0.14);
        const [x1, z1] = at(a1, 0.14);
        const [x2, z2] = at(a1, 1.35);
        const [x3, z3] = at(a0, 1.35);
        const top = SHOP_TOP - 0.02;
        const low = SHOP_TOP - 0.55;
        // Sloped canvas (both faces) and a short valance.
        const slope = Math.hypot(1.21, 0.53);
        const ny = 1.21 / slope;
        const nh = 0.53 / slope;
        const a = plain.vertex(x3, low, z3, side.nx * nh, ny, side.nz * nh, 0, 0);
        const b = plain.vertex(x2, low, z2, side.nx * nh, ny, side.nz * nh, 1, 0);
        const c = plain.vertex(x1, top, z1, side.nx * nh, ny, side.nz * nh, 1, 1);
        const d = plain.vertex(x0, top, z0, side.nx * nh, ny, side.nz * nh, 0, 1);
        plain.face(a, b, c, d);
        plain.paint(color, 0.45);
        const e = plain.vertex(x3, low, z3, -side.nx * nh, -ny, -side.nz * nh, 0, 0);
        const f = plain.vertex(x2, low, z2, -side.nx * nh, -ny, -side.nz * nh, 1, 0);
        const g = plain.vertex(x1, top, z1, -side.nx * nh, -ny, -side.nz * nh, 1, 1);
        const h = plain.vertex(x0, top, z0, -side.nx * nh, -ny, -side.nz * nh, 0, 1);
        plain.face(h, g, f, e);
        plain.paint(color, 0.7);
        plain.wall(x3, z3, x2, z2, low - 0.2, low, 0, 1, 0, 0.1);
      }
    }
    if (detailed) {
      plain.tint(trim.r, trim.g, trim.b);
      for (let i = 0; i <= shopCount; i++) {
        const centre = Math.min(side.length - 0.24, Math.max(0.24, i * width));
        wallBox(plain, side, centre - 0.24, centre + 0.24, 0, SHOP_TOP, 0, 0.2);
      }
    }
  };

  const roof = (tier: Tier, trim: THREE.Color, parapet: boolean): void => {
    const shade = 0.75 + rng() * 0.4;
    plain.tint(0.2 * shade, 0.195 * shade, 0.185 * shade);
    plain.flat(tier.x0, tier.x1, tier.z0, tier.z1, tier.y1, 0.25);
    if (!parapet) return;
    plain.tint(trim.r, trim.g, trim.b);
    const out = 0.12;
    const thick = 0.3;
    const top = tier.y1 + 0.9;
    plain.box(tier.x0 - out, tier.x1 + out, tier.y1 - 0.25, top, tier.z0 - out, tier.z0 + thick, 0.25, true);
    plain.box(tier.x0 - out, tier.x1 + out, tier.y1 - 0.25, top, tier.z1 - thick, tier.z1 + out, 0.25, true);
    plain.box(tier.x0 - out, tier.x0 + thick, tier.y1 - 0.25, top, tier.z0 + thick, tier.z1 - thick, 0.25, true);
    plain.box(tier.x1 - thick, tier.x1 + out, tier.y1 - 0.25, top, tier.z0 + thick, tier.z1 - thick, 0.25, true);
  };

  const clutter = (building: Building, tier: Tier): void => {
    const width = tier.x1 - tier.x0;
    const depth = tier.z1 - tier.z0;
    if (width < 8 || depth < 5) return;
    const y = tier.y1;
    const within = (margin: number, size: number, span: number, start: number) => start + margin + rng() * Math.max(0, span - 2 * margin - size);
    // Stair and lift room.
    const bw = Math.min(width - 3, 3.5 + rng() * 3);
    const bd = Math.min(depth - 3, 3 + rng() * 2.5);
    const bx = within(1.2, bw, width, tier.x0);
    const bz = within(1.2, bd, depth, tier.z0);
    const tone = 0.32 + rng() * 0.2;
    plain.tint(tone, tone * 0.98, tone * 0.95);
    plain.box(bx, bx + bw, y, y + 2.6 + rng() * 1.2, bz, bz + bd, 0.25);
    // Air handlers.
    const units = 1 + Math.floor(rng() * 4);
    for (let i = 0; i < units; i++) {
      const ux = within(1, 1.8, width, tier.x0);
      const uz = within(1, 1.2, depth, tier.z0);
      plain.tint(0.36, 0.37, 0.38);
      plain.box(ux, ux + 1.8, y + 0.25, y + 1.35, uz, uz + 1.2, 0.5);
      plain.tint(0.08, 0.08, 0.09);
      plain.box(ux + 0.25, ux + 1.55, y + 1.35, y + 1.38, uz + 0.2, uz + 1.0, 0.5);
    }
    const tall = building.tiers.length > 1 && tier.y1 > 45;
    if (!tall && depth >= 7 && building.facade !== 'glass' && building.facade !== 'band' && rng() < 0.4) {
      // A rooftop water tank on a steel stand.
      const tx = within(2.2, 0, width, tier.x0);
      const tz = within(2.2, 0, depth, tier.z0);
      plain.tint(0.1, 0.1, 0.11);
      for (const [ox, oz] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        plain.box(tx + ox - 0.07, tx + ox + 0.07, y, y + 1.9, tz + oz - 0.07, tz + oz + 0.07, 1);
      }
      plain.tint(0.22, 0.155, 0.1);
      plain.cylinder(tx, tz, y + 1.9, y + 4.5, 1.55, 1.55, 14, false);
      plain.tint(0.13, 0.12, 0.12);
      plain.cylinder(tx, tz, y + 4.5, y + 5.4, 1.7, 0.05, 14, false);
    }
    if (tall) {
      const mx = tier.x0 + width * (0.3 + rng() * 0.4);
      const mz = tier.z0 + depth * (0.3 + rng() * 0.4);
      const height = 5 + rng() * 9;
      plain.tint(0.2, 0.2, 0.21);
      plain.cylinder(mx, mz, y, y + height, 0.12, 0.05, 6, false);
      masts.push({ x: mx, y: y + height, z: mz });
    }
  };

  const trim = new THREE.Color();
  for (const building of plan.buildings) {
    const spec = FACADES[building.facade];
    trim.setHex(spec.trim).multiplyScalar(0.82 + rng() * 0.3);
    const near = building.distance < 115;
    building.tiers.forEach((tier, index) => {
      const tierSides = sides(tier);
      tierSides.forEach((side, s) => {
        const open = index > 0 || building.open[s]!;
        if (!open) {
          // Party wall: blank render, a little darker than the trim.
          plain.tint(trim.r * 0.62, trim.g * 0.6, trim.b * 0.58);
          plain.wall(side.ax, side.az, side.bx, side.bz, 0, tier.y1, 0, side.length * 0.25, 0, tier.y1 * 0.25);
          return;
        }
        if (index === 0) {
          groundFloor(side, trim, near);
          facadeWall(building.facade, side, GROUND_FLOOR, tier.y1);
        } else {
          facadeWall(building.facade, side, tier.y0, tier.y1);
        }
      });
      roof(tier, trim, building.distance < 160);
    });
    if (building.distance < 160) clutter(building, building.tiers[building.tiers.length - 1]!);
  }

  const meshes: THREE.Mesh[] = [];
  const materials: THREE.Material[] = [];
  const add = (builder: MeshBuilder, material: THREE.Material, name: string, color: boolean): void => {
    if (builder.vertexCount === 0) return;
    const mesh = new THREE.Mesh(builder.build({ color }), material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    meshes.push(mesh);
    materials.push(material);
  };

  for (const kind of Object.keys(walls) as FacadeKind[]) {
    const spec = FACADES[kind];
    const set = textures.facades[kind];
    const material = look.patch(new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normal, metalnessMap: set.metal, metalness: 1, roughness: 1 }), 1, {
      stageLights: 'none',
      key: 'facade',
      uniforms: {
        uCells: { value: new THREE.Vector3(spec.cols, spec.rows, spec.shift) },
        uLit: { value: new THREE.Vector2(spec.lit, 1.25) },
      },
      fragmentHead: `uniform vec3 uCells;\nuniform vec2 uLit;\n${HASH}`,
      surface: GLASS_SURFACE,
      emissive: WINDOW_GLOW,
    });
    material.normalScale.set(1.3, 1.3);
    add(walls[kind], material, `city-facade-${kind}`, false);
  }

  const glass = textures.facades.glass;
  const shopMaterial = look.patch(new THREE.MeshStandardMaterial({ map: glass.map, normalMap: glass.normal, metalnessMap: glass.metal, metalness: 1, roughness: 1 }), 1, {
    stageLights: 'none',
    key: 'shop',
    uniforms: { uLit: { value: new THREE.Vector2(0.62, 0.95) } },
    fragmentHead: `uniform vec2 uLit;\n${HASH}`,
    surface: GLASS_SURFACE,
    emissive: SHOP_GLOW,
  });
  add(shops, shopMaterial, 'city-shops', false);

  const plainMaterial = look.patch(new THREE.MeshStandardMaterial({ map: textures.concrete, vertexColors: true, roughness: 0.9, metalness: 0 }), 1, {
    stageLights: 'none',
    key: 'plain',
    // The concrete photograph is nearly white: keep only its texture.
    albedo: 'diffuseColor.rgb *= 1.9;',
  });
  add(plain, plainMaterial, 'city-masonry', true);

  return { meshes, materials, masts };
}
