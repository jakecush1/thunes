/**
 * The canonical skeleton builder.
 *
 * Turns a compact set of body proportions into a skeleton that follows the
 * conventions in bones.ts: T-pose, Y up, facing +Z, the character's LEFT side
 * at +X, soles on y = 0, hips centred on x = z = 0, every bone's local rotation
 * identity. Procedural characters are skinned to it and code-authored dances
 * are expressed against it.
 *
 * Everything here is pure (no WebGL), so it runs in Node.
 */
import * as THREE from 'three';
import { BODY_BONES, BONE_PARENT } from './bones';
import type { CanonicalBone } from './bones';

/** End markers (no skin, no animation): they only give the last real bone a direction and a length. */
export const END_MARKER_BONES = ['HeadTop_End', 'LeftToe_End', 'RightToe_End'] as const;

/**
 * Every bone the canonical skeleton has: the body bones plus the end markers
 * (no fingers), ordered so that a parent always comes before its children.
 * This order is also the skin-index order of the procedural characters.
 */
export const CANONICAL_BODY_BONES = [
  'Hips',
  'Spine',
  'Spine1',
  'Spine2',
  'Neck',
  'Head',
  'HeadTop_End',
  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'LeftToeBase',
  'LeftToe_End',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
  'RightToeBase',
  'RightToe_End',
] as const satisfies readonly CanonicalBone[];

export type CanonicalBodyBone = (typeof CANONICAL_BODY_BONES)[number];

/**
 * Body proportions of a humanoid. JSON-compatible.
 *
 * `height` is in metres and is exact: the top of the skull (HeadTop_End) lands
 * on it. Every other field is a length in "authoring units": metres on the
 * default 1.75 m adult. The builder scales all of them by one common factor
 * (see `unitScale`) so that the vertical chain adds up to `height`. That makes
 * the fields pure proportions: doubling the head of a variant keeps it exactly
 * `height` tall, with everything else shrinking to make room.
 *
 * Keep every length above zero: zero-length bones have no direction, which
 * retargeting cannot use.
 */
export interface HumanoidProportions {
  /** Overall standing height, soles to top of skull, metres. */
  height: number;

  /** Head joint (base of the skull) to the top of the skull. */
  headHeight: number;
  /** Neck joint (base of the neck) to the Head joint. */
  neckLength: number;

  /** Distance between the left and right shoulder joints (LeftArm to RightArm). */
  shoulderWidth: number;
  /** How far the shoulder joints and clavicle roots sit below the base of the neck. */
  shoulderDrop: number;

  /** Hips joint to Spine joint. */
  hipsToSpine: number;
  /** Spine joint to Spine1 joint. */
  spineToSpine1: number;
  /** Spine1 joint to Spine2 joint. */
  spine1ToSpine2: number;
  /** Spine2 joint to the Neck joint. */
  spine2ToNeck: number;

  /** Shoulder joint to elbow. */
  upperArmLength: number;
  /** Elbow to wrist. */
  forearmLength: number;
  /** Wrist to fingertips (there are no finger bones; meshes and reach estimates use it). */
  handLength: number;

  /** Distance between the left and right hip sockets. */
  hipWidth: number;
  /** How far the hip sockets sit below the Hips joint. */
  hipDrop: number;
  /** Hip socket to knee. */
  thighLength: number;
  /** Knee to ankle. */
  shinLength: number;
  /** Height of the ankle joint above the sole. */
  ankleHeight: number;
  /** Heel to toe tip. The ankle sits a quarter of this in front of the heel. */
  footLength: number;
}

/** An adult of average build, 1.75 m tall. */
export const DEFAULT_PROPORTIONS: Readonly<HumanoidProportions> = Object.freeze({
  height: 1.75,
  headHeight: 0.22,
  neckLength: 0.09,
  shoulderWidth: 0.38,
  shoulderDrop: 0.03,
  hipsToSpine: 0.09,
  spineToSpine1: 0.11,
  spine1ToSpine2: 0.12,
  spine2ToNeck: 0.16,
  upperArmLength: 0.28,
  forearmLength: 0.25,
  handLength: 0.18,
  hipWidth: 0.18,
  hipDrop: 0.05,
  thighLength: 0.41,
  shinLength: 0.41,
  ankleHeight: 0.09,
  footLength: 0.25,
});

/** Fraction of the clavicle root's distance from the centre line, relative to the shoulder joint's. */
const CLAVICLE_ROOT = 0.25;
/** Where the ankle sits along the foot, from the heel (fraction of footLength). */
const ANKLE_ALONG_FOOT = 0.25;
/** Where the ball of the foot (ToeBase) sits, from the heel (fraction of footLength). */
const BALL_ALONG_FOOT = 0.7;
/** Height of the ball of the foot and the toe tip above the sole (fraction of ankleHeight). */
const TOE_HEIGHT = 0.4;

/** A variant of `base` (default: the adult) with some fields replaced. Unknown or undefined overrides are ignored. */
export function deriveProportions(
  overrides: Partial<HumanoidProportions> = {},
  base: HumanoidProportions = DEFAULT_PROPORTIONS,
): HumanoidProportions {
  const result: HumanoidProportions = { ...base };
  for (const key of Object.keys(base) as (keyof HumanoidProportions)[]) {
    const value = overrides[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
  }
  return result;
}

/** The same body at a different overall height (metres). */
export function withHeight(p: HumanoidProportions, height: number): HumanoidProportions {
  return { ...p, height };
}

/** Sum of the vertical chain, soles to top of skull, in authoring units. */
export function statureUnits(p: HumanoidProportions): number {
  return (
    p.ankleHeight +
    p.shinLength +
    p.thighLength +
    p.hipDrop +
    p.hipsToSpine +
    p.spineToSpine1 +
    p.spine1ToSpine2 +
    p.spine2ToNeck +
    p.neckLength +
    p.headHeight
  );
}

/** Metres per authoring unit: multiply any length field by this to get its real size. */
export function unitScale(p: HumanoidProportions): number {
  return p.height / statureUnits(p);
}

/** Hip socket to ankle (thigh + shin), metres. */
export function legLength(p: HumanoidProportions): number {
  return (p.thighLength + p.shinLength) * unitScale(p);
}

/** Shoulder joint to wrist (upper arm + forearm), metres. */
export function armLength(p: HumanoidProportions): number {
  return (p.upperArmLength + p.forearmLength) * unitScale(p);
}

/** Height of the Hips joint above the floor in the rest pose, metres. */
export function hipHeight(p: HumanoidProportions): number {
  return (p.ankleHeight + p.shinLength + p.thighLength + p.hipDrop) * unitScale(p);
}

/** Z of the back of the heel in the rest pose, metres (negative: behind the ankle). The toe tip is LeftToe_End. */
export function heelZ(p: HumanoidProportions): number {
  return -ANKLE_ALONG_FOOT * p.footLength * unitScale(p);
}

/**
 * Rest-pose joint positions in model space, metres (new vectors on every call).
 * Left is +X, forward is +Z, the floor is y = 0.
 */
export function restJointPositions(p: HumanoidProportions): Record<CanonicalBodyBone, THREE.Vector3> {
  const u = unitScale(p);
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  const ankleY = p.ankleHeight * u;
  const kneeY = ankleY + p.shinLength * u;
  const hipSocketY = kneeY + p.thighLength * u;
  const hipsY = hipSocketY + p.hipDrop * u;
  const spineY = hipsY + p.hipsToSpine * u;
  const spine1Y = spineY + p.spineToSpine1 * u;
  const spine2Y = spine1Y + p.spine1ToSpine2 * u;
  const neckY = spine2Y + p.spine2ToNeck * u;
  const headY = neckY + p.neckLength * u;
  const topY = headY + p.headHeight * u;

  const shoulderY = neckY - p.shoulderDrop * u;
  const shoulderX = (p.shoulderWidth / 2) * u;
  const clavicleX = shoulderX * CLAVICLE_ROOT;
  const elbowX = shoulderX + p.upperArmLength * u;
  const wristX = elbowX + p.forearmLength * u;

  const hipX = (p.hipWidth / 2) * u;
  const toeY = ankleY * TOE_HEIGHT;
  const ballZ = (BALL_ALONG_FOOT - ANKLE_ALONG_FOOT) * p.footLength * u;
  const toeZ = (1 - ANKLE_ALONG_FOOT) * p.footLength * u;

  return {
    Hips: v(0, hipsY, 0),
    Spine: v(0, spineY, 0),
    Spine1: v(0, spine1Y, 0),
    Spine2: v(0, spine2Y, 0),
    Neck: v(0, neckY, 0),
    Head: v(0, headY, 0),
    HeadTop_End: v(0, topY, 0),

    LeftShoulder: v(clavicleX, shoulderY, 0),
    LeftArm: v(shoulderX, shoulderY, 0),
    LeftForeArm: v(elbowX, shoulderY, 0),
    LeftHand: v(wristX, shoulderY, 0),
    RightShoulder: v(-clavicleX, shoulderY, 0),
    RightArm: v(-shoulderX, shoulderY, 0),
    RightForeArm: v(-elbowX, shoulderY, 0),
    RightHand: v(-wristX, shoulderY, 0),

    LeftUpLeg: v(hipX, hipSocketY, 0),
    LeftLeg: v(hipX, kneeY, 0),
    LeftFoot: v(hipX, ankleY, 0),
    LeftToeBase: v(hipX, toeY, ballZ),
    LeftToe_End: v(hipX, toeY, toeZ),
    RightUpLeg: v(-hipX, hipSocketY, 0),
    RightLeg: v(-hipX, kneeY, 0),
    RightFoot: v(-hipX, ankleY, 0),
    RightToeBase: v(-hipX, toeY, ballZ),
    RightToe_End: v(-hipX, toeY, toeZ),
  };
}

/** A freshly built canonical skeleton. */
export interface CanonicalSkeleton {
  /** Plain Object3D at the origin (identity transform) that holds Hips. */
  root: THREE.Object3D;
  /** Every canonical body bone and end marker. `bone.name` is the canonical name. */
  bones: Record<CanonicalBodyBone, THREE.Bone>;
}

/**
 * Builds a new rest-pose skeleton for the given proportions: hierarchy per
 * BONE_PARENT, identity local rotations, unit scales, positions from
 * `restJointPositions`. World matrices are up to date on return.
 */
export function buildCanonicalSkeleton(p: HumanoidProportions): CanonicalSkeleton {
  const positions = restJointPositions(p);
  const root = new THREE.Object3D();
  root.name = 'CanonicalRig';
  const bones = {} as Record<CanonicalBodyBone, THREE.Bone>;
  for (const name of CANONICAL_BODY_BONES) {
    const bone = new THREE.Bone();
    bone.name = name;
    const parentName = BONE_PARENT[name] as CanonicalBodyBone | null;
    if (parentName === null) {
      bone.position.copy(positions[name]);
      root.add(bone);
    } else {
      bone.position.copy(positions[name]).sub(positions[parentName]);
      bones[parentName].add(bone);
    }
    bones[name] = bone;
  }
  root.updateMatrixWorld(true);
  return { root, bones };
}

/** True when `name` is one of the bones the canonical skeleton has. */
export function isCanonicalBodyBone(name: string): name is CanonicalBodyBone {
  return BODY_BONE_SET.has(name);
}

const BODY_BONE_SET: ReadonlySet<string> = new Set(CANONICAL_BODY_BONES);

// Guard against bones.ts and this file drifting apart (evaluated once at import).
for (const bone of BODY_BONES) {
  if (!BODY_BONE_SET.has(bone)) throw new Error(`canonical.ts: body bone "${bone}" is missing from CANONICAL_BODY_BONES`);
}
