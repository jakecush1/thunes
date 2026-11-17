/**
 * App-wide constants: the single source of truth for names, limits, slider
 * ranges and default values. The store clamps to these ranges, the UI builds
 * its sliders from them, and the serializer omits values equal to the defaults.
 */

import type { AudioSettings, CameraPose, DancerSettings, SceneSettings, UiState } from './types';

export const APP_NAME = 'Thunes';
export const APP_TAGLINE = 'Build a crew. Pick a beat. Let them dance.';

/** The band behind the app: its logo is the app's brand mark. */
export const BAND = {
  name: 'The Thunes',
  website: 'https://www.thethunes.com/home',
  websiteLabel: 'thethunes.com',
  instagram: 'https://www.instagram.com/the.thunes/',
  instagramHandle: '@the.thunes',
} as const;

/** Maximum number of dancers on stage at once. */
export const MAX_DANCERS = 8;

/** Dancers can be placed within this distance (metres) of the stage centre. */
export const STAGE_RADIUS = 6;

/** Every character is scaled to this height (metres) unless its definition says otherwise. */
export const CHARACTER_HEIGHT = 1.75;

/** Tempo used by the beat clock when no song is playing. */
export const DEFAULT_BPM = 120;

/** Seconds over which a dancer blends from one dance to the next. */
export const DANCE_CROSSFADE = 0.35;

/** Undo history depth. */
export const HISTORY_LIMIT = 100;

/** Shortest loop a dancer may be trimmed to, as a fraction of the clip. */
export const MIN_TRIM_SPAN = 0.05;

/** Ids that are guaranteed to exist in the registry (used when a saved scene references a missing asset). */
export const FALLBACK_CHARACTER_ID = 'builtin:mannequin';
export const FALLBACK_DANCE_ID = 'builtin:groove';

export interface NumberField {
  min: number;
  max: number;
  step: number;
  default: number;
  /** Display unit, e.g. '°', 'm', '×', 's', '%'. */
  unit?: string;
  /** Digits shown after the decimal point. */
  digits?: number;
}

/** Numeric per-dancer settings. */
export const DANCER_FIELDS = {
  x: { min: -STAGE_RADIUS, max: STAGE_RADIUS, step: 0.01, default: 0, unit: 'm', digits: 2 },
  z: { min: -STAGE_RADIUS, max: STAGE_RADIUS, step: 0.01, default: 0, unit: 'm', digits: 2 },
  y: { min: -1, max: 5, step: 0.01, default: 0, unit: 'm', digits: 2 },
  rotation: { min: -180, max: 180, step: 1, default: 0, unit: '°', digits: 0 },
  scale: { min: 0.25, max: 4, step: 0.01, default: 1, unit: '×', digits: 2 },

  speed: { min: 0, max: 3, step: 0.01, default: 1, unit: '×', digits: 2 },
  offset: { min: 0, max: 1, step: 0.01, default: 0, unit: '', digits: 2 },
  trimStart: { min: 0, max: 1 - MIN_TRIM_SPAN, step: 0.01, default: 0, unit: '', digits: 2 },
  trimEnd: { min: MIN_TRIM_SPAN, max: 1, step: 0.01, default: 1, unit: '', digits: 2 },

  headSize: { min: 0.25, max: 3, step: 0.01, default: 1, unit: '×', digits: 2 },
  handSize: { min: 0.25, max: 3, step: 0.01, default: 1, unit: '×', digits: 2 },
  footSize: { min: 0.25, max: 3, step: 0.01, default: 1, unit: '×', digits: 2 },
  shakeBody: { min: 0, max: 1, step: 0.01, default: 0, unit: '', digits: 2 },
  shakeArms: { min: 0, max: 1, step: 0.01, default: 0, unit: '', digits: 2 },
  shakeNeck: { min: 0, max: 1, step: 0.01, default: 0, unit: '', digits: 2 },
  shakeSpeed: { min: 0.25, max: 4, step: 0.01, default: 1, unit: '×', digits: 2 },

  warpAmount: { min: 0, max: 1, step: 0.01, default: 0, unit: '', digits: 2 },
  warpSpeed: { min: 0, max: 4, step: 0.01, default: 1, unit: '×', digits: 2 },
  warpWaves: { min: 0.5, max: 12, step: 0.1, default: 3, unit: '', digits: 1 },
} as const satisfies Record<string, NumberField>;

/**
 * Material overrides. In the state these are `number | null`; null means
 * "leave the character's own material alone". `default` is where the slider
 * starts when the override is first switched on.
 */
export const DANCER_LOOK_FIELDS = {
  shine: { min: 0, max: 1, step: 0.01, default: 0.5, unit: '', digits: 2 },
  metal: { min: 0, max: 1, step: 0.01, default: 0, unit: '', digits: 2 },
} as const satisfies Record<string, NumberField>;

/** Numeric scene settings. */
export const SCENE_FIELDS = {
  brightness: { min: 0, max: 2, step: 0.01, default: 1, unit: '×', digits: 2 },
  exposure: { min: 0.2, max: 2.5, step: 0.01, default: 1, unit: '×', digits: 2 },
  fog: { min: 0, max: 1, step: 0.01, default: 0.2, unit: '', digits: 2 },
  strobeIntensity: { min: 0, max: 1, step: 0.01, default: 0, unit: '', digits: 2 },
  strobeBpm: { min: 30, max: 180, step: 1, default: 120, unit: 'bpm', digits: 0 },
  cameraLoopPeriod: { min: 4, max: 120, step: 1, default: 24, unit: 's', digits: 0 },
  cameraLoopHeight: { min: 0.2, max: 12, step: 0.1, default: 2.2, unit: 'm', digits: 1 },
  cameraLoopTargetHeight: { min: 0, max: 4, step: 0.1, default: 1, unit: 'm', digits: 1 },
  cameraLoopDistance: { min: 2, max: 30, step: 0.1, default: 8, unit: 'm', digits: 1 },
} as const satisfies Record<string, NumberField>;

export const AUDIO_FIELDS = {
  volume: { min: 0, max: 1, step: 0.01, default: 0.8, unit: '', digits: 2 },
} as const satisfies Record<string, NumberField>;

/** Camera distance limits for free orbiting (metres). */
export const CAMERA_LIMITS = { minDistance: 1.5, maxDistance: 40, fov: 45, near: 0.1, far: 400 } as const;

export const DEFAULT_CAMERA: CameraPose = { position: [0, 1.9, 7.5], target: [0, 1, 0] };

/** Everything about a dancer except its identity and which character/dance it uses. */
export const DANCER_DEFAULTS: DancerSettings = {
  x: DANCER_FIELDS.x.default,
  z: DANCER_FIELDS.z.default,
  y: DANCER_FIELDS.y.default,
  rotation: DANCER_FIELDS.rotation.default,
  scale: DANCER_FIELDS.scale.default,
  speed: DANCER_FIELDS.speed.default,
  offset: DANCER_FIELDS.offset.default,
  trimStart: DANCER_FIELDS.trimStart.default,
  trimEnd: DANCER_FIELDS.trimEnd.default,
  mirror: false,
  shine: null,
  metal: null,
  tint: null,
  headSize: DANCER_FIELDS.headSize.default,
  handSize: DANCER_FIELDS.handSize.default,
  footSize: DANCER_FIELDS.footSize.default,
  shakeBody: DANCER_FIELDS.shakeBody.default,
  shakeArms: DANCER_FIELDS.shakeArms.default,
  shakeNeck: DANCER_FIELDS.shakeNeck.default,
  shakeSpeed: DANCER_FIELDS.shakeSpeed.default,
  warpAmount: DANCER_FIELDS.warpAmount.default,
  warpSpeed: DANCER_FIELDS.warpSpeed.default,
  warpWaves: DANCER_FIELDS.warpWaves.default,
  warpMode: 'wave',
  warpAlong: 'y',
  warpEffect: 'x',
};

export const SCENE_DEFAULTS: SceneSettings = {
  background: 'club',
  backgroundColor: '#14121f',
  floorStyle: 'grid',
  floorColor: null,
  brightness: SCENE_FIELDS.brightness.default,
  exposure: SCENE_FIELDS.exposure.default,
  fog: SCENE_FIELDS.fog.default,
  strobeIntensity: SCENE_FIELDS.strobeIntensity.default,
  strobeBpm: SCENE_FIELDS.strobeBpm.default,
  strobeSync: true,
  strobeDivision: 1,
  cameraLoop: false,
  cameraLoopPeriod: SCENE_FIELDS.cameraLoopPeriod.default,
  cameraLoopHeight: SCENE_FIELDS.cameraLoopHeight.default,
  cameraLoopTargetHeight: SCENE_FIELDS.cameraLoopTargetHeight.default,
  cameraLoopDistance: SCENE_FIELDS.cameraLoopDistance.default,
};

export const AUDIO_DEFAULTS: AudioSettings = {
  songId: 'builtin:night-drive',
  muted: false,
  volume: AUDIO_FIELDS.volume.default,
  beatSync: true,
};

export const UI_DEFAULTS: UiState = {
  selectedId: null,
  mode: 'both',
  quality: 'medium',
  uiHidden: false,
  entered: false,
  strobeAllowed: false,
  viewOnly: false,
};
