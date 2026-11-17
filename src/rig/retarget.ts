/**
 * Retargeting: bakes a clip authored on one humanoid rig into a clip for
 * another ("world-delta bake with rest alignment").
 *
 * MODEL SPACE of a rig is the space its root node lives in: the root's own
 * local transform is part of the pose, the root's parents are not. Both rigs
 * are expected to be normalised there (normalize.ts): upright, facing +Z,
 * hips over the origin, feet on y = 0.
 *
 * REST POSE of a rig is the pose it is in the first time it is passed to
 * retargetClip; it is captured once and cached per Rig object.
 *
 * For every sample time t and every canonical bone b mapped in both rigs:
 *   Ws_b(t)  model-space rotation of the source bone under the clip
 *   D_b(t) = Ws_b(t) · Rs_b⁻¹                 rotation away from the source rest pose
 *   Wt_b(t) = D_b(t) · A_b · Rt_b             target model-space rotation
 *   local_b(t) = parentWorld_b(t)⁻¹ · Wt_b(t)
 * where Rs_b / Rt_b are the model-space rest rotations and A_b is the rest
 * alignment (see alignment()). Rotations are composed from local quaternions,
 * so uniform scales anywhere in either hierarchy have no effect on them;
 * positions use full matrices, so centimetre rigs and scaled armatures work.
 */
import * as THREE from 'three';
import { CANONICAL_BONES, isCanonicalBone, mirrorBone } from './bones';
import type { CanonicalBone } from './bones';
import type { Rig } from './rig';

/** Options of retargetClip. */
export interface RetargetOptions {
  /** Samples per second of the baked clip (default 30). The end time is always sampled too. */
  fps?: number;
  /** Mirror the dance left ↔ right (reflection across the model's YZ plane). */
  mirror?: boolean;
  /** Keep the dance on its spot: see retargetClip. */
  inPlace?: boolean;
  /** Name of the new clip (default: the source clip's name). */
  name?: string;
}

/** Seconds: horizontal hips motion slower than about twice this is treated as travel by `inPlace`. */
const IN_PLACE_WINDOW = 2;

// ————————————————————————————————————————————————————————————————————————
// Rest data

interface RigRest {
  nodes: THREE.Object3D[];
  /** Parent index per node, -1 for the root. Parents always precede children. */
  parent: Int32Array;
  index: Map<THREE.Object3D, number>;
  /** Rest local quaternions, 4 per node. */
  localQ: Float64Array;
  /** Rest model-space rotations (products of local quaternions, root included), 4 per node. */
  modelQ: Float64Array;
  /** Rest model-space joint positions, 3 per node. */
  modelP: Float64Array;
  /** Canonical bone → node index. */
  bone: Partial<Record<CanonicalBone, number>>;
  /** Mean thigh + shin length in model units; 0 when unknown. */
  legLength: number;
  /** Inverse of the rest model matrix of the hips' parent (identity when the hips are the root). */
  hipsParentInverse: THREE.Matrix4;
}

const restCache = new WeakMap<Rig, RigRest>();

function captureRest(rig: Rig): RigRest {
  const nodes: THREE.Object3D[] = [];
  const parents: number[] = [];
  const index = new Map<THREE.Object3D, number>();
  const matrices: THREE.Matrix4[] = [];
  const visit = (node: THREE.Object3D, parent: number): void => {
    const i = nodes.length;
    nodes.push(node);
    parents.push(parent);
    index.set(node, i);
    const local = new THREE.Matrix4().compose(node.position, node.quaternion, node.scale);
    matrices.push(parent < 0 ? local : new THREE.Matrix4().multiplyMatrices(matrices[parent]!, local));
    for (const child of node.children) visit(child, i);
  };
  visit(rig.root, -1);

  const count = nodes.length;
  const localQ = new Float64Array(count * 4);
  const modelQ = new Float64Array(count * 4);
  const modelP = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    const q = nodes[i]!.quaternion;
    const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    localQ[i * 4] = q.x / len;
    localQ[i * 4 + 1] = q.y / len;
    localQ[i * 4 + 2] = q.z / len;
    localQ[i * 4 + 3] = q.w / len;
    const p = parents[i]!;
    if (p < 0) modelQ.set(localQ.subarray(0, 4), 0);
    else multiply(modelQ, i * 4, modelQ, p * 4, localQ, i * 4);
    const e = matrices[i]!.elements;
    modelP[i * 3] = e[12]!;
    modelP[i * 3 + 1] = e[13]!;
    modelP[i * 3 + 2] = e[14]!;
  }

  const bone: Partial<Record<CanonicalBone, number>> = {};
  for (const name of CANONICAL_BONES) {
    const node = rig.bones[name];
    if (!node) continue;
    const i = index.get(node);
    if (i === undefined) throw new Error(`retargetClip: the rig's "${name}" bone ("${node.name}") is not part of the hierarchy under the rig root`);
    bone[name] = i;
  }

  const distance = (a: number | undefined, b: number | undefined): number =>
    a === undefined || b === undefined ? 0 : Math.hypot(modelP[a * 3]! - modelP[b * 3]!, modelP[a * 3 + 1]! - modelP[b * 3 + 1]!, modelP[a * 3 + 2]! - modelP[b * 3 + 2]!);
  let legLength = 0;
  let legs = 0;
  for (const side of ['Left', 'Right'] as const) {
    const upper = distance(bone[`${side}UpLeg`], bone[`${side}Leg`]);
    const lower = distance(bone[`${side}Leg`], bone[`${side}Foot`]);
    if (upper > 0 && lower > 0) {
      legLength += upper + lower;
      legs++;
    }
  }
  if (legs > 0) legLength /= legs;

  const hipsParentInverse = new THREE.Matrix4();
  const hips = bone.Hips;
  if (hips !== undefined && parents[hips]! >= 0) hipsParentInverse.copy(matrices[parents[hips]!]!).invert();

  return { nodes, parent: Int32Array.from(parents), index, localQ, modelQ, modelP, bone, legLength, hipsParentInverse };
}

function restOf(rig: Rig): RigRest {
  let rest = restCache.get(rig);
  if (!rest) {
    rest = captureRest(rig);
    restCache.set(rig, rest);
  }
  return rest;
}

/**
 * Forgets the cached rest pose of a rig. Call it after changing a rig's rest
 * pose, hierarchy or bone map; the next retargetClip captures it afresh.
 */
export function clearRigCache(rig: Rig): void {
  restCache.delete(rig);
}

// ————————————————————————————————————————————————————————————————————————
// Quaternion maths on flat arrays (no allocations)

/** out[o..] = a[ai..] · b[bi..]; `out` may alias either input. */
function multiply(out: Float64Array, o: number, a: Float64Array, ai: number, b: Float64Array, bi: number): void {
  const ax = a[ai]!;
  const ay = a[ai + 1]!;
  const az = a[ai + 2]!;
  const aw = a[ai + 3]!;
  const bx = b[bi]!;
  const by = b[bi + 1]!;
  const bz = b[bi + 2]!;
  const bw = b[bi + 3]!;
  out[o] = ax * bw + aw * bx + ay * bz - az * by;
  out[o + 1] = ay * bw + aw * by + az * bx - ax * bz;
  out[o + 2] = az * bw + aw * bz + ax * by - ay * bx;
  out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** out[o..] = a[ai..]⁻¹ · b[bi..] for unit quaternions. */
function multiplyInverse(out: Float64Array, o: number, a: Float64Array, ai: number, b: Float64Array, bi: number): void {
  const ax = -a[ai]!;
  const ay = -a[ai + 1]!;
  const az = -a[ai + 2]!;
  const aw = a[ai + 3]!;
  const bx = b[bi]!;
  const by = b[bi + 1]!;
  const bz = b[bi + 2]!;
  const bw = b[bi + 3]!;
  out[o] = ax * bw + aw * bx + ay * bz - az * by;
  out[o + 1] = ay * bw + aw * by + az * bx - ax * bz;
  out[o + 2] = az * bw + aw * bz + ax * by - ay * bx;
  out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

const quat = (array: Float64Array, i: number, out: THREE.Quaternion): THREE.Quaternion => out.set(array[i]!, array[i + 1]!, array[i + 2]!, array[i + 3]!);

// ————————————————————————————————————————————————————————————————————————
// Rest alignment

/**
 * The bone whose joint gives each aligned bone its rest direction. Only the
 * limb bones are aligned by direction: their directions decide where hands and
 * feet end up, and they absorb A-pose versus T-pose rests.
 */
const DIRECTION_CHILD: Partial<Record<CanonicalBone, CanonicalBone>> = {
  LeftArm: 'LeftForeArm',
  LeftForeArm: 'LeftHand',
  RightArm: 'RightForeArm',
  RightForeArm: 'RightHand',
  LeftUpLeg: 'LeftLeg',
  LeftLeg: 'LeftFoot',
  RightUpLeg: 'RightLeg',
  RightLeg: 'RightFoot',
};

/** Bones that reuse another bone's alignment, so wrists and fingers stay as straight as they are at rest. */
function alignmentDonor(bone: CanonicalBone): CanonicalBone | null {
  const match = /^(Left|Right)Hand(.*)$/.exec(bone);
  if (!match) return null;
  return `${match[1]}${match[2] === '' ? 'ForeArm' : 'Hand'}` as CanonicalBone;
}

/**
 * Rest alignment A_b in model space: the rotation applied to the target's rest
 * pose before the source's motion is added.
 *  - Upper arm, forearm, thigh, shin: the shortest arc that turns the target's
 *    rest bone direction (joint → child joint) onto the source's. The baked
 *    bone therefore points exactly where the source bone points, whatever the
 *    two rest poses (A-pose, T-pose) and proportions are. The shortest arc
 *    adds no twist of its own.
 *  - Hands inherit the forearm's alignment and fingers the hand's, so the
 *    wrist and finger angles of the target's rest pose are kept.
 *  - Hips, spine, neck, head, shoulders, feet and toes: identity. These keep
 *    the target's own rest posture (spine curve, clavicle slope, soles flat on
 *    the floor, heels) and only receive the source's rotation away from rest.
 */
function alignment(bone: CanonicalBone, sourceBone: CanonicalBone, source: RigRest, target: RigRest, mirror: boolean, done: Map<CanonicalBone, THREE.Quaternion>): THREE.Quaternion {
  const child = DIRECTION_CHILD[bone];
  if (child) {
    const sourceChild = mirror ? mirrorBone(child) : child;
    const t0 = target.bone[bone];
    const t1 = target.bone[child];
    const s0 = source.bone[sourceBone];
    const s1 = source.bone[sourceChild];
    if (t0 !== undefined && t1 !== undefined && s0 !== undefined && s1 !== undefined) {
      const dt = new THREE.Vector3(target.modelP[t1 * 3]! - target.modelP[t0 * 3]!, target.modelP[t1 * 3 + 1]! - target.modelP[t0 * 3 + 1]!, target.modelP[t1 * 3 + 2]! - target.modelP[t0 * 3 + 2]!);
      const ds = new THREE.Vector3(source.modelP[s1 * 3]! - source.modelP[s0 * 3]!, source.modelP[s1 * 3 + 1]! - source.modelP[s0 * 3 + 1]!, source.modelP[s1 * 3 + 2]! - source.modelP[s0 * 3 + 2]!);
      if (mirror) ds.x = -ds.x;
      if (dt.lengthSq() > 1e-18 && ds.lengthSq() > 1e-18) return new THREE.Quaternion().setFromUnitVectors(dt.normalize(), ds.normalize());
    }
  }
  const donor = alignmentDonor(bone);
  return (donor && done.get(donor)?.clone()) ?? new THREE.Quaternion();
}

// ————————————————————————————————————————————————————————————————————————
// Source clip evaluation (no AnimationMixer: exact sample times, nothing left attached)

interface Binding {
  node: THREE.Object3D;
  property: 'position' | 'quaternion' | 'scale';
  interpolant: THREE.Interpolant;
}

function bindClip(clip: THREE.AnimationClip, rig: Rig, rest: RigRest): Binding[] {
  const bindings: Binding[] = [];
  for (const track of clip.tracks) {
    if (track.times.length === 0) continue;
    let parsed: ReturnType<typeof THREE.PropertyBinding.parseTrackName>;
    try {
      parsed = THREE.PropertyBinding.parseTrackName(track.name);
    } catch {
      continue;
    }
    const property = parsed.propertyName;
    if ((property !== 'position' && property !== 'quaternion' && property !== 'scale') || parsed.propertyIndex !== undefined) continue;
    // ".bones[Name].quaternion" addresses a bone by name; everything else addresses a node.
    const nodeName = parsed.objectName === 'bones' && parsed.objectIndex !== undefined ? parsed.objectIndex : parsed.nodeName;
    let node = (THREE.PropertyBinding.findNode(rig.root, nodeName) ?? undefined) as THREE.Object3D | undefined;
    // Clips authored on canonical names also drive rigs whose nodes are named differently.
    if ((!node || !rest.index.has(node)) && typeof nodeName === 'string' && isCanonicalBone(nodeName)) node = rig.bones[nodeName];
    if (!node || !rest.index.has(node)) continue;
    // createInterpolant is installed per track by setInterpolation() and is missing from three's type declarations.
    const interpolant = (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant();
    bindings.push({ node, property, interpolant });
  }
  return bindings;
}

// ————————————————————————————————————————————————————————————————————————
// The bake

const TRACK_UNSAFE = /[[\].:/]/;

/**
 * Bakes `clip` (which animates `source`) into a new clip for `target`.
 *
 * Preconditions: both rigs are in model space (see the top of this file) and
 * were in their rest pose when first passed to this function; `clip` binds to
 * the source hierarchy by node name the way an AnimationMixer rooted at
 * `source.root` would (tracks named by canonical bone are accepted too).
 *
 * Result:
 *  - One "<node name>.quaternion" track for every canonical bone mapped in
 *    both rigs and one "<hips node name>.position" track, all named by the
 *    TARGET's node names, so the clip drives the target hierarchy and every
 *    clone of it. Throws an Error if such a name is empty, contains track-name
 *    syntax ("[", "]", ".", ":", "/"), is shared by two mapped bones or
 *    resolves to another node under the target root.
 *  - Same duration as `clip`, sampled every 1 / fps seconds (default 30) from
 *    0 to the duration inclusive. Quaternions are sign-continuous. A pose is a
 *    pure function of the source pose at that time, so if the source's first
 *    and last frames match, so do the output's.
 *  - Target bones the source lacks (and unmapped target bones) get no track:
 *    they keep their rest rotation relative to their parent and ride along.
 *    Source bones the target lacks are ignored; because rotations are
 *    transferred in model space, the bones below them still end up right.
 *  - Hips translation: rest position + (source hips offset from its rest
 *    position, in model space) × targetLegLength / sourceLegLength, written in
 *    the space of the hips' parent.
 *
 * Options:
 *  - mirror: each target bone follows the source's opposite-side bone with
 *    the rotation reflected across the YZ plane (x, −y, −z, w); the hips' x
 *    offset is negated.
 *  - inPlace: removes horizontal travel from the hips track and nothing else.
 *    Per horizontal axis (x, z) the offset from the rest position loses (1) its
 *    linear drift between first and last frame and (2) its slow component, a
 *    wrap-around moving average over 2 s (over the whole clip when it is
 *    shorter). What remains is zero-mean sway faster than roughly one cycle
 *    per 2–4 s, centred over the rest spot, and it loops whenever the
 *    source pose loops. The vertical axis (bounce) is untouched.
 *
 * Neither rig is modified: the source is posed while sampling and restored
 * before returning (also on error); the target is only read. No mixer is used.
 */
export function retargetClip(clip: THREE.AnimationClip, source: Rig, target: Rig, options: RetargetOptions = {}): THREE.AnimationClip {
  const src = restOf(source);
  const dst = restOf(target);
  const mirror = options.mirror === true;
  const fps = options.fps !== undefined && options.fps > 0 ? options.fps : 30;
  const duration = Math.max(0, clip.duration);
  const intervals = duration > 0 ? Math.max(1, Math.round(duration * fps)) : 0;
  const frames = intervals + 1;

  // — Pairs: target bone ← source bone —
  const pairBones: CanonicalBone[] = [];
  const pairTarget: number[] = [];
  const pairSource: number[] = [];
  for (const bone of CANONICAL_BONES) {
    const t = dst.bone[bone];
    const s = src.bone[mirror ? mirrorBone(bone) : bone];
    if (t === undefined || s === undefined) continue;
    pairBones.push(bone);
    pairTarget.push(t);
    pairSource.push(s);
  }
  const pairs = pairBones.length;

  // — Track names —
  const namesSeen = new Map<string, CanonicalBone>();
  for (let k = 0; k < pairs; k++) {
    const node = dst.nodes[pairTarget[k]!]!;
    const bone = pairBones[k]!;
    if (node.name === '' || TRACK_UNSAFE.test(node.name)) {
      throw new Error(`retargetClip: target bone ${bone} has the node name "${node.name}", which cannot be used in an animation track name (sanitise node names with THREE.PropertyBinding.sanitizeNodeName)`);
    }
    const other = namesSeen.get(node.name);
    if (other) throw new Error(`retargetClip: target bones ${other} and ${bone} share the node name "${node.name}"; animation tracks address nodes by name, so mapped bones need unique names`);
    namesSeen.set(node.name, bone);
    if (THREE.PropertyBinding.findNode(target.root, node.name) !== node) {
      throw new Error(`retargetClip: the node name "${node.name}" of target bone ${bone} is also used by an earlier node under the target root, so a track could not reach the bone; rename one of them`);
    }
  }

  // — Constant part: Wt_b(t) = [mirrored] Ws(t) · C_b with C_b = [mirrored] Rs⁻¹ · A_b · Rt_b —
  const constant = new Float64Array(pairs * 4);
  {
    const aligned = new Map<CanonicalBone, THREE.Quaternion>();
    const q = new THREE.Quaternion();
    const rt = new THREE.Quaternion();
    for (let k = 0; k < pairs; k++) {
      const bone = pairBones[k]!;
      const a = alignment(bone, mirror ? mirrorBone(bone) : bone, src, dst, mirror, aligned);
      aligned.set(bone, a);
      quat(src.modelQ, pairSource[k]! * 4, q).invert();
      if (mirror) q.set(q.x, -q.y, -q.z, q.w);
      q.multiply(a).multiply(quat(dst.modelQ, pairTarget[k]! * 4, rt)).normalize();
      constant[k * 4] = q.x;
      constant[k * 4 + 1] = q.y;
      constant[k * 4 + 2] = q.z;
      constant[k * 4 + 3] = q.w;
    }
  }

  // — Source nodes whose model rotation is needed, parents first —
  const sourceNeeded = new Uint8Array(src.nodes.length);
  for (const s of pairSource) for (let i = s; i >= 0 && !sourceNeeded[i]; i = src.parent[i]!) sourceNeeded[i] = 1;
  const sourceOrder: number[] = [];
  for (let i = 0; i < src.nodes.length; i++) if (sourceNeeded[i]) sourceOrder.push(i);
  const sourceWorld = new Float64Array(src.nodes.length * 4);

  // — Target nodes on the paths to the paired bones, parents first —
  const pairOfTarget = new Int32Array(dst.nodes.length).fill(-1);
  pairTarget.forEach((t, k) => (pairOfTarget[t] = k));
  const targetNeeded = new Uint8Array(dst.nodes.length);
  for (const t of pairTarget) for (let i = t; i >= 0 && !targetNeeded[i]; i = dst.parent[i]!) targetNeeded[i] = 1;
  const targetOrder: number[] = [];
  for (let i = 0; i < dst.nodes.length; i++) if (targetNeeded[i]) targetOrder.push(i);
  const targetWorld = new Float64Array(dst.nodes.length * 4);

  // — Hips —
  const hipsPair = pairBones.indexOf('Hips');
  const sourceHips = hipsPair >= 0 ? pairSource[hipsPair]! : -1;
  const targetHips = hipsPair >= 0 ? pairTarget[hipsPair]! : -1;
  const travelScale = src.legLength > 0 && dst.legLength > 0 ? dst.legLength / src.legLength : 1;
  const offsets = new Float64Array(frames * 3);

  const rotations = new Float32Array(pairs * frames * 4);
  const local = new Float64Array(4);
  const tmp = new Float64Array(4);
  const IDENTITY = new Float64Array([0, 0, 0, 1]);

  const bindings = bindClip(clip, source, src);
  // Pose of every node the clip touches, to be restored afterwards.
  const touched = [...new Set(bindings.map((binding) => binding.node))];
  const saved = new Float64Array(touched.length * 10);
  touched.forEach((node, i) => {
    node.position.toArray(saved, i * 10);
    node.quaternion.toArray(saved, i * 10 + 3);
    node.scale.toArray(saved, i * 10 + 7);
  });

  try {
    for (let f = 0; f < frames; f++) {
      const time = intervals > 0 ? (f / intervals) * duration : 0;

      // Pose the source.
      for (let i = 0; i < bindings.length; i++) {
        const binding = bindings[i]!;
        const value = binding.interpolant.evaluate(time) as ArrayLike<number>;
        if (binding.property === 'quaternion') binding.node.quaternion.fromArray(value).normalize();
        else binding.node[binding.property].fromArray(value);
      }

      // Source model rotations.
      for (let n = 0; n < sourceOrder.length; n++) {
        const i = sourceOrder[n]!;
        const q = src.nodes[i]!.quaternion;
        tmp[0] = q.x;
        tmp[1] = q.y;
        tmp[2] = q.z;
        tmp[3] = q.w;
        const p = src.parent[i]!;
        multiply(sourceWorld, i * 4, p < 0 ? IDENTITY : sourceWorld, p < 0 ? 0 : p * 4, tmp, 0);
      }

      // Target rotations, parents first.
      for (let n = 0; n < targetOrder.length; n++) {
        const i = targetOrder[n]!;
        const p = dst.parent[i]!;
        const k = pairOfTarget[i]!;
        if (k < 0) {
          // Not driven: rest rotation relative to the parent.
          multiply(targetWorld, i * 4, p < 0 ? IDENTITY : targetWorld, p < 0 ? 0 : p * 4, dst.localQ, i * 4);
          continue;
        }
        const s = pairSource[k]! * 4;
        tmp[0] = sourceWorld[s]!;
        tmp[1] = mirror ? -sourceWorld[s + 1]! : sourceWorld[s + 1]!;
        tmp[2] = mirror ? -sourceWorld[s + 2]! : sourceWorld[s + 2]!;
        tmp[3] = sourceWorld[s + 3]!;
        multiply(targetWorld, i * 4, tmp, 0, constant, k * 4);
        multiplyInverse(local, 0, p < 0 ? IDENTITY : targetWorld, p < 0 ? 0 : p * 4, targetWorld, i * 4);
        let x = local[0]!;
        let y = local[1]!;
        let z = local[2]!;
        let w = local[3]!;
        const length = Math.hypot(x, y, z, w) || 1;
        const o = (k * frames + f) * 4;
        // Sign continuity with the previous frame.
        const flip = f > 0 && x * rotations[o - 4]! + y * rotations[o - 3]! + z * rotations[o - 2]! + w * rotations[o - 1]! < 0 ? -1 / length : 1 / length;
        x *= flip;
        y *= flip;
        z *= flip;
        w *= flip;
        rotations[o] = x;
        rotations[o + 1] = y;
        rotations[o + 2] = z;
        rotations[o + 3] = w;
      }

      // Source hips offset from rest, model space.
      if (sourceHips >= 0) {
        const node = src.nodes[sourceHips]!;
        let x = node.position.x;
        let y = node.position.y;
        let z = node.position.z;
        for (let i = src.parent[sourceHips]!; i >= 0; i = src.parent[i]!) {
          const a = src.nodes[i]!;
          // p ← a.position + a.quaternion · (a.scale ∘ p)
          const sx = x * a.scale.x;
          const sy = y * a.scale.y;
          const sz = z * a.scale.z;
          const q = a.quaternion;
          const tx = 2 * (q.y * sz - q.z * sy);
          const ty = 2 * (q.z * sx - q.x * sz);
          const tz = 2 * (q.x * sy - q.y * sx);
          x = sx + q.w * tx + (q.y * tz - q.z * ty) + a.position.x;
          y = sy + q.w * ty + (q.z * tx - q.x * tz) + a.position.y;
          z = sz + q.w * tz + (q.x * ty - q.y * tx) + a.position.z;
        }
        offsets[f * 3] = (x - src.modelP[sourceHips * 3]!) * (mirror ? -travelScale : travelScale);
        offsets[f * 3 + 1] = (y - src.modelP[sourceHips * 3 + 1]!) * travelScale;
        offsets[f * 3 + 2] = (z - src.modelP[sourceHips * 3 + 2]!) * travelScale;
      }
    }
  } finally {
    touched.forEach((node, i) => {
      node.position.fromArray(saved, i * 10);
      node.quaternion.fromArray(saved, i * 10 + 3);
      node.scale.fromArray(saved, i * 10 + 7);
    });
  }

  if (options.inPlace === true && sourceHips >= 0) {
    removeTravel(offsets, 0, frames, fps);
    removeTravel(offsets, 2, frames, fps);
  }

  // — Tracks —
  const times = new Float32Array(frames);
  for (let f = 0; f < frames; f++) times[f] = intervals > 0 ? (f / intervals) * duration : 0;
  const tracks: THREE.KeyframeTrack[] = [];
  for (let k = 0; k < pairs; k++) {
    const name = dst.nodes[pairTarget[k]!]!.name;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times.slice(), rotations.slice(k * frames * 4, (k + 1) * frames * 4)));
  }
  if (targetHips >= 0) {
    const positions = new Float32Array(frames * 3);
    const v = new THREE.Vector3();
    const px = dst.modelP[targetHips * 3]!;
    const py = dst.modelP[targetHips * 3 + 1]!;
    const pz = dst.modelP[targetHips * 3 + 2]!;
    for (let f = 0; f < frames; f++) {
      v.set(px + offsets[f * 3]!, py + offsets[f * 3 + 1]!, pz + offsets[f * 3 + 2]!).applyMatrix4(dst.hipsParentInverse);
      positions[f * 3] = v.x;
      positions[f * 3 + 1] = v.y;
      positions[f * 3 + 2] = v.z;
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${dst.nodes[targetHips]!.name}.position`, times.slice(), positions));
  }
  return new THREE.AnimationClip(options.name ?? clip.name, duration, tracks);
}

/**
 * Removes travel from one axis of a hips offset track in place: the linear
 * drift between first and last frame, then a wrap-around moving average over
 * IN_PLACE_WINDOW seconds (the plain mean when the clip is shorter).
 * `offsets` holds 3 values per frame; `axis` selects the component.
 */
function removeTravel(offsets: Float64Array, axis: number, frames: number, fps: number): void {
  const count = frames - 1; // the last frame closes the loop
  if (count < 1) {
    offsets[axis] = 0;
    return;
  }
  const first = offsets[axis]!;
  const drift = offsets[count * 3 + axis]! - first;
  const detrended = new Float64Array(count);
  for (let i = 0; i < count; i++) detrended[i] = offsets[i * 3 + axis]! - first - (drift * i) / count;
  const half = Math.round((IN_PLACE_WINDOW * fps) / 2);
  if (2 * half + 1 >= count) {
    let mean = 0;
    for (let i = 0; i < count; i++) mean += detrended[i]!;
    mean /= count;
    for (let i = 0; i < count; i++) offsets[i * 3 + axis] = detrended[i]! - mean;
  } else {
    let sum = 0;
    for (let j = -half; j <= half; j++) sum += detrended[(j + count) % count]!;
    for (let i = 0; i < count; i++) {
      offsets[i * 3 + axis] = detrended[i]! - sum / (2 * half + 1);
      sum += detrended[(i + half + 1) % count]! - detrended[(i - half + count) % count]!;
    }
  }
  offsets[count * 3 + axis] = offsets[axis]!;
}
