/**
 * The asset registry: the catalogue of characters, dances and songs, and the
 * cache of the heavy runtime objects behind each entry.
 *
 * Out of the box it serves the built-in placeholders (all generated in code).
 * File-based assets plug in through `RegistryOptions.loaders`, and the browser
 * upload flow through `RegistryOptions.uploads`.
 */
import type * as THREE from 'three';
import { BUILTIN_SONGS } from '../audio/songs';
import { BUILTIN_CHARACTERS, createProceduralCharacter } from '../characters';
import { BUILTIN_DANCES, compileScheme } from '../dances';
import { retargetClip } from '../rig/retarget';
import type {
  AssetRegistry,
  CharacterAsset,
  CharacterDef,
  DanceAsset,
  DanceDef,
  RetargetRequest,
  SongDef,
  SongSource,
  UploadReport,
} from '../types';

/** Loaders for file-based definitions (those with a `url`). */
export interface RegistryLoaders {
  character?(def: CharacterDef): Promise<CharacterAsset>;
  dance?(def: DanceDef): Promise<DanceAsset>;
  /** Encoded audio bytes for a song. Default: fetch(def.url). */
  song?(def: SongDef): Promise<ArrayBuffer>;
}

/** The browser-upload backend. */
export interface RegistryUploads {
  add(files: File[]): Promise<UploadReport>;
  remove(id: string): Promise<void>;
  /** Called when a tempo was learned for an uploaded song, so it can be persisted. */
  setSongBpm?(id: string, bpm: number): void;
}

export interface RegistryOptions {
  /** Initial catalogue. Defaults to the built-in placeholders. */
  characters?: readonly CharacterDef[];
  dances?: readonly DanceDef[];
  songs?: readonly SongDef[];
  loaders?: RegistryLoaders;
  uploads?: RegistryUploads;
}

export interface CatalogueEntries {
  characters?: readonly CharacterDef[];
  dances?: readonly DanceDef[];
  songs?: readonly SongDef[];
}

/** The registry plus the hooks used to extend the catalogue at runtime. */
export interface RegistryHandle extends AssetRegistry {
  /** Add entries, or replace entries with the same id (their cached runtime objects are dropped). */
  register(entries: CatalogueEntries): void;
  /** Remove entries by id and drop their cached runtime objects. */
  unregister(ids: readonly string[]): void;
  /** Install or replace the file loaders / upload backend after construction. */
  setLoaders(loaders: RegistryLoaders): void;
  setUploads(uploads: RegistryUploads | null): void;
}

export function createRegistry(options: RegistryOptions = {}): RegistryHandle {
  const characters = new Map<string, CharacterDef>();
  const dances = new Map<string, DanceDef>();
  const songs = new Map<string, SongDef>();
  for (const def of options.characters ?? BUILTIN_CHARACTERS) characters.set(def.id, def);
  for (const def of options.dances ?? BUILTIN_DANCES) dances.set(def.id, def);
  for (const def of options.songs ?? BUILTIN_SONGS) songs.set(def.id, def);

  let loaders: RegistryLoaders = options.loaders ?? {};
  let uploads: RegistryUploads | null = options.uploads ?? null;

  const characterCache = new Map<string, Promise<CharacterAsset>>();
  const danceCache = new Map<string, Promise<DanceAsset>>();
  const clipCache = new Map<string, Promise<THREE.AnimationClip>>();
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('[registry] listener failed', error);
      }
    }
  }

  /** Memoise a load; a failed load is forgotten so it can be retried. */
  function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
    const existing = cache.get(key);
    if (existing) return existing;
    const promise = load();
    cache.set(key, promise);
    promise.catch(() => {
      if (cache.get(key) === promise) cache.delete(key);
    });
    return promise;
  }

  async function buildCharacter(id: string): Promise<CharacterAsset> {
    const def = characters.get(id);
    if (!def) throw new Error(`Unknown character "${id}".`);
    if (def.procedural) return createProceduralCharacter(def);
    if (def.url && loaders.character) return loaders.character(def);
    throw new Error(`"${def.name}" cannot be loaded: no loader is installed for character files.`);
  }

  async function buildDance(id: string): Promise<DanceAsset> {
    const def = dances.get(id);
    if (!def) throw new Error(`Unknown dance "${id}".`);
    if (def.scheme) {
      const { clip, rig } = compileScheme(def.scheme, { name: def.id });
      return {
        def,
        clip,
        rig,
        duration: clip.duration,
        bpm: def.bpm ?? def.scheme.bpm,
        beats: def.beats ?? def.scheme.beats,
      };
    }
    if (def.url && loaders.dance) return loaders.dance(def);
    throw new Error(`"${def.name}" cannot be loaded: no loader is installed for dance files.`);
  }

  function clipKey(request: RetargetRequest): string {
    return `${request.danceId}\n${request.characterId}\n${request.mirror ? 1 : 0}`;
  }

  /** Drop every cached object that involves the given asset id. */
  function evict(id: string): void {
    characterCache.delete(id);
    danceCache.delete(id);
    for (const key of [...clipCache.keys()]) {
      const [danceId, characterId] = key.split('\n');
      if (danceId === id || characterId === id) clipCache.delete(key);
    }
  }

  const registry: RegistryHandle = {
    listCharacters: () => [...characters.values()],
    listDances: () => [...dances.values()],
    listSongs: () => [...songs.values()],
    getCharacter: (id) => characters.get(id),
    getDance: (id) => dances.get(id),
    getSong: (id) => songs.get(id),

    loadCharacter: (id) => cached(characterCache, id, () => buildCharacter(id)),
    loadDance: (id) => cached(danceCache, id, () => buildDance(id)),

    async loadSong(id): Promise<SongSource> {
      const def = songs.get(id);
      if (!def) throw new Error(`Unknown song "${id}".`);
      if (def.pattern) return { kind: 'pattern', pattern: def.pattern };
      if (loaders.song) return { kind: 'encoded', data: await loaders.song(def) };
      if (def.url) {
        const response = await fetch(def.url);
        if (!response.ok) throw new Error(`Could not download "${def.title}" (HTTP ${response.status}).`);
        return { kind: 'encoded', data: await response.arrayBuffer() };
      }
      throw new Error(`"${def.title}" has no audio source.`);
    },

    loadRetargetedClip(request) {
      return cached(clipCache, clipKey(request), async () => {
        const [dance, character] = await Promise.all([registry.loadDance(request.danceId), registry.loadCharacter(request.characterId)]);
        return retargetClip(dance.clip, dance.rig, character.rig, {
          mirror: request.mirror,
          inPlace: dance.def.inPlace === true,
          name: `${request.danceId} on ${request.characterId}${request.mirror ? ' (mirrored)' : ''}`,
        });
      });
    },

    setSongBpm(id, bpm) {
      const def = songs.get(id);
      if (!def || !Number.isFinite(bpm) || bpm <= 0 || def.bpm === bpm) return;
      songs.set(id, { ...def, bpm });
      if (def.source === 'upload') uploads?.setSongBpm?.(id, bpm);
      notify();
    },

    async addUploads(files) {
      if (uploads) return uploads.add(files);
      return {
        characters: [],
        dances: [],
        songs: [],
        problems: files.map((file) => ({ file: file.name, reason: 'Uploads are not available in this build.' })),
      };
    },

    async removeUpload(id) {
      if (!uploads) throw new Error('Uploads are not available in this build.');
      await uploads.remove(id);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    register(entries) {
      let changed = false;
      for (const def of entries.characters ?? []) {
        if (characters.has(def.id)) evict(def.id);
        characters.set(def.id, def);
        changed = true;
      }
      for (const def of entries.dances ?? []) {
        if (dances.has(def.id)) evict(def.id);
        dances.set(def.id, def);
        changed = true;
      }
      for (const def of entries.songs ?? []) {
        songs.set(def.id, def);
        changed = true;
      }
      if (changed) notify();
    },

    unregister(ids) {
      let changed = false;
      for (const id of ids) {
        const removed = [characters.delete(id), dances.delete(id), songs.delete(id)].some(Boolean);
        if (removed) {
          evict(id);
          changed = true;
        }
      }
      if (changed) notify();
    },

    setLoaders(next) {
      loaders = next;
    },

    setUploads(next) {
      uploads = next;
    },
  };

  return registry;
}
