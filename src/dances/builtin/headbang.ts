import type { DanceScheme } from '../scheme';

/** Wide rock stance with an air guitar: the torso crunches forward on every beat and the head whips after it. */
export const headbang: DanceScheme = {
  format: 'thunes-dance@1',
  beats: 4,
  bpm: 120,
  description: 'Wide stance, air guitar, the torso crunching forward on every beat with the head whipping after it.',
  base: {
    'hips.crouch': 0.045,
    'hips.forward': -0.05,
    'hips.tilt': 5,
    'feet.side': 0.17,
    'feet.turn': 20,
    'spine.lean': 8,
    // Left hand on the guitar neck, right hand strumming at the belly.
    'leftArm.raise': 52,
    'leftArm.swing': 38,
    'leftArm.elbow': 50,
    'leftArm.forearmTwist': 70,
    'leftArm.wrist': 30,
    'rightArm.raise': 22,
    'rightArm.swing': 6,
    'rightArm.elbow': 92,
    'rightArm.twist': -34,
  },
  tracks: [
    // Accelerate into the beat, recover more slowly.
    { control: 'spine.lean', repeat: 1, keys: [[0, 30, 'in'], [0.55, -6, 'out']] },
    { control: 'head.nod', repeat: 1, keys: [[0, 34, 'in'], [0.55, -22, 'out']], lag: 0.09 },
    { control: 'hips.crouch', repeat: 1, keys: [[0, 0.05, 'in'], [0.55, 0, 'out']] },
    { control: 'hips.tilt', repeat: 1, keys: [[0, 8, 'in'], [0.55, 0, 'out']] },
    { control: 'arms.shrug', repeat: 1, keys: [[0, 8, 'in'], [0.55, 0, 'out']], lag: 0.05 },
  ],
  oscillators: [
    // Strum twice per beat.
    { control: 'rightArm.elbow', amp: 16, period: 0.5 },
    { control: 'rightArm.wrist', amp: 24, period: 0.5, phase: 0.1 },
    // Rock toward one leg, then the other, over the four beats; the guitar neck rises and falls with it.
    { control: 'hips.shift', amp: 0.07, period: 4 },
    { control: 'spine.twist', amp: 12, period: 4, phase: 0.2 },
    { control: 'leftArm.raise', amp: 10, period: 4, phase: 0.4 },
    { control: 'head.tilt', amp: 9, period: 2, phase: 0.2 },
  ],
};
