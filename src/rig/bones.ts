/**
 * The canonical humanoid skeleton.
 *
 * Every character is mapped onto these bone names (Mixamo-style, without the
 * "mixamorig" prefix) and every dance is expressed against them, which is what
 * lets any dance play on any character.
 *
 * Conventions for the canonical rest pose (used by the procedural characters
 * and by code-authored dances):
 *   - T-pose, Y up, facing +Z, so the character's LEFT side is at +X.
 *   - Every bone's rest local rotation is identity (bone axes = model axes).
 */

export const CANONICAL_BONES = [
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
  'LeftHandThumb1',
  'LeftHandThumb2',
  'LeftHandThumb3',
  'LeftHandIndex1',
  'LeftHandIndex2',
  'LeftHandIndex3',
  'LeftHandMiddle1',
  'LeftHandMiddle2',
  'LeftHandMiddle3',
  'LeftHandRing1',
  'LeftHandRing2',
  'LeftHandRing3',
  'LeftHandPinky1',
  'LeftHandPinky2',
  'LeftHandPinky3',

  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'RightHandThumb1',
  'RightHandThumb2',
  'RightHandThumb3',
  'RightHandIndex1',
  'RightHandIndex2',
  'RightHandIndex3',
  'RightHandMiddle1',
  'RightHandMiddle2',
  'RightHandMiddle3',
  'RightHandRing1',
  'RightHandRing2',
  'RightHandRing3',
  'RightHandPinky1',
  'RightHandPinky2',
  'RightHandPinky3',

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
] as const;

export type CanonicalBone = (typeof CANONICAL_BONES)[number];

/** Parent of each canonical bone (null for the root). */
export const BONE_PARENT: Record<CanonicalBone, CanonicalBone | null> = (() => {
  const parent = {} as Record<CanonicalBone, CanonicalBone | null>;
  parent.Hips = null;
  parent.Spine = 'Hips';
  parent.Spine1 = 'Spine';
  parent.Spine2 = 'Spine1';
  parent.Neck = 'Spine2';
  parent.Head = 'Neck';
  parent.HeadTop_End = 'Head';
  for (const side of ['Left', 'Right'] as const) {
    parent[`${side}Shoulder`] = 'Spine2';
    parent[`${side}Arm`] = `${side}Shoulder`;
    parent[`${side}ForeArm`] = `${side}Arm`;
    parent[`${side}Hand`] = `${side}ForeArm`;
    for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const) {
      parent[`${side}Hand${finger}1`] = `${side}Hand`;
      parent[`${side}Hand${finger}2`] = `${side}Hand${finger}1`;
      parent[`${side}Hand${finger}3`] = `${side}Hand${finger}2`;
    }
    parent[`${side}UpLeg`] = 'Hips';
    parent[`${side}Leg`] = `${side}UpLeg`;
    parent[`${side}Foot`] = `${side}Leg`;
    parent[`${side}ToeBase`] = `${side}Foot`;
    parent[`${side}Toe_End`] = `${side}ToeBase`;
  }
  return parent;
})();

/**
 * Bones a rig must expose to be treated as a humanoid. Everything else is
 * optional: a missing optional bone is simply skipped by the retargeter.
 */
export const REQUIRED_BONES: readonly CanonicalBone[] = [
  'Hips',
  'Spine',
  'Head',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
];

/** The body bones (no fingers, no end markers): what code-authored dances animate. */
export const BODY_BONES: readonly CanonicalBone[] = [
  'Hips',
  'Spine',
  'Spine1',
  'Spine2',
  'Neck',
  'Head',
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
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
  'RightToeBase',
];

export type BoneSide = 'left' | 'right' | 'center';

export function boneSide(bone: CanonicalBone): BoneSide {
  if (bone.startsWith('Left')) return 'left';
  if (bone.startsWith('Right')) return 'right';
  return 'center';
}

/** The same bone on the other side of the body (centre bones map to themselves). */
export function mirrorBone(bone: CanonicalBone): CanonicalBone {
  if (bone.startsWith('Left')) return `Right${bone.slice(4)}` as CanonicalBone;
  if (bone.startsWith('Right')) return `Left${bone.slice(5)}` as CanonicalBone;
  return bone;
}

const BONE_SET: ReadonlySet<string> = new Set(CANONICAL_BONES);

export function isCanonicalBone(name: string): name is CanonicalBone {
  return BONE_SET.has(name);
}
