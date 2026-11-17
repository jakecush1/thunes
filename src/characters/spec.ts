/**
 * Parameters for a code-built placeholder character on the canonical skeleton.
 *
 * A spec is plain JSON: it can live in a CharacterDef, in a saved scene or in a
 * test. `createProceduralCharacter` (procedural.ts) turns it into geometry.
 */
import type { HumanoidProportions } from '../rig/canonical';

/**
 * The body styles the generator knows:
 *   mannequin — smooth artist's mannequin with visible ball joints (the neutral default)
 *   robot     — boxy retro robot, glowing visor and antenna
 *   toy       — chunky rounded toy, big head, short limbs
 *   stick     — 3D stick figure, thin limbs, round head
 *   voxel     — blocky figure built from cubes, flat shaded
 *   lanky     — tall long-limbed figure with a small one-eyed head
 */
export type CharacterStyle = 'mannequin' | 'robot' | 'toy' | 'stick' | 'voxel' | 'lanky';

export const CHARACTER_STYLES: readonly CharacterStyle[] = ['mannequin', 'robot', 'toy', 'stick', 'voxel', 'lanky'];

/**
 * Colours as '#rrggbb'. Each style reads the roles it needs and has its own
 * defaults, so a spec only lists what it wants to change.
 */
export interface CharacterPalette {
  /** Main body colour. */
  primary: string;
  /** Second body colour (belly, trousers, forearms… depends on the style). */
  secondary: string;
  /** Small highlights: joints, gloves, shoes, bow tie. */
  accent: string;
  /** Eyes and other dark facial marks. */
  dark: string;
  /** Eye whites, teeth, highlights. */
  light: string;
  /** Skin or face plate, where the style has one. */
  skin: string;
  /** Hair or head trim, where the style has one. */
  hair: string;
  /** Emissive details (visor, antenna tip, chest light). */
  glow: string;
}

/** Surface and detail switches. All optional; every style has defaults. */
export interface CharacterStyleOptions {
  /** Base roughness of the body material, 0 (glossy) … 1 (matte). */
  roughness?: number;
  /** Base metalness of the body material, 0 … 1. */
  metalness?: number;
  /** Emissive strength of glowing details (styles without glow ignore it). */
  glowIntensity?: number;
  /** Multiplier on limb and torso thickness, 1 = the style's own build. */
  bulk?: number;
}

export interface ProceduralCharacterSpec {
  /** Which body style to build. */
  style: CharacterStyle;
  /**
   * Overrides on the style's own proportions (authoring units, see
   * HumanoidProportions). `height` here is ignored: the character's height
   * comes from CharacterDef.height.
   */
  proportions?: Partial<HumanoidProportions>;
  /** Overrides on the style's own colours. */
  palette?: Partial<CharacterPalette>;
  options?: CharacterStyleOptions;
}
