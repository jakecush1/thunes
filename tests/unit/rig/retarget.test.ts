import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { retargetClip } from '../../../src/rig/retarget';
import { BODY_BONES, CANONICAL_BONES, mirrorBone } from '../../../src/rig/bones';
import type { CanonicalBone } from '../../../src/rig/bones';
import type { Rig } from '../../../src/rig/rig';
import { degBetween, degBetweenQ, jointPosition, jointRotation, makeDance, makeRig, modelMatrices, poseAt, restore, snapshot } from './helpers';

/** Bone → the child joint that defines its direction. */
const DIRECTIONS: [CanonicalBone, CanonicalBone][] = [];
for (const side of ['Left', 'Right'] as const) {
  DIRECTIONS.push([`${side}Arm`, `${side}ForeArm`], [`${side}ForeArm`, `${side}Hand`], [`${side}UpLeg`, `${side}Leg`], [`${side}Leg`, `${side}Foot`]);
}

const reflect = (q: THREE.Quaternion): THREE.Quaternion => new THREE.Quaternion(q.x, -q.y, -q.z, q.w);

interface Errors {
  /** Largest angle between source and target limb directions, degrees. */
  direction: number;
  /** Largest angle between source and target rotations-away-from-rest (model space), degrees, over `deltaBones`. */
  delta: number;
  /** Largest hips position error against rest + scale × source offset, model units. */
  hips: number;
}

function legLength(rig: Rig): number {
  const m = modelMatrices(rig);
  return jointPosition(rig, 'LeftUpLeg', m).distanceTo(jointPosition(rig, 'LeftLeg', m)) + jointPosition(rig, 'LeftLeg', m).distanceTo(jointPosition(rig, 'LeftFoot', m));
}

/** Plays both clips with real AnimationMixers and compares the poses in model space. Both rigs must be in rest pose. */
function compare(source: Rig, clip: THREE.AnimationClip, target: Rig, baked: THREE.AnimationClip, options: { mirror?: boolean; deltaBones?: readonly CanonicalBone[]; fps?: number } = {}): Errors {
  const mirror = options.mirror === true;
  const from = (bone: CanonicalBone): CanonicalBone => (mirror ? mirrorBone(bone) : bone);
  const sourceRest = snapshot(source);
  const targetRest = snapshot(target);
  const deltaBones = (options.deltaBones ?? BODY_BONES).filter((bone) => target.bones[bone] && source.bones[from(bone)]);
  const rs = new Map(deltaBones.map((bone) => [bone, jointRotation(source, from(bone))]));
  const rt = new Map(deltaBones.map((bone) => [bone, jointRotation(target, bone)]));
  const ps0 = jointPosition(source, 'Hips');
  const pt0 = jointPosition(target, 'Hips');
  const scale = legLength(target) / legLength(source);
  const errors: Errors = { direction: 0, delta: 0, hips: 0 };
  const fps = options.fps ?? 30;
  const frames = Math.round(clip.duration * fps);
  for (let f = 0; f <= frames; f += Math.max(1, Math.floor(frames / 24))) {
    const t = f / fps;
    poseAt(source, clip, t);
    poseAt(target, baked, t);
    const ms = modelMatrices(source);
    const mt = modelMatrices(target);
    for (const [bone, child] of DIRECTIONS) {
      if (!target.bones[bone] || !target.bones[child] || !source.bones[from(bone)] || !source.bones[from(child)]) continue;
      const ds = jointPosition(source, from(child), ms).sub(jointPosition(source, from(bone), ms));
      if (mirror) ds.x = -ds.x;
      const dt = jointPosition(target, child, mt).sub(jointPosition(target, bone, mt));
      errors.direction = Math.max(errors.direction, degBetween(ds, dt));
    }
    for (const bone of deltaBones) {
      let ds = jointRotation(source, from(bone)).multiply(rs.get(bone)!.clone().invert());
      if (mirror) ds = reflect(ds);
      const dt = jointRotation(target, bone).multiply(rt.get(bone)!.clone().invert());
      errors.delta = Math.max(errors.delta, degBetweenQ(ds, dt));
    }
    const offset = jointPosition(source, 'Hips', ms).sub(ps0).multiplyScalar(scale);
    if (mirror) offset.x = -offset.x;
    errors.hips = Math.max(errors.hips, jointPosition(target, 'Hips', mt).sub(pt0).distanceTo(offset));
    restore(source, sourceRest);
    restore(target, targetRest);
  }
  return errors;
}

/** Bones whose rest alignment is identity by design when both rigs share rest directions. */
const ALL = BODY_BONES;
/** Bones that are never direction-aligned: their rotation away from rest must always carry over exactly. */
const UNALIGNED: CanonicalBone[] = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'RightShoulder', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'];

describe('retargetClip', () => {
  it('(a) identical rigs: the output reproduces the input', () => {
    const source = makeRig();
    const target = makeRig();
    const clip = makeDance(source);
    const baked = retargetClip(clip, source, target);
    expect(baked.duration).toBe(clip.duration);
    expect(baked.name).toBe('dance');
    // Same local keys as the source clip (both are sampled at 30 fps).
    for (const track of clip.tracks) {
      const other = baked.tracks.find((candidate) => candidate.name === track.name)!;
      expect(other, track.name).toBeDefined();
      expect(other.times.length).toBe(track.times.length);
      const size = track.getValueSize();
      for (let i = 0; i < track.times.length; i++) {
        expect(other.times[i]).toBeCloseTo(track.times[i]!, 5);
        if (size === 4) {
          const a = new THREE.Quaternion().fromArray(track.values, i * 4);
          const b = new THREE.Quaternion().fromArray(other.values, i * 4);
          expect(degBetweenQ(a, b)).toBeLessThan(0.01);
        } else for (let c = 0; c < 3; c++) expect(other.values[i * 3 + c]).toBeCloseTo(track.values[i * 3 + c]!, 5);
      }
    }
    const errors = compare(source, clip, target, baked, { deltaBones: ALL });
    expect(errors.direction).toBeLessThan(0.01);
    expect(errors.delta).toBeLessThan(0.01);
    expect(errors.hips).toBeLessThan(1e-5);
  });

  it('tracks are named by the target node names: one quaternion track per shared bone plus the hips position', () => {
    const source = makeRig();
    const target = makeRig({ prefix: 'mixamorig', randomAxes: 3 });
    const baked = retargetClip(makeDance(source), source, target, { name: 'renamed' });
    const shared = CANONICAL_BONES.filter((bone) => source.bones[bone] && target.bones[bone]);
    expect(baked.name).toBe('renamed');
    expect(baked.tracks.map((track) => track.name).sort()).toEqual([...shared.map((bone) => `mixamorig${bone}.quaternion`), 'mixamorigHips.position'].sort());
    expect(baked.tracks.every((track) => track.times.length === 61)).toBe(true);
    // The clip also drives a clone of the target by name.
    const clone: Rig = { root: target.root.clone(true), bones: {} };
    for (const bone of shared) clone.bones[bone] = clone.root.getObjectByName(`mixamorig${bone}`)!;
    poseAt(target, baked, 0.7);
    poseAt(clone, baked, 0.7);
    expect(snapshot(clone)).toEqual(snapshot(target));
  });

  it('(b) canonical axes onto arbitrary bone axes: directions and twist match', () => {
    const source = makeRig();
    for (const seed of [1, 2, 3]) {
      const target = makeRig({ randomAxes: seed });
      const clip = makeDance(source);
      const errors = compare(source, clip, target, retargetClip(clip, source, target), { deltaBones: ALL });
      expect(errors.direction).toBeLessThan(0.05);
      // The full rotation away from rest matches, i.e. the direction and every perpendicular (twist) axis.
      expect(errors.delta).toBeLessThan(0.05);
      expect(errors.hips).toBeLessThan(1e-5);
    }
    // And the other way round: arbitrary axes as the source.
    const odd = makeRig({ randomAxes: 7 });
    const clip = makeDance(odd);
    const errors = compare(odd, clip, source, retargetClip(clip, odd, source), { deltaBones: ALL });
    expect(errors.direction).toBeLessThan(0.05);
    expect(errors.delta).toBeLessThan(0.05);
  });

  it('(c) different proportions: directions match and the hips trajectory scales with leg length', () => {
    const source = makeRig();
    const target = makeRig({ legs: 1.35, arms: 0.8, scale: 0.9, randomAxes: 5 });
    const clip = makeDance(source, { travel: 0.6 });
    const baked = retargetClip(clip, source, target);
    const errors = compare(source, clip, target, baked, { deltaBones: ALL });
    expect(errors.direction).toBeLessThan(0.05);
    expect(errors.delta).toBeLessThan(0.05);
    expect(errors.hips).toBeLessThan(1e-5);
    expect(legLength(target) / legLength(source)).toBeCloseTo(1.35 * 0.9, 5);
    // Explicit check of the scale on one frame.
    poseAt(source, clip, 1);
    poseAt(target, baked, 1);
    const sourceX = jointPosition(source, 'Hips').x;
    const targetX = jointPosition(target, 'Hips').x;
    expect(Math.abs(sourceX)).toBeGreaterThan(0.2);
    expect(targetX / sourceX).toBeCloseTo(1.35 * 0.9, 4);
  });

  it('(d) A-pose target: rest alignment makes the arms point where the source arms point', () => {
    const source = makeRig();
    const target = makeRig({ aPose: 45, randomAxes: 11 });
    const clip = makeDance(source);
    const baked = retargetClip(clip, source, target);
    const errors = compare(source, clip, target, baked, { deltaBones: UNALIGNED });
    expect(errors.direction).toBeLessThan(0.05);
    expect(errors.delta).toBeLessThan(0.05);

    // A source resting in T-pose puts the A-pose target into a T-pose, with straight wrists.
    const still = new THREE.AnimationClip('still', 1, [new THREE.QuaternionKeyframeTrack('LeftArm.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])]);
    poseAt(target, retargetClip(still, source, target), 0.5);
    const m = modelMatrices(target);
    const wrist: [CanonicalBone, CanonicalBone][] = [
      ['LeftHand', 'LeftHandMiddle1'],
      ['RightHand', 'RightHandMiddle1'],
    ];
    for (const [bone, child] of [...DIRECTIONS.filter(([bone]) => /Arm/.test(bone)), ...wrist]) {
      const direction = jointPosition(target, child, m).sub(jointPosition(target, bone, m));
      expect(degBetween(direction, new THREE.Vector3(bone.startsWith('Left') ? 1 : -1, 0, 0))).toBeLessThan(0.01);
    }
  });

  it('(d) T-pose target from an A-pose source', () => {
    const source = makeRig({ aPose: 50, randomAxes: 4 });
    const target = makeRig();
    const clip = makeDance(source);
    const errors = compare(source, clip, target, retargetClip(clip, source, target), { deltaBones: UNALIGNED });
    expect(errors.direction).toBeLessThan(0.05);
    expect(errors.delta).toBeLessThan(0.05);
  });

  it('(e) mirror equals the reflection across the YZ plane', () => {
    const source = makeRig();
    for (const target of [makeRig(), makeRig({ randomAxes: 9, legs: 1.2 })]) {
      const clip = makeDance(source, { travel: 0.4 });
      const baked = retargetClip(clip, source, target, { mirror: true });
      const errors = compare(source, clip, target, baked, { mirror: true, deltaBones: ALL });
      expect(errors.direction).toBeLessThan(0.05);
      expect(errors.delta).toBeLessThan(0.05);
      expect(errors.hips).toBeLessThan(1e-5);
    }
    // Mirroring twice gives the original back.
    const target = makeRig();
    const clip = makeDance(source);
    const twice = retargetClip(retargetClip(clip, source, target, { mirror: true }), target, makeRig(), { mirror: true });
    const errors = compare(source, clip, makeRig(), twice, { deltaBones: ALL });
    expect(errors.delta).toBeLessThan(0.05);
    expect(errors.hips).toBeLessThan(1e-5);
  });

  it('(f) inPlace removes travel but keeps sway and bounce', () => {
    const source = makeRig();
    const target = makeRig({ randomAxes: 2 });
    const hipsTrack = (clip: THREE.AnimationClip): Float32Array => clip.tracks.find((track) => track.name === 'Hips.position')!.values as Float32Array;
    const rest = jointPosition(target, 'Hips');

    // A long clip that wanders off: 3 m of drift plus a slow 1.5 m excursion, with a fast 8 cm sway on top.
    const duration = 12;
    const frames = duration * 30 + 1;
    const times = new Float32Array(frames);
    const values = new Float32Array(frames * 3);
    for (let i = 0; i < frames; i++) {
      const t = i / 30;
      times[i] = t;
      values[i * 3] = 3 * (t / duration) + 0.08 * Math.sin(2 * Math.PI * t);
      values[i * 3 + 1] = 0.93 + 0.04 * Math.cos(4 * Math.PI * t);
      values[i * 3 + 2] = 1.5 * Math.sin((Math.PI * t) / duration) + 0.05 * Math.sin(4 * Math.PI * t);
    }
    const walk = new THREE.AnimationClip('walk', duration, [new THREE.VectorKeyframeTrack('Hips.position', times, values)]);
    const free = hipsTrack(retargetClip(walk, source, target));
    const spot = hipsTrack(retargetClip(walk, source, target, { inPlace: true }));
    let maxX = 0;
    let maxZ = 0;
    let swayX = 0;
    for (let i = 0; i < frames; i++) {
      maxX = Math.max(maxX, Math.abs(spot[i * 3]! - rest.x));
      maxZ = Math.max(maxZ, Math.abs(spot[i * 3 + 2]! - rest.z));
      // Bounce is untouched.
      expect(spot[i * 3 + 1]).toBe(free[i * 3 + 1]);
      // The 1 Hz sway survives with its amplitude.
      swayX += (spot[i * 3]! - rest.x) * Math.sin((2 * Math.PI * i) / 30) * (2 / frames);
    }
    expect(Math.abs(free[(frames - 1) * 3]! - rest.x)).toBeGreaterThan(2.9);
    expect(maxX).toBeLessThan(0.12);
    expect(maxZ).toBeLessThan(0.3);
    expect(swayX).toBeGreaterThan(0.07);
    expect(swayX).toBeLessThan(0.09);
    // Starts and ends on the same spot.
    expect(spot[(frames - 1) * 3]).toBeCloseTo(spot[0]!, 6);
    expect(spot[(frames - 1) * 3 + 2]).toBeCloseTo(spot[2]!, 6);

    // A short looping dance only loses its mean horizontal offset.
    const clip = makeDance(source);
    const a = hipsTrack(retargetClip(clip, source, target));
    const b = hipsTrack(retargetClip(clip, source, target, { inPlace: true }));
    const count = a.length / 3;
    for (const axis of [0, 2]) {
      let mean = 0;
      for (let i = 0; i < count - 1; i++) mean += a[i * 3 + axis]! / (count - 1);
      for (let i = 0; i < count; i++) expect(b[i * 3 + axis]! - (a[i * 3 + axis]! - mean) - (axis === 0 ? rest.x : rest.z)).toBeCloseTo(0, 5);
    }
    // Rotations are identical with and without inPlace.
    const r1 = retargetClip(clip, source, target).tracks[3]!;
    const r2 = retargetClip(clip, source, target, { inPlace: true }).tracks[3]!;
    expect(Array.from(r2.values)).toEqual(Array.from(r1.values));
  });

  it('(g) extra intermediate bones (twist bones inside the chains) in either rig', () => {
    const insert: [string, CanonicalBone, CanonicalBone][] = [
      ['LeftArmTwist', 'LeftArm', 'LeftForeArm'],
      ['RightForeArmTwist', 'RightForeArm', 'RightHand'],
      ['LeftLegTwist', 'LeftLeg', 'LeftFoot'],
      ['PelvisExtra', 'Hips', 'RightUpLeg'],
      ['SpineExtra', 'Spine1', 'Spine2'],
    ];
    const plain = makeRig();
    const extra = makeRig({ insert, randomAxes: 6 });
    const clip = makeDance(plain);
    const baked = retargetClip(clip, plain, extra);
    expect(baked.tracks.some((track) => /Twist|Extra/.test(track.name))).toBe(false);
    let errors = compare(plain, clip, extra, baked, { deltaBones: ALL });
    expect(errors.direction).toBeLessThan(0.05);
    expect(errors.delta).toBeLessThan(0.05);
    expect(errors.hips).toBeLessThan(1e-5);

    // As the source: the intermediate bones are animated too (a twist bone twists about its bone axis,
    // an extra pelvis bone rotates freely) and their motion is absorbed.
    const tracks = makeDance(extra).tracks.slice();
    const times = [0, 0.5, 1, 1.5, 2];
    const twistNode = extra.root.getObjectByName('LeftArmTwist')!;
    const axis = extra.bones.LeftForeArm!.position.clone().normalize();
    const twist = times.flatMap((t) => twistNode.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, 1.2 * Math.sin(Math.PI * t))).toArray());
    const wobble = times.flatMap((t) => new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3 + 0.4 * Math.sin(Math.PI * t), -0.7, 0.2 + 0.5 * Math.sin(Math.PI * t))).toArray());
    tracks.push(new THREE.QuaternionKeyframeTrack('LeftArmTwist.quaternion', times, twist), new THREE.QuaternionKeyframeTrack('PelvisExtra.quaternion', times, wobble));
    const busy = new THREE.AnimationClip('busy', 2, tracks);
    errors = compare(extra, busy, plain, retargetClip(busy, extra, plain), { deltaBones: ALL });
    expect(errors.direction).toBeLessThan(0.05);
    expect(errors.delta).toBeLessThan(0.05);
    expect(errors.hips).toBeLessThan(1e-5);
  });

  it('(h) missing optional bones in either rig', () => {
    const full = makeRig();
    const omit: CanonicalBone[] = ['Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder', 'LeftToeBase', 'RightToeBase', 'LeftToe_End', 'RightToe_End', 'LeftHandMiddle1', 'RightHandMiddle1', 'LeftHandMiddle2', 'RightHandMiddle2', 'HeadTop_End'];
    const sparse = makeRig({ omit, randomAxes: 8 });
    const clip = makeDance(full);

    // Full → sparse: only shared bones get tracks; every shared bone still matches in model space.
    let baked = retargetClip(clip, full, sparse);
    expect(baked.tracks.length).toBe(CANONICAL_BONES.filter((bone) => full.bones[bone] && sparse.bones[bone]).length + 1);
    let errors = compare(full, clip, sparse, baked, { deltaBones: ALL });
    expect(errors.direction).toBeLessThan(0.05);
    expect(errors.delta).toBeLessThan(0.05);

    // Sparse → full: bones the source lacks get no track and keep their rest rotation relative to the parent.
    const sparseClip = makeDance(sparse);
    baked = retargetClip(sparseClip, sparse, full);
    for (const bone of omit) expect(baked.tracks.some((track) => track.name === `${bone}.quaternion`)).toBe(false);
    errors = compare(sparse, sparseClip, full, baked, { deltaBones: ALL });
    expect(errors.direction).toBeLessThan(0.05);
    expect(errors.delta).toBeLessThan(0.05);
    poseAt(full, baked, 0.9);
    // Spine1, Spine2 and the shoulders follow Spine rigidly; the toes follow the feet.
    const spine = jointRotation(full, 'Spine');
    for (const bone of ['Spine1', 'Spine2', 'LeftShoulder', 'RightShoulder'] as const) expect(degBetweenQ(jointRotation(full, bone), spine)).toBeLessThan(1e-3);
    expect(degBetweenQ(jointRotation(full, 'LeftToeBase'), jointRotation(full, 'LeftFoot'))).toBeLessThan(1e-3);
  });

  it('(i) a centimetre-scaled rig under a rotated armature, as target and as source', () => {
    const metres = makeRig();
    const armature = { rotation: new THREE.Euler(-Math.PI / 2, 0, 0), scale: 0.01 };
    const centimetres = makeRig({ armature, randomAxes: 12, legs: 1.1, prefix: 'mixamorig' });
    // The model-space rest pose is the same as without the armature.
    expect(jointPosition(centimetres, 'Head').y).toBeCloseTo(jointPosition(makeRig({ legs: 1.1 }), 'Head').y, 6);
    expect(centimetres.bones.Hips!.position.length()).toBeGreaterThan(50);

    const clip = makeDance(metres, { travel: 0.5 });
    const baked = retargetClip(clip, metres, centimetres);
    let errors = compare(metres, clip, centimetres, baked, { deltaBones: ALL });
    expect(errors.direction).toBeLessThan(0.05);
    expect(errors.delta).toBeLessThan(0.05);
    expect(errors.hips).toBeLessThan(1e-4);
    // The position track is in the armature's centimetres.
    const position = baked.tracks.find((track) => track.name === 'mixamorigHips.position')!;
    expect(Math.abs(position.values[1]!) + Math.abs(position.values[2]!)).toBeGreaterThan(50);

    const cmClip = makeDance(centimetres, { travel: 40 });
    errors = compare(centimetres, cmClip, metres, retargetClip(cmClip, centimetres, metres), { deltaBones: ALL });
    expect(errors.direction).toBeLessThan(0.05);
    expect(errors.delta).toBeLessThan(0.05);
    expect(errors.hips).toBeLessThan(1e-4);
  });

  it('model space includes the root transform, so a normalising wrapper works as the rig root', () => {
    // The same character authored Z-up, facing -Y, in centimetres, fixed by its root transform.
    const source = makeRig();
    const target = makeRig({ armature: { rotation: new THREE.Euler(0.3, 1.1, -0.4), scale: 37 }, randomAxes: 13 });
    const clip = makeDance(source);
    const errors = compare(source, clip, target, retargetClip(clip, source, target), { deltaBones: ALL });
    expect(errors.direction).toBeLessThan(0.05);
    expect(errors.delta).toBeLessThan(0.05);
    expect(errors.hips).toBeLessThan(1e-4);
  });

  it('(j) loops stay loops and quaternions are sign-continuous', () => {
    const source = makeRig({ randomAxes: 21 });
    const target = makeRig({ randomAxes: 22, aPose: 30, legs: 0.8 });
    // Big rotations so that raw quaternion signs would flip.
    const clip = makeDance(source, { duration: 3 });
    for (const options of [{}, { mirror: true }, { inPlace: true }, { fps: 60 }]) {
      const baked = retargetClip(clip, source, target, options);
      for (const track of baked.tracks) {
        const size = track.getValueSize();
        const last = track.values.length - size;
        if (size === 4) {
          for (let i = 4; i < track.values.length; i += 4) {
            const dot = track.values[i]! * track.values[i - 4]! + track.values[i + 1]! * track.values[i - 3]! + track.values[i + 2]! * track.values[i - 2]! + track.values[i + 3]! * track.values[i - 1]!;
            expect(dot).toBeGreaterThan(0.5);
          }
          const first = new THREE.Quaternion().fromArray(track.values, 0);
          expect(degBetweenQ(first, new THREE.Quaternion().fromArray(track.values, last))).toBeLessThan(0.02);
          expect(Math.abs(first.length() - 1)).toBeLessThan(1e-5);
        } else {
          for (let c = 0; c < 3; c++) expect(track.values[last + c]).toBeCloseTo(track.values[c]!, 5);
        }
        expect(track.times[0]).toBe(0);
        expect(track.times[track.times.length - 1]).toBeCloseTo(3, 5);
      }
      expect(baked.tracks[0]!.times.length).toBe(('fps' in options ? 180 : 90) + 1);
    }
  });

  it('(k) leaves both rigs exactly as they were', () => {
    const source = makeRig({ randomAxes: 31, insert: [['LeftArmTwist', 'LeftArm', 'LeftForeArm']] });
    const target = makeRig({ randomAxes: 32, armature: { rotation: new THREE.Euler(-Math.PI / 2, 0, 0), scale: 0.01 } });
    const before = [snapshot(source), snapshot(target)];
    const children = [source.root.children.length, target.root.children.length];
    retargetClip(makeDance(source, { travel: 1 }), source, target, { mirror: true, inPlace: true });
    expect(snapshot(source)).toEqual(before[0]);
    expect(snapshot(target)).toEqual(before[1]);
    expect([source.root.children.length, target.root.children.length]).toEqual(children);
    // Also when the source is not in rest pose at a later call: it is put back as found.
    source.bones.LeftArm!.quaternion.set(0.5, 0.5, 0.5, 0.5);
    const posed = snapshot(source);
    retargetClip(makeDance(makeRig()), source, target);
    expect(snapshot(source)).toEqual(posed);
  });

  it('accepts clips whose tracks use canonical bone names on a rig with other node names', () => {
    const named = makeRig();
    const source = makeRig({ prefix: 'rig_' });
    const target = makeRig({ randomAxes: 2 });
    const clip = makeDance(named);
    const reference = retargetClip(clip, named, target);
    const baked = retargetClip(clip, source, target);
    expect(Array.from(baked.tracks[5]!.values)).toEqual(Array.from(reference.tracks[5]!.values));
  });

  it('handles empty and single-key clips', () => {
    const source = makeRig();
    const target = makeRig({ randomAxes: 1 });
    const empty = retargetClip(new THREE.AnimationClip('empty', 0, []), source, target);
    expect(empty.duration).toBe(0);
    expect(empty.tracks[0]!.times.length).toBe(1);
    // With nothing animated the target stays in its rest pose.
    const rest = snapshot(target);
    poseAt(target, empty, 0);
    const posed = snapshot(target);
    for (let i = 0; i < rest.length; i++) expect(posed[i]).toBeCloseTo(rest[i]!, 5);
  });

  it('throws readable errors for unusable target node names', () => {
    const source = makeRig();
    const clip = makeDance(source);
    const twins = makeRig();
    twins.bones.LeftHand!.name = 'RightHand';
    expect(() => retargetClip(clip, source, twins)).toThrow(/LeftHand.*RightHand.*share the node name "RightHand"|RightHand.*LeftHand.*share the node name "RightHand"/);
    const dotted = makeRig();
    dotted.bones.LeftArm!.name = 'upper_arm.L';
    expect(() => retargetClip(clip, source, dotted)).toThrow(/LeftArm.*"upper_arm\.L".*cannot be used in an animation track name/);
    const shadowed = makeRig();
    const decoy = new THREE.Object3D();
    decoy.name = 'Head';
    shadowed.root.children[0]!.parent!.add(decoy);
    shadowed.root.children.reverse();
    expect(() => retargetClip(clip, source, shadowed)).toThrow(/"Head".*earlier node/);
  });

  it('is fast: a 15 s clip onto a 65-bone rig', () => {
    const source = makeRig({ randomAxes: 41 });
    const twist = ['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'] as const;
    const child: Record<string, CanonicalBone> = { Arm: 'ForeArm' as CanonicalBone, ForeArm: 'Hand' as CanonicalBone, UpLeg: 'Leg' as CanonicalBone, Leg: 'Foot' as CanonicalBone };
    const target = makeRig({
      randomAxes: 42,
      insert: twist.map((bone) => {
        const [, side, part] = /^(Left|Right)(.*)$/.exec(bone)!;
        return [`${bone}Twist`, bone, `${side}${child[part!]}` as CanonicalBone] as [string, CanonicalBone, CanonicalBone];
      }),
    });
    // Pad the target to 65 nodes with finger-like leaves.
    let count = 0;
    target.root.traverse(() => count++);
    for (let i = 0; count < 66; i++, count++) {
      const leaf = new THREE.Bone();
      leaf.name = `Extra${i}`;
      target.bones[i % 2 ? 'LeftHand' : 'RightHand']!.add(leaf);
    }
    const clip = makeDance(source, { duration: 15 });
    retargetClip(clip, source, target); // warm-up (also caches the rest data)
    const start = performance.now();
    const runs = 5;
    for (let i = 0; i < runs; i++) retargetClip(clip, source, target);
    const ms = (performance.now() - start) / runs;
    console.log(`retargetClip: 15 s clip, ${clip.tracks.length} source tracks, ${count - 1}-bone target, 451 frames: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(500);
  });
});
