import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BODY_BONES, BONE_PARENT, mirrorBone } from '../../../src/rig/bones';
import {
  CANONICAL_BODY_BONES,
  DEFAULT_PROPORTIONS,
  END_MARKER_BONES,
  armLength,
  buildCanonicalSkeleton,
  deriveProportions,
  heelZ,
  hipHeight,
  isCanonicalBodyBone,
  legLength,
  restJointPositions,
  statureUnits,
  unitScale,
  withHeight,
} from '../../../src/rig/canonical';
import type { CanonicalBodyBone, HumanoidProportions } from '../../../src/rig/canonical';

const VARIANTS: Record<string, HumanoidProportions> = {
  adult: DEFAULT_PROPORTIONS,
  bigHead: deriveProportions({ headHeight: 0.6, thighLength: 0.15, shinLength: 0.15, upperArmLength: 0.12 }),
  tall: deriveProportions({ height: 2.4, thighLength: 0.6, shinLength: 0.6, headHeight: 0.15 }),
  small: withHeight(DEFAULT_PROPORTIONS, 0.9),
};

function worldPositions(p: HumanoidProportions): Record<CanonicalBodyBone, THREE.Vector3> {
  const { bones } = buildCanonicalSkeleton(p);
  const out = {} as Record<CanonicalBodyBone, THREE.Vector3>;
  for (const name of CANONICAL_BODY_BONES) out[name] = bones[name].getWorldPosition(new THREE.Vector3());
  return out;
}

describe('canonical bone list', () => {
  it('is the body bones plus the end markers, parents first', () => {
    expect(new Set(CANONICAL_BODY_BONES)).toEqual(new Set([...BODY_BONES, ...END_MARKER_BONES]));
    expect(CANONICAL_BODY_BONES.length).toBe(BODY_BONES.length + END_MARKER_BONES.length);
    const seen = new Set<string>();
    for (const name of CANONICAL_BODY_BONES) {
      const parent = BONE_PARENT[name];
      if (parent !== null) expect(seen.has(parent), `${parent} before ${name}`).toBe(true);
      seen.add(name);
    }
    expect(isCanonicalBodyBone('LeftForeArm')).toBe(true);
    expect(isCanonicalBodyBone('LeftHandIndex1')).toBe(false);
  });
});

describe('proportions helpers', () => {
  it('default adult is authored in metres', () => {
    expect(DEFAULT_PROPORTIONS.height).toBe(1.75);
    expect(statureUnits(DEFAULT_PROPORTIONS)).toBeCloseTo(1.75, 9);
    expect(unitScale(DEFAULT_PROPORTIONS)).toBeCloseTo(1, 9);
  });

  it('deriveProportions overrides without mutating and ignores junk', () => {
    const derived = deriveProportions({ headHeight: 0.5, hipWidth: undefined, neckLength: Number.NaN });
    expect(derived.headHeight).toBe(0.5);
    expect(derived.hipWidth).toBe(DEFAULT_PROPORTIONS.hipWidth);
    expect(derived.neckLength).toBe(DEFAULT_PROPORTIONS.neckLength);
    expect(DEFAULT_PROPORTIONS.headHeight).toBe(0.22);
    expect(JSON.parse(JSON.stringify(derived))).toEqual(derived);
  });

  it('leg length, arm length and hip height agree with the joints', () => {
    for (const p of Object.values(VARIANTS)) {
      const j = restJointPositions(p);
      expect(legLength(p)).toBeCloseTo(j.LeftUpLeg.y - j.LeftFoot.y, 9);
      expect(armLength(p)).toBeCloseTo(j.LeftHand.x - j.LeftArm.x, 9);
      expect(hipHeight(p)).toBeCloseTo(j.Hips.y, 9);
      expect(j.LeftToe_End.z - heelZ(p)).toBeCloseTo(p.footLength * unitScale(p), 9);
    }
  });
});

describe.each(Object.entries(VARIANTS))('buildCanonicalSkeleton (%s)', (_label, p) => {
  const skeleton = buildCanonicalSkeleton(p);
  const world = worldPositions(p);

  it('has every bone, named canonically, in the canonical hierarchy', () => {
    expect(Object.keys(skeleton.bones).sort()).toEqual([...CANONICAL_BODY_BONES].sort());
    for (const name of CANONICAL_BODY_BONES) {
      const bone = skeleton.bones[name];
      expect(bone).toBeInstanceOf(THREE.Bone);
      expect(bone.name).toBe(name);
      const parent = BONE_PARENT[name];
      if (parent === null) expect(bone.parent).toBe(skeleton.root);
      else expect(bone.parent).toBe(skeleton.bones[parent as CanonicalBodyBone]);
    }
    expect(skeleton.root).not.toBeInstanceOf(THREE.Bone);
    expect(skeleton.root.position.length()).toBe(0);
    expect(skeleton.root.parent).toBeNull();
  });

  it('rest pose is identity rotations and unit scales', () => {
    for (const name of CANONICAL_BODY_BONES) {
      const bone = skeleton.bones[name];
      expect(bone.quaternion.equals(new THREE.Quaternion())).toBe(true);
      expect(bone.scale.equals(new THREE.Vector3(1, 1, 1))).toBe(true);
    }
  });

  it('world positions match restJointPositions', () => {
    const rest = restJointPositions(p);
    for (const name of CANONICAL_BODY_BONES) expect(world[name].distanceTo(rest[name])).toBeLessThan(1e-9);
  });

  it('is exactly `height` tall with the soles on y = 0', () => {
    expect(world.HeadTop_End.y).toBeCloseTo(p.height, 9);
    // The ankle is one ankle-height above the sole; nothing is below the floor.
    expect(world.LeftFoot.y).toBeCloseTo(p.ankleHeight * unitScale(p), 9);
    for (const name of CANONICAL_BODY_BONES) expect(world[name].y).toBeGreaterThan(0);
  });

  it('is mirror symmetric with the left side at +X and the hips centred', () => {
    expect(world.Hips.x).toBe(0);
    expect(world.Hips.z).toBe(0);
    for (const name of CANONICAL_BODY_BONES) {
      const other = world[mirrorBone(name) as CanonicalBodyBone];
      expect(other.x).toBeCloseTo(-world[name].x, 12);
      expect(other.y).toBeCloseTo(world[name].y, 12);
      expect(other.z).toBeCloseTo(world[name].z, 12);
      if (name.startsWith('Left')) expect(world[name].x).toBeGreaterThan(0);
      if (name.startsWith('Right')) expect(world[name].x).toBeLessThan(0);
      if (!name.startsWith('Left') && !name.startsWith('Right')) expect(world[name].x).toBe(0);
    }
  });

  it('is a T-pose: arms along X, spine and legs along Y, toes pointing +Z', () => {
    for (const name of ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand'] as const) expect(world[name].y).toBeCloseTo(world.LeftArm.y, 12);
    expect(world.LeftShoulder.x).toBeLessThan(world.LeftArm.x);
    expect(world.LeftArm.x).toBeLessThan(world.LeftForeArm.x);
    expect(world.LeftForeArm.x).toBeLessThan(world.LeftHand.x);
    const chain = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End'] as const;
    for (let i = 1; i < chain.length; i++) expect(world[chain[i]].y).toBeGreaterThan(world[chain[i - 1]].y);
    expect(world.LeftUpLeg.y).toBeLessThan(world.Hips.y);
    expect(world.LeftLeg.y).toBeLessThan(world.LeftUpLeg.y);
    expect(world.LeftFoot.y).toBeLessThan(world.LeftLeg.y);
    expect(world.LeftLeg.x).toBeCloseTo(world.LeftUpLeg.x, 12);
    // Ball of the foot: forward and down from the ankle; toe tip straight ahead of it.
    expect(world.LeftToeBase.z).toBeGreaterThan(world.LeftFoot.z);
    expect(world.LeftToeBase.y).toBeLessThan(world.LeftFoot.y);
    const toe = world.LeftToe_End.clone().sub(world.LeftToeBase).normalize();
    expect(toe.z).toBeCloseTo(1, 9);
    // Shoulder joints sit near the base of the neck, never above it.
    expect(world.LeftArm.y).toBeLessThanOrEqual(world.Neck.y);
    expect(world.LeftArm.y).toBeGreaterThan(world.Spine2.y);
  });

  it('builds independent skeletons', () => {
    const other = buildCanonicalSkeleton(p);
    expect(other.root).not.toBe(skeleton.root);
    other.bones.LeftArm.rotation.z = 1;
    expect(skeleton.bones.LeftArm.rotation.z).toBe(0);
  });
});
