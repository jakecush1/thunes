/**
 * Test helpers for the rig layer: tiny hierarchy DSL and synthetic humanoid rigs.
 * Not a test file.
 */
import * as THREE from 'three';
import type { CanonicalBone } from '../../../src/rig/bones';
import { BONE_PARENT, CANONICAL_BONES } from '../../../src/rig/bones';
import type { Rig } from '../../../src/rig/rig';

export interface Spec {
  name: string;
  children: Spec[];
}

/** A node with children. */
export const n = (name: string, ...children: Spec[]): Spec => ({ name, children });

/** A chain a > b > c; `children` hang below the last one. */
export const chain = (names: string[], ...children: Spec[]): Spec => {
  let spec = n(names[names.length - 1]!, ...children);
  for (let i = names.length - 2; i >= 0; i--) spec = n(names[i]!, spec);
  return spec;
};

/** Builds an Object3D hierarchy; `sanitize` renames like three's loaders do. */
export function build(spec: Spec, options: { sanitize?: boolean; bones?: boolean } = {}): THREE.Object3D {
  const node = options.bones === false ? new THREE.Object3D() : new THREE.Bone();
  node.name = options.sanitize ? THREE.PropertyBinding.sanitizeNodeName(spec.name) : spec.name;
  for (const child of spec.children) node.add(build(child, options));
  return node;
}

/** Canonical bone → node name (undefined for unmapped). */
export function names(bones: Partial<Record<CanonicalBone, THREE.Object3D>>): Partial<Record<CanonicalBone, string>> {
  const out: Partial<Record<CanonicalBone, string>> = {};
  for (const bone of CANONICAL_BONES) if (bones[bone]) out[bone] = bones[bone]!.name;
  return out;
}

// ————————————————————————————————————————————————————————————————————————
// Synthetic rigs

export interface RigOptions {
  /** Overall size multiplier of the offsets (1 = a 1.7 m character in metres). */
  scale?: number;
  /** Leg length multiplier. */
  legs?: number;
  /** Arm length multiplier. */
  arms?: number;
  /** Arms rotated down by this many degrees about the forward axis in the rest pose (A-pose). */
  aPose?: number;
  /** Bones to leave out (children re-attach to the nearest remaining ancestor). */
  omit?: CanonicalBone[];
  /** Give every bone a pseudo-random rest orientation ("Mixamo-like" bone axes). */
  randomAxes?: number;
  /** Extra unmapped bones: [name, parent bone, child bone] inserted between a bone and its child. */
  insert?: [string, CanonicalBone, CanonicalBone][];
  /** Node name prefix. */
  prefix?: string;
  /** Wrap the skeleton in an armature with this rotation and uniform scale (offsets are divided by the scale). */
  armature?: { rotation: THREE.Euler; scale: number };
}

/** Model-space rest offsets from the parent joint, metres, T-pose facing +Z (left = +X). */
function offsets(): Partial<Record<CanonicalBone, [number, number, number]>> {
  const o: Partial<Record<CanonicalBone, [number, number, number]>> = {
    Hips: [0, 0.95, 0],
    Spine: [0, 0.1, -0.01],
    Spine1: [0, 0.12, -0.01],
    Spine2: [0, 0.13, 0],
    Neck: [0, 0.15, 0.01],
    Head: [0, 0.1, 0.02],
    HeadTop_End: [0, 0.18, 0],
  };
  for (const [side, x] of [
    ['Left', 1],
    ['Right', -1],
  ] as const) {
    o[`${side}Shoulder`] = [0.06 * x, 0.1, 0];
    o[`${side}Arm`] = [0.12 * x, 0, 0];
    o[`${side}ForeArm`] = [0.27 * x, 0, 0];
    o[`${side}Hand`] = [0.26 * x, 0, 0];
    o[`${side}HandMiddle1`] = [0.09 * x, 0, 0];
    o[`${side}HandMiddle2`] = [0.03 * x, 0, 0];
    o[`${side}UpLeg`] = [0.09 * x, -0.05, 0];
    o[`${side}Leg`] = [0, -0.42, 0.005];
    o[`${side}Foot`] = [0, -0.4, -0.01];
    o[`${side}ToeBase`] = [0, -0.07, 0.12];
    o[`${side}Toe_End`] = [0, 0, 0.07];
  }
  return o;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A synthetic humanoid rig in rest pose. With no options: canonical axes
 * (identity rest rotations), T-pose, facing +Z, feet near y = 0, metres.
 */
export function makeRig(options: RigOptions = {}): Rig {
  const scale = options.scale ?? 1;
  const omit = new Set(options.omit ?? []);
  const random = options.randomAxes !== undefined ? mulberry(options.randomAxes) : null;
  const prefix = options.prefix ?? '';
  const off = offsets();
  const armature = options.armature;
  const unit = scale / (armature?.scale ?? 1);

  // Model-space rest positions and rotations per bone.
  const position = new Map<string, THREE.Vector3>();
  const rotation = new Map<string, THREE.Quaternion>();
  const parentOf = new Map<string, string | null>();
  const order: string[] = [];
  const aPose = new THREE.Quaternion();
  for (const bone of CANONICAL_BONES) {
    const o = off[bone];
    if (!o || omit.has(bone)) continue;
    let parent = BONE_PARENT[bone];
    // Accumulate the offsets of omitted ancestors.
    const v = new THREE.Vector3(...o);
    if (/^(Left|Right)(Leg|Foot)$/.test(bone)) v.multiplyScalar(options.legs ?? 1);
    if (/ForeArm$|Hand$/.test(bone)) v.multiplyScalar(options.arms ?? 1);
    while (parent && (omit.has(parent) || !off[parent])) {
      v.add(new THREE.Vector3(...off[parent]!));
      parent = BONE_PARENT[parent];
    }
    if (bone === 'Hips') v.y = 0.13 + 0.82 * (options.legs ?? 1);
    // A-pose: everything below the shoulder is rotated about +Z (forward): left arm down = -angle.
    const armPart = /^(Left|Right)(ForeArm|Hand)/.exec(bone);
    if (armPart && options.aPose) {
      aPose.setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(options.aPose) * (armPart[1] === 'Left' ? -1 : 1));
      v.applyQuaternion(aPose);
    }
    const parentPosition = parent ? position.get(parent)! : new THREE.Vector3();
    position.set(bone, v.multiplyScalar(unit).add(parentPosition));
    const q = new THREE.Quaternion();
    if (random) q.set(random() - 0.5, random() - 0.5, random() - 0.5, random() - 0.5).normalize();
    rotation.set(bone, q);
    parentOf.set(bone, parent);
    order.push(bone);
  }
  for (const [name, parent, child] of options.insert ?? []) {
    // Halfway between the two joints, with its own odd rest rotation.
    position.set(name, position.get(parent)!.clone().lerp(position.get(child)!, 0.5));
    rotation.set(name, new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.7, 0.2)));
    parentOf.set(name, parent);
    parentOf.set(child, name);
    order.splice(order.indexOf(child), 0, name);
  }

  const root = new THREE.Group();
  root.name = `${prefix}Root`;
  let top: THREE.Object3D = root;
  const topRotation = new THREE.Quaternion();
  if (armature) {
    const node = new THREE.Object3D();
    node.name = `${prefix}Armature`;
    node.quaternion.setFromEuler(armature.rotation);
    node.scale.setScalar(armature.scale);
    root.add(node);
    top = node;
    topRotation.copy(node.quaternion);
  }
  const nodes = new Map<string, THREE.Bone>();
  const bones: Partial<Record<CanonicalBone, THREE.Object3D>> = {};
  const inverseTop = topRotation.clone().invert();
  for (const name of order) {
    const node = new THREE.Bone();
    node.name = prefix + name;
    const parent = parentOf.get(name) ?? null;
    // Local transform from the model-space rest pose; the armature rotation is undone so the model pose is unchanged.
    const parentRotation = parent ? rotation.get(parent)! : new THREE.Quaternion();
    const parentPosition = parent ? position.get(parent)! : new THREE.Vector3();
    const local = position.get(name)!.clone().sub(parentPosition).applyQuaternion(parentRotation.clone().invert());
    node.quaternion.copy(parentRotation.clone().invert().multiply(rotation.get(name)!));
    if (!parent) {
      local.applyQuaternion(inverseTop);
      node.quaternion.premultiply(inverseTop);
    }
    node.position.copy(local);
    (parent ? nodes.get(parent)! : top).add(node);
    nodes.set(name, node);
    if ((CANONICAL_BONES as readonly string[]).includes(name)) bones[name as CanonicalBone] = node;
  }
  return { root, bones };
}

/** Model-space (root-inclusive) world matrices of a rig, without touching node.matrix. */
export function modelMatrices(rig: Rig): Map<THREE.Object3D, THREE.Matrix4> {
  const out = new Map<THREE.Object3D, THREE.Matrix4>();
  const visit = (node: THREE.Object3D, parent: THREE.Matrix4 | null): void => {
    const local = new THREE.Matrix4().compose(node.position, node.quaternion, node.scale);
    const world = parent ? parent.clone().multiply(local) : local;
    out.set(node, world);
    for (const child of node.children) visit(child, world);
  };
  visit(rig.root, null);
  return out;
}

/** Model-space joint position of a canonical bone in the rig's current pose. */
export function jointPosition(rig: Rig, bone: CanonicalBone, matrices = modelMatrices(rig)): THREE.Vector3 {
  return new THREE.Vector3().setFromMatrixPosition(matrices.get(rig.bones[bone]!)!);
}

/** Model-space rotation (scale-free) of a canonical bone in the rig's current pose. */
export function jointRotation(rig: Rig, bone: CanonicalBone): THREE.Quaternion {
  const q = new THREE.Quaternion();
  for (let node: THREE.Object3D | null = rig.bones[bone]!; node; node = node === rig.root ? null : node.parent) q.premultiply(node.quaternion);
  return q;
}

/**
 * Applies a clip to a rig at time t (seconds) with a real AnimationMixer and leaves the rig posed.
 * (The mixer is simply dropped: stopping or uncaching it would restore the original pose.)
 */
export function poseAt(rig: Rig, clip: THREE.AnimationClip, t: number): void {
  const mixer = new THREE.AnimationMixer(rig.root);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.setTime(Math.min(t, clip.duration));
}

/** Snapshot of every node's local transform under a rig root. */
export function snapshot(rig: Rig): number[] {
  const out: number[] = [];
  rig.root.traverse((node) => {
    out.push(...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray());
  });
  return out;
}

export function restore(rig: Rig, data: number[]): void {
  let i = 0;
  rig.root.traverse((node) => {
    node.position.fromArray(data, i);
    node.quaternion.fromArray(data, i + 3);
    node.scale.fromArray(data, i + 7);
    i += 10;
  });
}

/** Angle between two vectors in degrees. */
export const degBetween = (a: THREE.Vector3, b: THREE.Vector3): number => THREE.MathUtils.radToDeg(a.angleTo(b));

/** Angle of the rotation between two quaternions in degrees (accurate for tiny angles, unlike acos of the dot product). */
export const degBetweenQ = (a: THREE.Quaternion, b: THREE.Quaternion): number => {
  const r = a.clone().invert().multiply(b);
  return THREE.MathUtils.radToDeg(2 * Math.atan2(Math.hypot(r.x, r.y, r.z), Math.abs(r.w)));
};

/**
 * A lively test dance on the canonical bone names: every body bone rotates,
 * the hips bounce, sway and travel. Loops exactly (period = duration).
 */
export function makeDance(rig: Rig, options: { duration?: number; fps?: number; prefix?: string; travel?: number } = {}): THREE.AnimationClip {
  const duration = options.duration ?? 2;
  const fps = options.fps ?? 30;
  const count = Math.round(duration * fps) + 1;
  const times = new Float32Array(count);
  for (let i = 0; i < count; i++) times[i] = (i * duration) / (count - 1);
  const tracks: THREE.KeyframeTrack[] = [];
  const w = (2 * Math.PI) / duration;
  const euler = new THREE.Euler();
  const q = new THREE.Quaternion();
  let seed = 1;
  for (const bone of CANONICAL_BONES) {
    const node = rig.bones[bone];
    if (!node || /_End$/.test(bone)) continue;
    seed++;
    const amp = /Hand(Thumb|Index|Middle|Ring|Pinky)/.test(bone) ? 0.3 : /Arm|Leg/.test(bone) ? 0.9 : 0.35;
    const values = new Float32Array(count * 4);
    const rest = node.quaternion.clone();
    for (let i = 0; i < count; i++) {
      const t = times[i]!;
      euler.set(amp * Math.sin(w * t + seed), amp * 0.7 * Math.sin(2 * w * t + seed * 1.7), amp * 0.8 * Math.sin(w * t + seed * 2.3));
      // Model-space delta applied on top of the rest pose only for canonical-axes rigs; fine as "some motion" otherwise.
      q.setFromEuler(euler).premultiply(rest);
      if (i > 0 && q.x * values[i * 4 - 4]! + q.y * values[i * 4 - 3]! + q.z * values[i * 4 - 2]! + q.w * values[i * 4 - 1]! < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      q.toArray(values, i * 4);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values));
  }
  const hips = rig.bones.Hips!;
  const travel = options.travel ?? 0;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = times[i]!;
    const u = t / duration;
    positions[i * 3] = hips.position.x + 0.08 * Math.sin(2 * w * t) + travel * u;
    positions[i * 3 + 1] = hips.position.y - 0.05 + 0.04 * Math.cos(4 * w * t);
    positions[i * 3 + 2] = hips.position.z + 0.05 * Math.sin(w * t) + travel * 0.5 * Math.sin(Math.PI * u);
  }
  tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, positions));
  return new THREE.AnimationClip('dance', duration, tracks);
}
