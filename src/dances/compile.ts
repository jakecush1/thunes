/**
 * Compiles a dance scheme into an AnimationClip on a reference canonical rig.
 *
 * The clip has one "Hips.position" track (metres on the reference rig, whose
 * proportions are DEFAULT_PROPORTIONS) and one "<Bone>.quaternion" track for
 * every body bone, named by canonical bone name. It loops seamlessly: the
 * last frame equals the first. See pose.ts for the angle conventions and
 * scheme.ts for the format.
 */
import * as THREE from 'three';
import { DEFAULT_PROPORTIONS, buildCanonicalSkeleton } from '../rig/canonical';
import type { Rig } from '../rig/rig';
import { sampleControls } from './evaluate';
import type { ControlValues } from './evaluate';
import { POSE_BONES, PoseSolver, createPose } from './pose';
import { CONTROL_NAMES, validateScheme } from './scheme';
import type { DanceScheme } from './scheme';

export interface CompileOptions {
  /** Keyframes per second (default 30). */
  fps?: number;
  /** Name of the clip (default 'dance'). */
  name?: string;
}

export interface CompiledDance {
  /** Duration = beats × 60 / bpm seconds. */
  clip: THREE.AnimationClip;
  /** The rest-pose reference rig the clip animates (a fresh one per call). */
  rig: Rig;
}

/** Frames per second used when none is given. */
export const DEFAULT_FPS = 30;

/**
 * Compiles `scheme` to a looping clip. Throws a DanceSchemeError (with a
 * readable list of problems) when the scheme is invalid.
 */
export function compileScheme(scheme: DanceScheme, options: CompileOptions = {}): CompiledDance {
  validateScheme(scheme);
  const fps = options.fps ?? DEFAULT_FPS;
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`compileScheme: fps must be a positive number (got ${fps})`);

  const duration = (scheme.beats * 60) / scheme.bpm;
  const frames = Math.max(2, Math.round(duration * fps));
  const controls = sampleControls(scheme, frames);

  const solver = new PoseSolver(DEFAULT_PROPORTIONS);
  const pose = createPose();
  const values = {} as ControlValues;

  const times = new Float32Array(frames + 1);
  const position = new Float32Array((frames + 1) * 3);
  const rotations = POSE_BONES.map(() => new Float32Array((frames + 1) * 4));

  for (let frame = 0; frame < frames; frame++) {
    times[frame] = (frame * duration) / frames;
    for (const control of CONTROL_NAMES) values[control] = controls[control][frame];
    solver.solve(values, pose);
    pose.hipsPosition.toArray(position, frame * 3);
    POSE_BONES.forEach((bone, index) => {
      const data = rotations[index];
      const q = pose.rotations[bone].normalize();
      const at = frame * 4;
      // Keep neighbouring keys on the same side of the quaternion sphere so interpolation takes the short way.
      let sign = q.w < 0 ? -1 : 1;
      if (frame > 0) {
        const dot = data[at - 4] * q.x + data[at - 3] * q.y + data[at - 2] * q.z + data[at - 1] * q.w;
        sign = dot < 0 ? -1 : 1;
      }
      data[at] = q.x * sign;
      data[at + 1] = q.y * sign;
      data[at + 2] = q.z * sign;
      data[at + 3] = q.w * sign;
    });
  }

  // Close the loop: the last key repeats the first (with the sign that continues the track).
  times[frames] = duration;
  for (let k = 0; k < 3; k++) position[frames * 3 + k] = position[k];
  for (const data of rotations) {
    const at = frames * 4;
    const dot = data[at - 4] * data[0] + data[at - 3] * data[1] + data[at - 2] * data[2] + data[at - 1] * data[3];
    const sign = dot < 0 ? -1 : 1;
    for (let k = 0; k < 4; k++) data[at + k] = data[k] * sign;
  }

  for (const data of [position, ...rotations]) {
    for (let i = 0; i < data.length; i++) {
      if (!Number.isFinite(data[i])) throw new Error('compileScheme: the scheme produced a non-finite pose');
    }
  }

  const tracks: THREE.KeyframeTrack[] = [new THREE.VectorKeyframeTrack('Hips.position', times, position)];
  POSE_BONES.forEach((bone, index) => tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, rotations[index])));
  const clip = new THREE.AnimationClip(options.name ?? 'dance', duration, tracks);

  const skeleton = buildCanonicalSkeleton(DEFAULT_PROPORTIONS);
  return { clip, rig: { root: skeleton.root, bones: skeleton.bones } };
}
