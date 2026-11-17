import type { DanceScheme } from '../scheme';

/**
 * Relaxed two-step: step out, close with a tap, step back, close with a tap.
 * Loose bent arms swing against each other; the knees give on every beat.
 */
export const groove: DanceScheme = {
  format: 'thunes-dance@1',
  beats: 4,
  bpm: 120,
  description: 'Relaxed two-step: step to the side, tap the other foot in, and back again.',
  base: {
    'hips.crouch': 0.012,
    'hips.forward': -0.02,
    'hips.tilt': 6,
    'head.level': 0.7,
    'arms.raise': 13,
    'arms.elbow': 58,
    'arms.swing': -4,
    'arms.twist': -8,
    'feet.turn': 8,
    'spine.lean': 10,
  },
  tracks: [
    // The left foot stands from beat 0 to 2, closes in to tap on 3 and steps back out to land on 0.
    { control: 'leftFoot.side', keys: [[0, 0.16, 'inOut'], [2, 0.16], [3, -0.16, 'inOut']], mirror: 2 },
    { control: 'leftFoot.up', keys: [[0, 0, 'in'], [2.1, 0], [2.55, 0.05, 'out'], [3, 0, 'in'], [3.5, 0.06, 'out']], mirror: 2 },
    // The closing foot only taps with its ball.
    { control: 'leftFoot.pitch', keys: [[0, 0, 'out'], [2.1, 0], [2.6, -24], [3.2, -28], [3.6, -8]], mirror: 2 },
    // Open the arm on the stepping side a little.
    { control: 'leftArm.raise', keys: [[0, 12, 'out'], [1, 0], [2, -3], [3, 2]], mirror: 2 },
  ],
  oscillators: [
    { control: 'hips.shift', amp: 0.16, period: 4 },
    // Knees give on every beat.
    { control: 'hips.crouch', wave: 'bounce', amp: -0.026, bias: 0.026, period: 1 },
    { control: 'hips.roll', amp: -4, period: 4, phase: 0.25 },
    { control: 'spine.side', amp: 5, period: 4, phase: 0.4 },
    { control: 'hips.yaw', amp: 7, period: 4, phase: -0.5 },
    { control: 'spine.twist', amp: -12, period: 4, phase: -0.2 },
    { control: 'spine.lean', wave: 'bounce', amp: -3, bias: 3, period: 1, phase: 0.1 },
    { control: 'head.nod', wave: 'bounce', amp: -6, bias: 5, period: 1, phase: 0.2 },
    { control: 'head.tilt', amp: 4, period: 4, phase: 0.6 },
    // Arms pump opposite each other once per two beats, elbows trailing the shoulders.
    { control: 'leftArm.swing', amp: 27, period: 2, mirror: 1 },
    { control: 'leftArm.twist', amp: -14, period: 2, phase: 0.15, mirror: 1 },
    { control: 'leftArm.elbow', amp: 18, period: 2, phase: 0.3, mirror: 1 },
    { control: 'arms.shrug', wave: 'bounce', amp: -4, bias: 4, period: 1, phase: 0.15 },
    { control: 'arms.wrist', amp: 10, period: 1, phase: 0.4 },
  ],
  smooth: { 'feet.up': 0.2, 'feet.pitch': 0.2 },
};
