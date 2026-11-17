// Control-to-bone conventions, measured with forward kinematics on the reference skeleton.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { armLength, legLength, unitScale } from '../../../src/rig/canonical';
import { JOINT_LIMITS } from '../../../src/dances/pose';
import { P, pose } from './helpers';

const u = unitScale(P);
const L = legLength(P);
const ARM = armLength(P);
const UPPER = P.upperArmLength * u;
const FORE = P.forearmLength * u;
const rest = pose();

describe('relaxed standing pose (all controls zero)', () => {
  it('hangs the arms straight down at the sides', () => {
    for (const side of ['Left', 'Right'] as const) {
      const shoulder = rest.at(`${side}Arm`);
      const wrist = rest.at(`${side}Hand`);
      expect(wrist.x).toBeCloseTo(shoulder.x, 4);
      expect(wrist.z).toBeCloseTo(shoulder.z, 4);
      expect(shoulder.y - wrist.y).toBeCloseTo(ARM, 4);
    }
  });

  it('stands on both feet with the soles on the floor and nearly straight knees', () => {
    expect(rest.sole('Left')).toBeCloseTo(0, 5);
    expect(rest.sole('Right')).toBeCloseTo(0, 5);
    expect(rest.at('LeftFoot').x).toBeCloseTo((P.hipWidth / 2) * u, 4);
    expect(rest.at('Hips').y).toBeGreaterThan(0.99 * (P.ankleHeight + P.shinLength + P.thighLength + P.hipDrop) * u);
    expect(rest.at('Hips').x).toBeCloseTo(0, 6);
  });
});

describe('arm controls', () => {
  it('raise 90 puts the arm horizontal out to the side, on the named side only', () => {
    const left = pose({ 'leftArm.raise': 90 });
    expect(left.at('LeftHand').y).toBeCloseTo(left.at('LeftArm').y, 4);
    expect(left.at('LeftHand').x - left.at('LeftArm').x).toBeCloseTo(ARM, 4);
    expect(left.at('RightHand').y).toBeCloseTo(rest.at('RightHand').y, 4);

    const right = pose({ 'rightArm.raise': 90 });
    expect(right.at('RightHand').x - right.at('RightArm').x).toBeCloseTo(-ARM, 4);
    expect(right.at('RightHand').y).toBeCloseTo(right.at('RightArm').y, 4);
    expect(right.at('LeftHand').y).toBeCloseTo(rest.at('LeftHand').y, 4);
  });

  it('raise 180 puts the arm overhead', () => {
    const p = pose({ 'leftArm.raise': 180, 'rightArm.raise': 180 });
    for (const side of ['Left', 'Right'] as const) {
      expect(p.at(`${side}Hand`).y - p.at(`${side}Arm`).y).toBeCloseTo(ARM, 4);
      expect(p.at(`${side}Hand`).x).toBeCloseTo(p.at(`${side}Arm`).x, 4);
    }
  });

  it('swing 90 points the hanging arm straight ahead, swing −30 behind', () => {
    const p = pose({ 'leftArm.swing': 90, 'rightArm.swing': -30 });
    expect(p.at('LeftHand').z - p.at('LeftArm').z).toBeCloseTo(ARM, 4);
    expect(p.at('LeftHand').y).toBeCloseTo(p.at('LeftArm').y, 4);
    expect(p.at('RightHand').z).toBeLessThan(-0.2);
  });

  it('swing 180 is overhead by way of the front and raise then opens the arm outward', () => {
    const p = pose({ 'leftArm.swing': 180, 'leftArm.raise': 30 });
    const d = p.at('LeftHand').sub(p.at('LeftArm'));
    expect(d.x).toBeCloseTo(ARM * Math.sin(Math.PI / 6), 4);
    expect(d.y).toBeCloseTo(ARM * Math.cos(Math.PI / 6), 4);
  });

  it('elbow bend folds the forearm forward when the arm hangs', () => {
    for (const side of ['left', 'right'] as const) {
      const S = side === 'left' ? 'Left' : 'Right';
      const p = pose({ [`${side}Arm.elbow`]: 90 });
      const elbow = p.at(`${S}ForeArm`);
      const wrist = p.at(`${S}Hand`);
      expect(elbow.y).toBeCloseTo(p.at(`${S}Arm`).y - UPPER, 4);
      expect(wrist.z - elbow.z).toBeCloseTo(FORE, 4);
      expect(wrist.y).toBeCloseTo(elbow.y, 4);
      expect(wrist.x).toBeCloseTo(elbow.x, 4);
    }
  });

  it('never hyper-extends or over-folds the elbow', () => {
    const over = pose({ 'leftArm.elbow': 150 });
    const angle = (2 * Math.acos(Math.abs(over.skeleton.bones.LeftForeArm.quaternion.w)) * 180) / Math.PI;
    expect(angle).toBeLessThanOrEqual(JOINT_LIMITS.hingeMax + 1e-6);
  });

  it('twist rolls the upper arm outward: with the arm out and the elbow bent it lifts the forearm', () => {
    const flat = pose({ 'leftArm.raise': 90, 'leftArm.elbow': 90 });
    expect(flat.at('LeftHand').z - flat.at('LeftForeArm').z).toBeCloseTo(FORE, 4);
    const up = pose({ 'leftArm.raise': 90, 'leftArm.elbow': 90, 'leftArm.twist': 90, 'rightArm.raise': 90, 'rightArm.elbow': 90, 'rightArm.twist': 90 });
    expect(up.at('LeftHand').y - up.at('LeftForeArm').y).toBeCloseTo(FORE, 4);
    expect(up.at('RightHand').y - up.at('RightForeArm').y).toBeCloseTo(FORE, 4);
    // Hanging arm, bent elbow: positive twist swings the forearm outward.
    const out = pose({ 'leftArm.elbow': 90, 'leftArm.twist': 45, 'rightArm.elbow': 90, 'rightArm.twist': 45 });
    expect(out.at('LeftHand').x).toBeGreaterThan(out.at('LeftForeArm').x + 0.1);
    expect(out.at('RightHand').x).toBeLessThan(out.at('RightForeArm').x - 0.1);
  });

  it('shrug lifts the shoulder joint without changing where the arm points', () => {
    const p = pose({ 'leftArm.shrug': 20 });
    expect(p.at('LeftArm').y).toBeGreaterThan(rest.at('LeftArm').y + 0.02);
    expect(p.at('LeftHand').x).toBeCloseTo(p.at('LeftArm').x, 4);
    expect(p.at('RightArm').y).toBeCloseTo(rest.at('RightArm').y, 5);
  });

  it('forearm twist and wrist turn the hand, mirrored between the sides', () => {
    const palm = (side: 'Left' | 'Right', q: ReturnType<typeof pose>) => new THREE.Vector3(0, -1, 0).applyQuaternion(q.facing(`${side}Hand`));
    const hanging = pose();
    expect(palm('Left', hanging).x).toBeCloseTo(-1, 4); // palms face the thighs
    expect(palm('Right', hanging).x).toBeCloseTo(1, 4);
    const turned = pose({ 'leftArm.forearmTwist': 90, 'rightArm.forearmTwist': 90 });
    expect(palm('Left', turned).z).toBeCloseTo(1, 4); // palms face forward
    expect(palm('Right', turned).z).toBeCloseTo(1, 4);
    const flexed = pose({ 'leftArm.wrist': 45 });
    const fingers = new THREE.Vector3(1, 0, 0).applyQuaternion(flexed.facing('LeftHand'));
    expect(fingers.x).toBeLessThan(-0.5); // hanging hand flexes toward the palm, i.e. inward
  });
});

describe('leg controls', () => {
  it('knee bend moves the foot back and up while the other foot stays grounded', () => {
    const p = pose({ 'leftLeg.knee': 90 });
    expect(p.at('LeftFoot').z).toBeLessThan(rest.at('LeftFoot').z - 0.3);
    expect(p.at('LeftFoot').y).toBeGreaterThan(rest.at('LeftFoot').y + 0.3);
    expect(p.at('RightFoot').distanceTo(rest.at('RightFoot'))).toBeLessThan(1e-4);
    expect(p.sole('Right')).toBeCloseTo(0, 5);
  });

  it('hip lift moves the knee forward, spread moves it outward, on the named side', () => {
    const lifted = pose({ 'rightLeg.lift': 60 });
    expect(lifted.at('RightLeg').z).toBeGreaterThan(rest.at('RightLeg').z + 0.3);
    expect(lifted.at('LeftLeg').distanceTo(rest.at('LeftLeg'))).toBeLessThan(1e-4);
    const spread = pose({ 'leftLeg.spread': 30, 'rightLeg.spread': 30 });
    expect(spread.at('LeftLeg').x).toBeGreaterThan(rest.at('LeftLeg').x + 0.15);
    expect(spread.at('RightLeg').x).toBeLessThan(rest.at('RightLeg').x - 0.15);
    expect(spread.lowestSole()).toBeCloseTo(0, 5);
  });

  it('turn-out rolls the thigh so the toes point outward', () => {
    const p = pose({ 'leftLeg.turnOut': 40, 'leftFoot.turn': 40 });
    expect(p.at('LeftToe_End').x).toBeGreaterThan(p.at('LeftFoot').x + 0.08);
  });

  it('bending both knees with the angle controls turns into a drop of the hips (grounding)', () => {
    const p = pose({ 'leftLeg.lift': 30, 'leftLeg.knee': 60, 'rightLeg.lift': 30, 'rightLeg.knee': 60 });
    expect(p.lowestSole()).toBeCloseTo(0, 5);
    expect(p.at('Hips').y).toBeLessThan(rest.at('Hips').y - 0.08);
  });

  it('never bends a knee backward or beyond the limit', () => {
    for (const knee of [0, 60, 150]) {
      const p = pose({ 'leftLeg.knee': knee, 'hips.crouch': 0.3 });
      const q = p.skeleton.bones.LeftLeg.quaternion;
      expect(q.x * Math.sign(q.w || 1)).toBeGreaterThanOrEqual(0);
      expect((2 * Math.acos(Math.abs(q.w)) * 180) / Math.PI).toBeLessThanOrEqual(JOINT_LIMITS.hingeMax + 1e-6);
    }
  });
});

describe('foot targets', () => {
  it('places a foot on the floor where asked without moving the other', () => {
    const p = pose({ 'leftFoot.side': 0.2, 'leftFoot.forward': 0.1 });
    expect(p.at('LeftFoot').x).toBeCloseTo(rest.at('LeftFoot').x + 0.2 * L, 3);
    expect(p.at('LeftFoot').z).toBeCloseTo(0.1 * L, 3);
    expect(p.at('LeftFoot').y).toBeCloseTo(rest.at('LeftFoot').y, 3);
    expect(p.at('RightFoot').distanceTo(rest.at('RightFoot'))).toBeLessThan(1e-3);
    expect(p.sole('Left')).toBeCloseTo(0, 3);
    const right = pose({ 'rightFoot.side': 0.2 });
    expect(right.at('RightFoot').x).toBeCloseTo(rest.at('RightFoot').x - 0.2 * L, 3);
  });

  it('keeps planted feet still when the hips shift, turn, tilt or crouch', () => {
    const p = pose({ 'hips.shift': 0.1, 'hips.crouch': 0.15, 'hips.yaw': 20, 'hips.roll': 8, 'hips.forward': -0.05 });
    for (const foot of ['LeftFoot', 'RightFoot'] as const) expect(p.at(foot).distanceTo(rest.at(foot))).toBeLessThan(1e-3);
    expect(p.at('Hips').x).toBeCloseTo(0.1 * L, 4);
    expect(p.at('Hips').y).toBeCloseTo(rest.at('Hips').y - 0.15 * L, 2);
    expect(p.at('LeftLeg').z).toBeGreaterThan(0.05); // knees go forward
    expect(p.lowestSole()).toBeCloseTo(0, 5);
  });

  it('lifts a foot by `up` and keeps the sole level', () => {
    const p = pose({ 'rightFoot.up': 0.25, 'hips.crouch': 0.05 });
    expect(p.at('RightFoot').y).toBeCloseTo(rest.at('RightFoot').y + 0.25 * L, 3);
    expect(p.at('RightToe_End').y).toBeCloseTo(p.at('RightToeBase').y, 3);
    expect(p.sole('Left')).toBeCloseTo(0, 5);
  });

  it('pitch raises the heel about the ball, or the toes about the heel', () => {
    const heelUp = pose({ 'leftFoot.pitch': -30 });
    expect(heelUp.at('LeftFoot').y).toBeGreaterThan(rest.at('LeftFoot').y + 0.03);
    expect(heelUp.at('LeftToeBase').distanceTo(rest.at('LeftToeBase'))).toBeLessThan(2e-3);
    expect(heelUp.at('LeftToe_End').y).toBeCloseTo(rest.at('LeftToe_End').y, 3); // toes stay flat
    expect(heelUp.lowestSole()).toBeCloseTo(0, 5);
    const toesUp = pose({ 'leftFoot.pitch': 25 });
    expect(toesUp.at('LeftToe_End').y).toBeGreaterThan(rest.at('LeftToe_End').y + 0.05);
    expect(toesUp.lowestSole()).toBeCloseTo(0, 5);
  });

  it('turn swivels the foot on the floor, toes outward', () => {
    const p = pose({ 'leftFoot.turn': 45, 'rightFoot.turn': 45 });
    expect(p.at('LeftToe_End').x).toBeGreaterThan(p.at('LeftFoot').x + 0.1);
    expect(p.at('RightToe_End').x).toBeLessThan(p.at('RightFoot').x - 0.1);
  });

  it('lowers the hips when a planted foot is out of reach', () => {
    const p = pose({ 'leftFoot.side': 0.4, 'rightFoot.side': 0.4 });
    expect(p.at('Hips').y).toBeLessThan(rest.at('Hips').y - 0.05);
    expect(p.at('LeftFoot').y).toBeCloseTo(rest.at('LeftFoot').y, 3);
    expect(p.lowestSole()).toBeCloseTo(0, 5);
  });

  it('air lifts the whole body off the floor', () => {
    const p = pose({ air: 0.2 });
    expect(p.lowestSole()).toBeCloseTo(0.2 * L, 5);
    expect(p.at('Hips').y).toBeCloseTo(rest.at('Hips').y + 0.2 * L, 5);
  });
});

describe('torso and head controls', () => {
  it('lean tips the head forward, side bend and twist go to the dancer’s left', () => {
    expect(pose({ 'spine.lean': 30 }).at('Head').z).toBeGreaterThan(0.15);
    expect(pose({ 'spine.side': 20 }).at('Head').x).toBeGreaterThan(0.08);
    const twisted = pose({ 'spine.twist': 40 });
    expect(twisted.at('LeftArm').z).toBeLessThan(-0.05);
    expect(twisted.at('RightArm').z).toBeGreaterThan(0.05);
    expect(twisted.at('LeftFoot').distanceTo(rest.at('LeftFoot'))).toBeLessThan(1e-6);
  });

  it('hips yaw turns the body to the left, roll tips its top to the left', () => {
    const yawed = pose({ 'hips.yaw': 30 });
    expect(yawed.at('LeftArm').z).toBeLessThan(-0.05);
    const rolled = pose({ 'hips.roll': 10 });
    expect(rolled.at('Head').x).toBeGreaterThan(0.05);
    expect(rolled.at('RightUpLeg').y).toBeGreaterThan(rolled.at('LeftUpLeg').y);
  });

  it('head nod, tilt and turn move the face', () => {
    const face = (overrides: Parameters<typeof pose>[0]) => new THREE.Vector3(0, 0, 1).applyQuaternion(pose(overrides).facing('Head'));
    expect(face({ 'head.nod': 30 }).y).toBeCloseTo(-0.5, 3);
    expect(face({ 'head.turn': 30 }).x).toBeCloseTo(0.5, 3);
    const crown = new THREE.Vector3(0, 1, 0).applyQuaternion(pose({ 'head.tilt': 30 }).facing('Head'));
    expect(crown.x).toBeCloseTo(0.5, 3);
  });

  it('head.level keeps the head upright while the torso moves', () => {
    const free = pose({ 'spine.lean': 30, 'hips.roll': 10 });
    const level = pose({ 'spine.lean': 30, 'hips.roll': 10, 'head.level': 1 });
    const up = (p: ReturnType<typeof pose>) => new THREE.Vector3(0, 1, 0).applyQuaternion(p.facing('Head')).y;
    expect(up(free)).toBeLessThan(0.9);
    expect(up(level)).toBeGreaterThan(0.995);
  });
});
