// Compiler invariants for every built-in dance.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILTIN_DANCES, compileScheme, sampleControls, schemeProblems } from '../../../src/dances';
import type { DanceScheme } from '../../../src/dances';
import { FALLBACK_DANCE_ID } from '../../../src/config';
import { BODY_BONES } from '../../../src/rig/bones';
import { buildCanonicalSkeleton, legLength } from '../../../src/rig/canonical';
import type { CanonicalBodyBone } from '../../../src/rig/canonical';
import { P, measure } from './helpers';

const FPS = 30;
const L = legLength(P);
const DEG = 180 / Math.PI;

interface Frame {
  air: number;
  hips: THREE.Vector3;
  lowestSole: number;
  joint: Record<string, THREE.Vector3>;
  facing: Record<string, THREE.Quaternion>;
}

/** Plays a compiled clip frame by frame on a fresh skeleton and records what the body does. */
function play(scheme: DanceScheme) {
  const { clip } = compileScheme(scheme, { fps: FPS });
  const skeleton = buildCanonicalSkeleton(P);
  const frames = clip.tracks[0].times.length - 1;
  const air = sampleControls(scheme, frames).air;
  const track = (name: string) => {
    const found = clip.tracks.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`missing track ${name}`);
    return found;
  };
  const recorded: Frame[] = [];
  for (let frame = 0; frame <= frames; frame++) {
    skeleton.bones.Hips.position.fromArray(track('Hips.position').values, frame * 3);
    for (const bone of BODY_BONES) skeleton.bones[bone as CanonicalBodyBone].quaternion.fromArray(track(`${bone}.quaternion`).values, frame * 4);
    const posed = measure(skeleton);
    const joint: Record<string, THREE.Vector3> = {};
    const facing: Record<string, THREE.Quaternion> = {};
    for (const bone of Object.keys(skeleton.bones) as CanonicalBodyBone[]) {
      joint[bone] = posed.at(bone);
      facing[bone] = posed.facing(bone);
    }
    recorded.push({ air: air[frame % frames], hips: posed.at('Hips'), lowestSole: posed.lowestSole(), joint, facing });
  }
  return { clip, frames, recorded, track };
}

function distanceToSegment(point: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const t = Math.min(1, Math.max(0, point.clone().sub(a).dot(ab) / ab.lengthSq()));
  return point.distanceTo(a.clone().addScaledVector(ab, t));
}

/**
 * How far a point is outside the torso, modelled as an elliptical tube from the hips to the
 * neck (half-width 0.13 m, half-depth 0.09 m): below 1 means inside.
 */
function torsoClearance(frame: Frame, point: THREE.Vector3): number {
  const a = frame.joint.Hips;
  const b = frame.joint.Neck;
  const ab = b.clone().sub(a);
  const t = point.clone().sub(a).dot(ab) / ab.lengthSq();
  if (t < -0.05 || t > 1.02) return Infinity;
  const offset = point.clone().sub(a.clone().addScaledVector(ab, t));
  const chest = frame.facing.Spine1;
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(chest);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(chest);
  return Math.hypot(offset.dot(right) / 0.13, offset.dot(forward) / 0.09);
}

describe('BUILTIN_DANCES', () => {
  it('lists twelve valid dances with unique ids, including the fallback', () => {
    expect(BUILTIN_DANCES).toHaveLength(12);
    expect(new Set(BUILTIN_DANCES.map((def) => def.id)).size).toBe(12);
    expect(new Set(BUILTIN_DANCES.map((def) => def.name)).size).toBe(12);
    expect(BUILTIN_DANCES.some((def) => def.id === FALLBACK_DANCE_ID)).toBe(true);
    for (const def of BUILTIN_DANCES) {
      expect(def.id).toMatch(/^builtin:[a-z-]+$/);
      expect(def.source).toBe('builtin');
      expect(def.category).toBeTruthy();
      expect(def.scheme).toBeDefined();
      expect(def.url).toBeUndefined();
      expect(schemeProblems(def.scheme)).toEqual([]);
      expect(def.bpm).toBe(def.scheme!.bpm);
      expect(def.beats).toBe(def.scheme!.beats);
      expect([4, 8, 16]).toContain(def.beats);
      expect(def.bpm).toBeGreaterThanOrEqual(100);
      expect(def.bpm).toBeLessThanOrEqual(140);
      // Schemes are plain data.
      expect(JSON.parse(JSON.stringify(def.scheme))).toEqual(def.scheme);
    }
    expect(new Set(BUILTIN_DANCES.map((def) => def.category)).size).toBeGreaterThanOrEqual(3);
  });
});

describe.each(BUILTIN_DANCES.map((def) => [def.id, def] as const))('%s', (_id, def) => {
  const scheme = def.scheme as DanceScheme;
  const { clip, frames, recorded, track } = play(scheme);
  const usesSnap = (scheme.tracks ?? []).some((t) => t.keys.some((key) => key[2] === 'snap' || key[2] === 'hold'));

  it('has the right duration and tracks', () => {
    expect(clip.duration).toBeCloseTo((scheme.beats * 60) / scheme.bpm, 9);
    expect(frames).toBe(Math.round(clip.duration * FPS));
    expect(clip.tracks.map((t) => t.name).sort()).toEqual(['Hips.position', ...BODY_BONES.map((bone) => `${bone}.quaternion`)].sort());
    for (const t of clip.tracks) {
      expect(t.times.length).toBe(frames + 1);
      expect(t.times[0]).toBe(0);
      expect(t.times[frames]).toBeCloseTo(clip.duration, 5);
    }
  });

  it('loops seamlessly: the last frame equals the first', () => {
    const position = track('Hips.position').values;
    for (let k = 0; k < 3; k++) expect(position[frames * 3 + k]).toBe(position[k]);
    for (const bone of BODY_BONES) {
      const values = track(`${bone}.quaternion`).values;
      const first = new THREE.Quaternion().fromArray(values, 0);
      const last = new THREE.Quaternion().fromArray(values, frames * 4);
      expect(Math.abs(first.dot(last))).toBeCloseTo(1, 6);
    }
    // And the step across the loop point is no bigger than its neighbours allow.
    expect(recorded[frames].hips.distanceTo(recorded[frames - 1].hips)).toBeLessThan(0.08);
  });

  it('contains only finite, normalised, sign-continuous quaternions', () => {
    for (const t of clip.tracks) for (const value of t.values) expect(Number.isFinite(value)).toBe(true);
    for (const bone of BODY_BONES) {
      const values = track(`${bone}.quaternion`).values;
      for (let frame = 0; frame <= frames; frame++) {
        const at = frame * 4;
        expect(Math.hypot(values[at], values[at + 1], values[at + 2], values[at + 3])).toBeCloseTo(1, 5);
        if (frame === 0) continue;
        const dot = values[at] * values[at - 4] + values[at + 1] * values[at - 3] + values[at + 2] * values[at - 2] + values[at + 3] * values[at - 1];
        expect(dot).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the lowest sole on the floor, or exactly `air` above it', () => {
    for (const frame of recorded) expect(Math.abs(frame.lowestSole - frame.air * L)).toBeLessThan(0.01);
    if (!(scheme.tracks ?? []).some((t) => t.control === 'air')) {
      for (const frame of recorded) expect(Math.abs(frame.lowestSole)).toBeLessThan(1e-4);
    }
  });

  it('keeps the hips within sane bounds', () => {
    for (const frame of recorded) {
      expect(frame.hips.y).toBeGreaterThan(0.55);
      expect(frame.hips.y).toBeLessThan(1.3);
      expect(Math.abs(frame.hips.x)).toBeLessThan(0.35);
      expect(Math.abs(frame.hips.z)).toBeLessThan(0.35);
    }
  });

  it('respects the joint limits: knees and elbows only fold the right way, at most 150°', () => {
    for (let frame = 0; frame <= frames; frame++) {
      for (const side of ['Left', 'Right'] as const) {
        const knee = new THREE.Quaternion().fromArray(track(`${side}Leg.quaternion`).values, frame * 4);
        const shin = new THREE.Vector3(0, -1, 0).applyQuaternion(knee);
        expect(Math.abs(shin.x)).toBeLessThan(1e-5); // a pure hinge
        expect(shin.z).toBeLessThanOrEqual(1e-6); // the foot goes back, never forward
        expect(Math.acos(Math.min(1, -shin.y)) * DEG).toBeLessThanOrEqual(150.01);

        const elbow = new THREE.Quaternion().fromArray(track(`${side}ForeArm.quaternion`).values, frame * 4);
        const forearm = new THREE.Vector3(side === 'Left' ? 1 : -1, 0, 0).applyQuaternion(elbow);
        expect(Math.abs(forearm.y)).toBeLessThan(1e-5);
        expect(forearm.z).toBeGreaterThanOrEqual(-1e-6);
        expect(Math.acos(Math.min(1, Math.abs(forearm.x))) * (forearm.x * (side === 'Left' ? 1 : -1) < 0 ? -1 : 1) * DEG).toBeLessThanOrEqual(150.01);

        const ankle = new THREE.Quaternion().fromArray(track(`${side}Foot.quaternion`).values, frame * 4);
        expect(2 * Math.acos(Math.min(1, Math.abs(ankle.w))) * DEG).toBeLessThanOrEqual(65.01);
      }
    }
  });

  it('moves without jumps from one frame to the next', () => {
    const limit = usesSnap ? 80 : 45; // degrees per frame at 30 fps
    let worst = 0;
    for (const bone of BODY_BONES) {
      const values = track(`${bone}.quaternion`).values;
      for (let frame = 1; frame <= frames; frame++) {
        const a = new THREE.Quaternion().fromArray(values, (frame - 1) * 4);
        const b = new THREE.Quaternion().fromArray(values, frame * 4);
        worst = Math.max(worst, a.angleTo(b) * DEG);
      }
    }
    expect(worst).toBeLessThan(limit);
    for (let frame = 1; frame <= frames; frame++) expect(recorded[frame].hips.distanceTo(recorded[frame - 1].hips)).toBeLessThan(0.08);
  });

  it('keeps the limbs out of the body', () => {
    let torso = Infinity;
    let head = Infinity;
    let feet = Infinity;
    let knees = Infinity;
    let thigh = Infinity;
    for (const frame of recorded) {
      const skull = frame.joint.Head.clone().lerp(frame.joint.HeadTop_End, 0.5);
      for (const side of ['Left', 'Right'] as const) {
        const wrist = frame.joint[`${side}Hand`];
        const elbow = frame.joint[`${side}ForeArm`];
        const mid = wrist.clone().lerp(elbow, 0.5);
        for (const point of [wrist, elbow, mid]) torso = Math.min(torso, torsoClearance(frame, point));
        head = Math.min(head, wrist.distanceTo(skull), mid.distanceTo(skull));
        for (const leg of ['Left', 'Right'] as const) {
          thigh = Math.min(thigh, distanceToSegment(wrist, frame.joint[`${leg}UpLeg`], frame.joint[`${leg}Leg`]));
        }
      }
      feet = Math.min(feet, frame.joint.LeftFoot.distanceTo(frame.joint.RightFoot));
      knees = Math.min(knees, frame.joint.LeftLeg.distanceTo(frame.joint.RightLeg));
    }
    const report = `torso ${torso.toFixed(2)} head ${head.toFixed(3)} feet ${feet.toFixed(3)} knees ${knees.toFixed(3)} thigh ${thigh.toFixed(3)}`;
    expect(torso, report).toBeGreaterThan(1.05);
    expect(head, report).toBeGreaterThan(0.15);
    expect(feet, report).toBeGreaterThan(0.1);
    expect(knees, report).toBeGreaterThan(0.09);
    expect(thigh, report).toBeGreaterThan(0.075);
  });

  it('is alive: arms, legs, hips and head all move', () => {
    const travel = (bone: string) => {
      let total = 0;
      for (let frame = 1; frame <= frames; frame++) total += recorded[frame].joint[bone].distanceTo(recorded[frame - 1].joint[bone]);
      return total / scheme.beats; // metres per beat
    };
    expect(travel('LeftHand')).toBeGreaterThan(0.1);
    expect(travel('RightHand')).toBeGreaterThan(0.1);
    expect(travel('Hips')).toBeGreaterThan(0.04);
    expect(travel('Head')).toBeGreaterThan(0.05);
    expect(travel('LeftLeg') + travel('RightLeg')).toBeGreaterThan(0.08);
  });
});
