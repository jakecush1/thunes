/**
 * Model files: loading GLB / glTF / FBX / BVH from a URL or a Blob, and
 * turning what was loaded into characters and dances.
 *
 * This module pulls in the three.js loaders, so it is imported lazily
 * (see loaders.ts); nothing here runs until a file-based asset is used.
 */
import * as THREE from 'three';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CHARACTER_HEIGHT } from '../config';
import { CANONICAL_BONES } from '../rig/bones';
import type { CanonicalBone } from '../rig/bones';
import { mapHumanoid } from '../rig/humanoid';
import type { HumanoidMapping } from '../rig/humanoid';
import { normalizeHumanoid } from '../rig/normalize';
import type { Rig } from '../rig/rig';
import type { CharacterAsset, CharacterDef, CharacterInstance, DanceAsset, DanceDef, ModelFormat } from '../types';

/** Where a model file comes from. `name` is only used in error messages. */
export type ModelSource = { url: string; name?: string } | { blob: Blob; name?: string };

/** A parsed model file. */
export interface LoadedModel {
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
  format: ModelFormat;
}

/** Clips shorter than this are poses, not dances. */
export const MIN_DANCE_SECONDS = 0.2;

const EMPTY_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function labelOf(source: ModelSource): string {
  if (source.name) return source.name;
  if ('url' in source) {
    const path = source.url.split(/[?#]/)[0] ?? source.url;
    try {
      return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
    } catch {
      return path.slice(path.lastIndexOf('/') + 1);
    }
  }
  return 'the file';
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  const event = error as { message?: unknown; type?: unknown } | null;
  if (event && typeof event.message === 'string') return event.message;
  return 'unknown error';
}

async function readBytes(source: ModelSource): Promise<ArrayBuffer> {
  if ('blob' in source) return source.blob.arrayBuffer();
  let response: Response;
  try {
    response = await fetch(source.url);
  } catch (error) {
    throw new Error(`Could not download "${labelOf(source)}": ${messageOf(error)}.`);
  }
  if (!response.ok) throw new Error(`Could not download "${labelOf(source)}" (HTTP ${response.status}).`);
  return response.arrayBuffer();
}

/** Folder of a URL, with the trailing slash ('' for blobs): where a model's external resources are looked up. */
function resourcePath(source: ModelSource): string {
  if ('blob' in source) return '';
  const path = source.url.split(/[?#]/)[0] ?? source.url;
  return path.slice(0, path.lastIndexOf('/') + 1);
}

/**
 * A loading manager for the given source. Files that arrive as a Blob have no
 * folder to fetch companions from, so every external reference resolves to an
 * empty image instead of a failing network request.
 */
function managerFor(source: ModelSource): THREE.LoadingManager {
  const manager = new THREE.LoadingManager();
  if ('blob' in source) manager.setURLModifier((url) => (/^(blob:|data:)/i.test(url) ? url : EMPTY_IMAGE));
  return manager;
}

function gltfJson(bytes: ArrayBuffer): { extensionsUsed?: unknown; extensionsRequired?: unknown; buffers?: unknown; images?: unknown } | null {
  try {
    const view = new DataView(bytes);
    if (bytes.byteLength >= 20 && view.getUint32(0, true) === 0x46546c67) {
      const length = view.getUint32(12, true);
      return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length))) as object;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as object;
  } catch {
    return null;
  }
}

async function loadGltf(source: ModelSource, format: ModelFormat): Promise<LoadedModel> {
  const bytes = await readBytes(source);
  const label = labelOf(source);
  const json = gltfJson(bytes);
  if (!json) throw new Error(`"${label}" is not a valid ${format === 'glb' ? 'GLB' : 'glTF'} file.`);
  const extensions = [json.extensionsRequired, json.extensionsUsed].flatMap((list) => (Array.isArray(list) ? (list as unknown[]) : []));
  if (extensions.includes('KHR_draco_mesh_compression')) {
    throw new Error(`"${label}" uses Draco mesh compression, which Thunes cannot decode. Export it again without Draco (Meshopt compression is fine).`);
  }
  if ('blob' in source && format === 'gltf') {
    const external = [json.buffers, json.images]
      .flatMap((list) => (Array.isArray(list) ? (list as { uri?: unknown }[]) : []))
      .some((entry) => typeof entry?.uri === 'string' && !/^data:/i.test(entry.uri));
    if (external) throw new Error(`"${label}" refers to separate files (.bin, textures). Export it as a single .glb file instead.`);
  }
  const loader = new GLTFLoader(managerFor(source));
  loader.setMeshoptDecoder(MeshoptDecoder);
  try {
    const gltf = await loader.parseAsync(bytes, resourcePath(source));
    const root = gltf.scene ?? gltf.scenes[0];
    if (!root) throw new Error('it contains no scene');
    return { root, animations: gltf.animations ?? [], format };
  } catch (error) {
    throw new Error(`Could not read "${label}": ${messageOf(error).replace(/^THREE\.GLTFLoader:\s*/, '')}`);
  }
}

async function loadFbx(source: ModelSource): Promise<LoadedModel> {
  const bytes = await readBytes(source);
  try {
    const root = new FBXLoader(managerFor(source)).parse(bytes, resourcePath(source));
    return { root, animations: root.animations ?? [], format: 'fbx' };
  } catch (error) {
    throw new Error(`Could not read "${labelOf(source)}": ${messageOf(error).replace(/^THREE\.FBXLoader:\s*/, '')}`);
  }
}

async function loadBvh(source: ModelSource): Promise<LoadedModel> {
  const text = new TextDecoder().decode(await readBytes(source));
  const label = labelOf(source);
  if (!/^\s*HIERARCHY/i.test(text)) throw new Error(`"${label}" is not a BVH file (it does not start with HIERARCHY).`);
  let result: { skeleton: THREE.Skeleton; clip: THREE.AnimationClip };
  try {
    result = new BVHLoader().parse(text);
  } catch (error) {
    throw new Error(`Could not read "${label}": ${messageOf(error)}`);
  }
  const top = result.skeleton.bones[0];
  if (!top) throw new Error(`"${label}" contains no skeleton.`);
  const root = new THREE.Group();
  root.name = 'BVHRoot';
  root.add(top);
  return { root, animations: [result.clip], format: 'bvh' };
}

/**
 * Loads a model file. GLB/glTF support Meshopt compression (Draco is refused
 * with a readable message), FBX may be binary or ASCII, BVH yields a bare
 * skeleton with one clip. Rejects with an Error fit to show to the user.
 */
export function loadModel(source: ModelSource, format: ModelFormat): Promise<LoadedModel> {
  if (format === 'glb' || format === 'gltf') return loadGltf(source, format);
  if (format === 'fbx') return loadFbx(source);
  return loadBvh(source);
}

// ———————————————————————————————————————————————————————— Preparation ——

/** Makes node names safe for animation track names and keeps the clips' tracks pointing at the renamed nodes. */
function sanitizeNames(root: THREE.Object3D, clips: readonly THREE.AnimationClip[]): void {
  const renamed = new Map<string, string>();
  root.traverse((node) => {
    const safe = THREE.PropertyBinding.sanitizeNodeName(node.name);
    if (safe !== node.name) {
      if (node.name !== '') renamed.set(node.name, safe);
      node.name = safe;
    }
  });
  if (renamed.size === 0) return;
  for (const clip of clips) {
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf('.');
      if (dot <= 0) continue;
      const safe = renamed.get(track.name.slice(0, dot));
      if (safe !== undefined) track.name = safe + track.name.slice(dot);
    }
  }
}

function removeCamerasAndLights(root: THREE.Object3D): void {
  const doomed: THREE.Object3D[] = [];
  root.traverse((node) => {
    const flagged = node as THREE.Object3D & { isCamera?: boolean; isLight?: boolean };
    if ((flagged.isCamera || flagged.isLight) && node !== root && node.children.length === 0) doomed.push(node);
  });
  for (const node of doomed) node.removeFromParent();
}

/** How far two rigid-plus-scale transforms are apart: rotation angle (radians) plus the log of the scale ratio. */
function frameDistance(a: THREE.Matrix4, b: THREE.Matrix4): number {
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const sa = new THREE.Vector3();
  const sb = new THREE.Vector3();
  a.decompose(pa, qa, sa);
  b.decompose(pb, qb, sb);
  const scaleA = Math.cbrt(Math.abs(sa.x * sa.y * sa.z)) || 1e-12;
  const scaleB = Math.cbrt(Math.abs(sb.x * sb.y * sb.z)) || 1e-12;
  return qa.angleTo(qb) + Math.abs(Math.log(scaleA / scaleB));
}

/**
 * Puts every skinned skeleton under `root` into its bind pose (the pose in
 * which the mesh is undeformed). `root` must have no parent. Returns false
 * when there is no skinned mesh.
 *
 * Bind matrices fix the pose only up to one overall transform F (bone world =
 * F · bindMatrix⁻¹ renders the same undeformed mesh for any F). Exporters use
 * two conventions: bind matrices in world space (F = identity: Mixamo GLB,
 * FBX) or in the space of the armature node (F = the armature's world
 * matrix: rigs whose armature carries a rotation or a centimetre scale). The
 * convention that leaves the skeleton's root bone closest to where the file
 * put it is chosen, so the rest pose stays in the frame its animations play in.
 * Unlike Skeleton.pose() this is also right for bones below transformed
 * non-bone nodes.
 */
export function applyBindPose(root: THREE.Object3D): boolean {
  root.updateMatrixWorld(true);
  const bindWorld = new Map<THREE.Object3D, THREE.Matrix4>();
  root.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.skeleton) return;
    mesh.skeleton.bones.forEach((bone, i) => {
      const inverse = mesh.skeleton.boneInverses[i];
      if (bone && inverse && !bindWorld.has(bone) && Math.abs(inverse.determinant()) > 1e-18) bindWorld.set(bone, inverse.clone().invert());
    });
  });
  if (bindWorld.size === 0) return false;

  // The frame F, judged at the top-most bound bone with the most descendants (the hips or the armature's root bone).
  const frame = new THREE.Matrix4();
  let top: THREE.Object3D | null = null;
  let topSize = -1;
  for (const bone of bindWorld.keys()) {
    if (bone.parent && bindWorld.has(bone.parent)) continue;
    let size = 0;
    bone.traverse(() => size++);
    if (size > topSize) {
      top = bone;
      topSize = size;
    }
  }
  if (top && top.parent) {
    const implied = new THREE.Matrix4().copy(top.matrixWorld).multiply(new THREE.Matrix4().copy(bindWorld.get(top)!).invert());
    const parentWorld = top.parent.matrixWorld;
    if (frameDistance(parentWorld, implied) < frameDistance(frame, implied) - 1e-6) frame.copy(parentWorld);
  }

  const local = new THREE.Matrix4();
  const target = new THREE.Matrix4();
  const visit = (node: THREE.Object3D, parentWorld: THREE.Matrix4 | null): void => {
    const world = bindWorld.get(node);
    if (world) {
      target.multiplyMatrices(frame, world);
      if (parentWorld) local.copy(parentWorld).invert().multiply(target);
      else local.copy(target);
      local.decompose(node.position, node.quaternion, node.scale);
    }
    node.updateMatrix();
    if (parentWorld) node.matrixWorld.multiplyMatrices(parentWorld, node.matrix);
    else node.matrixWorld.copy(node.matrix);
    for (const child of node.children) visit(child, node.matrixWorld);
  };
  visit(root, null);
  root.updateMatrixWorld(true);
  return true;
}

/** Readable explanation of why a hierarchy is not a usable humanoid. */
export function describeNotHumanoid(mapping: HumanoidMapping): string {
  const found = CANONICAL_BONES.filter((bone) => mapping.bones[bone]).length;
  if (found === 0) {
    return 'no humanoid skeleton was found: none of its bones have recognisable names (hips, spine, head, arms, legs).';
  }
  const missing = mapping.missingRequired;
  const shown = missing.slice(0, 8).join(', ') + (missing.length > 8 ? ` and ${missing.length - 8} more` : '');
  return `its skeleton is not a complete humanoid: ${missing.length === 1 ? 'the bone' : 'the bones'} ${shown} could not be found.`;
}

function hasMesh(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) found = true;
  });
  return found;
}

interface PreparedHumanoid {
  wrapper: THREE.Object3D;
  mapping: HumanoidMapping;
  height: number;
  radius: number;
  skinned: boolean;
}

/**
 * Maps the humanoid, puts it into its rest pose (bind pose for skinned files,
 * the loaded transforms otherwise) and normalises it. Throws when it is not a humanoid.
 */
function prepareHumanoid(model: LoadedModel, height: number, label: string): PreparedHumanoid {
  const root = model.root;
  root.removeFromParent();
  removeCamerasAndLights(root);
  sanitizeNames(root, model.animations);
  root.updateMatrixWorld(true);
  const mapping = mapHumanoid(root);
  if (!mapping.isHumanoid) throw new Error(`"${label}" cannot be used: ${describeNotHumanoid(mapping)}`);
  const skinned = applyBindPose(root);
  const normalized = normalizeHumanoid(root, mapping, { height });
  return { wrapper: normalized.root, mapping, height: normalized.height, radius: normalized.radius, skinned };
}

// ————————————————————————————————————————————————————————— Characters ——

const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'specularMap', 'lightMap', 'envMap'] as const;

/** FBX materials are Phong/Lambert; the stage's look controls expect PBR parameters. */
function toStandardMaterial(material: THREE.Material): THREE.Material {
  const legacy = material as THREE.MeshPhongMaterial & { isMeshPhongMaterial?: boolean; isMeshLambertMaterial?: boolean };
  if (!legacy.isMeshPhongMaterial && !legacy.isMeshLambertMaterial) return material;
  const standard = new THREE.MeshStandardMaterial({
    name: legacy.name,
    color: legacy.color,
    map: legacy.map,
    normalMap: legacy.normalMap ?? null,
    emissive: legacy.emissive,
    emissiveMap: legacy.emissiveMap,
    emissiveIntensity: legacy.emissiveIntensity,
    alphaMap: legacy.alphaMap,
    transparent: legacy.transparent && legacy.opacity < 1,
    opacity: legacy.opacity,
    alphaTest: legacy.alphaTest,
    side: legacy.side,
    vertexColors: legacy.vertexColors,
    metalness: 0,
    roughness: legacy.isMeshPhongMaterial ? THREE.MathUtils.clamp(1 - Math.sqrt(Math.max(0, legacy.shininess ?? 30) / 100) * 0.6, 0.35, 1) : 0.9,
  });
  if (legacy.normalMap && legacy.normalScale) standard.normalScale.copy(legacy.normalScale);
  legacy.dispose();
  return standard;
}

function forEachMaterial(mesh: THREE.Mesh, visit: (material: THREE.Material) => void): void {
  if (Array.isArray(mesh.material)) for (const material of mesh.material) visit(material);
  else if (mesh.material) visit(mesh.material);
}

function disposeMaterial(material: THREE.Material, withTextures: boolean): void {
  if (withTextures) {
    const slots = material as unknown as Record<string, THREE.Texture | null | undefined>;
    for (const slot of TEXTURE_SLOTS) slots[slot]?.dispose?.();
  }
  material.dispose();
}

/** Frees everything a parsed model holds (geometry, materials, textures, bone textures). */
export function disposeModel(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    forEachMaterial(mesh, (material) => disposeMaterial(material, true));
    if (mesh.isSkinnedMesh) mesh.skeleton?.dispose();
  });
}

/**
 * Builds a character from a parsed model. The model must contain a humanoid
 * skeleton and at least one mesh; otherwise a readable Error is thrown. The
 * model's hierarchy becomes the asset's private rest-pose template (and rig);
 * every instance is an independent clone of it.
 */
export function buildCharacterAsset(def: CharacterDef, model: LoadedModel): CharacterAsset {
  const label = def.name;
  if (!hasMesh(model.root)) throw new Error(`"${label}" cannot be used as a character: the file contains a skeleton but no mesh.`);
  const prepared = prepareHumanoid(model, def.height ?? CHARACTER_HEIGHT, label);
  const template = prepared.wrapper;
  template.name = def.id;

  template.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(toStandardMaterial) : toStandardMaterial(mesh.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // The bounding volume of a skinned mesh is that of its rest pose; a dancing body leaves it.
    if (mesh.isSkinnedMesh) mesh.frustumCulled = false;
  });

  const boneEntries = Object.entries(prepared.mapping.bones) as [CanonicalBone, THREE.Object3D][];
  let disposed = false;

  const instantiate = (): CharacterInstance => {
    if (disposed) throw new Error(`Character "${def.id}" was disposed and cannot be instantiated`);
    const root = SkeletonUtils.clone(template);
    // Template node → clone node (clone() keeps the child order).
    const twin = new Map<THREE.Object3D, THREE.Object3D>();
    const pair = (a: THREE.Object3D, b: THREE.Object3D): void => {
      twin.set(a, b);
      for (let i = 0; i < a.children.length; i++) pair(a.children[i]!, b.children[i]!);
    };
    pair(template, root);

    const bones: Partial<Record<CanonicalBone, THREE.Object3D>> = {};
    for (const [bone, node] of boneEntries) {
      const copy = twin.get(node);
      if (copy) bones[bone] = copy;
    }

    const meshes: THREE.Mesh[] = [];
    const materialCopies = new Map<THREE.Material, THREE.Material>();
    const skeletons = new Map<THREE.Skeleton, THREE.Skeleton>();
    const copyOf = (material: THREE.Material): THREE.Material => {
      let copy = materialCopies.get(material);
      if (!copy) {
        copy = material.clone();
        materialCopies.set(material, copy);
      }
      return copy;
    };
    template.traverse((node) => {
      const source = node as THREE.SkinnedMesh;
      if (!source.isMesh) return;
      const mesh = twin.get(source) as THREE.SkinnedMesh;
      meshes.push(mesh);
      mesh.material = Array.isArray(source.material) ? source.material.map(copyOf) : copyOf(source.material);
      if (source.isSkinnedMesh) {
        // SkeletonUtils.clone gives every mesh its own skeleton; meshes that shared one share one again.
        const shared = skeletons.get(source.skeleton);
        if (shared) {
          mesh.skeleton.dispose();
          mesh.bind(shared, mesh.bindMatrix);
        } else skeletons.set(source.skeleton, mesh.skeleton);
      }
    });
    const materials = [...materialCopies.values()];

    return {
      root,
      bones,
      meshes,
      materials,
      dispose() {
        root.removeFromParent();
        for (const material of materials) material.dispose();
        for (const skeleton of skeletons.values()) skeleton.dispose();
      },
    };
  };

  return {
    def,
    rig: { root: template, bones: prepared.mapping.bones },
    height: prepared.height,
    radius: prepared.radius,
    instantiate,
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeModel(template);
    },
  };
}

// ————————————————————————————————————————————————————————————— Dances ——

/** A dance file ready for use: its skeleton in rest pose, normalised, and its clips. Shared by all dances from the file. */
export interface DanceSource {
  rig: Rig;
  clips: THREE.AnimationClip[];
}

/**
 * Prepares a parsed model as a dance source: the hierarchy is mapped, put into
 * its rest pose and normalised; its meshes are dropped (only the skeleton is
 * needed). Throws a readable Error when the skeleton is not a humanoid.
 */
export function buildDanceSource(model: LoadedModel, label: string): DanceSource {
  const prepared = prepareHumanoid(model, CHARACTER_HEIGHT, label);
  // Geometry was only needed to measure the body.
  disposeModel(prepared.wrapper);
  const bones = new Set<THREE.Object3D>();
  prepared.wrapper.traverse((node) => {
    if ((node as THREE.Bone).isBone) bones.add(node);
  });
  const keep = new Set<THREE.Object3D>();
  for (const bone of bones) for (let node: THREE.Object3D | null = bone; node && !keep.has(node); node = node.parent) keep.add(node);
  for (const node of Object.values(prepared.mapping.bones)) for (let n: THREE.Object3D | null = node ?? null; n && !keep.has(n); n = n.parent) keep.add(n);
  const doomed: THREE.Object3D[] = [];
  prepared.wrapper.traverse((node) => {
    if ((node as THREE.Mesh).isMesh && !keep.has(node)) doomed.push(node);
  });
  for (const node of doomed) node.removeFromParent();
  return { rig: { root: prepared.wrapper, bones: prepared.mapping.bones }, clips: model.animations };
}

/** The clips of a file that are long enough to be dances, with their index in the file. */
export function danceClips(clips: readonly THREE.AnimationClip[]): { index: number; name: string; duration: number }[] {
  const out: { index: number; name: string; duration: number }[] = [];
  clips.forEach((clip, index) => {
    if (clip.tracks.length > 0 && clip.duration >= MIN_DANCE_SECONDS) out.push({ index, name: clip.name, duration: clip.duration });
  });
  return out;
}

/** Picks a clip by index or name (exact, then case-insensitive); the first clip when `wanted` is undefined. Throws readably. */
export function pickClip(clips: readonly THREE.AnimationClip[], wanted: string | number | undefined, label: string): THREE.AnimationClip {
  if (clips.length === 0) throw new Error(`"${label}" contains no animation.`);
  if (wanted === undefined) return clips[0]!;
  if (typeof wanted === 'number') {
    const clip = clips[wanted];
    if (!clip) throw new Error(`"${label}" has ${clips.length} animation clip${clips.length === 1 ? '' : 's'}; there is no clip number ${wanted}.`);
    return clip;
  }
  const lower = wanted.toLowerCase();
  const clip = clips.find((c) => c.name === wanted) ?? clips.find((c) => c.name.toLowerCase() === lower);
  if (!clip) {
    const names = clips.map((c) => `"${c.name}"`).slice(0, 12).join(', ');
    throw new Error(`"${label}" has no animation clip named "${wanted}" (it has ${names}).`);
  }
  return clip;
}

const FOOT_JOINTS: readonly CanonicalBone[] = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase', 'LeftToe_End', 'RightToe_End'];
/** A clip whose feet stay further than this fraction of the leg length from the rest floor is re-grounded. */
const GROUND_TOLERANCE = 0.06;
/** A clip that starts further than this fraction of the leg length from the rest spot is re-centred. */
const CENTRE_TOLERANCE = 0.3;

/**
 * Where a clip keeps the body relative to the rig's rest pose, in the rig's
 * model space: `lift` is how far above the rest floor the feet stay (the 10th
 * percentile over the clip of the lowest foot joint), `x`/`z` how far from the
 * rest spot the hips are in the first frame. Motion-capture files (BVH) store
 * absolute hips positions while their rest pose sits at the origin, so both
 * can be far from zero. The rig is restored before returning.
 */
export function measureClipPlacement(clip: THREE.AnimationClip, rig: Rig): { lift: number; x: number; z: number; legLength: number } {
  const root = rig.root;
  const hips = rig.bones.Hips;
  const feet = FOOT_JOINTS.map((bone) => rig.bones[bone]).filter((node): node is THREE.Object3D => node !== undefined);
  const zero = { lift: 0, x: 0, z: 0, legLength: 0 };
  if (!hips || feet.length === 0 || !(clip.duration > 0)) return zero;

  const saved: { node: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[] = [];
  root.traverse((node) => saved.push({ node, p: node.position.clone(), q: node.quaternion.clone(), s: node.scale.clone() }));
  const v = new THREE.Vector3();
  const lowestFoot = (): number => {
    let lowest = Infinity;
    for (const foot of feet) lowest = Math.min(lowest, v.setFromMatrixPosition(foot.matrixWorld).y);
    return lowest;
  };
  root.updateMatrixWorld(true);
  const restFloor = lowestFoot();
  const restHips = new THREE.Vector3().setFromMatrixPosition(hips.matrixWorld);
  const joint = (bone: CanonicalBone): THREE.Vector3 | null => {
    const node = rig.bones[bone];
    return node ? new THREE.Vector3().setFromMatrixPosition(node.matrixWorld) : null;
  };
  let legLength = 0;
  for (const side of ['Left', 'Right'] as const) {
    const a = joint(`${side}UpLeg`);
    const b = joint(`${side}Leg`);
    const c = joint(`${side}Foot`);
    if (a && b && c) legLength = Math.max(legLength, a.distanceTo(b) + b.distanceTo(c));
  }

  const mixer = new THREE.AnimationMixer(root);
  const samples = Math.max(8, Math.min(240, Math.round(clip.duration * 20)));
  const heights: number[] = [];
  let x = 0;
  let z = 0;
  try {
    const action = mixer.clipAction(clip);
    action.play();
    for (let i = 0; i < samples; i++) {
      mixer.setTime((clip.duration * i) / samples);
      root.updateMatrixWorld(true);
      heights.push(lowestFoot() - restFloor);
      if (i === 0) {
        v.setFromMatrixPosition(hips.matrixWorld);
        x = v.x - restHips.x;
        z = v.z - restHips.z;
      }
    }
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    for (const entry of saved) {
      entry.node.position.copy(entry.p);
      entry.node.quaternion.copy(entry.q);
      entry.node.scale.copy(entry.s);
    }
    root.updateMatrixWorld(true);
  }
  heights.sort((a, b) => a - b);
  const lift = heights[Math.floor(heights.length * 0.1)] ?? 0;
  return { lift: Number.isFinite(lift) ? lift : 0, x, z, legLength };
}

/** A copy of a (mesh-free) rig hierarchy with its bone map. */
function cloneRig(rig: Rig): Rig {
  const root = rig.root.clone(true);
  const twin = new Map<THREE.Object3D, THREE.Object3D>();
  const pair = (a: THREE.Object3D, b: THREE.Object3D): void => {
    twin.set(a, b);
    for (let i = 0; i < a.children.length; i++) pair(a.children[i]!, b.children[i]!);
  };
  pair(rig.root, root);
  const bones: Rig['bones'] = {};
  for (const [bone, node] of Object.entries(rig.bones) as [CanonicalBone, THREE.Object3D][]) {
    const copy = twin.get(node);
    if (copy) bones[bone] = copy;
  }
  return { root, bones };
}

/**
 * A dance from a prepared file: the chosen clip plus the file's rig.
 *
 * If the clip keeps the body away from where the rest pose stands (floating,
 * sunk into the floor, or starting far from the spot), the dance gets its own
 * copy of the rig whose resting hips are moved to match, so the retargeted
 * dancer has its feet on the floor and starts on its spot.
 */
export function buildDanceAsset(def: DanceDef, source: DanceSource): DanceAsset {
  const clip = pickClip(source.clips, def.clip, def.name);
  if (!(clip.duration > 0)) throw new Error(`"${def.name}" cannot be used as a dance: its animation has no length.`);
  const bpm = def.bpm !== undefined && def.bpm > 0 ? def.bpm : null;
  const beats = def.beats !== undefined && def.beats > 0 ? def.beats : bpm !== null ? (clip.duration * bpm) / 60 : null;

  let rig = source.rig;
  const placement = measureClipPlacement(clip, rig);
  if (placement.legLength > 0) {
    const lift = Math.abs(placement.lift) > GROUND_TOLERANCE * placement.legLength ? placement.lift : 0;
    const offCentre = Math.hypot(placement.x, placement.z) > CENTRE_TOLERANCE * placement.legLength;
    if (lift !== 0 || offCentre) {
      rig = cloneRig(source.rig);
      const hips = rig.bones.Hips!;
      rig.root.updateMatrixWorld(true);
      const world = new THREE.Vector3().setFromMatrixPosition(hips.matrixWorld);
      world.y += lift;
      if (offCentre) {
        world.x += placement.x;
        world.z += placement.z;
      }
      if (hips.parent) hips.parent.worldToLocal(world);
      hips.position.copy(world);
      rig.root.updateMatrixWorld(true);
    }
  }
  return { def, clip, rig, duration: clip.duration, bpm, beats: bpm !== null ? beats : null };
}

// ———————————————————————————————————————————————————————————— Uploads ——

/** What an uploaded model file can be used for. */
export interface ModelAnalysis {
  /** It has a mesh on a humanoid skeleton. */
  character: boolean;
  /** Clips long enough to be dances. */
  clips: { index: number; name: string; duration: number }[];
}

/**
 * Parses a model file just to find out what it offers, then frees it.
 * Rejects with a readable Error when the file cannot be read or holds no humanoid.
 */
export async function analyseModel(source: ModelSource, format: ModelFormat): Promise<ModelAnalysis> {
  const model = await loadModel(source, format);
  try {
    const label = labelOf(source);
    sanitizeNames(model.root, model.animations);
    model.root.updateMatrixWorld(true);
    const mapping = mapHumanoid(model.root);
    if (!mapping.isHumanoid) throw new Error(`"${label}" cannot be used: ${describeNotHumanoid(mapping)}`);
    return { character: hasMesh(model.root), clips: danceClips(model.animations) };
  } finally {
    disposeModel(model.root);
  }
}
