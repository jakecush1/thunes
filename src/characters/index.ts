/**
 * The built-in placeholder characters, generated in code.
 *
 * Each is a CharacterDef with a `procedural` spec; `createProceduralCharacter`
 * turns a def into a CharacterAsset. 'builtin:mannequin' is the app-wide
 * fallback (config.FALLBACK_CHARACTER_ID) and must always exist.
 */
import type { CharacterDef } from '../types';

export { createProceduralCharacter, resolveProportions } from './procedural';
export type { ProceduralCharacterAsset } from './procedural';
export { CHARACTER_STYLES } from './spec';
export type { CharacterPalette, CharacterStyle, CharacterStyleOptions, ProceduralCharacterSpec } from './spec';

export const BUILTIN_CHARACTERS: CharacterDef[] = [
  { id: 'builtin:mannequin', source: 'builtin', category: 'Placeholders', name: 'Mannequin', procedural: { style: 'mannequin' } },
  { id: 'builtin:robot', source: 'builtin', category: 'Placeholders', name: 'Bolt', procedural: { style: 'robot' } },
  { id: 'builtin:toy', source: 'builtin', category: 'Placeholders', name: 'Mochi', procedural: { style: 'toy' } },
  { id: 'builtin:stick', source: 'builtin', category: 'Placeholders', name: 'Doodle', procedural: { style: 'stick' } },
  { id: 'builtin:voxel', source: 'builtin', category: 'Placeholders', name: 'Cubby', procedural: { style: 'voxel' } },
  { id: 'builtin:lanky', source: 'builtin', category: 'Placeholders', name: 'Stretch', procedural: { style: 'lanky' } },
];
