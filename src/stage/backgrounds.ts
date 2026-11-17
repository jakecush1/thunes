/**
 * Background presets: the data the stage renders and the UI lists.
 *
 * Four kinds:
 *   gradient — a screen-aligned vertical gradient (it does not move with the camera),
 *   sky      — a world-anchored procedural sky drawn on a big inverted sphere,
 *   solid    — one flat colour,
 *   place    — a sky plus 3D scenery around the stage (forest, city, desert, ocean);
 *              the scenery itself is built by stage/places.ts.
 * Every preset also carries the colours the rest of the environment derives
 * from it: floor pattern, fog and the tint of the light rig.
 *
 * All colours are '#rrggbb' display (sRGB) values. Backgrounds and the floor
 * pattern are drawn exactly in these colours at exposure 1 (they are graphic
 * elements and bypass tone mapping).
 */
import type { FloorStyle, SceneSettings } from '../types';
import { luminance, mixHex, normalizeHex } from './color';

export type BackgroundKind = 'gradient' | 'sky' | 'solid' | 'place';
export type PlaceKind = 'forest' | 'city' | 'desert' | 'ocean';
export type SkyKind = 'stars' | 'sunset' | 'clouds' | 'aurora';

export interface GradientStop {
  /** 0 = top of the screen … 1 = bottom. */
  at: number;
  color: string;
}

export interface FloorHints {
  /** Grid lines, checker squares and the base tile colour. */
  line: string;
  /** Second colour of the dance-floor tiles. */
  accent: string;
  /** Soft pool of light on the floor around the stage centre (so shadows read on dark backdrops). */
  glow: string;
  /** Peak opacity of the pool, 0..1. */
  glowStrength: number;
  /** Opacity of the dancers' shadows on the floor, 0..1. */
  shadow: number;
  /**
   * Colour the textured floors (grass, concrete, dirt, sand) are multiplied by,
   * so they sit in the backdrop's light. Default: halfway between the fog colour and white.
   */
  tone?: string;
}

export interface LightHints {
  /** Key (shadow-casting) light colour and intensity. */
  key: string;
  keyIntensity: number;
  /** Hemisphere fill: colour from above, colour from below, intensity. */
  fill: string;
  bounce: string;
  fillIntensity: number;
  /** Coloured back light that outlines the dancers. */
  rim: string;
  rimIntensity: number;
  /** Strength of the image-based (reflection) lighting. */
  envIntensity: number;
}

export interface BackgroundPreset {
  id: string;
  name: string;
  kind: BackgroundKind;
  /** CSS `background` value for a preview chip. */
  swatch: string;
  /** Gradient stops top → bottom (one stop for solids; for skies an approximation used only by the swatch). */
  stops: readonly GradientStop[];
  /** Which procedural sky to draw (kinds 'sky' and 'place'). */
  sky?: SkyKind;
  /** 'clouds' sky only: 0 = clear … 1 = overcast. */
  cloudCover?: number;
  /** Which scenery surrounds the stage (kind === 'place'). */
  place?: PlaceKind;
  /** The floor that belongs to this place; the UI switches to it when the place is chosen. */
  naturalFloor?: FloorStyle;
  /** Sky only: colour of the ground below the horizon. */
  ground?: string;
  /** Fog colour = the colour of the horizon. */
  fog: string;
  floor: FloorHints;
  light: LightHints;
}

/** The preset used for unknown ids. */
export const DEFAULT_BACKGROUND_ID = 'club';
/** `scene.background` value meaning "a solid of scene.backgroundColor". */
export const CUSTOM_BACKGROUND_ID = 'custom';

const NEUTRAL_LIGHT: LightHints = {
  key: '#fff6ea',
  keyIntensity: 2.6,
  fill: '#dfe6ff',
  bounce: '#5a5560',
  fillIntensity: 0.75,
  rim: '#ffffff',
  rimIntensity: 3.3,
  envIntensity: 0.4,
};

function cssGradient(stops: readonly GradientStop[]): string {
  if (stops.length === 1) return stops[0]!.color;
  return `linear-gradient(180deg, ${stops.map((s) => `${s.color} ${Math.round(s.at * 100)}%`).join(', ')})`;
}

interface PresetInit {
  id: string;
  name: string;
  kind: BackgroundKind;
  stops: readonly (readonly [number, string])[];
  sky?: SkyKind;
  place?: PlaceKind;
  naturalFloor?: FloorStyle;
  cloudCover?: number;
  ground?: string;
  swatch?: string;
  fog: string;
  floor: FloorHints;
  light?: Partial<LightHints>;
}

function preset(init: PresetInit): BackgroundPreset {
  const stops = init.stops.map(([at, color]) => ({ at, color }));
  return {
    id: init.id,
    name: init.name,
    kind: init.kind,
    swatch: init.swatch ?? cssGradient(stops),
    stops,
    ...(init.sky ? { sky: init.sky } : {}),
    ...(init.place ? { place: init.place } : {}),
    ...(init.naturalFloor ? { naturalFloor: init.naturalFloor } : {}),
    ...(init.cloudCover !== undefined ? { cloudCover: init.cloudCover } : {}),
    ...(init.ground ? { ground: init.ground } : {}),
    fog: init.fog,
    floor: init.floor,
    light: { ...NEUTRAL_LIGHT, ...init.light },
  };
}

export const BACKGROUNDS: readonly BackgroundPreset[] = [
  // ── Screen-aligned gradients ──
  preset({
    // A dim back-room gig: warm haze under red stage light (after The Thunes' show photos).
    id: 'club',
    name: 'Back Room',
    kind: 'gradient',
    stops: [
      [0, '#0b0807'],
      [0.42, '#1d0f0b'],
      [0.64, '#3e1c13'],
      [1, '#150c09'],
    ],
    fog: '#34170f',
    floor: { line: '#b98258', accent: '#f28a2e', glow: '#d9553b', glowStrength: 0.08, shadow: 0.62 },
    light: { key: '#fff0dc', fill: '#c9a184', bounce: '#4a1e14', rim: '#f28a2e', rimIntensity: 4.2, fillIntensity: 0.75 },
  }),
  preset({
    // Late light at the lookout: VHS-blue sky down to a peach and gold horizon (after the "Practice" reel).
    id: 'lookout',
    name: 'Lookout',
    kind: 'gradient',
    stops: [
      [0, '#2c66ad'],
      [0.4, '#7fb0dc'],
      [0.66, '#f0c6a4'],
      [1, '#e9a656'],
    ],
    fog: '#e3b48c',
    floor: { line: '#fff1dc', accent: '#f28a2e', glow: '#ffd29a', glowStrength: 0.1, shadow: 0.4 },
    light: { key: '#fff0d8', fill: '#a9c8e8', bounce: '#c98a5a', rim: '#ffb35c', fillIntensity: 0.9 },
  }),
  preset({
    id: 'peach',
    name: 'Peach Fizz',
    kind: 'gradient',
    stops: [
      [0, '#ffe2b3'],
      [0.55, '#ffa38c'],
      [1, '#ff7193'],
    ],
    fog: '#ffa48d',
    floor: { line: '#fff6ea', accent: '#ffd76a', glow: '#ffffff', glowStrength: 0.12, shadow: 0.34 },
    light: { key: '#fff1dc', fill: '#ffe9d6', bounce: '#ff9a8b', rim: '#ff4f7b', fillIntensity: 0.95 },
  }),
  preset({
    id: 'lagoon',
    name: 'Lagoon',
    kind: 'gradient',
    stops: [
      [0, '#05263d'],
      [0.5, '#0b7c8a'],
      [1, '#6de0c2'],
    ],
    fog: '#0e8a92',
    floor: { line: '#cdfff1', accent: '#ffe66d', glow: '#b8fff0', glowStrength: 0.1, shadow: 0.42 },
    light: { key: '#f2fffb', fill: '#9fe8ff', bounce: '#0f6f78', rim: '#3dffd0', rimIntensity: 3.9 },
  }),
  preset({
    id: 'ember',
    name: 'Ember Room',
    kind: 'gradient',
    stops: [
      [0, '#110304'],
      [0.5, '#5c0d0e'],
      [0.8, '#bf3a18'],
      [1, '#ef762f'],
    ],
    fog: '#8a2012',
    floor: { line: '#ffb884', accent: '#ffd84f', glow: '#ff9a52', glowStrength: 0.12, shadow: 0.5 },
    light: { key: '#ffe6cc', fill: '#ff9c7a', bounce: '#5a1408', rim: '#ff5a1f', rimIntensity: 4.5 },
  }),
  preset({
    id: 'bubblegum',
    name: 'Bubblegum',
    kind: 'gradient',
    stops: [
      [0, '#ff90d9'],
      [0.5, '#b18dff'],
      [1, '#70d4ff'],
    ],
    fog: '#b28eff',
    floor: { line: '#ffffff', accent: '#fff17c', glow: '#ffffff', glowStrength: 0.12, shadow: 0.36 },
    light: { key: '#fff5fb', fill: '#ffd9f4', bounce: '#8fb8ff', rim: '#6ff0ff', fillIntensity: 0.95 },
  }),
  preset({
    id: 'mint',
    name: 'Mint Parlour',
    kind: 'gradient',
    stops: [
      [0, '#f0fff8'],
      [0.6, '#c0f3db'],
      [1, '#88dac3'],
    ],
    fog: '#c6f5df',
    floor: { line: '#2c8c79', accent: '#ff8fab', glow: '#ffffff', glowStrength: 0.14, shadow: 0.3 },
    light: { key: '#fffaf0', fill: '#eafff6', bounce: '#8fd9c4', rim: '#ffffff', fillIntensity: 1 },
  }),
  preset({
    id: 'bluehour',
    name: 'Blue Hour',
    kind: 'gradient',
    stops: [
      [0, '#070b25'],
      [0.42, '#243070'],
      [0.74, '#86508f'],
      [1, '#de8a7b'],
    ],
    fog: '#4a3f86',
    floor: { line: '#ffc6ad', accent: '#7fa9ff', glow: '#ffc0b0', glowStrength: 0.1, shadow: 0.48 },
    light: { key: '#ffe4d6', fill: '#8ea0ff', bounce: '#6a3a66', rim: '#ff8f6b', rimIntensity: 4.2 },
  }),

  // ── World-anchored procedural skies ──
  preset({
    id: 'deepfield',
    name: 'Deep Field',
    kind: 'sky',
    sky: 'stars',
    stops: [
      [0, '#03040c'],
      [1, '#0e1638'],
    ],
    swatch:
      'radial-gradient(circle at 22% 30%, #ffffff 0 1.5px, transparent 2.5px), radial-gradient(circle at 68% 18%, #cfe0ff 0 1.5px, transparent 2.5px), radial-gradient(circle at 48% 62%, #ffffff 0 1px, transparent 2px), radial-gradient(circle at 84% 55%, #ffe9c9 0 1px, transparent 2px), linear-gradient(180deg, #03040c, #0e1638)',
    ground: '#070a1c',
    fog: '#0e1638',
    floor: { line: '#8fb5ff', accent: '#c59dff', glow: '#7f9cff', glowStrength: 0.13, shadow: 0.62 },
    light: { key: '#eaf0ff', fill: '#7f95e6', bounce: '#1c1e40', rim: '#7aa3ff', rimIntensity: 4.5, fillIntensity: 0.65 },
  }),
  preset({
    id: 'lastlight',
    name: 'Last Light',
    kind: 'sky',
    sky: 'sunset',
    stops: [
      [0, '#2a1a5e'],
      [0.55, '#e0567c'],
      [1, '#ffab66'],
    ],
    swatch:
      'radial-gradient(circle at 50% 78%, #fff3c9 0 16%, transparent 17%), linear-gradient(180deg, #2a1a5e, #e0567c 60%, #ffab66)',
    ground: '#4a2440',
    fog: '#f29a62',
    floor: { line: '#ffe2bd', accent: '#ff7a59', glow: '#ffc890', glowStrength: 0.12, shadow: 0.5 },
    light: { key: '#ffd9b0', fill: '#b08ad6', bounce: '#6a3040', rim: '#ff9440', rimIntensity: 6.0, keyIntensity: 2.2 },
  }),
  preset({
    id: 'daydream',
    name: 'Daydream',
    kind: 'sky',
    sky: 'clouds',
    stops: [
      [0, '#3a86d8'],
      [1, '#d6ecff'],
    ],
    swatch:
      'radial-gradient(ellipse at 30% 40%, #ffffff 0 18%, transparent 30%), radial-gradient(ellipse at 72% 58%, #ffffff 0 14%, transparent 26%), linear-gradient(180deg, #3a86d8, #d6ecff)',
    ground: '#9cc4e8',
    fog: '#d6ecff',
    floor: { line: '#ffffff', accent: '#ffb648', glow: '#ffffff', glowStrength: 0.16, shadow: 0.34 },
    light: { key: '#fff3d4', keyIntensity: 3, fill: '#cfe6ff', bounce: '#9fc0dc', rim: '#ffffff', fillIntensity: 1 },
  }),
  preset({
    id: 'polar',
    name: 'Polar Glow',
    kind: 'sky',
    sky: 'aurora',
    stops: [
      [0, '#030814'],
      [0.5, '#0e4a44'],
      [1, '#0b2a2e'],
    ],
    swatch:
      'radial-gradient(ellipse at 40% 45%, rgba(61,255,160,0.75) 0 12%, transparent 45%), radial-gradient(ellipse at 70% 30%, rgba(138,92,255,0.6) 0 10%, transparent 40%), linear-gradient(180deg, #030814, #0b2a2e)',
    ground: '#06181c',
    fog: '#0b2a2e',
    floor: { line: '#74ffc4', accent: '#b58dff', glow: '#5fffc0', glowStrength: 0.1, shadow: 0.6 },
    light: { key: '#e8fff6', fill: '#5fd6b0', bounce: '#0f2a30', rim: '#58ffb0', rimIntensity: 4.5, fillIntensity: 0.65 },
  }),

  // ── Solids ──
  preset({
    id: 'white',
    name: 'Paper White',
    kind: 'solid',
    stops: [[0, '#ffffff']],
    fog: '#ffffff',
    floor: { line: '#8e959e', accent: '#4f8dff', glow: '#ffffff', glowStrength: 0, shadow: 0.3 },
    light: { key: '#fff8ee', fill: '#ffffff', bounce: '#d8d8d8', rim: '#cfdcff', fillIntensity: 1.05, rimIntensity: 2.4 },
  }),
  preset({
    id: 'black',
    name: 'Blackout',
    kind: 'solid',
    stops: [[0, '#000000']],
    fog: '#000000',
    floor: { line: '#f0f0f0', accent: '#ff3d81', glow: '#ffffff', glowStrength: 0.11, shadow: 0.75 },
    light: { key: '#ffffff', fill: '#b9c4e6', bounce: '#202024', rim: '#6aa8ff', rimIntensity: 4.8, fillIntensity: 0.55 },
  }),
  preset({
    id: 'studio',
    name: 'Studio Grey',
    kind: 'solid',
    stops: [[0, '#84878c']],
    fog: '#84878c',
    floor: { line: '#eceef1', accent: '#ffcf5c', glow: '#ffffff', glowStrength: 0.12, shadow: 0.42 },
    light: { key: '#fff7ec', fill: '#eef2ff', bounce: '#6c6e72', rim: '#ffffff', fillIntensity: 0.9 },
  }),
  // ── Places: a sky plus 3D scenery (see stage/places.ts) ──
  preset({
    id: 'forest',
    name: 'Forest',
    kind: 'place',
    place: 'forest',
    sky: 'clouds',
    cloudCover: 0.62,
    naturalFloor: 'grass',
    stops: [
      [0, '#6fb0e6'],
      [1, '#4f8a2b'],
    ],
    swatch:
      'radial-gradient(circle at 24% 50%, #2f6b2a 0 17%, transparent 18%), radial-gradient(circle at 58% 44%, #3d7d33 0 21%, transparent 22%), radial-gradient(circle at 86% 52%, #2f6b2a 0 15%, transparent 16%), linear-gradient(180deg, #7fb6e6 0 56%, #5f9a3a 56%)',
    ground: '#55893a',
    fog: '#cfe3c4',
    floor: { line: '#ffffff', accent: '#ffd76a', glow: '#ffffff', glowStrength: 0, shadow: 0.42, tone: '#ffffff' },
    light: { key: '#fff2d2', keyIntensity: 2.9, fill: '#d4ecc4', bounce: '#4c6a2c', rim: '#f4ffd8', fillIntensity: 0.95 },
  }),
  preset({
    id: 'city',
    name: 'City',
    kind: 'place',
    place: 'city',
    sky: 'sunset',
    naturalFloor: 'concrete',
    stops: [
      [0, '#3a2468'],
      [1, '#ffab66'],
    ],
    swatch:
      'linear-gradient(#4a4046, #4a4046) 12% 100% / 20% 72% no-repeat, linear-gradient(#5d5055, #5d5055) 46% 100% / 17% 50% no-repeat, linear-gradient(#3f363c, #3f363c) 84% 100% / 24% 62% no-repeat, linear-gradient(180deg, #3a2468, #e0567c 55%, #ffab66)',
    ground: '#8a6a66',
    fog: '#f29a62',
    floor: { line: '#ffe2bd', accent: '#ff7a59', glow: '#ffc890', glowStrength: 0, shadow: 0.5, tone: '#f3cdb6' },
    light: { key: '#ffd9b0', fill: '#b08ad6', bounce: '#6a3040', rim: '#ff9440', rimIntensity: 6.0, keyIntensity: 2.2 },
  }),
  preset({
    id: 'desert',
    name: 'Desert',
    kind: 'place',
    place: 'desert',
    sky: 'clouds',
    cloudCover: 0.3,
    naturalFloor: 'sand',
    stops: [
      [0, '#5fa3df'],
      [1, '#d9b879'],
    ],
    swatch:
      'radial-gradient(ellipse at 28% 100%, #d9b879 0 46%, transparent 47%), radial-gradient(ellipse at 80% 100%, #c79f60 0 40%, transparent 41%), linear-gradient(180deg, #5fa3df, #f1dcb2 72%)',
    ground: '#d6b577',
    fog: '#ecd9b4',
    floor: { line: '#ffffff', accent: '#f28a2e', glow: '#ffffff', glowStrength: 0, shadow: 0.45, tone: '#ffffff' },
    light: { key: '#fff0d0', keyIntensity: 3.1, fill: '#f3e2c0', bounce: '#c9a66a', rim: '#fff4dc', fillIntensity: 0.95 },
  }),
  preset({
    id: 'ocean',
    name: 'Ocean',
    kind: 'place',
    place: 'ocean',
    sky: 'clouds',
    cloudCover: 0.45,
    stops: [
      [0, '#5fa3df'],
      [1, '#1f6f93'],
    ],
    swatch:
      'linear-gradient(115deg, transparent 0 48%, #f3e9d2 49% 66%, transparent 67%) 50% 26% / 44% 46% no-repeat, linear-gradient(#b8452f, #b8452f) 50% 64% / 46% 9% no-repeat, linear-gradient(180deg, #7fb6e6 0 60%, #1f6f93 60%)',
    ground: '#2f6f93',
    fog: '#cfe6f3',
    floor: { line: '#ffffff', accent: '#f28a2e', glow: '#ffffff', glowStrength: 0, shadow: 0.45, tone: '#ffffff' },
    light: { key: '#fff4dc', keyIntensity: 3.0, fill: '#cfe6ff', bounce: '#7fb0cc', rim: '#ffffff', fillIntensity: 1 },
  }),
];

const BY_ID: ReadonlyMap<string, BackgroundPreset> = new Map(BACKGROUNDS.map((p) => [p.id, p]));

/** Preset by id; unknown ids give the default ('club'). */
export function getBackground(id: string): BackgroundPreset {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_BACKGROUND_ID)!;
}

/**
 * A solid backdrop of any colour with a floor and light rig derived from it:
 * light colours get dark floor lines and gentle shadows, dark colours get
 * light lines and a pool of light on the floor.
 */
export function customBackground(color: string): BackgroundPreset {
  const base = normalizeHex(color);
  const lum = luminance(base);
  const light = lum > 0.35;
  return preset({
    id: CUSTOM_BACKGROUND_ID,
    name: 'Custom',
    kind: 'solid',
    stops: [[0, base]],
    fog: base,
    floor: {
      line: light ? mixHex(base, '#000000', 0.45) : mixHex(base, '#ffffff', 0.8),
      accent: light ? mixHex(base, '#3355ff', 0.6) : mixHex(base, '#ff5fa8', 0.75),
      glow: '#ffffff',
      glowStrength: lum > 0.8 ? 0 : 0.12,
      shadow: light ? 0.34 : 0.62,
    },
    light: {
      fill: mixHex(base, '#ffffff', 0.7),
      bounce: mixHex(base, '#404040', 0.5),
      rim: light ? '#ffffff' : mixHex(base, '#ffffff', 0.55),
      fillIntensity: light ? 0.95 : 0.65,
      rimIntensity: light ? 2 : 3,
    },
  });
}

let cachedCustom: BackgroundPreset | null = null;
let cachedCustomColor = '';

/**
 * The preset a scene shows: the named preset, a derived solid when
 * `background === 'custom'`, or the default for unknown ids. Results are
 * cached, so the same settings give the same object (cheap to diff by reference).
 */
export function resolveBackground(scene: Pick<SceneSettings, 'background' | 'backgroundColor'>): BackgroundPreset {
  if (scene.background === CUSTOM_BACKGROUND_ID) {
    if (!cachedCustom || cachedCustomColor !== scene.backgroundColor) {
      cachedCustom = customBackground(scene.backgroundColor);
      cachedCustomColor = scene.backgroundColor;
    }
    return cachedCustom;
  }
  return getBackground(scene.background);
}
