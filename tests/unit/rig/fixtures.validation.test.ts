/**
 * Real-asset validation of the rig layer. Skipped unless THUNES_FIXTURES points
 * at a directory holding Xbot.glb, Michelle.glb, Soldier.glb,
 * "Samba Dancing.fbx" and pirouette.bvh:
 *
 *   THUNES_FIXTURES=/path/to/fixtures npx vitest run tests/unit/rig/fixtures.validation
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mapHumanoid } from '../../../src/rig/humanoid';
import { normalizeHumanoid } from '../../../src/rig/normalize';
import { retargetClip } from '../../../src/rig/retarget';
import { BODY_BONES, CANONICAL_BONES, REQUIRED_BONES } from '../../../src/rig/bones';
import type { CanonicalBone } from '../../../src/rig/bones';
import type { Rig } from '../../../src/rig/rig';
import { degBetween, degBetweenQ, jointPosition, jointRotation, makeDance, makeRig, modelMatrices, poseAt, restore, snapshot } from './helpers';
import { FIXTURES, loadAsset } from './nodeLoaders.mjs';

interface Loaded {
  rig: Rig;
  clips: THREE.AnimationClip[];
  convention: string | null;
}

async function load(file: string): Promise<Loaded> {
  const asset = await loadAsset(file);
  const mapping = mapHumanoid(asset.root);
  expect(mapping.missingRequired, `${file}: missing required bones`).toEqual([]);
  const normalized = normalizeHumanoid(asset.root, mapping, { height: 1.7 });
  return { rig: { root: normalized.root, bones: mapping.bones }, clips: asset.clips, convention: mapping.convention };
}

const CHAINS: Record<string, CanonicalBone[]> = {
  spine: ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'],
  arms: ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'],
  legs: ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'],
  fingers: CANONICAL_BONES.filter((bone) => /Hand(Thumb|Index|Middle|Ring|Pinky)/.test(bone)),
};
/** Bone → child joint for the geometric direction check (limb bones that are direction-aligned). */
const LIMB_CHILD: Partial<Record<CanonicalBone, CanonicalBone>> = {};
for (const side of ['Left', 'Right'] as const) {
  LIMB_CHILD[`${side}Arm`] = `${side}ForeArm`;
  LIMB_CHILD[`${side}ForeArm`] = `${side}Hand`;
  LIMB_CHILD[`${side}UpLeg`] = `${side}Leg`;
  LIMB_CHILD[`${side}Leg`] = `${side}Foot`;
}
/** Bones with identity rest alignment: their rotation away from rest must equal the source's. */
const UNALIGNED = new Set<CanonicalBone>(['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'RightShoulder', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']);

interface Stat {
  sum: number;
  max: number;
  count: number;
}
const stat = (): Stat => ({ sum: 0, max: 0, count: 0 });
const add = (s: Stat, value: number): void => {
  s.sum += value;
  s.max = Math.max(s.max, value);
  s.count++;
};
const show = (s: Stat): string => (s.count === 0 ? '      -      ' : `${(s.sum / s.count).toFixed(3).padStart(6)}/${s.max.toFixed(3).padEnd(6)}`);

interface Row {
  name: string;
  tracks: number;
  ms: number;
  /** Limb direction error (joint → child joint, geometric), degrees. */
  direction: Record<string, Stat>;
  /** Error of the rotation away from rest for bones without rest alignment, degrees. */
  rotation: Record<string, Stat>;
  /** Hips trajectory error against rest + legRatio × source offset, millimetres at 1.7 m. */
  hips: Stat;
  /** Lowest toe / foot joint over the clip relative to its rest height, target minus scaled source, millimetres. */
  ground: number;
  /** How far the source's limb directions are from their rest directions, degrees (shows the clip really moves). */
  motion: Stat;
  /** Baked local rotations against the source's local rotations (what a naive copy would produce), body bones, degrees. */
  local: Stat;
}

const rows: Row[] = [];

function legLength(rig: Rig): number {
  const m = modelMatrices(rig);
  let total = 0;
  for (const side of ['Left', 'Right'] as const) {
    total += jointPosition(rig, `${side}UpLeg`, m).distanceTo(jointPosition(rig, `${side}Leg`, m)) + jointPosition(rig, `${side}Leg`, m).distanceTo(jointPosition(rig, `${side}Foot`, m));
  }
  return total / 2;
}

function validate(name: string, source: Rig, clip: THREE.AnimationClip, target: Rig): Row {
  const start = performance.now();
  const baked = retargetClip(clip, source, target);
  const ms = performance.now() - start;
  expect(baked.duration).toBe(clip.duration);

  const sourceRest = snapshot(source);
  const targetRest = snapshot(target);
  const shared = CANONICAL_BONES.filter((bone) => source.bones[bone] && target.bones[bone] && !/_End$/.test(bone));
  const rs = new Map(shared.map((bone) => [bone, jointRotation(source, bone)]));
  const rt = new Map(shared.map((bone) => [bone, jointRotation(target, bone)]));
  const ps0 = jointPosition(source, 'Hips');
  const pt0 = jointPosition(target, 'Hips');
  const scale = legLength(target) / legLength(source);
  const lowJoint = (rig: Rig, m: Map<THREE.Object3D, THREE.Matrix4>): number => Math.min(...(['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'] as const).filter((bone) => rig.bones[bone]).map((bone) => jointPosition(rig, bone, m).y));
  const sourceLowRest = lowJoint(source, modelMatrices(source));
  const targetLowRest = lowJoint(target, modelMatrices(target));
  let sourceLow = Infinity;
  let targetLow = Infinity;

  const row: Row = { name, tracks: baked.tracks.length, ms, direction: {}, rotation: {}, hips: stat(), ground: 0, motion: stat(), local: stat() };
  const restMatrices = modelMatrices(source);
  const restDirection = new Map<CanonicalBone, THREE.Vector3>();
  for (const [bone, child] of Object.entries(LIMB_CHILD) as [CanonicalBone, CanonicalBone][]) {
    if (shared.includes(bone) && shared.includes(child)) restDirection.set(bone, jointPosition(source, child, restMatrices).sub(jointPosition(source, bone, restMatrices)));
  }
  for (const chain of Object.keys(CHAINS)) {
    row.direction[chain] = stat();
    row.rotation[chain] = stat();
  }
  // Compare on baked key times, so that the baked clip's own 30 fps sampling is not part of the error.
  const times = baked.tracks[0]!.times;
  const step = Math.max(1, Math.floor(times.length / 40));
  for (let f = 0; f < times.length; f += step) {
    const t = Math.min(times[f]!, clip.duration);
    poseAt(source, clip, t);
    poseAt(target, baked, t);
    const ms_ = modelMatrices(source);
    const mt = modelMatrices(target);
    for (const [chain, bones] of Object.entries(CHAINS)) {
      for (const bone of bones) {
        if (!shared.includes(bone)) continue;
        const child = LIMB_CHILD[bone];
        if (child && shared.includes(child)) {
          const ds = jointPosition(source, child, ms_).sub(jointPosition(source, bone, ms_));
          const dt = jointPosition(target, child, mt).sub(jointPosition(target, bone, mt));
          add(row.direction[chain]!, degBetween(ds, dt));
          add(row.motion, degBetween(ds, restDirection.get(bone)!));
        }
        if (chain !== 'fingers') add(row.local, degBetweenQ(source.bones[bone]!.quaternion, target.bones[bone]!.quaternion));
        if (UNALIGNED.has(bone)) {
          const ds = jointRotation(source, bone).multiply(rs.get(bone)!.clone().invert());
          const dt = jointRotation(target, bone).multiply(rt.get(bone)!.clone().invert());
          add(row.rotation[chain]!, degBetweenQ(ds, dt));
        }
      }
    }
    const offset = jointPosition(source, 'Hips', ms_).sub(ps0).multiplyScalar(scale);
    add(row.hips, jointPosition(target, 'Hips', mt).sub(pt0).distanceTo(offset) * 1000);
    sourceLow = Math.min(sourceLow, lowJoint(source, ms_) - sourceLowRest);
    targetLow = Math.min(targetLow, lowJoint(target, mt) - targetLowRest);
    restore(source, sourceRest);
    restore(target, targetRest);
  }
  row.ground = (targetLow - sourceLow * scale) * 1000;
  rows.push(row);

  // Thresholds.
  for (const chain of Object.keys(CHAINS)) {
    expect(row.direction[chain]!.max, `${name}: ${chain} direction`).toBeLessThan(0.5);
    expect(row.rotation[chain]!.max, `${name}: ${chain} rotation`).toBeLessThan(0.5);
  }
  expect(row.hips.max, `${name}: hips trajectory (mm)`).toBeLessThan(1);
  expect(row.motion.max, `${name}: the source clip moves`).toBeGreaterThan(30);
  // Loop / continuity sanity on the baked clip.
  for (const track of baked.tracks) {
    if (track.getValueSize() !== 4) continue;
    for (let i = 4; i < track.values.length; i += 4) {
      const dot = track.values[i]! * track.values[i - 4]! + track.values[i + 1]! * track.values[i - 3]! + track.values[i + 2]! * track.values[i - 2]! + track.values[i + 3]! * track.values[i - 1]!;
      expect(dot, `${name}: ${track.name} sign continuity`).toBeGreaterThan(0);
    }
  }
  return row;
}

/** How far the rest pose is from a T-pose: arm and leg directions against ±X and −Y, degrees. */
function restPose(rig: Rig): { arms: number; legs: number; height: number; hips: THREE.Vector3; ground: number } {
  const m = modelMatrices(rig);
  let arms = 0;
  let legs = 0;
  for (const [side, x] of [
    ['Left', 1],
    ['Right', -1],
  ] as const) {
    arms = Math.max(arms, degBetween(jointPosition(rig, `${side}Hand`, m).sub(jointPosition(rig, `${side}Arm`, m)), new THREE.Vector3(x, 0, 0)));
    legs = Math.max(legs, degBetween(jointPosition(rig, `${side}Foot`, m).sub(jointPosition(rig, `${side}UpLeg`, m)), new THREE.Vector3(0, -1, 0)));
  }
  let ground = Infinity;
  for (const bone of CANONICAL_BONES) if (rig.bones[bone]) ground = Math.min(ground, jointPosition(rig, bone, m).y);
  const head = rig.bones.HeadTop_End ? jointPosition(rig, 'HeadTop_End', m).y : jointPosition(rig, 'Head', m).y;
  return { arms, legs, height: head, hips: jointPosition(rig, 'Hips', m), ground };
}

describe.skipIf(!FIXTURES)('real-asset validation (THUNES_FIXTURES)', () => {
  it('maps, normalises and retargets the fixtures', async () => {
    const xbot = await load('Xbot.glb');
    const michelle = await load('Michelle.glb');
    const soldier = await load('Soldier.glb');
    const samba = await load('Samba Dancing.fbx');
    const bvh = await load('pirouette.bvh');
    const all: [string, Loaded][] = [
      ['Xbot.glb', xbot],
      ['Michelle.glb', michelle],
      ['Soldier.glb', soldier],
      ['Samba Dancing.fbx', samba],
      ['pirouette.bvh', bvh],
    ];

    // — Mapping and normalisation —
    const lines: string[] = ['', 'asset               convention  bones  arms°  legs°  hipsXZ(mm)      hipsY  top    lowest joint'];
    for (const [name, asset] of all) {
      const rest = restPose(asset.rig);
      const mapped = CANONICAL_BONES.filter((bone) => asset.rig.bones[bone]).length;
      lines.push(
        `${name.padEnd(19)} ${String(asset.convention).padEnd(11)} ${String(mapped).padStart(5)}  ${rest.arms.toFixed(1).padStart(5)}  ${rest.legs.toFixed(1).padStart(5)}  ${(rest.hips.x * 1000).toFixed(2)},${(rest.hips.z * 1000).toFixed(2)}`.padEnd(66) +
          `${rest.hips.y.toFixed(3)}  ${rest.height.toFixed(3)}  ${rest.ground.toFixed(3)}`,
      );
      // Upright, facing +Z (left hand at +X, toes in front of the ankles), hips centred, sensible size.
      const m = modelMatrices(asset.rig);
      expect(jointPosition(asset.rig, 'LeftHand', m).x, `${name}: left is +X`).toBeGreaterThan(0.2);
      expect(jointPosition(asset.rig, 'RightHand', m).x).toBeLessThan(-0.2);
      expect(Math.hypot(rest.hips.x, rest.hips.z)).toBeLessThan(1e-4);
      expect(rest.hips.y).toBeGreaterThan(0.75);
      expect(rest.hips.y).toBeLessThan(1.15);
      expect(rest.height).toBeGreaterThan(1.3);
      expect(rest.height).toBeLessThan(1.72);
      expect(rest.ground).toBeGreaterThan(-0.02);
      expect(rest.ground).toBeLessThan(0.12);
      if (asset.rig.bones.LeftToeBase) expect(jointPosition(asset.rig, 'LeftToeBase', m).z, `${name}: faces +Z`).toBeGreaterThan(jointPosition(asset.rig, 'LeftFoot', m).z);
      for (const bone of REQUIRED_BONES) expect(asset.rig.bones[bone]).toBeDefined();
    }
    for (const asset of [xbot, michelle, soldier, samba]) {
      expect(asset.convention).toBe('mixamo');
      for (const bone of BODY_BONES) expect(asset.rig.bones[bone]!.name).toBe(`mixamorig${bone}`);
    }
    expect(bvh.convention).toBe('bvh-poser');

    // — Retargeting —
    const sambaGlb = michelle.clips.find((clip) => clip.duration > 1) ?? michelle.clips[0]!;
    const sambaFbx = samba.clips.find((clip) => clip.tracks.length > 0)!;
    const canonical = makeRig();
    const generated = makeDance(canonical, { duration: 4, travel: 0.3 });
    validate('Michelle clip → Xbot', michelle.rig, sambaGlb, xbot.rig);
    validate('Michelle clip → Soldier', michelle.rig, sambaGlb, soldier.rig);
    // The same skeleton: the bake must reproduce the clip's local rotations.
    expect(validate('Michelle clip → Michelle', michelle.rig, sambaGlb, michelle.rig).local.max).toBeLessThan(0.01);
    expect(validate('Samba FBX → its own rig', samba.rig, sambaFbx, samba.rig).local.max).toBeLessThan(0.01);
    validate('Michelle clip → canonical', michelle.rig, sambaGlb, canonical);
    validate('canonical dance → Xbot', canonical, generated, xbot.rig);
    validate('canonical dance → Michelle', canonical, generated, michelle.rig);
    validate('Samba FBX → Xbot', samba.rig, sambaFbx, xbot.rig);
    validate('Samba FBX → Michelle', samba.rig, sambaFbx, michelle.rig);
    validate('Samba FBX → Soldier', samba.rig, sambaFbx, soldier.rig);
    validate('Samba FBX → canonical', samba.rig, sambaFbx, canonical);
    validate('pirouette BVH → Xbot', bvh.rig, bvh.clips[0]!, xbot.rig);

    lines.push('', 'degrees, mean/max over sampled frames. dir = limb direction (joint to child joint); rot = rotation away from rest of the unaligned bones;');
    lines.push('hips = trajectory error in mm; ground = lowest foot joint vs scaled source, mm (negative = deeper than the source).', '');
    lines.push('motion = source limb directions vs rest (proof of movement); local = baked local rotations vs the source clip\'s (difference to a naive copy).', '');
    lines.push(`${'case'.padEnd(27)} trk   ms   dir arms      dir legs      rot spine     rot arms      rot legs      hips mm       ground  motion        local`);
    for (const row of rows) {
      lines.push(
        `${row.name.padEnd(27)} ${String(row.tracks).padStart(3)} ${row.ms.toFixed(0).padStart(4)}   ${show(row.direction.arms!)} ${show(row.direction.legs!)} ${show(row.rotation.spine!)} ${show(row.rotation.arms!)} ${show(row.rotation.legs!)} ${show(row.hips)} ${row.ground.toFixed(1).padStart(7)}  ${show(row.motion)} ${show(row.local)}`,
      );
    }
    console.log(lines.join('\n'));
  }, 120_000);

  it('agrees with Mixamo\'s own retarget: the FBX samba baked onto Michelle against Michelle\'s own samba clip', async () => {
    // Independent evidence: Michelle.glb ships the same dance as retargeted by Mixamo itself. Mixamo adapts
    // the motion to the character, so a few degrees of difference are expected; a wrong twist or axis is not.
    const michelle = await load('Michelle.glb');
    const samba = await load('Samba Dancing.fbx');
    const own = michelle.clips.find((clip) => clip.duration > 1)!;
    const baked = retargetClip(samba.clips.find((clip) => clip.tracks.length > 0)!, samba.rig, michelle.rig);
    const rest = snapshot(michelle.rig);
    const stats: Record<string, Stat> = { spine: stat(), arms: stat(), legs: stat() };
    const hips = stat();
    for (let i = 0; i <= 80; i++) {
      const u = i / 80;
      poseAt(michelle.rig, own, u * own.duration);
      const truth = new Map(BODY_BONES.map((bone) => [bone, jointRotation(michelle.rig, bone)]));
      const hipsTruth = jointPosition(michelle.rig, 'Hips');
      restore(michelle.rig, rest);
      poseAt(michelle.rig, baked, u * baked.duration);
      for (const [chain, bones] of Object.entries(CHAINS)) {
        if (chain === 'fingers') continue;
        for (const bone of bones) add(stats[chain]!, degBetweenQ(truth.get(bone)!, jointRotation(michelle.rig, bone)));
      }
      add(hips, jointPosition(michelle.rig, 'Hips').distanceTo(hipsTruth) * 1000);
      restore(michelle.rig, rest);
    }
    console.log(`\nFBX samba → Michelle vs Mixamo's own Michelle samba, model-space rotation difference, degrees mean/max:\n  spine ${show(stats.spine!)}  arms ${show(stats.arms!)}  legs ${show(stats.legs!)}  hips ${show(hips)} mm`);
    expect(stats.spine!.sum / stats.spine!.count).toBeLessThan(5);
    expect(stats.arms!.sum / stats.arms!.count).toBeLessThan(10);
    expect(stats.legs!.sum / stats.legs!.count).toBeLessThan(10);
    expect(hips.max).toBeLessThan(100);
  }, 120_000);
});
