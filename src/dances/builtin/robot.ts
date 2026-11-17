import type { DanceScheme } from '../scheme';

/** Stiff, segmented moves that snap onto each beat: goalpost arm, hinge at the elbow, swap, with the head turning on its own. */
export const robot: DanceScheme = {
  format: 'thunes-dance@1',
  beats: 8,
  bpm: 120,
  description: 'Mechanical poses that snap into place on every beat: right-angle arms, a hinging elbow and a swivelling head.',
  base: {
    'hips.crouch': 0.015,
    'feet.side': 0.06,
    'arms.raise': 6,
    'arms.elbow': 8,
    'head.level': 0.2,
  },
  tracks: [
    // Left arm: goalpost on 0, forearm hinges down on 1, arm forward at a right angle on 2, forearm hinges on 3.
    { control: 'leftArm.raise', repeat: 4, mirror: 2, keys: [[0, 78, 'snap'], [1, 78], [2, 4, 'snap'], [3, 4]] },
    { control: 'leftArm.twist', repeat: 4, mirror: 2, keys: [[0, 80, 'snap'], [1, 80], [2, 0, 'snap'], [3, 0]] },
    { control: 'leftArm.swing', repeat: 4, mirror: 2, keys: [[0, 0, 'snap'], [1, 0], [2, 38, 'snap'], [3, 38]] },
    { control: 'leftArm.elbow', repeat: 4, mirror: 2, keys: [[0, 82, 'snap'], [1, 22, 'snap'], [2, 82, 'snap'], [3, 40, 'snap']] },
    { control: 'leftArm.wrist', repeat: 4, mirror: 2, keys: [[0, 0, 'snap'], [1, 40, 'snap'], [2, 0, 'snap'], [3, -30, 'snap']] },
    { control: 'spine.twist', repeat: 4, keys: [[0, 14, 'snap'], [1, 14], [2, -14, 'snap'], [3, -14]] },
    { control: 'spine.side', repeat: 4, keys: [[0, 0, 'snap'], [1, 7, 'snap'], [2, 0, 'snap'], [3, -7, 'snap']] },
    { control: 'head.turn', repeat: 4, keys: [[0, -28, 'snap'], [1, 32, 'snap'], [2, 28, 'snap'], [3, -32, 'snap']], lag: 0.06 },
    { control: 'head.tilt', keys: [[0, 0, 'snap'], [3, 0], [4, 10, 'snap'], [6, 10], [7, -10, 'snap']] },
    { control: 'hips.shift', repeat: 4, keys: [[0, 0.05, 'snap'], [1, 0.05], [2, -0.05, 'snap'], [3, -0.05]] },
    // The whole machine swivels on its base every four beats, one foot pivoting on its heel.
    { control: 'hips.yaw', keys: [[0, 16, 'snap'], [3, 16], [4, -16, 'snap'], [7, -16]] },
    { control: 'leftFoot.turn', keys: [[0, 34, 'snap'], [3, 34], [4, 0, 'snap'], [7, 0]], mirror: 4 },
    { control: 'leftFoot.pitch', keys: [[0, 0, 'snap'], [3.3, 0], [3.8, 14], [4, 0, 'in'], [7.3, 0], [7.8, 14]], mirror: 4 },
  ],
  oscillators: [
    // A square little bob on every beat.
    { control: 'hips.crouch', wave: 'pulse', amp: 0.03, period: 1, width: 0.35, phase: -0.08 },
    { control: 'spine.lean', wave: 'pulse', amp: 4, period: 2, width: 0.5 },
  ],
};
