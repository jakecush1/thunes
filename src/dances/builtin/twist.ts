import type { DanceScheme } from '../scheme';

/** Swivel on the balls of the feet: hips and knees one way, shoulders and arms the other, sinking low and coming back up. */
export const twist: DanceScheme = {
  format: 'thunes-dance@1',
  beats: 4,
  bpm: 120,
  description: 'Swivel on the balls of the feet with hips against shoulders, sinking down and rising over four beats.',
  base: {
    'hips.crouch': 0.045,
    'hips.forward': -0.03,
    'hips.tilt': 8,
    'feet.side': 0.04,
    'feet.pitch': -14,
    'spine.lean': 13,
    'head.level': 0.9,
    'arms.raise': 26,
    'arms.elbow': 88,
    'arms.twist': -6,
  },
  tracks: [
    { control: 'hips.crouch', keys: [[0, 0], [2, 0.09], [3.3, 0.015]] },
    { control: 'spine.lean', keys: [[0, 0], [2, 9], [3.3, 1]] },
    { control: 'arms.raise', keys: [[0, 0], [2, 10], [3.3, 0]], lag: 0.1 },
  ],
  oscillators: [
    // Toes swing left on even beats and right on odd beats; the pelvis goes with them.
    { control: 'leftFoot.turn', amp: 32, period: 2, phase: -0.5, mirror: 1 },
    { control: 'hips.yaw', amp: 22, period: 2, phase: -0.5 },
    { control: 'hips.shift', amp: -0.03, period: 2, phase: -0.5 },
    // The chest and arms go the other way, a touch late.
    { control: 'spine.twist', amp: -40, period: 2, phase: -0.42 },
    { control: 'leftArm.swing', amp: 30, period: 2, phase: -0.36, mirror: 1 },
    { control: 'leftArm.elbow', amp: 14, period: 2, phase: -0.25, mirror: 1 },
    { control: 'spine.side', amp: 6, period: 4 },
    { control: 'head.tilt', amp: 5, period: 4, phase: 0.3 },
    { control: 'head.nod', wave: 'bounce', amp: -5, bias: 5, period: 1, phase: 0.1 },
    { control: 'hips.crouch', wave: 'bounce', amp: -0.02, bias: 0.02, period: 1 },
  ],
};
