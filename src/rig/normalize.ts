/**
 * Normalisation: puts any humanoid into "model space" — upright (Y up),
 * facing +Z (the character's left at +X), lowest point on y = 0, hips over the
 * origin, a given number of metres tall.
 */
import * as THREE from 'three';
import type { CanonicalBone } from './bones';
import type { HumanoidMapping } from './humanoid';

/** Result of normalizeHumanoid. */
export interface NormalizedHumanoid {
  /** The new wrapper. Its own transform is identity; treat it as the character and add it wherever it is needed. */
  root: THREE.Object3D;
  /** Height in metres after normalisation (equals options.height). */
  height: number;
  /**
   * Approximate horizontal half-extent of the body in metres: the largest
   * horizontal distance from the hips axis to the upper-arm joints, legs, feet
   * and head, padded by 30 %. Outstretched rest-pose arms are deliberately not counted.
   */
  radius: number;
}

/** Up snaps to a source axis within this angle (Z-up rigs, exact upright rigs); a leaning rest pose is not "corrected". */
const UP_SNAP_COS = Math.cos(THREE.MathUtils.degToRad(30));
/** The left-right axis snaps to a source axis within this angle, so a slightly asymmetric rest pose does not yaw the model. */
const LEFT_SNAP_COS = Math.cos(THREE.MathUtils.degToRad(10));
/** Without geometry: the skull top is this fraction of the joint height above the head joint. */
const HEAD_ALLOWANCE = 0.15;
/** Without geometry and without any joint below the ankles: the sole is this fraction of the joint height below the ankle. */
const SOLE_ALLOWANCE = 0.045;
const MAX_SAMPLED_VERTICES = 200_000;

function snapToAxis(v: THREE.Vector3, minCos: number): boolean {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  if (Math.max(ax, ay, az) < minCos) return false;
  if (ax >= ay && ax >= az) v.set(Math.sign(v.x), 0, 0);
  else if (ay >= az) v.set(0, Math.sign(v.y), 0);
  else v.set(0, 0, Math.sign(v.z));
  return true;
}

/**
 * Wraps `root` so that, in the returned wrapper's own space ("model space"),
 * the character in its current (rest) pose is upright, faces +Z, stands with
 * its lowest point on y = 0, has its hips on the Y axis and is
 * `options.height` metres tall.
 *
 * The hierarchy becomes wrapper › fit › root: `fit` carries the rotation,
 * uniform scale and translation, the wrapper stays at identity (so it can be
 * placed freely) and `root` itself is not modified. If `root` had a parent,
 * the wrapper takes its place there.
 *
 * Facing comes from the skeleton: left-right from upper arms and thighs, up
 * from hips to head (snapped to the nearest source axis within 30°, which
 * handles Z-up rigs), forward = left × up. Height and ground come from the
 * posed geometry of every mesh under `root` (skinned or rigid) when there is
 * any, otherwise from the joints with an allowance for skull and soles.
 * Centimetre units, scaled or rotated armature nodes and skeletons that are
 * not parented under their SkinnedMesh are all handled, because everything is
 * measured in world space.
 *
 * Call once, with the hierarchy in rest pose. Requires at least Hips in the mapping.
 */
export function normalizeHumanoid(root: THREE.Object3D, mapping: HumanoidMapping, options: { height: number }): NormalizedHumanoid {
  const bones = mapping.bones;
  const hipsNode = bones.Hips;
  if (!hipsNode) throw new Error('normalizeHumanoid: the mapping has no Hips bone');

  const wrapper = new THREE.Group();
  wrapper.name = 'ModelRoot';
  const fit = new THREE.Group();
  fit.name = 'ModelFit';
  const formerParent = root.parent;
  wrapper.add(fit);
  fit.add(root);
  if (formerParent) formerParent.add(wrapper);

  wrapper.updateWorldMatrix(true, false);
  wrapper.updateMatrixWorld(true); // also refreshes SkinnedMesh.bindMatrixInverse
  const toWrapper = new THREE.Matrix4().copy(wrapper.matrixWorld).invert();
  const joint = (bone: CanonicalBone): THREE.Vector3 | null => {
    const node = bones[bone];
    return node ? new THREE.Vector3().setFromMatrixPosition(node.matrixWorld).applyMatrix4(toWrapper) : null;
  };
  const hips = joint('Hips')!;

  // — Orientation —
  const up = new THREE.Vector3(0, 1, 0);
  const top = joint('Head') ?? joint('Neck') ?? joint('Spine2') ?? joint('Spine1') ?? joint('Spine');
  if (top && top.distanceToSquared(hips) > 1e-12) {
    up.subVectors(top, hips).normalize();
    snapToAxis(up, UP_SNAP_COS);
  }
  const upSnapped = Math.abs(up.x) + Math.abs(up.y) + Math.abs(up.z) === 1;
  const left = new THREE.Vector3();
  for (const [l, r] of [
    ['LeftArm', 'RightArm'],
    ['LeftUpLeg', 'RightUpLeg'],
    ['LeftShoulder', 'RightShoulder'],
    ['LeftFoot', 'RightFoot'],
  ] as const) {
    const a = joint(l);
    const b = joint(r);
    if (a && b) left.add(a).sub(b);
  }
  left.addScaledVector(up, -left.dot(up));
  if (left.lengthSq() < 1e-12) {
    // No usable left-right pair: keep the source's yaw.
    left.set(1, 0, 0).addScaledVector(up, -up.x);
    if (left.lengthSq() < 1e-12) left.set(0, 0, 1);
  }
  left.normalize();
  if (upSnapped) snapToAxis(left, LEFT_SNAP_COS);
  const forward = new THREE.Vector3().crossVectors(left, up);
  // Rows = the character's axes: maps left → +X, up → +Y, forward → +Z.
  const rotation = new THREE.Matrix4().makeBasis(left, up, forward).transpose();
  const toUpright = new THREE.Matrix4().multiplyMatrices(rotation, toWrapper);

  // — Extents (upright, unscaled) —
  let minY = Infinity;
  let maxY = -Infinity;
  const v = new THREE.Vector3();
  let sampled = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const position = mesh.geometry?.getAttribute('position');
    if (!position) return;
    const step = Math.max(1, Math.ceil(position.count / MAX_SAMPLED_VERTICES));
    for (let i = 0; i < position.count; i += step) {
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).applyMatrix4(toUpright);
      if (Number.isFinite(v.y)) {
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
        sampled++;
      }
    }
  });
  if (sampled === 0 || !(maxY - minY > 1e-9)) {
    minY = Infinity;
    maxY = -Infinity;
    hipsNode.traverse((node) => {
      const flagged = node as THREE.Object3D & { isMesh?: boolean; isCamera?: boolean; isLight?: boolean };
      if (flagged.isMesh || flagged.isCamera || flagged.isLight) return;
      v.setFromMatrixPosition(node.matrixWorld).applyMatrix4(toUpright);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    });
    const span = Math.max(maxY - minY, 1e-9);
    const head = joint('Head');
    if (!bones.HeadTop_End && head) maxY = Math.max(maxY, head.applyMatrix4(rotation).y + HEAD_ALLOWANCE * span);
    // Soles: only when nothing (toe joint, end site) reaches below the ankles.
    const ankles = [joint('LeftFoot'), joint('RightFoot')].filter((p): p is THREE.Vector3 => p !== null).map((p) => p.applyMatrix4(rotation).y);
    if (ankles.length > 0 && Math.min(...ankles) - minY < 0.02 * span) minY -= SOLE_ALLOWANCE * span;
  }
  const measured = maxY - minY;
  const scale = measured > 1e-9 && options.height > 0 ? options.height / measured : 1;

  // — Radius —
  const hipsUpright = hips.clone().applyMatrix4(rotation);
  let radius = 0;
  for (const bone of ['LeftArm', 'RightArm', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase', 'Head'] as const) {
    const p = joint(bone);
    if (!p) continue;
    p.applyMatrix4(rotation).sub(hipsUpright);
    radius = Math.max(radius, Math.hypot(p.x, p.z) * scale);
  }
  radius = radius > 0 ? radius * 1.3 : options.height * 0.18;

  // — Fit transform: p_model = scale * rotation * p + translation —
  fit.quaternion.setFromRotationMatrix(rotation);
  fit.scale.setScalar(scale);
  fit.position.set(-scale * hipsUpright.x, -scale * minY, -scale * hipsUpright.z);
  wrapper.updateMatrixWorld(true);

  return { root: wrapper, height: measured > 1e-9 ? scale * measured : options.height, radius };
}
