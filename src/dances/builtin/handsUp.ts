import type { DanceScheme } from '../scheme';

/** Both arms overhead, swaying from side to side with the whole body; wrists and head trail behind. */
export const handsUp: DanceScheme = {
  format: 'thunes-dance@1',
  beats: 8,
  bpm: 120,
  description: 'Arms in the air, waving side to side with the body, hands trailing. The second half reaches higher.',
  base: {
    'hips.crouch': 0.015,
    'hips.tilt': 3,
    'spine.lean': 5,
    'feet.side': 0.09,
    'feet.turn': 10,
    'feet.pitch': -8,
    'arms.raise': 158,
    'arms.twist': 45,
    'arms.elbow': 32,
    'arms.forearmTwist': 30,
    'head.level': 0.6,
    'head.nod': -8,
  },
  tracks: [
    // Reach taller and straighter in the second half.
    { control: 'arms.elbow', keys: [[0, 0], [3.5, 0], [4.5, -20], [7.5, -20]] },
    { control: 'arms.shrug', keys: [[0, 0], [3.5, 0], [4.5, 8], [7.5, 8]] },
    { control: 'hips.crouch', keys: [[0, 0.015], [3.5, 0.015], [4.5, -0.01], [7.5, -0.01]] },
  ],
  oscillators: [
    // Lean left on beats 0 and 4, right on 2 and 6: the body leads, the arms follow, the hands come last.
    { control: 'hips.shift', amp: 0.09, period: 4, phase: -1 },
    { control: 'hips.roll', amp: 4, period: 4, phase: -0.9 },
    { control: 'spine.side', amp: 13, period: 4, phase: -0.85 },
    { control: 'leftArm.raise', amp: -24, period: 4, phase: -0.7, mirror: 2 },
    { control: 'leftArm.elbow', amp: 12, period: 4, phase: -0.5, mirror: 2 },
    { control: 'leftArm.wrist', amp: -30, period: 4, phase: -0.35, mirror: 2 },
    { control: 'head.tilt', amp: 8, period: 4, phase: -0.6 },
    // The unweighted heel lifts.
    { control: 'leftFoot.pitch', amp: 8, period: 4, phase: -1, mirror: 2 },
    // Pulse on every beat.
    { control: 'hips.crouch', wave: 'bounce', amp: -0.03, bias: 0.03, period: 1 },
    { control: 'arms.elbow', wave: 'bounce', amp: 12, period: 1, lag: 0.1 },
    { control: 'head.nod', wave: 'bounce', amp: -5, bias: 5, period: 1, lag: 0.12 },
    { control: 'spine.twist', amp: 6, period: 8 },
  ],
};
