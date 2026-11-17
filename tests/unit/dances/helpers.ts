// Shared helpers for the dance tests: pose a canonical skeleton and measure it.
import * as THREE from 'three';
import { BODY_BONES } from '../../../src/rig/bones';
import { DEFAULT_PROPORTIONS, buildCanonicalSkeleton, heelZ } from '../../../src/rig/canonical';
import type { CanonicalBodyBone, CanonicalSkeleton } from '../../../src/rig/canonical';
import { CONTROL_NAMES } from '../../../src/dances/scheme';
import type { ControlName } from '../../../src/dances/scheme';
import type { ControlValues } from '../../../src/dances/evaluate';
import { PoseSolver, createPose } from '../../../src/dances/pose';

export const P = DEFAULT_PROPORTIONS;

/** All controls at zero, with some replaced. */
export function controls(overrides: Partial<Record<ControlName, number>> = {}): ControlValues {
  const values = {} as ControlValues;
  for (const name of CONTROL_NAMES) values[name] = overrides[name] ?? 0;
  return values;
}

export interface Posed {
  skeleton: CanonicalSkeleton;
  /** World position of a joint. */
  at(bone: CanonicalBodyBone): THREE.Vector3;
  /** World orientation of a bone. */
  facing(bone: CanonicalBodyBone): THREE.Quaternion;
  /** World y of the lowest sole point (heels, balls, toe tips). */
  lowestSole(): number;
  /** World y of the lowest sole point of one foot. */
  sole(side: 'Left' | 'Right'): number;
}

const solver = new PoseSolver(P);

export function measure(skeleton: CanonicalSkeleton): Posed {
  skeleton.root.updateMatrixWorld(true);
  const rest = buildCanonicalSkeleton(P);
  const ankleHeight = rest.bones.LeftFoot.getWorldPosition(new THREE.Vector3()).y;
  const ballHeight = rest.bones.LeftToeBase.getWorldPosition(new THREE.Vector3()).y;
  const toeLength = rest.bones.LeftToe_End.position.z;
  const sole = (side: 'Left' | 'Right'): number => {
    const foot = skeleton.bones[`${side}Foot`];
    const toe = skeleton.bones[`${side}ToeBase`];
    const points = [
      foot.localToWorld(new THREE.Vector3(0, -ankleHeight, heelZ(P))),
      toe.localToWorld(new THREE.Vector3(0, -ballHeight, 0)),
      toe.localToWorld(new THREE.Vector3(0, -ballHeight, toeLength)),
    ];
    return Math.min(...points.map((point) => point.y));
  };
  return {
    skeleton,
    at: (bone) => skeleton.bones[bone].getWorldPosition(new THREE.Vector3()),
    facing: (bone) => skeleton.bones[bone].getWorldQuaternion(new THREE.Quaternion()),
    lowestSole: () => Math.min(sole('Left'), sole('Right')),
    sole,
  };
}

/** Solves `overrides` (everything else zero) and returns the posed reference skeleton. */
export function pose(overrides: Partial<Record<ControlName, number>> = {}): Posed {
  const solved = solver.solve(controls(overrides), createPose());
  const skeleton = buildCanonicalSkeleton(P);
  for (const bone of BODY_BONES) skeleton.bones[bone as CanonicalBodyBone].quaternion.copy(solved.rotations[bone]);
  skeleton.bones.Hips.position.copy(solved.hipsPosition);
  return measure(skeleton);
}
