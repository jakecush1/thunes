import { describe, expect, it } from 'vitest';
import { MAX_DANCERS, STAGE_RADIUS } from '../../../src/config';
import { MIN_SPACING, findCloneSpot, findFreeSpot, type Spot } from '../../../src/core/placement';

function fill(n: number): Spot[] {
  const spots: Spot[] = [];
  for (let i = 0; i < n; i++) spots.push(findFreeSpot(spots));
  return spots;
}

function minDistance(spots: Spot[]): number {
  let m = Infinity;
  for (let i = 0; i < spots.length; i++)
    for (let j = i + 1; j < spots.length; j++) m = Math.min(m, Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z));
  return m;
}

describe('findFreeSpot', () => {
  it('starts at the centre, then alternates right/left in the front row, then a staggered row behind', () => {
    const s = fill(5);
    expect(s[0]).toEqual({ x: 0, z: 0 });
    expect(s[1].z).toBe(0);
    expect(s[2].z).toBe(0);
    expect(s[1].x).toBeGreaterThan(0);
    expect(s[2].x).toBeCloseTo(-s[1].x);
    expect(s[3].z).toBeLessThan(0);
    expect(s[4].z).toBe(s[3].z);
    expect(s[3].x).toBeCloseTo(-s[4].x);
    // Staggered: back-row dancers sit between front-row ones.
    expect(Math.abs(s[3].x)).toBeCloseTo(0.7);
  });

  it('fits 8 dancers within 3.5 m of the centre with at least 1.3 m spacing, never behind the camera line', () => {
    const s = fill(MAX_DANCERS);
    expect(minDistance(s)).toBeGreaterThanOrEqual(1.3 - 1e-9);
    for (const p of s) {
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(3.5);
      expect(p.z).toBeLessThanOrEqual(0);
    }
  });

  it('is deterministic', () => {
    expect(fill(8)).toEqual(fill(8));
  });

  it('avoids dancers placed anywhere and stays on stage', () => {
    const occupied: Spot[] = [
      { x: 0.2, z: 0.1 },
      { x: 1.5, z: -0.3 },
      { x: -3, z: 2 },
    ];
    for (let i = 0; i < 20; i++) {
      const p = findFreeSpot(occupied);
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(STAGE_RADIUS);
      occupied.push(p);
    }
    expect(minDistance(occupied.slice(3))).toBeGreaterThanOrEqual(MIN_SPACING - 1e-9);
  });

  it('still returns an on-stage spot when the stage is packed', () => {
    const packed: Spot[] = [];
    for (let x = -6; x <= 6; x += 0.5) for (let z = -6; z <= 6; z += 0.5) packed.push({ x, z });
    const p = findFreeSpot(packed);
    expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
    expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(STAGE_RADIUS);
  });
});

describe('findCloneSpot', () => {
  it('prefers 1.4 m to the right of the original', () => {
    expect(findCloneSpot({ x: 0, z: 0 }, [])).toEqual({ x: 1.4, z: 0 });
    expect(findCloneSpot({ x: -2, z: -1 }, [])).toEqual({ x: -0.6, z: -1 });
  });

  it('takes the left when the right is occupied, then the nearest free spot', () => {
    expect(findCloneSpot({ x: 0, z: 0 }, [{ x: 1.4, z: 0 }])).toEqual({ x: -1.4, z: 0 });
    const p = findCloneSpot({ x: 0, z: 0 }, [
      { x: 1.4, z: 0 },
      { x: -1.4, z: 0 },
    ]);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(1.39, 1);
    expect(p.z).toBeLessThan(0);
  });

  it('stays on stage near the edge', () => {
    const p = findCloneSpot({ x: 5.5, z: 0 }, []);
    expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(STAGE_RADIUS);
    expect(Math.hypot(p.x - 5.5, p.z)).toBeLessThan(1.5);
  });

  it('keeps spacing from every dancer', () => {
    const others = fill(7);
    const p = findCloneSpot(others[0], others.slice(1));
    expect(minDistance([...others, p])).toBeGreaterThanOrEqual(MIN_SPACING - 1e-9);
  });
});
