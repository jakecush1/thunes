/**
 * The dance system: the scheme format, its compiler, and the built-in
 * placeholder dances.
 */
import type { DanceDef } from '../types';
import type { DanceScheme } from './scheme';
import { bounce } from './builtin/bounce';
import { discoPoint } from './builtin/discoPoint';
import { fistPump } from './builtin/fistPump';
import { groove } from './builtin/groove';
import { handsUp } from './builtin/handsUp';
import { headbang } from './builtin/headbang';
import { hipSway } from './builtin/hipSway';
import { robot } from './builtin/robot';
import { shuffle } from './builtin/shuffle';
import { sideClap } from './builtin/sideClap';
import { starJumps } from './builtin/starJumps';
import { twist } from './builtin/twist';

export { compileScheme, DEFAULT_FPS } from './compile';
export type { CompileOptions, CompiledDance } from './compile';
export {
  CONTROLS,
  CONTROL_NAMES,
  DanceSchemeError,
  EASES,
  WAVES,
  isControlName,
  mirrorControl,
  resolveTarget,
  schemeProblems,
  validateScheme,
} from './scheme';
export type {
  ControlName,
  ControlSpec,
  ControlTarget,
  DanceKey,
  DanceOscillator,
  DanceScheme,
  DanceTrack,
  Ease,
  GroupControl,
  Side,
  Wave,
} from './scheme';
export { evaluateControls, sampleControls } from './evaluate';
export type { ControlValues } from './evaluate';
export { JOINT_LIMITS, PoseSolver, createPose } from './pose';
export type { SolvedPose } from './pose';

function dance(slug: string, name: string, category: string, scheme: DanceScheme): DanceDef {
  return { id: `builtin:${slug}`, source: 'builtin', name, category, bpm: scheme.bpm, beats: scheme.beats, scheme };
}

/** The placeholder dances, generated in code. 'builtin:groove' is the fallback dance. */
export const BUILTIN_DANCES: DanceDef[] = [
  dance('groove', 'Two-Step Groove', 'Groove', groove),
  dance('bounce', 'Knee Bounce', 'Groove', bounce),
  dance('hip-sway', 'Hip Sway', 'Groove', hipSway),
  dance('side-clap', 'Side Step Clap', 'Groove', sideClap),
  dance('disco-point', 'Disco Point', 'Party', discoPoint),
  dance('hands-up', 'Hands-Up Wave', 'Party', handsUp),
  dance('fist-pump', 'Fist Pump', 'Party', fistPump),
  dance('twist', 'Swivel Twist', 'Party', twist),
  dance('shuffle', 'Shuffle Step', 'Party', shuffle),
  dance('robot', 'Robot', 'Silly', robot),
  dance('headbang', 'Headbang', 'Silly', headbang),
  dance('star-jumps', 'Star Jumps', 'Silly', starJumps),
];
