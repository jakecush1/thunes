import type { DanceKey, DanceScheme } from '../scheme';

/** Hips bump twice to the left, then twice to the right (in leg lengths). */
const BUMPS: DanceKey[] = [
  [0, 0.13, 'out'],
  [0.5, 0.07],
  [1, 0.13, 'out'],
  [1.5, 0.04],
  [2, -0.13, 'out'],
  [2.5, -0.07],
  [3, -0.13, 'out'],
  [3.5, -0.04],
];

/** Slow hip sway with double bumps, one arm floating up overhead and down again while the other rests low. */
export const hipSway: DanceScheme = {
  format: 'thunes-dance@1',
  beats: 8,
  bpm: 120,
  description: 'Hips bump twice to each side while one arm floats up overhead and back down, then the other.',
  base: {
    'hips.crouch': 0.02,
    'hips.tilt': 4,
    'spine.lean': 5,
    'feet.side': 0.06,
    'feet.turn': 12,
    'feet.pitch': -9,
    'arms.raise': 17,
    'arms.elbow': 32,
    'arms.swing': 6,
    'head.level': 0.8,
  },
  tracks: [
    { control: 'hips.shift', repeat: 4, keys: BUMPS },
    // The hip on the weighted side rides up; the spine bends back over it so the shoulders stay level.
    { control: 'hips.roll', repeat: 4, keys: BUMPS, scale: -85 },
    { control: 'spine.side', repeat: 4, keys: BUMPS, scale: 60, lag: 0.1 },
    { control: 'head.tilt', repeat: 4, keys: BUMPS, scale: -45, lag: 0.25 },
    // The free leg softens: heel up, knee in.
    { control: 'leftFoot.pitch', repeat: 4, keys: BUMPS, scale: 70 },
    { control: 'rightFoot.pitch', repeat: 4, keys: BUMPS, scale: -70 },
    { control: 'leftLeg.kneeOut', repeat: 4, keys: BUMPS, scale: 70 },
    { control: 'rightLeg.kneeOut', repeat: 4, keys: BUMPS, scale: -70 },
    // Left arm floats up on beats 0 to 2 and down by 4; the right arm does the same four beats later.
    { control: 'leftArm.raise', mirror: 4, keys: [[0, 0], [1, 70], [2, 130], [3, 56], [4, 0]] },
    { control: 'leftArm.swing', mirror: 4, keys: [[0, 0], [1, 12], [2, 16], [3, 42], [4, 0]] },
    { control: 'leftArm.twist', mirror: 4, keys: [[0, 0], [2, 40], [3, 10], [4, 0]] },
    { control: 'leftArm.elbow', mirror: 4, keys: [[0, 0], [1, 26], [2, -14], [3, 36], [4, 0]], lag: 0.1 },
    { control: 'leftArm.forearmTwist', mirror: 4, keys: [[0, 0], [2, 50], [4, 0]], lag: 0.15 },
    { control: 'leftArm.wrist', mirror: 4, keys: [[0, 0], [1, 30], [2.2, -20], [3.2, 30], [4.2, 0]] },
    { control: 'head.turn', mirror: 4, keys: [[0, 0], [2, 18], [4, 0]], lag: 0.1 },
    { control: 'spine.twist', mirror: 4, keys: [[0, 0], [2, 8], [4, 0]] },
  ],
  oscillators: [
    { control: 'hips.crouch', wave: 'bounce', amp: -0.025, bias: 0.025, period: 1 },
    { control: 'hips.yaw', amp: 6, period: 4, phase: 0.5 },
    // The resting arm drifts with the hips.
    { control: 'leftArm.swing', amp: 10, period: 4, phase: 0.3, mirror: 2 },
    { control: 'arms.wrist', amp: 12, period: 2, phase: 0.5 },
    { control: 'head.nod', wave: 'bounce', amp: -4, bias: 4, period: 1, phase: 0.2 },
  ],
  smooth: { 'hips.shift': 0.2, 'hips.roll': 0.2 },
};
