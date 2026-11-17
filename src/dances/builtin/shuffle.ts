import type { DanceScheme } from '../scheme';

/** Running on the spot with a slide: one foot lands in front while the other slides back, then the back knee lifts through. */
export const shuffle: DanceScheme = {
  format: 'thunes-dance@1',
  beats: 4,
  bpm: 120,
  description: 'A sliding run on the spot: the front foot slides back as the other knee lifts and lands in front.',
  base: {
    'hips.crouch': 0.022,
    'hips.tilt': 7,
    'spine.lean': 11,
    'head.level': 0.6,
    'arms.raise': 12,
    'arms.elbow': 85,
    'arms.twist': -8,
  },
  tracks: [
    // Left foot: lands in front on 0, slides back through the centre to behind by 1, then lifts through to land again on 2.
    { control: 'leftFoot.forward', repeat: 2, mirror: 1, keys: [[0, 0.2, 'out'], [0.5, 0.02, 'linear'], [1, -0.17, 'linear'], [1.5, 0.03, 'inOut']] },
    { control: 'leftFoot.up', repeat: 2, mirror: 1, keys: [[0, 0, 'in'], [1, 0], [1.5, 0.2, 'out']] },
    { control: 'leftFoot.pitch', repeat: 2, mirror: 1, keys: [[0, 6, 'out'], [0.3, 0], [1, -26, 'inOut'], [1.5, -18]] },
  ],
  oscillators: [
    // Arms pump like a runner's, opposite the legs.
    { control: 'leftArm.swing', amp: 36, period: 2, phase: 0.5, mirror: 1 },
    { control: 'leftArm.elbow', amp: -14, period: 2, phase: 0.6, mirror: 1 },
    { control: 'spine.twist', amp: -10, period: 2, phase: 0.5 },
    { control: 'hips.yaw', amp: 7, period: 2, phase: 0.5 },
    { control: 'hips.crouch', wave: 'bounce', amp: -0.024, bias: 0.024, period: 1 },
    { control: 'spine.lean', wave: 'bounce', amp: -4, bias: 4, period: 1, phase: 0.1 },
    { control: 'head.nod', wave: 'bounce', amp: -6, bias: 6, period: 1, phase: 0.2 },
    { control: 'hips.shift', amp: 0.025, period: 2, phase: 0.5 },
    { control: 'spine.side', amp: 4, period: 4 },
    { control: 'arms.shrug', wave: 'bounce', amp: 5, period: 1 },
  ],
  smooth: { 'feet.forward': 0.15, 'feet.up': 0.15, 'feet.pitch': 0.2 },
};
