/**
 * Thumbnails: small square pictures of characters and dances, drawn by a
 * private offscreen renderer (transparent background, neutral light).
 *
 * Jobs run one at a time with a pause between them, so a picker full of
 * thumbnails never stalls the main view. Results are cached per key.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FALLBACK_CHARACTER_ID, FALLBACK_DANCE_ID } from '../config';
import type { CanonicalBone } from '../rig/bones';
import type { AssetRegistry, CharacterDef, DanceDef, Thumbnailer } from '../types';
import { pickExpressiveFrame } from './poseScore';

/** Edge of every thumbnail, pixels. */
export const THUMBNAIL_SIZE = 256;
/** Poses examined when looking for a dance's most characteristic frame. */
const SAMPLES = 36;
const FOV = 30;
/** Where the camera stands relative to the subject for a dance: in front, a little to the side and above. */
const DANCE_VIEW = new THREE.Vector3(0.32, 0.16, 1).normalize();
/** Character portraits are taken from the other side and more head-on, so they never repeat a dance picture. */
const PORTRAIT_VIEW = new THREE.Vector3(-0.2, 0.12, 1).normalize();

const POSE_POINTS: readonly CanonicalBone[] = [
  'Hips',
  'Head',
  'LeftArm',
  'RightArm',
  'LeftForeArm',
  'RightForeArm',
  'LeftHand',
  'RightHand',
  'LeftLeg',
  'RightLeg',
  'LeftFoot',
  'RightFoot',
];

interface CacheEntry {
  promise: Promise<string>;
  character: CharacterDef | undefined;
  dance: DanceDef | undefined;
}

interface Studio {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  environment: THREE.WebGLRenderTarget;
  dispose(): void;
}

function createStudio(): Studio {
  const canvas = document.createElement('canvas');
  canvas.width = THUMBNAIL_SIZE;
  canvas.height = THUMBNAIL_SIZE;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, stencil: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  renderer.setSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  pmrem.dispose();
  room.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.55;

  const fill = new THREE.HemisphereLight(0xffffff, 0x9aa0b4, 1.1);
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(2.5, 4, 5);
  const rim = new THREE.DirectionalLight(0xdde6ff, 1.6);
  rim.position.set(-3, 3, -4);
  scene.add(fill, key, rim);

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 100);
  return {
    renderer,
    scene,
    camera,
    environment,
    dispose() {
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

const _box = new THREE.Box3();
const _part = new THREE.Box3();
const _corner = new THREE.Vector3();
const _center = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _world = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** World-space bounds of the meshes as posed right now. */
function posedBounds(meshes: readonly THREE.Mesh[], out: THREE.Box3): THREE.Box3 {
  out.makeEmpty();
  for (const mesh of meshes) {
    const skinned = mesh as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      skinned.computeBoundingBox();
      if (skinned.boundingBox) out.union(_part.copy(skinned.boundingBox).applyMatrix4(mesh.matrixWorld));
    } else {
      out.expandByObject(mesh, true);
    }
  }
  return out;
}

/** Place the camera along `view` so the box fills the square with a small margin. */
function frameBox(camera: THREE.PerspectiveCamera, box: THREE.Box3, view: THREE.Vector3): void {
  box.getCenter(_center);
  _right.crossVectors(_up.set(0, 1, 0), view).normalize();
  _up.crossVectors(view, _right).normalize();
  let halfWidth = 0;
  let halfHeight = 0;
  let halfDepth = 0;
  for (let i = 0; i < 8; i++) {
    _corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(_center);
    halfWidth = Math.max(halfWidth, Math.abs(_corner.dot(_right)));
    halfHeight = Math.max(halfHeight, Math.abs(_corner.dot(_up)));
    halfDepth = Math.max(halfDepth, Math.abs(_corner.dot(view)));
  }
  const reach = Math.max(halfWidth, halfHeight, 0.05) * 1.1;
  const distance = reach / Math.tan((FOV * Math.PI) / 360) + halfDepth;
  camera.position.copy(_center).addScaledVector(view, distance);
  camera.near = Math.max(0.05, distance - halfDepth * 2 - 1);
  camera.far = distance + halfDepth * 2 + 10;
  camera.up.set(0, 1, 0);
  camera.lookAt(_center);
  camera.updateProjectionMatrix();
}

function readable(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Wait for a quiet moment on the main thread. */
function pause(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 150 });
    else setTimeout(resolve, 0);
  });
}

/** Create the thumbnail renderer. Nothing is allocated until the first request. */
export function createThumbnailer(deps: { registry: AssetRegistry }): Thumbnailer {
  const { registry } = deps;
  const cache = new Map<string, CacheEntry>();
  let studio: Studio | null = null;
  let disposed = false;
  let queue: Promise<void> = Promise.resolve();

  function enqueue(job: () => Promise<string>): Promise<string> {
    const result = queue.then(pause).then(job);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function draw(characterId: string, danceId: string, view: THREE.Vector3): Promise<string> {
    if (disposed) throw new Error('The thumbnail renderer was shut down.');
    const [character, dance, clip] = await Promise.all([
      registry.loadCharacter(characterId),
      registry.loadDance(danceId),
      registry.loadRetargetedClip({ danceId, characterId, mirror: false }),
    ]);
    if (disposed) throw new Error('The thumbnail renderer was shut down.');
    studio ??= createStudio();
    const { renderer, scene, camera } = studio;
    if (renderer.getContext().isContextLost()) throw new Error('The thumbnail renderer lost its graphics context.');

    const instance = character.instantiate();
    const mixer = new THREE.AnimationMixer(instance.root);
    try {
      scene.add(instance.root);
      const action = mixer.clipAction(clip);
      action.play();
      const duration = Math.max(1e-3, dance.duration);

      // Sample the dance and keep the pose that stands out most.
      const nodes = POSE_POINTS.map((name) => instance.bones[name]).filter((node): node is THREE.Object3D => node !== undefined);
      const positions = new Float32Array(SAMPLES * nodes.length * 3);
      const facing = new Float32Array(SAMPLES);
      const leftShoulder = instance.bones.LeftArm;
      const rightShoulder = instance.bones.RightArm;
      const timeOf = (index: number): number => (index / SAMPLES) * duration;
      for (let f = 0; f < SAMPLES; f++) {
        action.time = timeOf(f);
        mixer.update(0);
        instance.root.updateMatrixWorld(true);
        for (let p = 0; p < nodes.length; p++) {
          _world.setFromMatrixPosition(nodes[p]!.matrixWorld);
          positions[(f * nodes.length + p) * 3] = _world.x;
          positions[(f * nodes.length + p) * 3 + 1] = _world.y;
          positions[(f * nodes.length + p) * 3 + 2] = _world.z;
        }
        if (leftShoulder && rightShoulder) {
          // Left is +X when facing +Z, so (left − right) × up points forward.
          _a.setFromMatrixPosition(leftShoulder.matrixWorld).sub(_b.setFromMatrixPosition(rightShoulder.matrixWorld));
          _a.cross(_b.set(0, 1, 0)).normalize();
          facing[f] = _a.dot(view);
        } else {
          facing[f] = 1;
        }
      }
      const best = nodes.length > 0 ? pickExpressiveFrame(positions, SAMPLES, nodes.length, { height: character.height, facing }) : 0;
      action.time = timeOf(best);
      mixer.update(0);
      instance.root.updateMatrixWorld(true);

      posedBounds(instance.meshes, _box);
      if (_box.isEmpty()) _box.setFromCenterAndSize(_center.set(0, character.height / 2, 0), _corner.set(character.height, character.height, character.height));
      frameBox(camera, _box, view);
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    } finally {
      mixer.stopAllAction();
      mixer.uncacheRoot(instance.root);
      instance.root.removeFromParent();
      instance.dispose();
    }
  }

  function request(key: string, label: string, characterId: string, danceId: string, view: THREE.Vector3): Promise<string> {
    const characterDef = registry.getCharacter(characterId);
    const danceDef = registry.getDance(danceId);
    const hit = cache.get(key);
    // A replaced asset (same id, new definition) gets a fresh picture.
    if (hit && hit.character === characterDef && hit.dance === danceDef) return hit.promise;
    const promise = enqueue(() => draw(characterId, danceId, view)).catch((error: unknown) => {
      if (cache.get(key)?.promise === promise) cache.delete(key);
      throw new Error(`Could not draw a thumbnail for ${label}: ${readable(error)}`);
    });
    cache.set(key, { promise, character: characterDef, dance: danceDef });
    return promise;
  }

  return {
    character(characterId) {
      return request(`c\n${characterId}`, `character "${characterId}"`, characterId, FALLBACK_DANCE_ID, PORTRAIT_VIEW);
    },
    dance(danceId, characterId = FALLBACK_CHARACTER_ID) {
      return request(`d\n${danceId}\n${characterId}`, `dance "${danceId}"`, characterId, danceId, DANCE_VIEW);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cache.clear();
      studio?.dispose();
      studio = null;
    },
  };
}
