/**
 * Turns one set of control values into a pose of the canonical skeleton:
 * local bone quaternions plus the hips position, grounded on the floor.
 *
 * ── Conventions ───────────────────────────────────────────────────────────
 * Canonical rest is a T-pose with identity local rotations: Y up, facing +Z,
 * the dancer's LEFT at +X. Rx/Ry/Rz below are rotations about the parent-frame
 * X/Y/Z axes by a right-handed angle; products apply right to left. Formulas
 * are given for the LEFT side; the right side is the mirror image
 * (quaternion (x, y, z, w) → (x, −y, −z, w)).
 *
 *   Hips      Ry(yaw) · Rx(tilt) · Rz(−roll)                       (Euler order YXZ)
 *   Spine*    Ry(twist·k) · Rx(lean·k) · Rz(−side·k), k = 0.30 / 0.35 / 0.35 for Spine / Spine1 / Spine2
 *   Neck,Head Ry(turn·k) · Rx(nod·k) · Rz(−tilt·k), k = 0.4 / 0.6, after `head.level` has
 *             subtracted level × (hips + spine angles) per axis
 *   Shoulder  Rz(shrug + automatic lift when the arm is above about 60° of elevation)
 *   Arm       in the chest frame: Rx(−swing) · Rz(raise − 90°) · Rx(−twist)
 *             (the clavicle rotation is divided out, so shrugging does not change where the arm points);
 *             the upper arm points along (sin raise, −cos raise · cos swing, cos raise · sin swing)
 *   ForeArm   Ry(−elbow) · Rx(−forearmTwist)
 *   Hand      Rz(−wrist)
 *   UpLeg     two-bone IK toward the foot target, with the knee pointing along the average of the
 *             pelvis heading and the foot heading (+ kneeOut), then · Rx(−lift) · Rz(spread) · Ry(turnOut)
 *   Leg       Rx(knee): IK bend + `knee`, clamped to 0..150°
 *   Foot      held at the floor orientation Ry(turn) · Rx(−pitch), limited to 65° away from the shin's rest alignment
 *   ToeBase   bends back so the toes stay flat while the heel is raised near the floor
 *
 * Grounding: the hips are lowered when a planted leg cannot reach its target,
 * and finally shifted vertically so the lowest sole point (heel, ball or toe
 * tip of either foot) is exactly on y = 0; `air` is then added on top.
 */
import * as THREE from 'three';
import { BODY_BONES, BONE_PARENT } from '../rig/bones';
import type { CanonicalBone } from '../rig/bones';
import { DEFAULT_PROPORTIONS, heelZ, legLength, restJointPositions, unitScale } from '../rig/canonical';
import type { CanonicalBodyBone, HumanoidProportions } from '../rig/canonical';
import type { ControlValues } from './evaluate';
import type { Side } from './scheme';

/** Limits enforced by the solver, degrees. */
export const JOINT_LIMITS = {
  /** Elbow and knee flexion never go below 0 (no hyper-extension) or above this. */
  hingeMax: 150,
  /** Largest rotation of the ankle away from its rest alignment with the shin. */
  ankleCone: 65,
  /** Largest bend of the toes. */
  toeMax: 60,
} as const;

/** A planted leg is never stretched beyond this fraction of its length (keeps the knee from locking and popping). */
const MAX_REACH = 0.998;
const MIN_REACH = 0.3;
const SPINE_SHARE = [0.3, 0.35, 0.35] as const;
const NECK_SHARE = 0.4;
const DEG = Math.PI / 180;

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** A solved pose. `rotations` holds a local quaternion for every body bone. */
export interface SolvedPose {
  /** Local position of the Hips bone, metres on the solver's proportions. */
  hipsPosition: THREE.Vector3;
  rotations: Record<string, THREE.Quaternion>;
}

/** An empty pose to pass to `PoseSolver.solve`. */
export function createPose(): SolvedPose {
  const rotations: Record<string, THREE.Quaternion> = {};
  for (const bone of BODY_BONES) rotations[bone] = new THREE.Quaternion();
  return { hipsPosition: new THREE.Vector3(), rotations };
}

function smoothstep(x: number, edge0: number, edge1: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}

interface LegScratch {
  /** Where the ankle joint should be, world space. */
  ankle: THREE.Vector3;
  /** World orientation the foot should have. */
  footWorld: THREE.Quaternion;
  /** Heading of the foot about Y, radians (+ toward the dancer's left). */
  footYaw: number;
  /** Lift of this foot above the lower of the two, leg lengths. */
  up: number;
  /** Lowest sole point after solving, world y. */
  lowest: number;
}

/**
 * Solves poses for one set of body proportions. Reusable and allocation-free
 * per call; not re-entrant.
 */
export class PoseSolver {
  /** Thigh + shin, metres: the unit of the 'leg' controls. */
  readonly legLength: number;
  readonly restHipsY: number;

  private readonly offset: Record<string, THREE.Vector3> = {};
  private readonly thigh: number;
  private readonly shin: number;
  private readonly ankleHeight: number;
  private readonly hipX: number;
  private readonly heel: THREE.Vector3;
  private readonly ballSole: THREE.Vector3;
  private readonly toeTip: THREE.Vector3;

  private readonly legs: Record<Side, LegScratch> = {
    left: { ankle: new THREE.Vector3(), footWorld: new THREE.Quaternion(), footYaw: 0, up: 0, lowest: 0 },
    right: { ankle: new THREE.Vector3(), footWorld: new THREE.Quaternion(), footYaw: 0, up: 0, lowest: 0 },
  };
  private readonly hipsPos = new THREE.Vector3();
  private readonly qHips = new THREE.Quaternion();
  private readonly qHipsInv = new THREE.Quaternion();
  private readonly q1 = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly q3 = new THREE.Quaternion();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly socket = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly bx = new THREE.Vector3();
  private readonly by = new THREE.Vector3();
  private readonly bz = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly euler = new THREE.Euler();

  constructor(proportions: HumanoidProportions = DEFAULT_PROPORTIONS) {
    const rest = restJointPositions(proportions);
    const u = unitScale(proportions);
    for (const side of ['Left', 'Right'] as const) {
      for (const part of ['UpLeg', 'Leg', 'Foot', 'ToeBase', 'Toe_End'] as const) {
        const bone = `${side}${part}` as const;
        const parent = BONE_PARENT[bone] as CanonicalBodyBone;
        this.offset[bone] = rest[bone].clone().sub(rest[parent]);
      }
    }
    this.legLength = legLength(proportions);
    this.restHipsY = rest.Hips.y;
    this.thigh = proportions.thighLength * u;
    this.shin = proportions.shinLength * u;
    this.ankleHeight = rest.LeftFoot.y;
    this.hipX = rest.LeftFoot.x;
    const toeHeight = rest.LeftToeBase.y;
    // Sole points: the heel in the Foot frame, the ball and the toe tip in the ToeBase frame.
    this.heel = new THREE.Vector3(0, -this.ankleHeight, heelZ(proportions));
    this.ballSole = new THREE.Vector3(0, -toeHeight, 0);
    this.toeTip = new THREE.Vector3(0, -toeHeight, rest.LeftToe_End.z - rest.LeftToeBase.z);
  }

  /** Quaternion from angles in degrees: Ry(y) · Rx(x) · Rz(z). */
  private setEuler(target: THREE.Quaternion, x: number, y: number, z: number): THREE.Quaternion {
    return target.setFromEuler(this.euler.set(x * DEG, y * DEG, z * DEG, 'YXZ'));
  }

  /**
   * Solves the pose for `v` and writes it into `out` (which it returns).
   * Values are expected to be within the control ranges (see `clampControl`).
   */
  solve(v: ControlValues, out: SolvedPose): SolvedPose {
    const L = this.legLength;
    const rot = out.rotations;

    // ── Pelvis ──
    this.setEuler(this.qHips, v['hips.tilt'], v['hips.yaw'], -v['hips.roll']);
    this.qHipsInv.copy(this.qHips).invert();
    this.hipsPos.set(v['hips.shift'] * L, this.restHipsY - v['hips.crouch'] * L, v['hips.forward'] * L);
    rot.Hips.copy(this.qHips);

    // ── Foot targets ──
    const lowestUp = Math.min(v['leftFoot.up'], v['rightFoot.up']);
    this.footTarget('left', 1, v, lowestUp);
    this.footTarget('right', -1, v, lowestUp);

    // Lower the hips until every planted foot can be reached.
    let drop = 0;
    for (const side of ['left', 'right'] as const) {
      const leg = this.legs[side];
      this.socket.copy(this.offset[side === 'left' ? 'LeftUpLeg' : 'RightUpLeg']).applyQuaternion(this.qHips).add(this.hipsPos);
      const dx = leg.ankle.x - this.socket.x;
      const dz = leg.ankle.z - this.socket.z;
      const reach = MAX_REACH * L;
      const horizontal2 = dx * dx + dz * dz;
      if (horizontal2 >= reach * reach) continue;
      const needed = this.socket.y - leg.ankle.y - Math.sqrt(reach * reach - horizontal2);
      const planted = 1 - smoothstep(leg.up, 0, 0.06);
      drop = Math.max(drop, needed * planted);
    }
    this.hipsPos.y -= drop;

    // ── Legs ──
    this.solveLeg('left', 1, v, rot);
    this.solveLeg('right', -1, v, rot);

    // ── Grounding ──
    this.hipsPos.y -= Math.min(this.legs.left.lowest, this.legs.right.lowest);
    this.hipsPos.y += v.air * L;
    out.hipsPosition.copy(this.hipsPos);

    // ── Spine ──
    const lean = v['spine.lean'];
    const side = v['spine.side'];
    const twist = v['spine.twist'];
    this.setEuler(rot.Spine, lean * SPINE_SHARE[0], twist * SPINE_SHARE[0], -side * SPINE_SHARE[0]);
    this.setEuler(rot.Spine1, lean * SPINE_SHARE[1], twist * SPINE_SHARE[1], -side * SPINE_SHARE[1]);
    this.setEuler(rot.Spine2, lean * SPINE_SHARE[2], twist * SPINE_SHARE[2], -side * SPINE_SHARE[2]);

    // ── Head ──
    const level = v['head.level'];
    const nod = clamp(v['head.nod'] - level * (v['hips.tilt'] + lean), -60, 70);
    const tilt = clamp(v['head.tilt'] - level * (v['hips.roll'] + side), -50, 50);
    const turn = clamp(v['head.turn'] - level * (v['hips.yaw'] + twist), -85, 85);
    this.setEuler(rot.Neck, nod * NECK_SHARE, turn * NECK_SHARE, -tilt * NECK_SHARE);
    this.setEuler(rot.Head, nod * (1 - NECK_SHARE), turn * (1 - NECK_SHARE), -tilt * (1 - NECK_SHARE));

    // ── Arms ──
    this.solveArm('left', v, rot);
    this.solveArm('right', v, rot);
    return out;
  }

  private footTarget(side: Side, sx: number, v: ControlValues, lowestUp: number): void {
    const L = this.legLength;
    const leg = this.legs[side];
    const pitch = v[`${side}Foot.pitch`] * DEG;
    leg.up = v[`${side}Foot.up`] - lowestUp;
    leg.footYaw = sx * v[`${side}Foot.turn`] * DEG;
    leg.footWorld.setFromAxisAngle(Y_AXIS, leg.footYaw);
    // The flat-footed ankle position…
    leg.ankle.set(sx * (this.hipX + v[`${side}Foot.side`] * L), this.ankleHeight + leg.up * L, v[`${side}Foot.forward`] * L);
    // …then pitch the foot about the ball joint (heel up) or the heel (toes up), keeping that point where it was.
    const pivot = pitch < 0 ? this.offset.LeftToeBase : this.heel;
    this.v1.copy(pivot).applyQuaternion(leg.footWorld);
    leg.footWorld.multiply(this.q1.setFromAxisAngle(X_AXIS, -pitch));
    this.v2.copy(pivot).applyQuaternion(leg.footWorld);
    leg.ankle.add(this.v1).sub(this.v2);
  }

  private solveLeg(side: Side, sx: number, v: ControlValues, rot: Record<string, THREE.Quaternion>): void {
    const leg = this.legs[side];
    const prefix = side === 'left' ? 'Left' : 'Right';
    const l1 = this.thigh;
    const l2 = this.shin;

    this.socket.copy(this.offset[`${prefix}UpLeg`]).applyQuaternion(this.qHips).add(this.hipsPos);
    this.axis.copy(leg.ankle).sub(this.socket);
    const distance = clamp(this.axis.length(), MIN_REACH * (l1 + l2), MAX_REACH * (l1 + l2));
    this.axis.normalize();

    // Knee direction: forward along the average of the pelvis and foot headings, tipped up a
    // little so that a leg pointing straight ahead still has a defined bend direction (up).
    const yaw = 0.5 * (v['hips.yaw'] * DEG + leg.footYaw) + sx * v[`${side}Leg.kneeOut`] * DEG;
    this.pole.set(Math.sin(yaw), 0.35, Math.cos(yaw));
    this.pole.addScaledVector(this.axis, -this.pole.dot(this.axis)).normalize();

    const hipAngle = Math.acos(clamp((l1 * l1 + distance * distance - l2 * l2) / (2 * l1 * distance), -1, 1));
    const kneeInterior = Math.acos(clamp((l1 * l1 + l2 * l2 - distance * distance) / (2 * l1 * l2), -1, 1));
    let knee = Math.PI - kneeInterior;

    // Thigh frame: −Y runs down the thigh, X is the knee hinge.
    this.bx.crossVectors(this.pole, this.axis).normalize();
    this.by.copy(this.axis).multiplyScalar(-Math.cos(hipAngle)).addScaledVector(this.pole, -Math.sin(hipAngle));
    this.bz.crossVectors(this.bx, this.by);
    const thighWorld = this.q1.setFromRotationMatrix(this.basis.makeBasis(this.bx, this.by, this.bz));

    // Angle controls on top of the solved leg (mirrored for the right side).
    const fk = this.q2.setFromAxisAngle(X_AXIS, -v[`${side}Leg.lift`] * DEG);
    fk.multiply(this.q3.setFromAxisAngle(Z_AXIS, sx * v[`${side}Leg.spread`] * DEG));
    fk.multiply(this.q3.setFromAxisAngle(Y_AXIS, sx * v[`${side}Leg.turnOut`] * DEG));
    thighWorld.multiply(fk);
    rot[`${prefix}UpLeg`].copy(this.qHipsInv).multiply(thighWorld);

    knee = clamp(knee + v[`${side}Leg.knee`] * DEG, 0, JOINT_LIMITS.hingeMax * DEG);
    const shinLocal = rot[`${prefix}Leg`].setFromAxisAngle(X_AXIS, knee);
    const shinWorld = this.q2.copy(thighWorld).multiply(shinLocal);

    // Foot: hold the floor orientation, within the ankle's range.
    const footLocal = rot[`${prefix}Foot`].copy(shinWorld).invert().multiply(leg.footWorld);
    if (footLocal.w < 0) footLocal.set(-footLocal.x, -footLocal.y, -footLocal.z, -footLocal.w);
    const ankleAngle = 2 * Math.acos(clamp(footLocal.w, -1, 1));
    const cone = JOINT_LIMITS.ankleCone * DEG;
    if (ankleAngle > cone) {
      this.q3.copy(footLocal);
      footLocal.identity().slerp(this.q3, cone / ankleAngle).normalize();
    }
    const footWorld = this.q3.copy(shinWorld).multiply(footLocal);

    // Toes: flat on the floor while the heel is up and the foot is near the floor.
    const pitch = v[`${side}Foot.pitch`];
    const nearFloor = 1 - smoothstep(leg.up + v.air, 0.02, 0.12);
    const toeBend = pitch < 0 ? Math.max(pitch * nearFloor, -JOINT_LIMITS.toeMax) : 0;
    const toeLocal = rot[`${prefix}ToeBase`].setFromAxisAngle(X_AXIS, toeBend * DEG);

    // Forward kinematics down to the sole.
    const ankle = this.v1.copy(this.offset[`${prefix}Leg`]).applyQuaternion(thighWorld).add(this.socket);
    ankle.add(this.v2.copy(this.offset[`${prefix}Foot`]).applyQuaternion(shinWorld));
    let lowest = this.v2.copy(this.heel).applyQuaternion(footWorld).y + ankle.y;
    const ball = ankle.add(this.v2.copy(this.offset[`${prefix}ToeBase`]).applyQuaternion(footWorld));
    const toeWorld = footWorld.multiply(toeLocal);
    lowest = Math.min(lowest, ball.y + this.v2.copy(this.ballSole).applyQuaternion(toeWorld).y);
    lowest = Math.min(lowest, ball.y + this.v2.copy(this.toeTip).applyQuaternion(toeWorld).y);
    leg.lowest = lowest;
  }

  private solveArm(side: Side, v: ControlValues, rot: Record<string, THREE.Quaternion>): void {
    const prefix = side === 'left' ? 'Left' : 'Right';
    const raise = v[`${side}Arm.raise`] * DEG;
    const swing = v[`${side}Arm.swing`] * DEG;

    // Shoulder girdle: shrug, plus a lift that grows as the arm rises above 60° from hanging.
    const elevation = Math.acos(clamp(Math.cos(raise) * Math.cos(swing), -1, 1)) / DEG;
    const shrug = v[`${side}Arm.shrug`] + clamp((elevation - 60) * 0.18, 0, 18);
    const clavicle = rot[`${prefix}Shoulder`].setFromAxisAngle(Z_AXIS, shrug * DEG);

    const arm = rot[`${prefix}Arm`].copy(clavicle).invert();
    arm.multiply(this.q1.setFromAxisAngle(X_AXIS, -swing));
    arm.multiply(this.q1.setFromAxisAngle(Z_AXIS, raise - Math.PI / 2));
    arm.multiply(this.q1.setFromAxisAngle(X_AXIS, -v[`${side}Arm.twist`] * DEG));

    const elbow = clamp(v[`${side}Arm.elbow`], 0, JOINT_LIMITS.hingeMax);
    const forearm = rot[`${prefix}ForeArm`].setFromAxisAngle(Y_AXIS, -elbow * DEG);
    forearm.multiply(this.q1.setFromAxisAngle(X_AXIS, -v[`${side}Arm.forearmTwist`] * DEG));

    const hand = rot[`${prefix}Hand`].setFromAxisAngle(Z_AXIS, -v[`${side}Arm.wrist`] * DEG);

    if (side === 'right') {
      for (const q of [clavicle, arm, forearm, hand]) q.set(q.x, -q.y, -q.z, q.w);
    }
  }
}

/** The bones a solved pose (and a compiled clip) animates. */
export const POSE_BONES: readonly CanonicalBone[] = BODY_BONES;
