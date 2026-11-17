/**
 * A small geometry builder for the city: indexed quads, walls, boxes and
 * cylinders with per-vertex colour and, optionally, per-vertex surface
 * properties (roughness, metalness, glow) for the shared "detail" material.
 */
import * as THREE from 'three';

export class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly colors: number[] = [];
  private readonly surfaces: number[] = [];
  private readonly indices: number[] = [];
  private r = 1;
  private g = 1;
  private b = 1;
  private roughness = 0.85;
  private metalness = 0;
  private glow = 0;
  private readonly scratch = new THREE.Color();

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  /** Colour of the vertices that follow (sRGB hex), optionally scaled. */
  paint(hex: number, scale = 1): this {
    this.scratch.setHex(hex);
    this.r = this.scratch.r * scale;
    this.g = this.scratch.g * scale;
    this.b = this.scratch.b * scale;
    return this;
  }

  /** Colour of the vertices that follow (linear RGB). */
  tint(r: number, g: number, b: number): this {
    this.r = r;
    this.g = g;
    this.b = b;
    return this;
  }

  /** Surface of the vertices that follow. A negative glow is switched per instance (car lights). */
  surface(roughness: number, metalness = 0, glow = 0): this {
    this.roughness = roughness;
    this.metalness = metalness;
    this.glow = glow;
    return this;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u = 0, v = 0): number {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.uvs.push(u, v);
    this.colors.push(this.r, this.g, this.b);
    this.surfaces.push(this.roughness, this.metalness, this.glow);
    return this.positions.length / 3 - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  /** Two triangles a-b-c, a-c-d (counter-clockwise seen from the front). */
  face(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  /**
   * A vertical wall from A to B (as seen from outside, A is on the left),
   * with u running from u0 at A to u1 at B and v from v0 at the bottom to v1 at the top.
   */
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, u0: number, u1: number, v0: number, v1: number): void {
    const length = Math.hypot(bx - ax, bz - az) || 1;
    const nx = -(bz - az) / length;
    const nz = (bx - ax) / length;
    const a = this.vertex(ax, y0, az, nx, 0, nz, u0, v0);
    const b = this.vertex(bx, y0, bz, nx, 0, nz, u1, v0);
    const c = this.vertex(bx, y1, bz, nx, 0, nz, u1, v1);
    const d = this.vertex(ax, y1, az, nx, 0, nz, u0, v1);
    this.face(a, b, c, d);
  }

  /** A horizontal rectangle facing up, textured at `scale` repeats per metre. */
  flat(x0: number, x1: number, z0: number, z1: number, y: number, scale = 1): void {
    const a = this.vertex(x0, y, z1, 0, 1, 0, x0 * scale, -z1 * scale);
    const b = this.vertex(x1, y, z1, 0, 1, 0, x1 * scale, -z1 * scale);
    const c = this.vertex(x1, y, z0, 0, 1, 0, x1 * scale, -z0 * scale);
    const d = this.vertex(x0, y, z0, 0, 1, 0, x0 * scale, -z0 * scale);
    this.face(a, b, c, d);
  }

  /** An axis-aligned box (no bottom unless asked), textured at `scale` repeats per metre. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, scale = 1, bottom = false): void {
    this.wall(x1, z1, x1, z0, y0, y1, -z1 * scale, -z0 * scale, y0 * scale, y1 * scale);
    this.wall(x0, z0, x0, z1, y0, y1, z0 * scale, z1 * scale, y0 * scale, y1 * scale);
    this.wall(x0, z1, x1, z1, y0, y1, x0 * scale, x1 * scale, y0 * scale, y1 * scale);
    this.wall(x1, z0, x0, z0, y0, y1, -x1 * scale, -x0 * scale, y0 * scale, y1 * scale);
    this.flat(x0, x1, z0, z1, y1, scale);
    if (bottom) {
      const a = this.vertex(x0, y0, z0, 0, -1, 0, x0 * scale, z0 * scale);
      const b = this.vertex(x1, y0, z0, 0, -1, 0, x1 * scale, z0 * scale);
      const c = this.vertex(x1, y0, z1, 0, -1, 0, x1 * scale, z1 * scale);
      const d = this.vertex(x0, y0, z1, 0, -1, 0, x0 * scale, z1 * scale);
      this.face(a, b, c, d);
    }
  }

  /** An upright (optionally tapered) cylinder with smooth sides; `cap` closes the top. */
  cylinder(cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, segments = 10, cap = true): void {
    const slope = (r0 - r1) / Math.max(1e-6, y1 - y0);
    const ny = slope / Math.hypot(1, slope);
    const nh = 1 / Math.hypot(1, slope);
    const first = this.vertexCount;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      this.vertex(cx + c * r0, y0, cz + s * r0, c * nh, ny, s * nh, i / segments, y0);
      this.vertex(cx + c * r1, y1, cz + s * r1, c * nh, ny, s * nh, i / segments, y1);
    }
    for (let i = 0; i < segments; i++) {
      const a = first + i * 2;
      this.face(a, a + 1, a + 3, a + 2);
    }
    if (cap && r1 > 0) {
      const centre = this.vertex(cx, y1, cz, 0, 1, 0, 0.5, 0.5);
      const ring = this.vertexCount;
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        this.vertex(cx + Math.cos(angle) * r1, y1, cz + Math.sin(angle) * r1, 0, 1, 0, 0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5);
      }
      for (let i = 0; i < segments; i++) this.triangle(centre, ring + i + 1, ring + i);
    }
  }

  /** Append another builder's mesh, rotated about Y and moved. */
  append(other: MeshBuilder, x = 0, y = 0, z = 0, yaw = 0): void {
    const base = this.vertexCount;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (let i = 0; i < other.positions.length; i += 3) {
      const px = other.positions[i]!;
      const pz = other.positions[i + 2]!;
      const nx = other.normals[i]!;
      const nz = other.normals[i + 2]!;
      this.positions.push(x + px * c + pz * s, y + other.positions[i + 1]!, z - px * s + pz * c);
      this.normals.push(nx * c + nz * s, other.normals[i + 1]!, -nx * s + nz * c);
    }
    for (const value of other.uvs) this.uvs.push(value);
    for (const value of other.colors) this.colors.push(value);
    for (const value of other.surfaces) this.surfaces.push(value);
    for (const index of other.indices) this.indices.push(base + index);
  }

  /** `smooth` recomputes the normals from the triangles (for lofted shapes). */
  build(options: { color?: boolean; surface?: boolean; smooth?: boolean } = {}): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (options.color) geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    if (options.surface) geometry.setAttribute('surf', new THREE.Float32BufferAttribute(this.surfaces, 3));
    geometry.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.indices, 1) : new THREE.Uint16BufferAttribute(this.indices, 1));
    if (options.smooth) geometry.computeVertexNormals();
    return geometry;
  }
}

/** What each part of the city hands back: everything in it is disposed with the place. */
export interface CityPart {
  meshes: THREE.Mesh[];
  materials: THREE.Material[];
  textures?: THREE.Texture[];
}
