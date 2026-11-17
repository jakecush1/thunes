import type { DanceScheme } from '../scheme';

/** Wide side step with open arms, the other foot closes and the hands clap; the second pair of claps is up high. */
export const sideClap: DanceScheme = {
  format: 'thunes-dance@1',
  beats: 8,
  bpm: 120,
  description: 'Step wide with open arms, close and clap. The claps of the second half go up high.',
  base: {
    'hips.crouch': 0.012,
    'hips.forward': -0.02,
    'hips.tilt': 5,
    'spine.lean': 9,
    'head.level': 0.7,
    'arms.raise': 10,
    'arms.swing': 12,
    'arms.elbow': 30,
    'arms.forearmTwist': 10,
    'feet.turn': 8,
  },
  tracks: [
    { control: 'leftFoot.side', repeat: 4, keys: [[0, 0.22, 'inOut'], [2, 0.22], [3, -0.22, 'inOut']], mirror: 2 },
    { control: 'leftFoot.up', repeat: 4, keys: [[0, 0, 'in'], [2.1, 0], [2.55, 0.06, 'out'], [3, 0, 'in'], [3.5, 0.08, 'out']], mirror: 2 },
    { control: 'leftFoot.pitch', repeat: 4, keys: [[0, 0, 'out'], [2.1, 0], [2.6, -20], [3.2, -25], [3.6, -8]], mirror: 2 },
    // Open on the step (even beats), clap on the close (odd beats).
    { control: 'arms.raise', repeat: 2, keys: [[0, 48, 'out'], [0.4, 50], [1, -4, 'in'], [1.15, -4]] },
    { control: 'arms.elbow', repeat: 2, keys: [[0, 0, 'out'], [0.4, 0], [1, 66, 'in'], [1.15, 66]], lag: 0.03 },
    { control: 'arms.twist', repeat: 2, keys: [[0, 20, 'out'], [0.4, 20], [1, -29, 'in'], [1.15, -29]] },
    { control: 'arms.swing', repeat: 2, keys: [[0, -8, 'out'], [0.4, -8], [1, 12, 'in'], [1.15, 12]] },
    // Second half: the claps go up to face height.
    { control: 'arms.swing', keys: [[0, 0], [3.6, 0], [4.6, 42], [7.2, 42]] },
    { control: 'head.nod', keys: [[0, 0], [3.6, 0], [4.6, -10], [7.2, -10]] },
  ],
  oscillators: [
    { control: 'hips.shift', amp: 0.22, period: 4 },
    { control: 'hips.crouch', wave: 'bounce', amp: -0.028, bias: 0.028, period: 1 },
    { control: 'hips.roll', amp: -4, period: 4, phase: 0.25 },
    { control: 'spine.side', amp: 6, period: 4, phase: 0.3 },
    { control: 'hips.yaw', amp: 9, period: 4, phase: -0.5 },
    { control: 'spine.twist', amp: 6, period: 4, phase: -0.3 },
    { control: 'head.turn', amp: 14, period: 4, phase: -0.6 },
    { control: 'head.nod', wave: 'bounce', amp: -5, bias: 4, period: 1, phase: 0.2 },
    { control: 'arms.shrug', wave: 'bounce', amp: -5, bias: 5, period: 2, phase: 1 },
  ],
  smooth: { 'feet.up': 0.2, 'feet.pitch': 0.2 },
};
