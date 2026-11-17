import type { DanceScheme } from '../scheme';

/** Jumping jacks: land wide with the arms overhead, land together with the arms down. */
export const starJumps: DanceScheme = {
  format: 'thunes-dance@1',
  beats: 4,
  bpm: 120,
  description: 'Star jumps: land with feet apart and arms overhead, then feet together and arms down.',
  base: {
    'arms.raise': 8,
    'arms.elbow': 12,
    'arms.twist': 20,
    'feet.turn': 8,
    'head.level': 0.5,
    'spine.lean': 3,
  },
  tracks: [
    { control: 'air', repeat: 1, keys: [[0, 0, 'in'], [0.14, 0], [0.56, 0.13, 'out']] },
    // Absorb the landing just after the beat, push off, hang straight.
    { control: 'hips.crouch', repeat: 1, keys: [[0.07, 0.085, 'out'], [0.3, 0.005, 'inOut'], [0.72, 0.005]] },
    { control: 'feet.pitch', repeat: 1, keys: [[0, 0, 'in'], [0.12, -4], [0.5, -34, 'out'], [0.9, -10]] },
    { control: 'feet.side', repeat: 2, keys: [[0, 0.27], [0.15, 0.27], [1, 0], [1.15, 0]] },
    { control: 'arms.raise', repeat: 2, keys: [[0, 150, 'out'], [0.2, 150], [1, 0, 'out'], [1.2, 0]] },
    { control: 'arms.elbow', repeat: 2, keys: [[0, 0], [0.5, 14], [1, 0], [1.5, 14]], lag: 0.05 },
    { control: 'arms.wrist', repeat: 2, keys: [[0, -10], [0.5, 20], [1, 0], [1.5, -25]], lag: 0.1 },
    { control: 'head.nod', repeat: 2, keys: [[0, -10], [1, 6]], lag: 0.08 },
  ],
  oscillators: [
    { control: 'spine.lean', wave: 'bounce', amp: -3, bias: 4, period: 1, phase: 0.1 },
    { control: 'spine.side', amp: 3, period: 4 },
    { control: 'head.tilt', amp: 4, period: 4, phase: 0.5 },
  ],
};
