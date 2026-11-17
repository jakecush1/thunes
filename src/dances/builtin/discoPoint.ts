import type { DanceKey, DanceScheme } from '../scheme';

/** +1 on the "up" beats and −1 on the "down" beats of the first half, flipped in the second half. */
const SWAY: DanceKey[] = [
  [0, 1],
  [1, -1],
  [2, 1],
  [3, -1],
  [4, -1],
  [5, 1],
  [6, -1],
  [7, 1],
];

/** Point up and out, then down across the body, four times with one arm, then with the other. Hips push the opposite way. */
export const discoPoint: DanceScheme = {
  format: 'thunes-dance@1',
  beats: 8,
  bpm: 120,
  description: 'One arm points high to the side, then low across the body, hips pushing the other way. Arms swap every four beats.',
  base: {
    'hips.crouch': 0.015,
    'hips.tilt': 4,
    'feet.side': 0.1,
    'feet.turn': 14,
    'feet.pitch': -9,
    'arms.raise': 20,
    'arms.elbow': 10,
    'head.level': 0.5,
    'spine.lean': 6,
  },
  tracks: [
    // The right arm points on beats 0 to 3 and rests on the hip from 4 to 7. The left arm follows four beats later.
    {
      control: 'rightArm.raise',
      mirror: 4,
      keys: [[0, 118], [0.4, 118], [1, -42], [1.4, -42], [2, 118], [2.4, 118], [3, -42], [3.4, -42], [4.1, 18], [7.4, 18]],
    },
    {
      control: 'rightArm.swing',
      mirror: 4,
      keys: [[0, 8], [0.4, 8], [1, 66], [1.4, 66], [2, 8], [2.4, 8], [3, 66], [3.4, 66], [4.1, -18], [7.4, -18]],
    },
    {
      control: 'rightArm.elbow',
      mirror: 4,
      lag: 0.04,
      keys: [[0, -6], [0.4, -6], [1, 12], [1.4, 12], [2, -6], [2.4, -6], [3, 12], [3.4, 12], [4.1, 88], [7.4, 88]],
    },
    { control: 'rightArm.twist', mirror: 4, keys: [[0, 0], [3.4, 0], [4.1, -62], [7.4, -62]] },
    { control: 'rightArm.wrist', mirror: 4, keys: [[0, 0], [3.4, 0], [4.1, 25], [7.4, 25]] },
    // Hips push away from the raised arm (the dancer's right arm is up first, so the hips go left).
    { control: 'hips.shift', keys: SWAY, scale: 0.085 },
    { control: 'hips.roll', keys: SWAY, scale: -7, lag: 0.05 },
    { control: 'spine.side', keys: SWAY, scale: 9, lag: 0.1 },
    { control: 'spine.twist', keys: SWAY, scale: -12, lag: 0.05 },
    { control: 'head.turn', keys: SWAY, scale: -24, lag: 0.12 },
    { control: 'head.nod', keys: SWAY, scale: -9, lag: 0.12 },
    // The unweighted leg pops its heel.
    { control: 'leftFoot.pitch', keys: SWAY, scale: 9 },
    { control: 'rightFoot.pitch', keys: SWAY, scale: -9 },
    { control: 'leftLeg.kneeOut', keys: SWAY, scale: 8 },
    { control: 'rightLeg.kneeOut', keys: SWAY, scale: -8 },
  ],
  oscillators: [
    { control: 'hips.crouch', wave: 'bounce', amp: -0.025, bias: 0.025, period: 1 },
    { control: 'head.nod', wave: 'bounce', amp: -4, bias: 4, period: 1, phase: 0.15 },
  ],
};
