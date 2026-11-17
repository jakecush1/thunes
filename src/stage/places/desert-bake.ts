/**
 * Sun shadows for the desert, baked once.
 *
 * Nothing in the scenery moves, so instead of a second shadow-casting light
 * (whose map would be redrawn every frame and sampled by every material) the
 * scenery's shadows are flattened onto the ground along the sun's rays and
 * drawn top-down into two masks: a sharp one around the stage and a coarse one
 * out to the horizon. The sand samples them (see desert-materials.ts).
 *   R: 1 = sunlit, 0 = in the shadow of a rock, cactus, shrub or butte.
 *   G: 1 = open, lower = contact shade around the foot of an object.
 */
import * as THREE from 'three';

/** A soft round patch of contact shade on the ground. */
export interface Blob {
  x: number;
  z: number;
  radius: number;
  /** 0..1 darkness at the centre. */
  strength: number;
}

export interface Caster {
  mesh: THREE.InstancedMesh;
  /** Coverage texture of alpha-tested cards (their geometry carries `uv` and the mesh an `aCell` attribute). */
  alpha?: THREE.Texture;
}

export interface ShadowMasks {
  readonly near: THREE.Texture;
  readonly far: THREE.Texture;
  /** Half extents of the two masks, metres. */
  readonly nearHalf: number;
  readonly farHalf: number;
  /** (Re)draws both masks. Call once after building and again if the WebGL context was restored. */
  render(renderer: THREE.WebGLRenderer): void;
  dispose(): void;
}

const PROJECT_VERTEX = /* glsl */ `
uniform vec3 uSun;
uniform float uHalf;
varying float vAbove;
#ifdef TH_CARD
attribute vec2 aCell;
varying vec2 vCardUv;
#endif
void main() {
  vec4 world = modelMatrix * instanceMatrix * vec4( position, 1.0 );
  float base = ( modelMatrix * instanceMatrix[ 3 ] ).y;
  vAbove = world.y - base;
  // Slide the point along the sun's ray down to the level of the object's foot.
  vec2 xz = world.xz - uSun.xz * ( max( vAbove, 0.0 ) / uSun.y );
  #ifdef TH_CARD
  vCardUv = uv * 0.5 + aCell;
  #endif
  gl_Position = vec4( xz / uHalf, 0.0, 1.0 );
}
`;

const PROJECT_FRAGMENT = /* glsl */ `
varying float vAbove;
#ifdef TH_CARD
uniform sampler2D uAlpha;
varying vec2 vCardUv;
#endif
void main() {
  // The buried part of an object casts nothing.
  if ( vAbove < 0.0 ) discard;
  #ifdef TH_CARD
  if ( texture2D( uAlpha, vCardUv ).g < 0.4 ) discard;
  #endif
  gl_FragColor = vec4( 0.0, 1.0, 1.0, 1.0 );
}
`;

const BLOB_VERTEX = /* glsl */ `
uniform float uHalf;
attribute float aStrength;
varying vec2 vDisc;
varying float vStrength;
void main() {
  vDisc = position.xy;
  vStrength = aStrength;
  vec4 world = instanceMatrix * vec4( position.x, 0.0, position.y, 1.0 );
  gl_Position = vec4( world.xz / uHalf, 0.0, 1.0 );
}
`;

const BLOB_FRAGMENT = /* glsl */ `
varying vec2 vDisc;
varying float vStrength;
void main() {
  float d = length( vDisc );
  float shade = ( 1.0 - smoothstep( 0.2, 1.0, d ) ) * vStrength;
  gl_FragColor = vec4( 1.0, 1.0 - shade, 1.0, 1.0 );
}
`;

/** Multiplies what is already in the target by the fragment colour. */
const MULTIPLY = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.ZeroFactor,
  blendDst: THREE.SrcColorFactor,
  depthTest: false,
  depthWrite: false,
  side: THREE.DoubleSide,
  toneMapped: false,
  fog: false,
} as const;

export function createShadowMasks(casters: readonly Caster[], blobs: readonly Blob[], sun: THREE.Vector3, nearHalf: number, farHalf: number, nearSize: number, farSize: number): ShadowMasks {
  const half = { value: nearHalf };
  const sunUniform = { value: sun.clone().normalize() };
  const scene = new THREE.Scene();
  scene.matrixWorldAutoUpdate = false;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const materials: THREE.ShaderMaterial[] = [];
  const proxies: THREE.InstancedMesh[] = [];

  for (const caster of casters) {
    const material = new THREE.ShaderMaterial({
      uniforms: { uSun: sunUniform, uHalf: half, uAlpha: { value: caster.alpha ?? null } },
      defines: caster.alpha ? { TH_CARD: '' } : {},
      vertexShader: PROJECT_VERTEX,
      fragmentShader: PROJECT_FRAGMENT,
      ...MULTIPLY,
    });
    materials.push(material);
    // Same geometry and placements as the visible mesh, drawn with the flattening shader.
    const proxy = new THREE.InstancedMesh(caster.mesh.geometry, material, caster.mesh.count);
    proxy.instanceMatrix = caster.mesh.instanceMatrix;
    proxy.frustumCulled = false;
    proxy.matrixAutoUpdate = false;
    proxies.push(proxy);
    scene.add(proxy);
  }

  const blobGeometry = new THREE.PlaneGeometry(2, 2);
  const blobMaterial = new THREE.ShaderMaterial({ uniforms: { uHalf: half }, vertexShader: BLOB_VERTEX, fragmentShader: BLOB_FRAGMENT, ...MULTIPLY });
  materials.push(blobMaterial);
  const blobMesh = new THREE.InstancedMesh(blobGeometry, blobMaterial, Math.max(1, blobs.length));
  blobMesh.count = blobs.length;
  const strengths = new Float32Array(Math.max(1, blobs.length));
  const matrix = new THREE.Matrix4();
  blobs.forEach((blob, i) => {
    // The quad lies in XY; the shader lays it down on XZ.
    matrix.makeScale(blob.radius, 1, blob.radius).setPosition(blob.x, 0, blob.z);
    blobMesh.setMatrixAt(i, matrix);
    strengths[i] = blob.strength;
  });
  blobGeometry.setAttribute('aStrength', new THREE.InstancedBufferAttribute(strengths, 1));
  blobMesh.frustumCulled = false;
  blobMesh.matrixAutoUpdate = false;
  blobMesh.renderOrder = 1;
  scene.add(blobMesh);

  const target = (size: number): THREE.WebGLRenderTarget => {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      samples: 4,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: THREE.NoColorSpace,
    });
    rt.texture.anisotropy = 4;
    return rt;
  };
  const near = target(nearSize);
  const far = target(farSize);
  const clear = new THREE.Color();

  return {
    near: near.texture,
    far: far.texture,
    nearHalf,
    farHalf,
    render(renderer) {
      const previousTarget = renderer.getRenderTarget();
      const previousAutoClear = renderer.autoClear;
      const previousAlpha = renderer.getClearAlpha();
      renderer.getClearColor(clear);
      renderer.autoClear = true;
      renderer.setClearColor(0xffffff, 1);
      half.value = nearHalf;
      renderer.setRenderTarget(near);
      renderer.render(scene, camera);
      half.value = farHalf;
      renderer.setRenderTarget(far);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(clear, previousAlpha);
      renderer.autoClear = previousAutoClear;
    },
    dispose() {
      near.dispose();
      far.dispose();
      for (const material of materials) material.dispose();
      for (const proxy of proxies) proxy.dispose();
      blobMesh.dispose();
      blobGeometry.dispose();
    },
  };
}
