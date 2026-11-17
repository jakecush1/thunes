/**
 * A tiny modelling kit for the procedural characters.
 *
 * `SkinnedGeometryBuilder` accumulates primitives (capsules, ellipsoids, boxes,
 * cylinders, lofted tubes) placed directly in the rest pose. Every vertex gets
 * the current colour and skin weights, and `build()` returns ONE BufferGeometry
 * with position / normal / color / skinIndex / skinWeight, ready for a
 * SkinnedMesh. Triangles go to one of two material slots (0 = body, 1 = glow).
 *
 * Build-time only: nothing here runs per frame.
 */
import * as THREE from 'three';

export type Vec3 = THREE.Vector3;

/** Up to four (bone index, weight) pairs; they are normalised when stored. */
export type BoneWeights = readonly (readonly [bone: number, weight: number])[];

/** Either one bone index (rigid part) or a function of the rest position (blended part). */
export type WeightSpec = number | ((x: number, y: number, z: number) => BoneWeights);

export interface RevolveOptions {
  /** Segments around the axis (default 14). */
  radial?: number;
  /** Rings per hemispherical cap (default 4). */
  capRings?: number;
  /** Cross-section scale along the local X axis (default 1). */
  scaleX?: number;
  /** Cross-section scale along the local Z axis (default 1). */
  scaleZ?: number;
  /** Extra radius at the middle of a capsule's shaft, same units as the radii (default 0). */
  bulge?: number;
  /** Direction that the local Z axis should follow as closely as possible (default world +Z). */
  hint?: Vec3;
}

export interface BoxOptions {
  /** Edge rounding radius (default 0: hard edges with flat normals). */
  radius?: number;
  /** Segments per rounded edge quarter (default 2). */
  bevel?: number;
  /** Extra subdivisions of the flat faces along local X, Y, Z (default 1 each); needed for blended weights. */
  segments?: readonly [number, number, number];
  /** Orientation and origin of the local frame (default: world axes at the origin). */
  frame?: THREE.Matrix4;
}

/** One cross-section of a loft: a superellipse in the local XZ plane. */
export interface LoftRing {
  /** Centre of the ring. */
  x: number;
  y: number;
  z: number;
  /** Half extents along X and Z. */
  rx: number;
  rz: number;
  /** Superellipse exponent: 2 = ellipse, 4+ = rounded rectangle (default 2). */
  e?: number;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _c = new THREE.Color();
const WORLD_Z = new THREE.Vector3(0, 0, 1);
const WORLD_X = new THREE.Vector3(1, 0, 0);

/**
 * A frame whose origin is `a`, whose local Y axis points from `a` to `b` and
 * whose local Z axis is as close to `hint` as possible. For limbs lying in the
 * XY plane (arms in T-pose, legs, spine) local Z is world +Z, so "depth" always
 * means front-to-back.
 */
export function frameBetween(a: Vec3, b: Vec3, hint: Vec3 = WORLD_Z, target = new THREE.Matrix4()): THREE.Matrix4 {
  _y.subVectors(b, a);
  if (_y.lengthSq() < 1e-12) _y.set(0, 1, 0);
  _y.normalize();
  _x.crossVectors(_y, hint);
  if (_x.lengthSq() < 1e-8) _x.crossVectors(_y, Math.abs(_y.x) < 0.9 ? WORLD_X : WORLD_Z);
  _x.normalize();
  _z.crossVectors(_x, _y);
  return target.makeBasis(_x, _y, _z).setPosition(a);
}

/** Point of a profile curve that is swept around the local Y axis. */
interface ProfilePoint {
  /** Height along the axis and distance from it. */
  y: number;
  r: number;
  /** Normal in the (axis, radial) plane; need not be normalised. */
  ny: number;
  nr: number;
}

export class SkinnedGeometryBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly skinIndices: number[] = [];
  private readonly skinWeights: number[] = [];
  private readonly indices: [number[], number[]] = [[], []];

  private red = 1;
  private green = 1;
  private blue = 1;
  private slot: 0 | 1 = 0;
  private weight: WeightSpec = 0;

  /** Colour ('#rrggbb', sRGB) of the vertices added from now on. */
  paint(color: string): this {
    _c.set(color); // converted to the linear working space, which is what vertex colours must be in
    this.red = _c.r;
    this.green = _c.g;
    this.blue = _c.b;
    return this;
  }

  /** Skin weights of the vertices added from now on. */
  bind(weight: WeightSpec): this {
    this.weight = weight;
    return this;
  }

  /** Material slot of the triangles added from now on: 0 = body, 1 = glow. */
  material(slot: 0 | 1): this {
    this.slot = slot;
    return this;
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get triangleCount(): number {
    return (this.indices[0].length + this.indices[1].length) / 3;
  }

  // ───────────────────────────────────────────────────────── primitives ──

  /**
   * A capsule from `a` to `b`: spheres of radius `ra` at `a` and `rb` at `b`
   * joined by their tangent cone. Because the caps are true spheres centred on
   * the end points, two capsules that share an end point and radius stay
   * seamlessly joined at any angle between them (a ball joint).
   */
  capsule(a: Vec3, b: Vec3, ra: number, rb: number = ra, options: RevolveOptions = {}): this {
    const length = a.distanceTo(b);
    const capRings = options.capRings ?? 4;
    const bulge = options.bulge ?? 0;
    const sinA = length > 1e-9 ? THREE.MathUtils.clamp((ra - rb) / length, -0.95, 0.95) : 0;
    const alpha = Math.asin(sinA);
    const split = Math.PI / 2 + alpha; // polar angle (from the -Y pole) where caps meet the cone
    const profile: ProfilePoint[] = [];
    for (let i = 0; i <= capRings; i++) {
      const t = (i / capRings) * split;
      profile.push({ y: -ra * Math.cos(t), r: ra * Math.sin(t), ny: -Math.cos(t), nr: Math.sin(t) });
    }
    if (bulge !== 0) {
      const y0 = ra * sinA;
      const y1 = length + rb * sinA;
      const r0 = ra * Math.cos(alpha);
      const r1 = rb * Math.cos(alpha);
      const steps = 6;
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const slope = (r1 - r0 + bulge * Math.PI * Math.cos(Math.PI * t)) / Math.max(1e-9, y1 - y0);
        profile.push({ y: y0 + (y1 - y0) * t, r: r0 + (r1 - r0) * t + bulge * Math.sin(Math.PI * t), ny: -slope, nr: 1 });
      }
    }
    for (let i = 0; i <= capRings; i++) {
      const t = split + (i / capRings) * (Math.PI - split);
      profile.push({ y: length - rb * Math.cos(t), r: rb * Math.sin(t), ny: -Math.cos(t), nr: Math.sin(t) });
    }
    this.revolve(profile, frameBetween(a, b, options.hint, _m), options);
    return this;
  }

  /** An ellipsoid with the given half extents, optionally rotated. */
  ellipsoid(center: Vec3, radii: Vec3, options: RevolveOptions & { rotation?: THREE.Quaternion; rings?: number } = {}): this {
    const rings = options.rings ?? 10;
    const profile: ProfilePoint[] = [];
    for (let i = 0; i <= rings; i++) {
      const t = (i / rings) * Math.PI;
      profile.push({ y: -radii.y * Math.cos(t), r: Math.sin(t), ny: -Math.cos(t) / radii.y, nr: Math.sin(t) });
    }
    if (options.rotation) _m.makeRotationFromQuaternion(options.rotation);
    else _m.identity();
    _m.setPosition(center);
    this.revolve(profile, _m, { ...options, scaleX: radii.x, scaleZ: radii.z });
    return this;
  }

  /** A sphere. */
  ball(center: Vec3, radius: number, options: RevolveOptions & { rings?: number } = {}): this {
    _p.set(radius, radius, radius);
    return this.ellipsoid(center, _p.clone(), options);
  }

  /** A flat-ended cylinder or cone frustum from `a` to `b` with hard rims. */
  cylinder(a: Vec3, b: Vec3, ra: number, rb: number = ra, options: RevolveOptions = {}): this {
    const length = a.distanceTo(b);
    const slope = (rb - ra) / Math.max(1e-9, length);
    const profile: ProfilePoint[] = [
      { y: 0, r: 0, ny: -1, nr: 0 },
      { y: 0, r: ra, ny: -1, nr: 0 },
      { y: 0, r: ra, ny: -slope, nr: 1 },
      { y: length, r: rb, ny: -slope, nr: 1 },
      { y: length, r: rb, ny: 1, nr: 0 },
      { y: length, r: 0, ny: 1, nr: 0 },
    ];
    this.revolve(profile, frameBetween(a, b, options.hint, _m), options);
    return this;
  }

  /**
   * A box of the given full size centred on `center` (in the local frame).
   * With a radius its edges are rounded and shaded smoothly; without, faces are
   * flat. Faces never share vertices with each other.
   */
  box(center: Vec3, size: Vec3, options: BoxOptions = {}): this {
    const half = [size.x / 2, size.y / 2, size.z / 2];
    const radius = Math.min(options.radius ?? 0, half[0], half[1], half[2]);
    const bevel = radius > 0 ? (options.bevel ?? 2) : 0;
    const segments = options.segments ?? [1, 1, 1];
    const frame = options.frame;
    // Sample coordinates along each axis: rounded ends (uniform in angle) around a flat middle.
    const coords = half.map((h, axis) => {
      const list: number[] = [];
      const flat = h - radius;
      for (let j = bevel; j >= 1; j--) list.push(-flat - radius * Math.tan(((j / bevel) * Math.PI) / 4));
      const n = Math.max(1, Math.round(segments[axis]));
      for (let j = 0; j <= n; j++) list.push(-flat + (2 * flat * j) / n);
      for (let j = 1; j <= bevel; j++) list.push(flat + radius * Math.tan(((j / bevel) * Math.PI) / 4));
      return list;
    });
    const point = [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) {
      const ua = (axis + 1) % 3;
      const va = (axis + 2) % 3;
      for (const sign of [-1, 1]) {
        const base = this.vertexCount;
        const cu = coords[ua];
        const cv = coords[va];
        for (let i = 0; i < cu.length; i++) {
          for (let j = 0; j < cv.length; j++) {
            point[axis] = sign * half[axis];
            point[ua] = cu[i];
            point[va] = cv[j];
            if (radius > 0) {
              let nx = 0;
              let ny = 0;
              let nz = 0;
              const inner = [0, 0, 0];
              for (let k = 0; k < 3; k++) inner[k] = THREE.MathUtils.clamp(point[k], -(half[k] - radius), half[k] - radius);
              nx = point[0] - inner[0];
              ny = point[1] - inner[1];
              nz = point[2] - inner[2];
              const length = Math.hypot(nx, ny, nz) || 1;
              nx /= length;
              ny /= length;
              nz /= length;
              _p.set(inner[0] + nx * radius, inner[1] + ny * radius, inner[2] + nz * radius).add(center);
              _n.set(nx, ny, nz);
            } else {
              _p.set(point[0], point[1], point[2]).add(center);
              _n.set(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
            }
            if (frame) {
              _p.applyMatrix4(frame);
              _n.transformDirection(frame);
            }
            this.vertex(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z);
          }
        }
        const rows = cv.length;
        for (let i = 0; i < cu.length - 1; i++) {
          for (let j = 0; j < rows - 1; j++) {
            const a = base + i * rows + j;
            const b = a + rows;
            const c = a + 1;
            const d = b + 1;
            if (sign > 0) this.quad(a, b, d, c);
            else this.quad(a, c, d, b);
          }
        }
      }
    }
    return this;
  }

  /**
   * A box around the segment from `a` to `b`: `width` across (local X), `depth`
   * front to back (local Z), extended past the end points by `extendA` / `extendB`.
   */
  boxBetween(a: Vec3, b: Vec3, width: number, depth: number, extendA = 0, extendB = 0, options: BoxOptions & { hint?: Vec3 } = {}): this {
    const length = a.distanceTo(b);
    const frame = frameBetween(a, b, options.hint, new THREE.Matrix4());
    const total = length + extendA + extendB;
    return this.box(new THREE.Vector3(0, (length + extendB - extendA) / 2, 0), new THREE.Vector3(width, total, depth), { ...options, frame });
  }

  /**
   * A smooth tube through the given cross-sections (bottom to top), closed
   * with a fan at both ends. Normals are computed from the faces.
   */
  loft(rings: readonly LoftRing[], options: { radial?: number } = {}): this {
    const radial = options.radial ?? 20;
    const base = this.vertexCount;
    const firstTriangle = [this.indices[0].length, this.indices[1].length] as const;
    for (const ring of rings) {
      const power = 2 / (ring.e ?? 2);
      for (let j = 0; j < radial; j++) {
        const angle = (j / radial) * Math.PI * 2;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const x = ring.x + ring.rx * Math.sign(c) * Math.abs(c) ** power;
        const z = ring.z + ring.rz * Math.sign(s) * Math.abs(s) ** power;
        this.vertex(x, ring.y, z, 0, 1, 0);
      }
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < radial; j++) {
        const a = base + i * radial + j;
        const b = base + i * radial + ((j + 1) % radial);
        this.quad(a, a + radial, b + radial, b);
      }
    }
    const bottom = rings[0];
    const top = rings[rings.length - 1];
    const bottomCentre = this.vertexCount;
    this.vertex(bottom.x, bottom.y, bottom.z, 0, -1, 0);
    const topCentre = this.vertexCount;
    this.vertex(top.x, top.y, top.z, 0, 1, 0);
    const topBase = base + (rings.length - 1) * radial;
    for (let j = 0; j < radial; j++) {
      const next = (j + 1) % radial;
      this.triangle(bottomCentre, base + j, base + next);
      this.triangle(topCentre, topBase + next, topBase + j);
    }
    this.recomputeNormals(base, firstTriangle);
    return this;
  }

  // ──────────────────────────────────────────────────────── post edits ──

  /**
   * Moves the vertices added since `fromVertex` (a value of `vertexCount`
   * taken earlier). `edit` may change the position and the normal in place.
   * Skin weights keep the values they got when the vertex was created.
   */
  deform(fromVertex: number, edit: (position: Vec3, normal: Vec3) => void): this {
    for (let i = fromVertex; i < this.vertexCount; i++) {
      _p.fromArray(this.positions, i * 3);
      _n.fromArray(this.normals, i * 3);
      edit(_p, _n);
      _n.normalize();
      _p.toArray(this.positions, i * 3);
      _n.toArray(this.normals, i * 3);
    }
    return this;
  }

  /** Highest Y of any vertex so far. */
  maxY(): number {
    let top = -Infinity;
    for (let i = 1; i < this.positions.length; i += 3) top = Math.max(top, this.positions[i]);
    return top;
  }

  /**
   * The finished geometry. `scale` multiplies every position (used to
   * normalise the height). Material groups are only added when slot 1 is used.
   */
  build(scale = 1): { geometry: THREE.BufferGeometry; hasGlow: boolean } {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.positions.length);
    for (let i = 0; i < positions.length; i++) positions[i] = this.positions[i] * scale;
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.normals), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.colors), 3));
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(this.skinIndices), 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(this.skinWeights), 4));
    const [body, glow] = this.indices;
    const all = this.vertexCount > 65535 ? new Uint32Array(body.length + glow.length) : new Uint16Array(body.length + glow.length);
    all.set(body, 0);
    all.set(glow, body.length);
    geometry.setIndex(new THREE.BufferAttribute(all, 1));
    const hasGlow = glow.length > 0;
    if (hasGlow) {
      geometry.addGroup(0, body.length, 0);
      geometry.addGroup(body.length, glow.length, 1);
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return { geometry, hasGlow };
  }

  // ─────────────────────────────────────────────────────────── private ──

  /** Sweeps a profile around the local Y axis of `frame`. Profile points with r = 0 become single pole vertices. */
  private revolve(profile: readonly ProfilePoint[], frame: THREE.Matrix4, options: RevolveOptions): void {
    const radial = options.radial ?? 14;
    const sx = options.scaleX ?? 1;
    const sz = options.scaleZ ?? 1;
    const starts: number[] = [];
    const counts: number[] = [];
    for (const point of profile) {
      starts.push(this.vertexCount);
      const pole = point.r <= 1e-9;
      const count = pole ? 1 : radial;
      counts.push(count);
      for (let j = 0; j < count; j++) {
        const angle = (j / radial) * Math.PI * 2;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        _p.set(point.r * c * sx, point.y, point.r * s * sz).applyMatrix4(frame);
        if (pole) _n.set(0, Math.sign(point.ny) || 1, 0);
        else _n.set((point.nr * c) / sx, point.ny, (point.nr * s) / sz).normalize();
        _n.transformDirection(frame);
        this.vertex(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z);
      }
    }
    for (let i = 0; i < profile.length - 1; i++) {
      const lower = profile[i];
      const upper = profile[i + 1];
      if (Math.abs(lower.y - upper.y) < 1e-9 && Math.abs(lower.r - upper.r) < 1e-9) continue; // hard-edge duplicate
      for (let j = 0; j < radial; j++) {
        const next = (j + 1) % radial;
        const a = starts[i] + (counts[i] === 1 ? 0 : j);
        const b = starts[i] + (counts[i] === 1 ? 0 : next);
        const c = starts[i + 1] + (counts[i + 1] === 1 ? 0 : j);
        const d = starts[i + 1] + (counts[i + 1] === 1 ? 0 : next);
        if (counts[i] === 1 && counts[i + 1] === 1) continue;
        if (counts[i] === 1) this.triangle(a, c, d);
        else if (counts[i + 1] === 1) this.triangle(a, c, b);
        else this.quad(a, c, d, b);
      }
    }
  }

  private vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.colors.push(this.red, this.green, this.blue);
    if (typeof this.weight === 'number') {
      this.skinIndices.push(this.weight, 0, 0, 0);
      this.skinWeights.push(1, 0, 0, 0);
      return;
    }
    // Keep the four strongest influences and normalise them.
    const sorted = this.weight(x, y, z)
      .filter(([, w]) => w > 1e-4)
      .sort((p, q) => q[1] - p[1])
      .slice(0, 4);
    let total = 0;
    for (const [, w] of sorted) total += w;
    if (sorted.length === 0 || total <= 0) throw new Error('meshkit: a vertex has no skin weights');
    for (let k = 0; k < 4; k++) {
      const entry = sorted[k];
      this.skinIndices.push(entry ? entry[0] : 0);
      this.skinWeights.push(entry ? entry[1] / total : 0);
    }
  }

  /** Counter-clockwise (seen from outside) triangle. */
  private triangle(a: number, b: number, c: number): void {
    this.indices[this.slot].push(a, b, c);
  }

  /** Counter-clockwise (seen from outside) quad a → b → c → d. */
  private quad(a: number, b: number, c: number, d: number): void {
    this.indices[this.slot].push(a, b, c, a, c, d);
  }

  /** Area-weighted smooth normals for the vertices from `fromVertex`, using the triangles added since `fromTriangle`. */
  private recomputeNormals(fromVertex: number, fromTriangle: readonly [number, number]): void {
    const { positions, normals } = this;
    for (let i = fromVertex * 3; i < normals.length; i++) normals[i] = 0;
    for (const slot of [0, 1] as const) {
      const list = this.indices[slot];
      for (let i = fromTriangle[slot]; i < list.length; i += 3) {
        const a = list[i] * 3;
        const b = list[i + 1] * 3;
        const c = list[i + 2] * 3;
        _x.set(positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]);
        _y.set(positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]);
        _z.crossVectors(_x, _y);
        for (const v of [a, b, c]) {
          normals[v] += _z.x;
          normals[v + 1] += _z.y;
          normals[v + 2] += _z.z;
        }
      }
    }
    for (let i = fromVertex * 3; i < normals.length; i += 3) {
      const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
      normals[i] /= length;
      normals[i + 1] /= length;
      normals[i + 2] /= length;
    }
  }
}
