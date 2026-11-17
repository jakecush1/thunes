/**
 * Deterministic free-spot finder for new and cloned dancers.
 *
 * New dancers fill a staggered (hexagonal) crowd facing the camera (+Z):
 * the centre first, then alternating right/left in the front row, then a
 * staggered row behind (−Z), and so on. Clones go to the free lattice spot
 * nearest the original, preferring 1.4 m to its right (+X).
 */

import { STAGE_RADIUS } from '../config';

export interface Spot {
  x: number;
  z: number;
}

/** Horizontal distance between neighbours in a row, metres. */
export const ROW_SPACING = 1.4;
/** Depth between rows, metres (stagger keeps diagonal neighbours ~1.39 m apart). */
export const ROW_DEPTH = 1.2;
/** Two dancers closer than this (metres) are considered to collide. */
export const MIN_SPACING = 1.3;
/** Spots stay this far inside STAGE_RADIUS, metres. */
export const EDGE_MARGIN = 0.3;

const LIMIT = STAGE_RADIUS - EDGE_MARGIN;
const EPS = 1e-6;

function round(v: number): number {
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

function isFree(x: number, z: number, occupied: readonly Spot[], spacing: number): boolean {
  for (const o of occupied) {
    if (Math.hypot(o.x - x, o.z - z) < spacing - EPS) return false;
  }
  return true;
}

function inside(x: number, z: number): boolean {
  return Math.hypot(x, z) <= LIMIT + EPS;
}

interface Candidate extends Spot {
  cost: number;
  order: number;
}

let crowdCache: Candidate[] | null = null;

/** The crowd lattice in preference order (computed once). */
function crowdSlots(): Candidate[] {
  if (crowdCache) return crowdCache;
  const list: Candidate[] = [];
  const rows = Math.ceil(LIMIT / ROW_DEPTH);
  const cols = Math.ceil(LIMIT / ROW_SPACING) + 1;
  for (let r = -rows; r <= rows; r++) {
    const z = -r * ROW_DEPTH;
    const shift = (r & 1) !== 0 ? ROW_SPACING / 2 : 0;
    for (let k = -cols; k <= cols; k++) {
      const x = k * ROW_SPACING + shift;
      if (!inside(x, z)) continue;
      // Rows behind cost 1.6 per metre of depth, rows in front 3 (keep the crowd behind the front line).
      const cost = Math.abs(x) + (z <= 0 ? -z * 1.6 : z * 3);
      // Tie-break: right before left, back before front.
      const order = (x > 0 ? 0 : x < 0 ? 1 : 0) + (z > 0 ? 2 : 0);
      list.push({ x: round(x), z: round(z), cost, order });
    }
  }
  list.sort((a, b) => a.cost - b.cost || a.order - b.order || b.x - a.x || a.z - b.z);
  crowdCache = list;
  return list;
}

/**
 * Picks the spot for a new dancer, given the positions already taken.
 * Returns the first crowd slot at least MIN_SPACING from every occupied
 * spot; if none is free, the slot farthest from its nearest neighbour.
 */
export function findFreeSpot(occupied: readonly Spot[]): Spot {
  const slots = crowdSlots();
  for (const s of slots) {
    if (isFree(s.x, s.z, occupied, MIN_SPACING)) return { x: s.x, z: s.z };
  }
  return farthestSlot(slots, occupied);
}

function farthestSlot(slots: readonly Spot[], occupied: readonly Spot[]): Spot {
  let best: Spot = { x: 0, z: 0 };
  let bestD = -1;
  for (const s of slots) {
    let d = Infinity;
    for (const o of occupied) d = Math.min(d, Math.hypot(o.x - s.x, o.z - s.z));
    if (d > bestD + EPS) {
      bestD = d;
      best = { x: s.x, z: s.z };
    }
  }
  return best;
}

/**
 * Picks the spot for a clone of the dancer at `original`. `occupied` lists
 * every other dancer (the original may be included or not). Prefers the
 * nearest free lattice spot around the original — first 1.4 m to its right
 * (+X), then left, then behind — falling back to findFreeSpot.
 */
export function findCloneSpot(original: Spot, occupied: readonly Spot[]): Spot {
  const taken = occupied.concat([original]);
  const candidates: Candidate[] = [];
  const n = Math.ceil((2 * LIMIT) / ROW_DEPTH) + 1;
  for (let r = -n; r <= n; r++) {
    const dz = -r * ROW_DEPTH;
    const shift = (((r % 2) + 2) % 2) * (ROW_SPACING / 2);
    for (let k = -n; k <= n; k++) {
      const dx = k * ROW_SPACING + shift;
      if (r === 0 && k === 0) continue;
      const x = original.x + dx;
      const z = original.z + dz;
      if (!inside(x, z)) continue;
      const dist = Math.hypot(dx, dz);
      // Same row first, then behind, then in front; right before left.
      const order = (dz === 0 ? 0 : dz < 0 ? 2 : 4) + (dx > 0 ? 0 : 1);
      candidates.push({ x: round(x), z: round(z), cost: Math.round(dist * 10), order });
    }
  }
  candidates.sort((a, b) => a.cost - b.cost || a.order - b.order);
  for (const c of candidates) {
    if (isFree(c.x, c.z, taken, MIN_SPACING)) return { x: c.x, z: c.z };
  }
  return findFreeSpot(taken);
}
