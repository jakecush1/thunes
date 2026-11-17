/**
 * Drop-in library files (public/assets/…), as listed by the Vite plugin
 * (scripts/vite/thunes-assets.ts), turned into catalogue definitions.
 *
 * Everything here is pure and runs in Node and in the browser.
 */
import type { SongPattern } from '../audio/pattern';
import { validateScheme } from '../dances/scheme';
import type { CharacterDef, DanceDef, ModelFormat, SongDef } from '../types';
import { AUDIO_EXTENSIONS } from './formats';
import { validateSongPattern } from './songPattern';

/** Optional metadata from a "<file name>.meta.json" sidecar. Every field is optional and validated before use. */
export interface AssetMeta {
  /** Display name of a character or dance. */
  name?: string;
  /** Picker group. */
  category?: string;
  /** Character height in metres (0.3 – 5). */
  height?: number;
  /** Tempo of a dance or song (30 – 300). */
  bpm?: number;
  /** Loop length of a dance in beats. */
  beats?: number;
  /** Keep a dance on its spot. */
  inPlace?: boolean;
  /** Which animation clip of a dance file to use (name or index). */
  clip?: string | number;
  /** Song title. */
  title?: string;
  artist?: string;
  /** Short mood/genre label of a song. */
  vibe?: string;
}

/** One file found under public/assets. */
export interface DiscoveredFile {
  /** Path relative to public/assets, POSIX separators, e.g. "dances/hip_hop-01.fbx". */
  file: string;
  /** Public URL (honours Vite's `base`). */
  url: string;
  /** Lower-case extension without the dot. */
  ext: string;
  /** Bytes. */
  size: number;
  /** Raw content of the sidecar, if there is a readable one. */
  meta?: unknown;
  /** Animation clip names of a .glb/.gltf dance file ('' for unnamed clips). */
  clips?: string[];
  /** Parsed content of a .json file (dance scheme or song pattern). */
  json?: unknown;
}

/** What the virtual module 'virtual:thunes-assets' exports. */
export interface DiscoveredAssets {
  characters: DiscoveredFile[];
  dances: DiscoveredFile[];
  music: DiscoveredFile[];
}

/** Catalogue entries derived from the library files, plus readable reasons for files that were skipped. */
export interface LibraryDefs {
  characters: CharacterDef[];
  dances: DanceDef[];
  songs: SongDef[];
  problems: { file: string; reason: string }[];
}

export { AUDIO_EXTENSIONS, CHARACTER_EXTENSIONS, DANCE_EXTENSIONS, MUSIC_EXTENSIONS } from './formats';

/** Limits applied to metadata. */
export const META_LIMITS = {
  bpm: [30, 300],
  height: [0.3, 5],
  beats: [0.25, 4096],
  name: 80,
  category: 40,
  artist: 80,
  vibe: 40,
  clip: 120,
} as const;

const MAX_SLUG = 80;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed.slice(0, max).trim() : undefined;
}

function numberIn(value: unknown, [min, max]: readonly [number, number]): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

/**
 * Keeps only the well-formed fields of a sidecar (or any untrusted metadata):
 * numbers inside their ranges, trimmed strings cut to their length limits.
 * Anything else is dropped silently.
 */
export function sanitizeMeta(raw: unknown): AssetMeta {
  const meta: AssetMeta = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return meta;
  const source = raw as Record<string, unknown>;
  const set = <K extends keyof AssetMeta>(key: K, value: AssetMeta[K] | undefined): void => {
    if (value !== undefined) meta[key] = value;
  };
  set('name', text(source.name, META_LIMITS.name));
  set('category', text(source.category, META_LIMITS.category));
  set('height', numberIn(source.height, META_LIMITS.height));
  set('bpm', numberIn(source.bpm, META_LIMITS.bpm));
  set('beats', numberIn(source.beats, META_LIMITS.beats));
  if (typeof source.inPlace === 'boolean') meta.inPlace = source.inPlace;
  if (typeof source.clip === 'number') {
    if (Number.isInteger(source.clip) && source.clip >= 0 && source.clip < 10000) meta.clip = source.clip;
  } else set('clip', text(source.clip, META_LIMITS.clip));
  set('title', text(source.title, META_LIMITS.name));
  set('artist', text(source.artist, META_LIMITS.artist));
  set('vibe', text(source.vibe, META_LIMITS.vibe));
  return meta;
}

/** Lower-case slug: runs of anything but a–z and 0–9 become '-', no leading or trailing '-', at most `max` characters. */
export function slugify(input: string, max = MAX_SLUG): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, max).replace(/-+$/g, '');
}

/** "dances/hip_hop-01.fbx" → "Hip Hop 01": the file's base name without extension, separators as spaces, words capitalised. */
export function prettifyName(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? file;
  const stem = base.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const words = stem
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (words === '') return 'Untitled';
  return words
    .split(' ')
    .map((word) => (/^[a-z]/.test(word) ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ')
    .slice(0, META_LIMITS.name)
    .trim();
}

/** Path relative to the kind folder, without the extension: "dances/street/hip_hop-01.fbx" → "street/hip_hop-01". */
function stemOf(file: string): string {
  const inner = file.replace(/^[^/]+\//, '');
  return inner.replace(/\.[A-Za-z0-9]{1,5}$/, '');
}

/** Hands out unique slugs: the first taker gets the plain slug, later ones a numeric suffix. */
function slugAllocator(): (wanted: string) => string {
  const used = new Set<string>();
  return (wanted) => {
    const base = wanted === '' ? 'asset' : wanted;
    let slug = base;
    for (let n = 2; used.has(slug); n++) {
      const suffix = `-${n}`;
      slug = base.slice(0, MAX_SLUG - suffix.length).replace(/-+$/g, '') + suffix;
    }
    used.add(slug);
    return slug;
  };
}

function sortedByFile(list: readonly DiscoveredFile[]): DiscoveredFile[] {
  return [...list].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

function modelFormat(ext: string): ModelFormat | undefined {
  return ext === 'glb' || ext === 'gltf' || ext === 'fbx' || ext === 'bvh' ? ext : undefined;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Turns the discovered files into catalogue definitions.
 *
 * Ids are 'library:<slug>' where the slug comes from the path inside the kind
 * folder without the extension ("dances/Street/Hip Hop.fbx" → 'library:street-hip-hop').
 * Files are processed in path order, so ids are stable as long as the files
 * are; two files that would collide get '-2', '-3' … in that order. A dance
 * file with several clips yields one dance per clip ('library:<slug>.<clip slug>')
 * unless its sidecar picks one with `clip`.
 */
export function discoveredToDefs(list: Partial<DiscoveredAssets>): LibraryDefs {
  const out: LibraryDefs = { characters: [], dances: [], songs: [], problems: [] };

  // — Characters —
  const characterSlug = slugAllocator();
  for (const entry of sortedByFile(list.characters ?? [])) {
    const format = modelFormat(entry.ext);
    if (!format || format === 'bvh') {
      out.problems.push({ file: entry.file, reason: `".${entry.ext}" files cannot be used as characters (use .glb, .gltf or .fbx).` });
      continue;
    }
    const meta = sanitizeMeta(entry.meta);
    const def: CharacterDef = {
      id: `library:${characterSlug(slugify(stemOf(entry.file)))}`,
      source: 'library',
      name: meta.name ?? prettifyName(entry.file),
      url: entry.url,
      format,
    };
    if (meta.category) def.category = meta.category;
    if (meta.height !== undefined) def.height = meta.height;
    out.characters.push(def);
  }

  // — Dances —
  const danceSlug = slugAllocator();
  for (const entry of sortedByFile(list.dances ?? [])) {
    const meta = sanitizeMeta(entry.meta);
    const slug = danceSlug(slugify(stemOf(entry.file)));
    const base: DanceDef = { id: `library:${slug}`, source: 'library', name: meta.name ?? prettifyName(entry.file) };
    if (meta.category) base.category = meta.category;
    if (meta.inPlace !== undefined) base.inPlace = meta.inPlace;

    if (entry.ext === 'json') {
      try {
        const scheme = validateScheme(entry.json);
        out.dances.push({ ...base, scheme, bpm: meta.bpm ?? scheme.bpm, beats: meta.beats ?? scheme.beats });
      } catch (error) {
        out.problems.push({ file: entry.file, reason: `Not a usable dance scheme: ${reasonOf(error)}` });
      }
      continue;
    }
    const format = modelFormat(entry.ext);
    if (!format) {
      out.problems.push({ file: entry.file, reason: `".${entry.ext}" files cannot be used as dances.` });
      continue;
    }
    base.url = entry.url;
    base.format = format;
    if (meta.bpm !== undefined) base.bpm = meta.bpm;
    if (meta.beats !== undefined) base.beats = meta.beats;

    const clips = entry.clips;
    if (clips && clips.length === 0) {
      out.problems.push({ file: entry.file, reason: 'The file contains no animation clips.' });
      continue;
    }
    if (meta.clip !== undefined || !clips || clips.length === 1) {
      if (meta.clip !== undefined) base.clip = meta.clip;
      out.dances.push(base);
      continue;
    }
    // One dance per clip.
    const clipSlug = slugAllocator();
    clips.forEach((clipName, index) => {
      const label = text(clipName, META_LIMITS.clip);
      const suffix = clipSlug(slugify(label ?? '', 24) || `clip-${index + 1}`);
      const id = `library:${slug.slice(0, MAX_SLUG - suffix.length - 1)}.${suffix}`;
      const name = `${base.name} · ${label ? prettifyName(label) : `Clip ${index + 1}`}`.slice(0, META_LIMITS.name);
      out.dances.push({ ...base, id, name, clip: index });
    });
  }

  // — Songs —
  const songSlug = slugAllocator();
  for (const entry of sortedByFile(list.music ?? [])) {
    const meta = sanitizeMeta(entry.meta);
    const def: SongDef = {
      id: `library:${songSlug(slugify(stemOf(entry.file)))}`,
      source: 'library',
      title: meta.title ?? meta.name ?? prettifyName(entry.file),
    };
    if (meta.category) def.category = meta.category;
    if (meta.artist) def.artist = meta.artist;
    if (meta.vibe) def.vibe = meta.vibe;
    if (entry.ext === 'json') {
      let pattern: SongPattern;
      try {
        pattern = validateSongPattern(entry.json);
      } catch (error) {
        out.problems.push({ file: entry.file, reason: `Not a usable song pattern: ${reasonOf(error)}` });
        continue;
      }
      out.songs.push({ ...def, pattern, bpm: pattern.bpm });
      continue;
    }
    if (!AUDIO_EXTENSIONS.includes(entry.ext)) {
      out.problems.push({ file: entry.file, reason: `".${entry.ext}" files cannot be used as music.` });
      continue;
    }
    def.url = entry.url;
    if (meta.bpm !== undefined) def.bpm = meta.bpm;
    out.songs.push(def);
  }

  return out;
}
