import type { DanceScheme } from '../scheme';

/** Feet planted, knees dropping hard on every beat, forearms hammering along, a deeper dip on beat four. */
export const bounce: DanceScheme = {
  format: 'thunes-dance@1',
  beats: 4,
  bpm: 120,
  description: 'Planted feet and a springy knee bounce on every beat, with a deeper dip on the last beat.',
  base: {
    'hips.crouch': 0.02,
    'hips.forward': -0.03,
    'hips.tilt': 7,
    'feet.side': 0.07,
    'feet.turn': 12,
    'spine.lean': 13,
    'head.level': 0.6,
    'arms.raise': 20,
    'arms.elbow': 85,
    'arms.swing': -6,
    'arms.twist': -12,
  },
  tracks: [
    { control: 'hips.crouch', keys: [[0, 0], [2.5, 0], [3, 0.07, 'in'], [3.5, 0, 'out']] },
    { control: 'spine.lean', keys: [[0, 0], [2.5, 0], [3, 10, 'in'], [3.6, 0, 'out']] },
    { control: 'arms.raise', keys: [[0, 0], [2.5, 0], [3, 22, 'in'], [3.7, 0, 'out']], lag: 0.05 },
  ],
  oscillators: [
    // Sharp on the beat, floating in between.
    { control: 'hips.crouch', wave: 'bounce', amp: -0.055, bias: 0.055, period: 1 },
    { control: 'feet.pitch', wave: 'bounce', amp: -7, period: 1 },
    { control: 'arms.elbow', wave: 'bounce', amp: 26, bias: -12, period: 1, lag: 0.08 },
    { control: 'arms.shrug', wave: 'bounce', amp: 8, period: 1, lag: 0.04 },
    { control: 'arms.wrist', wave: 'bounce', amp: -25, bias: 12, period: 1, lag: 0.16 },
    // Rock from side to side, one side per beat.
    { control: 'spine.side', amp: 7, period: 2, phase: -0.5 },
    { control: 'hips.shift', amp: 0.035, period: 2, phase: -0.5 },
    { control: 'hips.roll', amp: -3, period: 2, phase: -0.4 },
    { control: 'spine.twist', amp: 9, period: 4 },
    { control: 'leftArm.swing', amp: 13, period: 2, phase: -0.5, mirror: 1 },
    { control: 'head.nod', wave: 'bounce', amp: -11, bias: 9, period: 1, lag: 0.1 },
    { control: 'head.tilt', amp: 5, period: 2, phase: -0.3 },
  ],
};
