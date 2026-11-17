/**
 * The city's street plan: two main streets crossing at the stage, side streets
 * every 70 m or so, and the buildings that fill the blocks between them.
 * Pure data, on a one-metre grid, the same on every load.
 *
 * On the camera's side (+Z) the frontages step back so nothing solid stands
 * in the corridor between the default camera and the stage: the street opens
 * into a small square there.
 */
import { inCorridor, mulberry32 } from './shared';

/** Half-width of the two main roads, kerb to centre line. */
export const ROAD = 6;
/** Pavement width along the main roads / the side streets. */
export const WALK = 4;
export const SIDE_WALK = 3;
/** Height of the pavements above the road. */
export const KERB = 0.15;
/** The ground ends here (well inside the fog). */
export const EDGE = 400;
/** Kerb-to-kerb extent of the three rings of blocks, on the positive side of either axis. */
export const BLOCK_SPANS: readonly (readonly [number, number])[] = [
  [6, 74],
  [82, 148],
  [156, 224],
];
/** Centre lines of the side streets (both axes, both signs). */
export const SIDE_STREETS: readonly number[] = [78, 152];
/** Height of the ground floor (shop fronts) of every building. */
export const GROUND_FLOOR = 4.5;

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export type FacadeKind = 'brick' | 'stone' | 'pier' | 'band' | 'glass';

/** Storey height per facade, metres (the facade photographs are scaled to it). */
export const STOREY: Record<FacadeKind, number> = { brick: 3.3, stone: 3.5, pier: 3.3, band: 3.4, glass: 3.4 };

/** One box of a building: the whole footprint, or a set-back upper part. */
export interface Tier extends Rect {
  y0: number;
  y1: number;
}

export interface Building {
  tiers: Tier[];
  facade: FacadeKind;
  /** Walls of the lowest tier that face a street or square (+X, -X, +Z, -Z); the others touch a neighbour. */
  open: [boolean, boolean, boolean, boolean];
  /** Distance from the stage to the nearest point of the footprint. */
  distance: number;
  seed: number;
}

export interface CityPlan {
  /** Kerb-to-kerb rectangles: raised pavement with buildings on it. */
  blocks: Rect[];
  buildings: Building[];
}

function contains(rect: Rect, x: number, z: number): boolean {
  return x > rect.x0 && x < rect.x1 && z > rect.z0 && z < rect.z1;
}

/** Cut a rectangle into lots of roughly 14 to 30 m. */
function subdivide(rect: Rect, rng: () => number, out: Rect[]): void {
  const width = rect.x1 - rect.x0;
  const depth = rect.z1 - rect.z0;
  const longest = Math.max(width, depth);
  if (longest <= 30 && (longest <= 20 || rng() < 0.4)) {
    out.push(rect);
    return;
  }
  const cut = Math.round(longest * (0.36 + rng() * 0.28));
  if (cut < 10 || longest - cut < 10) {
    out.push(rect);
    return;
  }
  if (width >= depth) {
    subdivide({ ...rect, x1: rect.x0 + cut }, rng, out);
    subdivide({ ...rect, x0: rect.x0 + cut }, rng, out);
  } else {
    subdivide({ ...rect, z1: rect.z0 + cut }, rng, out);
    subdivide({ ...rect, z0: rect.z0 + cut }, rng, out);
  }
}

function distanceTo(rect: Rect): number {
  const dx = Math.max(rect.x0, Math.min(0, rect.x1));
  const dz = Math.max(rect.z0, Math.min(0, rect.z1));
  return Math.hypot(dx, dz);
}

function pick<T>(rng: () => number, options: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const [, weight] of options) total += weight;
  let roll = rng() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return options[0]![0];
}

function inset(rect: Rect, by: number): Rect {
  return { x0: rect.x0 + by, x1: rect.x1 - by, z0: rect.z0 + by, z1: rect.z1 - by };
}

function raise(rng: () => number, lot: Rect, distance: number): Pick<Building, 'tiers' | 'facade'> {
  const size = Math.min(lot.x1 - lot.x0, lot.z1 - lot.z0);
  const tower = size >= 16 && distance > 38 && rng() < 0.27;
  if (tower) {
    const facade = pick<FacadeKind>(rng, [
      ['glass', 4],
      ['band', 3],
      ['stone', 2],
      ['pier', 1],
    ]);
    const storey = STOREY[facade];
    const podiumFloors = 2 + Math.floor(rng() * 3);
    const shaftFloors = 9 + Math.floor(rng() * 15);
    const podiumTop = GROUND_FLOOR + podiumFloors * storey;
    const shaft = inset(lot, 2 + Math.floor(rng() * 3));
    const shaftTop = podiumTop + shaftFloors * storey;
    const tiers: Tier[] = [
      { ...lot, y0: 0, y1: podiumTop },
      { ...shaft, y0: podiumTop, y1: shaftTop },
    ];
    if (size >= 22 && rng() < 0.6) tiers.push({ ...inset(shaft, 2 + Math.floor(rng() * 2)), y0: shaftTop, y1: shaftTop + (2 + Math.floor(rng() * 3)) * storey });
    return { tiers, facade };
  }
  const facade = pick<FacadeKind>(rng, [
    ['brick', 3],
    ['stone', 3],
    ['pier', 3],
    ['band', 2],
    ['glass', 1],
  ]);
  const storey = STOREY[facade];
  const floors = 4 + Math.floor(rng() * 5) + (distance > 60 ? Math.floor(rng() * 3) : 0);
  const top = GROUND_FLOOR + floors * storey;
  const tiers: Tier[] = [{ ...lot, y0: 0, y1: top }];
  if (size >= 16 && rng() < 0.3) tiers.push({ ...inset(lot, 3), y0: top, y1: top + (1 + Math.floor(rng() * 2)) * storey });
  return { tiers, facade };
}

export function createCityPlan(): CityPlan {
  const rng = mulberry32(2107);
  const blocks: Rect[] = [];
  const lots: Rect[] = [];

  for (let ix = 0; ix < BLOCK_SPANS.length; ix++) {
    for (let iz = 0; iz < BLOCK_SPANS.length; iz++) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const [a0, a1] = BLOCK_SPANS[ix]!;
          const [b0, b1] = BLOCK_SPANS[iz]!;
          blocks.push({ x0: Math.min(sx * a0, sx * a1), x1: Math.max(sx * a0, sx * a1), z0: Math.min(sz * b0, sz * b1), z1: Math.max(sz * b0, sz * b1) });
          // Where buildings may stand, in |x|, |z|: the block minus its pavements.
          const near = (i: number) => (i === 0 ? WALK : SIDE_WALK);
          const zone = { x0: a0 + near(ix), x1: a1 - SIDE_WALK, z0: b0 + near(iz), z1: b1 - SIDE_WALK };
          const parts: Rect[] = [];
          if (ix === 0 && iz === 0 && sz > 0) {
            // The square on the camera's side: three rows stepping back, clear of the camera corridor.
            parts.push({ x0: 12, x1: zone.x1, z0: zone.z0, z1: 16 }, { x0: 17, x1: zone.x1, z0: 16, z1: 24 }, { x0: 23, x1: zone.x1, z0: 24, z1: 34 }, { ...zone, z0: 34 });
          } else {
            parts.push(zone);
          }
          for (const part of parts) {
            const cut: Rect[] = [];
            subdivide(part, rng, cut);
            for (const lot of cut) {
              lots.push({ x0: Math.min(sx * lot.x0, sx * lot.x1), x1: Math.max(sx * lot.x0, sx * lot.x1), z0: Math.min(sz * lot.z0, sz * lot.z1), z1: Math.max(sz * lot.z0, sz * lot.z1) });
            }
          }
        }
      }
    }
  }

  /** True when the point is inside no lot, i.e. on a street, a pavement or the square. */
  const isOpen = (x: number, z: number): boolean => {
    for (const lot of lots) if (contains(lot, x, z)) return false;
    return true;
  };
  const wallOpen = (ax: number, az: number, bx: number, bz: number): boolean => {
    for (const t of [0.2, 0.5, 0.8]) if (isOpen(ax + (bx - ax) * t, az + (bz - az) * t)) return true;
    return false;
  };

  const buildings: Building[] = [];
  for (const lot of lots) {
    // Belt and braces: nothing may stand in the camera corridor or on the stage.
    let blocked = false;
    for (let x = lot.x0; x <= lot.x1 && !blocked; x += 1) {
      for (let z = lot.z0; z <= lot.z1 && !blocked; z += 1) blocked = inCorridor(x, z) || Math.hypot(x, z) < 9;
    }
    const distance = distanceTo(lot);
    const seed = Math.floor(rng() * 1e6);
    const shape = raise(rng, lot, distance);
    if (blocked) continue;
    const out = 0.7;
    buildings.push({
      ...shape,
      distance,
      seed,
      open: [
        wallOpen(lot.x1 + out, lot.z0, lot.x1 + out, lot.z1),
        wallOpen(lot.x0 - out, lot.z0, lot.x0 - out, lot.z1),
        wallOpen(lot.x0, lot.z1 + out, lot.x1, lot.z1 + out),
        wallOpen(lot.x0, lot.z0 - out, lot.x1, lot.z0 - out),
      ],
    });
  }
  return { blocks, buildings };
}
