/**
 * The warp effect: a travelling vertex wave injected into a character's own
 * materials with onBeforeCompile. It runs after skinning, in the character's
 * own space (metres, Y up), so it looks the same on any rig and at any scale.
 *
 * Nothing is installed while the effect is off, so an unwarped dancer uses the
 * stock shader programs.
 */
import * as THREE from 'three';
import type { Axis, WarpMode } from '../types';

/** Wave amplitude at warpAmount = 1, as a fraction of the character's height. */
export const WARP_WAVE_AMPLITUDE = 0.12;
/** Scale swing at warpAmount = 1 in 'pulse' mode (0.6 means 40 % .. 160 %). */
export const WARP_PULSE_AMOUNT = 0.6;
/** Wave cycles per second at warpSpeed = 1. */
export const WARP_CYCLES_PER_SECOND = 0.75;

const AXIS_VECTORS: Record<Axis, readonly [number, number, number]> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

const VERTEX_PARS = /* glsl */ `
uniform mat4 uWarpToBody;
uniform mat4 uWarpToWorld;
uniform vec3 uWarpAlong;
uniform vec3 uWarpEffect;
uniform vec4 uWarpParams;
`;

/** Runs right before projection: `transformed` is the skinned position in the mesh's local space. */
const VERTEX_MAIN = /* glsl */ `
{
  vec4 warpP = uWarpToBody * ( modelMatrix * vec4( transformed, 1.0 ) );
  float warpTheta = dot( warpP.xyz, uWarpAlong ) * uWarpParams.z - uWarpParams.w;
  float warpSin = sin( warpTheta );
  float warpReach = uWarpParams.x + uWarpParams.y * dot( warpP.xyz, uWarpEffect );
  warpP.xyz += uWarpEffect * ( warpReach * warpSin );
  transformed = ( inverse( modelMatrix ) * ( uWarpToWorld * warpP ) ).xyz;
  #if defined( WARP_NORMALS ) && ! defined( FLAT_SHADED )
    float warpSlope = warpReach * uWarpParams.z * cos( warpTheta );
    mat3 warpView = mat3( viewMatrix ) * mat3( uWarpToWorld );
    vec3 warpAlongView = normalize( warpView * uWarpAlong );
    vec3 warpEffectView = normalize( warpView * uWarpEffect );
    float warpDen = max( 0.25, 1.0 + warpSlope * dot( uWarpAlong, uWarpEffect ) );
    vNormal = normalize( vNormal - warpAlongView * ( warpSlope / warpDen * dot( warpEffectView, vNormal ) ) );
  #endif
}
`;

type CompileHook = THREE.Material['onBeforeCompile'];
type CacheKeyHook = THREE.Material['customProgramCacheKey'];

interface Patched {
  material: THREE.Material;
  onBeforeCompile: CompileHook;
  customProgramCacheKey: CacheKeyHook;
}

/** What the effect needs to know each time a setting changes. */
export interface WarpSettings {
  warpAmount: number;
  warpWaves: number;
  warpMode: WarpMode;
  warpAlong: Axis;
  warpEffect: Axis;
}

/** The warp effect of one character instance. */
export interface Warp {
  /** True while the shader patch is installed (warpAmount > 0). */
  readonly active: boolean;
  /** Apply settings; installs or removes the shader patch as needed. `height` is the character's height in metres. */
  configure(settings: WarpSettings, height: number): void;
  /** Per frame while active: the wave phase in cycles and the world matrix of the character's own space. */
  update(phaseCycles: number, bodyMatrixWorld: THREE.Matrix4): void;
  /** Remove the patch and free the depth material. */
  dispose(): void;
}

/** True for materials whose vertex shader carries a view-space normal the patch can correct. */
function hasVertexNormal(material: THREE.Material): boolean {
  const m = material as THREE.Material & {
    isMeshStandardMaterial?: boolean;
    isMeshPhongMaterial?: boolean;
    isMeshLambertMaterial?: boolean;
    isMeshToonMaterial?: boolean;
  };
  return Boolean(m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshLambertMaterial || m.isMeshToonMaterial);
}

function patchShader(shader: { vertexShader: string; uniforms: Record<string, THREE.IUniform> }, uniforms: Record<string, THREE.IUniform>, normals: boolean): void {
  if (!shader.vertexShader.includes('#include <project_vertex>') || !shader.vertexShader.includes('#include <common>')) return;
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${normals ? '#define WARP_NORMALS\n' : ''}${VERTEX_PARS}`)
    .replace('#include <project_vertex>', `${VERTEX_MAIN}\n#include <project_vertex>`);
}

/**
 * Create the (initially inactive) warp for a set of meshes and their materials.
 * Shadows follow the warp through a shared custom depth material.
 */
export function createWarp(meshes: readonly THREE.Mesh[], materials: readonly THREE.Material[]): Warp {
  const uniforms = {
    uWarpToBody: { value: new THREE.Matrix4() },
    uWarpToWorld: { value: new THREE.Matrix4() },
    uWarpAlong: { value: new THREE.Vector3(0, 1, 0) },
    uWarpEffect: { value: new THREE.Vector3(1, 0, 0) },
    /** x: wave amplitude (m), y: pulse amount, z: wave number (rad/m), w: phase (rad). */
    uWarpParams: { value: new THREE.Vector4() },
  };
  let active = false;
  const patched: Patched[] = [];
  let depthMaterial: THREE.MeshDepthMaterial | null = null;

  function install(): void {
    for (const material of materials) {
      const original: Patched = { material, onBeforeCompile: material.onBeforeCompile, customProgramCacheKey: material.customProgramCacheKey };
      const normals = hasVertexNormal(material);
      material.onBeforeCompile = function (this: THREE.Material, shader, renderer) {
        original.onBeforeCompile.call(this, shader, renderer);
        patchShader(shader, uniforms, normals);
      };
      material.customProgramCacheKey = function (this: THREE.Material) {
        return `${original.customProgramCacheKey.call(this)}|thunes-warp${normals ? '-n' : ''}`;
      };
      material.needsUpdate = true;
      patched.push(original);
    }
    depthMaterial = new THREE.MeshDepthMaterial();
    depthMaterial.name = 'warp-depth';
    depthMaterial.onBeforeCompile = (shader) => patchShader(shader, uniforms, false);
    depthMaterial.customProgramCacheKey = () => 'thunes-warp-depth';
    for (const mesh of meshes) mesh.customDepthMaterial = depthMaterial;
    active = true;
  }

  function uninstall(): void {
    for (const entry of patched) {
      entry.material.onBeforeCompile = entry.onBeforeCompile;
      entry.material.customProgramCacheKey = entry.customProgramCacheKey;
      entry.material.needsUpdate = true;
    }
    patched.length = 0;
    for (const mesh of meshes) {
      if (mesh.customDepthMaterial === depthMaterial) delete (mesh as { customDepthMaterial?: THREE.Material }).customDepthMaterial;
    }
    depthMaterial?.dispose();
    depthMaterial = null;
    active = false;
  }

  return {
    get active() {
      return active;
    },
    configure(settings, height) {
      const on = settings.warpAmount > 0;
      if (on && !active) install();
      else if (!on && active) uninstall();
      if (!on) return;
      const h = height > 0 ? height : 1;
      const along = AXIS_VECTORS[settings.warpAlong] ?? AXIS_VECTORS.y;
      const effect = AXIS_VECTORS[settings.warpEffect] ?? AXIS_VECTORS.x;
      uniforms.uWarpAlong.value.set(along[0], along[1], along[2]);
      uniforms.uWarpEffect.value.set(effect[0], effect[1], effect[2]);
      const params = uniforms.uWarpParams.value;
      const pulse = settings.warpMode === 'pulse';
      params.x = pulse ? 0 : settings.warpAmount * WARP_WAVE_AMPLITUDE * h;
      params.y = pulse ? settings.warpAmount * WARP_PULSE_AMOUNT : 0;
      params.z = (Math.PI * 2 * settings.warpWaves) / h;
    },
    update(phaseCycles, bodyMatrixWorld) {
      uniforms.uWarpParams.value.w = (phaseCycles - Math.floor(phaseCycles)) * Math.PI * 2;
      uniforms.uWarpToWorld.value.copy(bodyMatrixWorld);
      uniforms.uWarpToBody.value.copy(bodyMatrixWorld).invert();
    },
    dispose() {
      if (active) uninstall();
    },
  };
}
