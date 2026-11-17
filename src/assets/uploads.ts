/**
 * Browser uploads: files chosen or dropped by the user become characters,
 * dances and songs with ids 'upload:<file id>…'. The original bytes are kept
 * once per file in the upload store (IndexedDB) together with the derived
 * definitions, so after a reload the definitions are registered again at once
 * and the files are only parsed when they are used.
 */
import { detectBufferBpm } from '../audio/bpm';
import { validateScheme } from '../dances/scheme';
import type { CharacterDef, DanceDef, ModelFormat, SongDef, UploadReport } from '../types';
import { prettifyName } from './discovered';
import { AUDIO_EXTENSIONS, MODEL_EXTENSIONS, extensionOf } from './formats';
import { createMemoryUploadStore } from './idb';
import type { UploadRecord, UploadStore } from './idb';
import { UPLOAD_URL_PREFIX } from './loaders';
import type { ModelAnalysis } from './models';
import type { CatalogueEntries, RegistryUploads } from './registry';
import { looksLikeDanceScheme, looksLikeSongPattern, validateSongPattern } from './songPattern';

/** Size limits per kind of file, bytes. */
export const UPLOAD_LIMITS = {
  model: 200 * 1024 * 1024,
  audio: 100 * 1024 * 1024,
  json: 2 * 1024 * 1024,
} as const;

/** What an uploaded audio file turned out to be. */
export interface AudioAnalysis {
  /** Seconds. */
  duration?: number;
  bpm?: number;
}

/** An UploadReport with the extra facts the contract has no field for. */
export interface DetailedUploadReport extends UploadReport {
  /** False when at least one accepted file could only be kept for this session. */
  persisted: boolean;
}

export interface UploadsOptions {
  /** The catalogue to add to and remove from. */
  registry: { register(entries: CatalogueEntries): void; unregister(ids: readonly string[]): void };
  /** The persistent store, or null / a rejected promise when there is none (uploads then last for the session). */
  store: UploadStore | null | Promise<UploadStore | null>;
  /** Finds out what a model file offers; rejects with a readable Error when it is unusable. Default: parse it with the model loaders. */
  analyseModel?(file: Blob, name: string, format: ModelFormat): Promise<ModelAnalysis>;
  /** Decodes an audio file to check it and measure it; rejects when it cannot be decoded. Default: Web Audio, skipped where unavailable. */
  analyseAudio?(file: Blob, name: string): Promise<AudioAnalysis>;
  /** Called after an upload's definitions were removed, with the file's upload URL. */
  onForget?(url: string): void;
  /** New file ids (default: 10 random base-36 characters). */
  newId?(): string;
  now?(): number;
}

/** The upload backend handed to the registry, plus what the app wiring needs. */
export interface Uploads extends RegistryUploads {
  add(files: File[]): Promise<DetailedUploadReport>;
  /**
   * Removes one uploaded definition by id. The file's bytes are deleted when
   * its last definition is removed. Unknown ids are ignored.
   */
  remove(id: string): Promise<void>;
  setSongBpm(id: string, bpm: number): void;
  /** Registers the definitions of everything stored on this device. Resolves when done (also when storage is unavailable). */
  restore(): Promise<void>;
  /** The bytes of an uploaded file (for the loaders). */
  blob(fileId: string): Promise<Blob | undefined>;
  /** Records of all current uploads, oldest first. */
  records(): UploadRecord[];
  /** Whether new uploads survive a reload. Settles once the store has been opened. */
  persistent(): Promise<boolean>;
}

const SESSION_ONLY = 'Added for this session only: this browser does not allow Thunes to store files, so it will be gone after a reload.';

function randomId(): string {
  const bytes = new Uint8Array(8);
  const crypto = (globalThis as { crypto?: Crypto }).crypto;
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let id = '';
  for (const byte of bytes) id += byte.toString(36).padStart(2, '0');
  return id.slice(0, 10);
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isQuotaError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

async function defaultAnalyseModel(file: Blob, name: string, format: ModelFormat): Promise<ModelAnalysis> {
  const models = await import('./models');
  return models.analyseModel({ blob: file, name }, format);
}

async function defaultAnalyseAudio(file: Blob, name: string): Promise<AudioAnalysis> {
  const Offline = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!Offline) return {};
  let buffer: AudioBuffer;
  try {
    buffer = await new Offline(1, 1, 44100).decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error(`"${name}" could not be decoded as audio. Try MP3, WAV, OGG or M4A.`);
  }
  if (!(buffer.duration > 0)) throw new Error(`"${name}" contains no audio.`);
  const analysis: AudioAnalysis = { duration: buffer.duration };
  try {
    const estimate = detectBufferBpm(buffer);
    if (estimate) analysis.bpm = estimate.bpm;
  } catch {
    // The tempo is estimated again at playback time.
  }
  return analysis;
}

function isDef(value: unknown): value is { id: string } {
  const id = (value as { id?: unknown } | null)?.id;
  return typeof id === 'string' && id.startsWith('upload:');
}

/** Drops anything from a stored record that is not a well-formed upload definition (old or damaged data). */
function cleanRecord(raw: UploadRecord): UploadRecord | null {
  if (!raw || typeof raw.id !== 'string' || raw.id === '') return null;
  const record: UploadRecord = {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : 'file',
    size: typeof raw.size === 'number' ? raw.size : 0,
    type: typeof raw.type === 'string' ? raw.type : '',
    addedAt: typeof raw.addedAt === 'number' ? raw.addedAt : 0,
    characters: (Array.isArray(raw.characters) ? raw.characters : []).filter((def) => isDef(def) && typeof def.name === 'string'),
    dances: (Array.isArray(raw.dances) ? raw.dances : []).filter((def) => isDef(def) && typeof def.name === 'string'),
    songs: (Array.isArray(raw.songs) ? raw.songs : []).filter((def) => isDef(def) && typeof def.title === 'string'),
  };
  return record.characters.length + record.dances.length + record.songs.length > 0 ? record : null;
}

/** Creates the upload backend. */
export function createUploads(options: UploadsOptions): Uploads {
  const newId = options.newId ?? randomId;
  const now = options.now ?? Date.now;
  const analyseModel = options.analyseModel ?? defaultAnalyseModel;
  const analyseAudio = options.analyseAudio ?? defaultAnalyseAudio;

  /** Files that could not be persisted live here until the page is closed. */
  const session = createMemoryUploadStore();
  const persistentStore: Promise<UploadStore | null> = Promise.resolve(options.store).then(
    (store) => store,
    () => null,
  );
  /** Every current upload, and which store holds it. */
  const records = new Map<string, { record: UploadRecord; store: UploadStore }>();
  let restored: Promise<void> | null = null;

  function entriesOf(record: UploadRecord): CatalogueEntries {
    return { characters: record.characters, dances: record.dances, songs: record.songs };
  }

  function findByDefId(id: string): { record: UploadRecord; store: UploadStore } | undefined {
    for (const entry of records.values()) {
      const { record } = entry;
      if (record.characters.some((def) => def.id === id) || record.dances.some((def) => def.id === id) || record.songs.some((def) => def.id === id)) return entry;
    }
    return undefined;
  }

  /** Stores a record; falls back to the session store when persistence fails. Returns a note for the report, or null. */
  async function keep(record: UploadRecord, blob: Blob | null): Promise<string | null> {
    const store = await persistentStore;
    if (store) {
      try {
        await store.put(record, blob);
        records.set(record.id, { record, store });
        return store.persistent ? null : SESSION_ONLY;
      } catch (error) {
        await session.put(record, blob);
        records.set(record.id, { record, store: session });
        return isQuotaError(error)
          ? 'Added for this session only: the storage of this browser is full. Remove some uploads to make room.'
          : `Added for this session only: it could not be saved on this device (${messageOf(error)}).`;
      }
    }
    await session.put(record, blob);
    records.set(record.id, { record, store: session });
    return SESSION_ONLY;
  }

  async function addOne(file: File, report: DetailedUploadReport): Promise<void> {
    const name = file.name || 'file';
    const problem = (reason: string): void => {
      report.problems.push({ file: name, reason });
    };
    const ext = extensionOf(name);
    const isAudio = AUDIO_EXTENSIONS.includes(ext) || (ext === '' && /^audio\//.test(file.type));
    const isModel = MODEL_EXTENSIONS.includes(ext);
    const isJson = ext === 'json';
    if (!isAudio && !isModel && !isJson) {
      problem(
        `Unsupported file type${ext ? ` ".${ext}"` : ''}. Use ${MODEL_EXTENSIONS.map((e) => `.${e}`).join(', ')} for characters and dances, ${AUDIO_EXTENSIONS.map((e) => `.${e}`).join(', ')} for music, or .json for dance schemes and song patterns.`,
      );
      return;
    }
    if (file.size === 0) {
      problem('The file is empty.');
      return;
    }
    const limit = isModel ? UPLOAD_LIMITS.model : isAudio ? UPLOAD_LIMITS.audio : UPLOAD_LIMITS.json;
    if (file.size > limit) {
      problem(`The file is too large (${megabytes(file.size)}); the limit for ${isModel ? 'models' : isAudio ? 'music' : 'JSON files'} is ${megabytes(limit)}.`);
      return;
    }

    const id = newId();
    const record: UploadRecord = { id, name, size: file.size, type: file.type ?? '', addedAt: now(), characters: [], dances: [], songs: [] };
    const url = `${UPLOAD_URL_PREFIX}${id}`;
    const pretty = prettifyName(name);
    let blob: Blob | null = file;

    if (isJson) {
      let json: unknown;
      try {
        json = JSON.parse(await file.text()) as unknown;
      } catch (error) {
        problem(`Not valid JSON: ${messageOf(error)}`);
        return;
      }
      try {
        if (looksLikeDanceScheme(json)) {
          const scheme = validateScheme(json);
          record.dances.push({ id: `upload:${id}`, source: 'upload', name: pretty, scheme, bpm: scheme.bpm, beats: scheme.beats });
        } else if (looksLikeSongPattern(json)) {
          const pattern = validateSongPattern(json);
          record.songs.push({ id: `upload:${id}`, source: 'upload', title: pretty, pattern, bpm: pattern.bpm });
        } else {
          problem('This JSON file is neither a dance scheme ("format": "thunes-dance@1") nor a song pattern ("format": "thunes-song@1").');
          return;
        }
      } catch (error) {
        problem(messageOf(error));
        return;
      }
      // The definition carries the whole content; no bytes need to be kept.
      blob = null;
    } else if (isModel) {
      const format = ext as ModelFormat;
      let analysis: ModelAnalysis;
      try {
        analysis = await analyseModel(file, name, format);
      } catch (error) {
        problem(messageOf(error));
        return;
      }
      if (analysis.character) record.characters.push({ id: `upload:${id}`, source: 'upload', name: pretty, url, format });
      const single = analysis.clips.length === 1;
      analysis.clips.forEach((clip, n) => {
        const clipName = clip.name.trim();
        // A lone clip is named after the file; several are told apart by their own names.
        const label = single || clipName === '' ? (single ? pretty : `${pretty} · Clip ${n + 1}`) : `${pretty} · ${prettifyName(clipName)}`;
        record.dances.push({ id: `upload:${id}.${n + 1}`, source: 'upload', name: label.slice(0, 80), url, format, clip: clip.index });
      });
      if (record.characters.length === 0 && record.dances.length === 0) {
        problem('The file has a humanoid skeleton but neither a mesh (for a character) nor an animation (for a dance).');
        return;
      }
    } else {
      let analysis: AudioAnalysis;
      try {
        analysis = await analyseAudio(file, name);
      } catch (error) {
        problem(messageOf(error));
        return;
      }
      const song: SongDef = { id: `upload:${id}`, source: 'upload', title: pretty, url };
      if (analysis.duration !== undefined && analysis.duration > 0) song.duration = analysis.duration;
      if (analysis.bpm !== undefined && analysis.bpm > 0) song.bpm = analysis.bpm;
      record.songs.push(song);
    }

    const note = await keep(record, blob);
    if (note) {
      report.persisted = false;
      problem(note);
    }
    options.registry.register(entriesOf(record));
    report.characters.push(...record.characters);
    report.dances.push(...record.dances);
    report.songs.push(...record.songs);
  }

  const uploads: Uploads = {
    async add(files) {
      // Stored uploads are registered first, so a restore finishing later cannot clash with new entries.
      await uploads.restore();
      const report: DetailedUploadReport = { characters: [], dances: [], songs: [], problems: [], persisted: true };
      for (const file of files) {
        try {
          await addOne(file, report);
        } catch (error) {
          report.problems.push({ file: file.name || 'file', reason: `Could not be added: ${messageOf(error)}` });
        }
      }
      return report;
    },

    async remove(id) {
      await uploads.restore();
      const entry = findByDefId(id);
      if (!entry) return;
      const { record, store } = entry;
      const next: UploadRecord = {
        ...record,
        characters: record.characters.filter((def: CharacterDef) => def.id !== id),
        dances: record.dances.filter((def: DanceDef) => def.id !== id),
        songs: record.songs.filter((def: SongDef) => def.id !== id),
      };
      options.registry.unregister([id]);
      if (next.characters.length + next.dances.length + next.songs.length === 0) {
        records.delete(record.id);
        options.onForget?.(`${UPLOAD_URL_PREFIX}${record.id}`);
        await store.delete(record.id);
      } else {
        records.set(record.id, { record: next, store });
        await store.update(next);
      }
    },

    setSongBpm(id, bpm) {
      const entry = findByDefId(id);
      if (!entry || !Number.isFinite(bpm) || bpm <= 0) return;
      const next: UploadRecord = { ...entry.record, songs: entry.record.songs.map((def) => (def.id === id ? { ...def, bpm } : def)) };
      records.set(next.id, { record: next, store: entry.store });
      entry.store.update(next).catch((error: unknown) => console.warn('[uploads] could not save the tempo', error));
    },

    restore() {
      restored ??= (async () => {
        const store = await persistentStore;
        if (!store) return;
        let stored: UploadRecord[];
        try {
          stored = await store.list();
        } catch (error) {
          console.warn('[uploads] stored uploads could not be read', error);
          return;
        }
        const entries: Required<CatalogueEntries> = { characters: [], dances: [], songs: [] };
        for (const raw of stored) {
          const record = cleanRecord(raw);
          if (!record || records.has(record.id)) continue;
          records.set(record.id, { record, store });
          entries.characters = [...entries.characters, ...record.characters];
          entries.dances = [...entries.dances, ...record.dances];
          entries.songs = [...entries.songs, ...record.songs];
        }
        options.registry.register(entries);
      })();
      return restored;
    },

    async blob(fileId) {
      await uploads.restore();
      const entry = records.get(fileId);
      return entry ? entry.store.getBlob(fileId) : undefined;
    },

    records: () => [...records.values()].map((entry) => entry.record).sort((a, b) => a.addedAt - b.addedAt),

    async persistent() {
      const store = await persistentStore;
      return store !== null && store.persistent;
    },
  };
  return uploads;
}
