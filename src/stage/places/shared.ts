/**
 * Shared building blocks for the places (stage/places/*): the Place contract,
 * seeded randomness, scattering, instancing and a few material helpers.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** One place's scenery. Built once, on first use, and kept for the lifetime of the stage. */
export interface Place {
  /** Everything the place draws. Added to the scene while the place is shown. */
  object: THREE.Object3D;
  /**
   * True when the place draws its own ground (and receives the dancers'
   * shadows on it): the stage's floor plane is hidden while it is shown.
   */
  ownsGround?: boolean;
  /** Per-frame animation. `time` is seconds since the app started. */
  update?(time: number): void;
  /** Follow the exposure slider for parts drawn without tone mapping. */
  setGain?(gain: number): void;
  dispose(): void;
}

/** Direction to the sun of the daytime ('clouds') sky. */
export const DAY_SUN = new THREE.Vector3(-0.45, 0.62, -0.64).normalize();

// ───────────────────────────────────────────────────────────── helpers ──

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** True inside the wedge that must stay clear between the default camera (on +Z) and the stage. */
export function inCorridor(x: number, z: number): boolean {
  return z > 2 && z < 34 && Math.abs(x) < 3.5 + (z - 2) * 0.6;
}

/** A non-indexed copy of `geometry` with one vertex colour; the original is disposed. */
export function tinted(geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  const color = new THREE.Color(hex);
  const count = flat.getAttribute('position').count;
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    data[i * 3] = color.r;
    data[i * 3 + 1] = color.g;
    data[i * 3 + 2] = color.b;
  }
  flat.setAttribute('color', new THREE.BufferAttribute(data, 3));
  return flat;
}

export function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geometry = mergeGeometries(parts, false);
  if (!geometry) throw new Error('Scenery geometry could not be merged.');
  for (const part of parts) part.dispose();
  return geometry;
}

export interface Spot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
  /** Brightness/tint multiplier. */
  color: THREE.Color;
}

export function spot(x: number, z: number, scale: number, yaw = 0, color = new THREE.Color(1, 1, 1)): Spot {
  return { x, y: 0, z, yaw, sx: scale, sy: scale, sz: scale, color };
}

export const UP = new THREE.Vector3(0, 1, 0);

export function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, spots: readonly Spot[], name: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
  mesh.name = name;
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  spots.forEach((s, i) => {
    rotation.setFromAxisAngle(UP, s.yaw);
    matrix.compose(position.set(s.x, s.y, s.z), rotation, scale.set(s.sx, s.sy, s.sz));
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, s.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  // Scenery surrounds the camera: culling the whole batch would never succeed.
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

export interface ScatterOptions {
  count: number;
  /** Distance from the stage centre, metres. */
  near: number;
  far: number;
  /** Minimum distance between two items. */
  gap: number;
  /** > 1 crowds items toward `near`. */
  bias?: number;
}

/** Random positions in a ring around the stage, keeping the camera corridor and earlier items clear. */
export function scatter(rng: () => number, occupied: { x: number; z: number; r: number }[], options: ScatterOptions): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const bias = options.bias ?? 1.6;
  for (let attempt = 0; out.length < options.count && attempt < options.count * 40; attempt++) {
    const angle = rng() * Math.PI * 2;
    const distance = options.near + Math.pow(rng(), bias) * (options.far - options.near);
    const x = Math.sin(angle) * distance;
    const z = Math.cos(angle) * distance;
    if (inCorridor(x, z)) continue;
    let free = true;
    for (const other of occupied) {
      const dx = other.x - x;
      const dz = other.z - z;
      const reach = other.r + options.gap;
      if (dx * dx + dz * dz < reach * reach) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    occupied.push({ x, z, r: options.gap });
    out.push({ x, z });
  }
  return out;
}

/** Collects everything a place must free. */
export function createBin() {
  const items: { dispose(): void }[] = [];
  return {
    add<T extends { dispose(): void }>(item: T): T {
      items.push(item);
      return item;
    },
    dispose(): void {
      for (const item of items) item.dispose();
      items.length = 0;
    },
  };
}

/** Lambert material for instanced, vertex-coloured, flat-shaded scenery. */
export function sceneryMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
}

/** Adds a gentle wind sway to an instanced material (each instance gets its own phase). */
export function addSway(material: THREE.Material, time: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSwayTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uSwayTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float swayPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
          float swayAmount = position.y * position.y * 0.03;
          transformed.x += sin(uSwayTime * 1.1 + swayPhase) * swayAmount;
          transformed.z += cos(uSwayTime * 0.83 + swayPhase * 1.7) * swayAmount * 0.6;
        #endif`,
      );
  };
  material.customProgramCacheKey = () => 'thunes-sway';
}

