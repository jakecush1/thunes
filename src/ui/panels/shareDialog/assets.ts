/** Pure helpers for the share dialog: which uploaded assets a scene uses, and link length text. */
import type { SceneDocument } from '../../../types';

export const UPLOAD_PREFIX = 'upload:';

export interface UploadedRefs {
  characters: string[];
  dances: string[];
  songs: string[];
}

/** Ids of uploaded (device-only) characters, dances and the song a document refers to, without duplicates. */
export function findUploadedAssets(doc: Pick<SceneDocument, 'dancers' | 'audio'>): UploadedRefs {
  const characters = new Set<string>();
  const dances = new Set<string>();
  for (const d of doc.dancers) {
    if (d.characterId.startsWith(UPLOAD_PREFIX)) characters.add(d.characterId);
    if (d.danceId.startsWith(UPLOAD_PREFIX)) dances.add(d.danceId);
  }
  const songs = doc.audio.songId?.startsWith(UPLOAD_PREFIX) ? [doc.audio.songId] : [];
  return { characters: [...characters], dances: [...dances], songs };
}

export function hasUploads(refs: UploadedRefs): boolean {
  return refs.characters.length + refs.dances.length + refs.songs.length > 0;
}

/** "1,234 characters" with a note for links some apps may cut short. */
export function describeLinkLength(length: number): { text: string; long: boolean } {
  const text = `${length.toLocaleString('en-US')} characters`;
  const long = length > 2000;
  return { text: long ? `${text} · long links can be cut short by some apps` : text, long };
}

/** Sentence explaining the upload fallback, naming what is affected. */
export function uploadWarning(names: { characters: string[]; dances: string[]; songs: string[] }): string {
  const parts: string[] = [];
  const list = (items: string[], one: string, many: string) => {
    if (items.length === 0) return;
    const quoted = items.map((n) => `“${n}”`);
    const joined = quoted.length === 1 ? quoted[0]! : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
    parts.push(`the ${items.length === 1 ? one : many} ${joined}`);
  };
  list(names.characters, 'character', 'characters');
  list(names.dances, 'dance', 'dances');
  list(names.songs, 'song', 'songs');
  const what = parts.length <= 1 ? (parts[0] ?? 'some files') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `This scene uses ${what} you added on this device. They are not part of the link, so other people see stand-ins instead.`;
}
