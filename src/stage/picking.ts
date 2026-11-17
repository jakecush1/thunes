/**
 * Picking and dragging maths (pure): per-dancer proxy volumes, ray tests,
 * the drag plane and stage clamping.
 */

/** A vertical cylinder standing in for a dancer when picking. */
export interface PickProxy {
  /** Axis position (world, metres). */
  x: number;
  z: number;
  /** Bottom and top (world, metres). */
  y0: number;
  y1: number;
  radius: number;
}

/** Proxy radius never drops below this (metres, before the dancer's scale): thin characters stay easy to hit. */
export const MIN_PROXY_RADIUS = 0.24;
/** Extra room around the rest-pose footprint for swinging arms and hips. */
export const PROXY_RADIUS_PADDING = 1.2;
/** Extra height above the head, as a fraction of the character's height. */
export const PROXY_HEIGHT_PADDING = 0.04;
/** Pointer travel (CSS pixels) below which a press counts as a click. */
export const CLICK_SLOP = 5;

/**
 * Size a proxy from the character's rest-pose height and radius and the dancer's scale.
 * `x`/`z` are the axis position (the dancer's hips), `baseY` the height of its feet.
 */
export function sizeProxy(out: PickProxy, x: number, baseY: number, z: number, height: number, radius: number, scale: number): PickProxy {
  const s = Math.abs(scale);
  out.x = x;
  out.z = z;
  out.y0 = baseY;
  out.y1 = baseY + height * s * (1 + PROXY_HEIGHT_PADDING);
  out.radius = Math.max(MIN_PROXY_RADIUS, radius * PROXY_RADIUS_PADDING) * s;
  return out;
}

/**
 * Distance along a ray to a capped vertical cylinder, or -1 for a miss.
 * (ox, oy, oz) is the ray origin and (dx, dy, dz) its unit direction.
 */
export function rayCylinder(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, proxy: PickProxy): number {
  const px = ox - proxy.x;
  const pz = oz - proxy.z;
  const r2 = proxy.radius * proxy.radius;
  let best = -1;

  // Side wall.
  const a = dx * dx + dz * dz;
  if (a > 1e-12) {
    const b = px * dx + pz * dz;
    const c = px * px + pz * pz - r2;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      let t = (-b - root) / a;
      if (t < 0) t = (-b + root) / a;
      if (t >= 0) {
        const y = oy + dy * t;
        if (y >= proxy.y0 && y <= proxy.y1) best = t;
      }
    }
  }

  // Caps.
  if (Math.abs(dy) > 1e-12) {
    for (let i = 0; i < 2; i++) {
      const t = ((i === 0 ? proxy.y0 : proxy.y1) - oy) / dy;
      if (t < 0 || (best >= 0 && t >= best)) continue;
      const hx = px + dx * t;
      const hz = pz + dz * t;
      if (hx * hx + hz * hz <= r2) best = t;
    }
  }
  return best;
}

/** Index of the nearest proxy hit by the ray, or -1. `count` limits how many proxies are tested. */
export function pickNearest(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, proxies: readonly PickProxy[], count = proxies.length): number {
  let best = -1;
  let bestT = Infinity;
  for (let i = 0; i < count; i++) {
    const t = rayCylinder(ox, oy, oz, dx, dy, dz, proxies[i]!);
    if (t >= 0 && t < bestT) {
      bestT = t;
      best = i;
    }
  }
  return best;
}

/**
 * Height of the horizontal plane a drag moves on. Dragging on the plane through
 * the grabbed point keeps that point under the pointer; when the camera is
 * almost level with it the dancer's base height is used instead, if that is better.
 */
export function dragPlaneHeight(cameraY: number, hitY: number, baseY: number, minClearance = 0.35): number {
  if (Math.abs(cameraY - hitY) >= minClearance) return hitY;
  return Math.abs(cameraY - baseY) > Math.abs(cameraY - hitY) ? baseY : hitY;
}

/**
 * Distance along a ray to the horizontal plane y = planeY, or -1 when the ray
 * does not reach it within `maxDistance` (parallel, behind, or grazing).
 */
export function rayPlaneY(oy: number, dy: number, planeY: number, maxDistance = 80): number {
  if (Math.abs(dy) < 1e-6) return -1;
  const t = (planeY - oy) / dy;
  return t > 0 && t <= maxDistance ? t : -1;
}

/** Clamp a floor position to the disc of the given radius around the stage centre. Writes into `out`. */
export function clampToStage(x: number, z: number, radius: number, out: { x: number; z: number }): { x: number; z: number } {
  const d = Math.hypot(x, z);
  if (d > radius && d > 0) {
    const k = radius / d;
    out.x = x * k;
    out.z = z * k;
  } else {
    out.x = x;
    out.z = z;
  }
  return out;
}

/**
 * Largest polar angle (radians from straight up) the orbiting camera may reach
 * so that it stays at least `minY` above the floor.
 */
export function maxPolarAngle(targetY: number, distance: number, minY: number): number {
  if (!(distance > 0)) return Math.PI / 2;
  const c = (minY - targetY) / distance;
  return Math.acos(Math.min(1, Math.max(-1, c)));
}

/**
 * Keep the orbit target near the stage: within `radius` horizontally and
 * between `minY` and `maxY`. Mutates `target`; returns true when it moved.
 */
export function clampTarget(target: { x: number; y: number; z: number }, radius: number, minY: number, maxY: number): boolean {
  let moved = false;
  const d = Math.hypot(target.x, target.z);
  if (d > radius) {
    const k = radius / d;
    target.x *= k;
    target.z *= k;
    moved = true;
  }
  if (target.y < minY) {
    target.y = minY;
    moved = true;
  } else if (target.y > maxY) {
    target.y = maxY;
    moved = true;
  }
  return moved;
}
