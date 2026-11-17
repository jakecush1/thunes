import type { DanceScheme } from '../scheme';

/** Hopping on every beat while one fist punches the air; the arms swap after four beats. */
export const fistPump: DanceScheme = {
  format: 'thunes-dance@1',
  beats: 8,
  bpm: 120,
  description: 'Hop on every beat and punch a fist into the air. Four punches with one arm, then four with the other.',
  base: {
    'hips.crouch': 0.02,
    'feet.side': 0.05,
    'feet.turn': 8,
    'hips.tilt': 4,
    'spine.lean': 7,
    'head.level': 0.5,
    'arms.raise': 22,
    'arms.swing': 12,
    'arms.elbow': 96,
    'arms.twist': -10,
  },
  tracks: [
    // Right fist: up on the beat, back to the shoulder in between, for beats 0 to 3. The left arm takes over on 4.
    {
      control: 'rightArm.swing',
      mirror: 4,
      keys: [[0, 150, 'out'], [0.5, 38], [1, 150, 'out'], [1.5, 38], [2, 150, 'out'], [2.5, 38], [3, 150, 'out'], [3.55, 20], [4.2, 0], [7.5, 0]],
    },
    {
      control: 'rightArm.elbow',
      mirror: 4,
      lag: 0.03,
      keys: [[0, -82, 'out'], [0.5, 30], [1, -82, 'out'], [1.5, 30], [2, -82, 'out'], [2.5, 30], [3, -82, 'out'], [3.55, 10], [4.2, 0], [7.5, 0]],
    },
    {
      control: 'rightArm.raise',
      mirror: 4,
      keys: [[0, -8, 'out'], [0.5, 30], [1, -8, 'out'], [1.5, 30], [2, -8, 'out'], [2.5, 30], [3, -8, 'out'], [3.55, 8], [4.2, 0], [7.5, 0]],
    },
    // Hop: off the floor between the beats, landing on them.
    { control: 'air', repeat: 1, keys: [[0, 0, 'in'], [0.16, 0], [0.57, 0.07, 'out']] },
    { control: 'hips.crouch', repeat: 1, keys: [[0.06, 0.07, 'out'], [0.3, 0.005, 'inOut'], [0.72, 0.005]] },
    { control: 'feet.pitch', repeat: 1, keys: [[0, 0, 'in'], [0.14, -4], [0.5, -28, 'out'], [0.9, -8]] },
    // Lean away from the punching arm and look up at it.
    { control: 'spine.side', keys: [[0, 7], [3.4, 7], [4, -7], [7.4, -7]] },
    { control: 'spine.twist', keys: [[0, 10], [3.4, 10], [4, -10], [7.4, -10]] },
    { control: 'hips.shift', keys: [[0, 0.03], [3.4, 0.03], [4, -0.03], [7.4, -0.03]] },
    { control: 'head.tilt', keys: [[0, -6], [3.4, -6], [4, 6], [7.4, 6]], lag: 0.1 },
  ],
  oscillators: [
    // The resting arm keeps time with small pumps.
    { control: 'arms.elbow', wave: 'bounce', amp: 10, period: 1, lag: 0.05 },
    { control: 'arms.shrug', wave: 'bounce', amp: 6, period: 1 },
    { control: 'head.nod', wave: 'bounce', amp: 10, bias: -12, period: 1, lag: 0.08 },
    { control: 'spine.lean', wave: 'bounce', amp: -4, bias: 4, period: 1, phase: 0.08 },
  ],
};
