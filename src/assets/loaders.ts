/**
 * Loaders for file-based definitions (library files and uploads), in the
 * shape the registry expects. The model code (three.js loaders) is imported
 * on first use, so it stays out of the initial bundle.
 */
import { compileScheme } from '../dances/compile';
import { validateScheme } from '../dances/scheme';
import type { CharacterAsset, CharacterDef, DanceAsset, DanceDef, ModelFormat, SongDef } from '../types';
import { extensionOf } from './formats';
import type { DanceSource, ModelSource } from './models';
import type { RegistryLoaders } from './registry';

/** URL scheme of uploaded files: `thunes-upload:<file id>`. The bytes come from the upload store, not the network. */
export const UPLOAD_URL_PREFIX = 'thunes-upload:';

/** The upload file id inside an upload URL, or null for ordinary URLs. */
export function uploadFileId(url: string | undefined): string | null {
  return url !== undefined && url.startsWith(UPLOAD_URL_PREFIX) ? url.slice(UPLOAD_URL_PREFIX.length) : null;
}

export interface FileLoaderOptions {
  /** Bytes of an uploaded file by file id. */
  uploadBlob?(fileId: string): Promise<Blob | undefined>;
}

/** The registry loaders plus cache control. */
export interface FileLoaders extends RegistryLoaders {
  character(def: CharacterDef): Promise<CharacterAsset>;
  dance(def: DanceDef): Promise<DanceAsset>;
  song(def: SongDef): Promise<ArrayBuffer>;
  /** Drop the parsed dance file cached for this URL (after an upload was removed). */
  forget(url: string): void;
}

function modelFormatOf(def: { format?: string; url?: string; name: string }): ModelFormat {
  const format = def.format ?? extensionOf((def.url ?? '').split(/[?#]/)[0] ?? '');
  if (format === 'glb' || format === 'gltf' || format === 'fbx' || format === 'bvh') return format;
  throw new Error(`"${def.name}" cannot be loaded: unsupported file type "${format}".`);
}

/** Creates the loaders for definitions that have a `url`. */
export function createFileLoaders(options: FileLoaderOptions = {}): FileLoaders {
  const danceSources = new Map<string, Promise<DanceSource>>();

  async function sourceOf(url: string, name: string): Promise<ModelSource> {
    const fileId = uploadFileId(url);
    if (fileId === null) return { url, name };
    const blob = await options.uploadBlob?.(fileId);
    if (!blob) throw new Error(`"${name}" cannot be loaded: the uploaded file is no longer stored on this device.`);
    return { blob, name };
  }

  return {
    async character(def) {
      if (!def.url) throw new Error(`"${def.name}" has no file.`);
      const format = modelFormatOf(def);
      const [models, source] = await Promise.all([import('./models'), sourceOf(def.url, def.name)]);
      return models.buildCharacterAsset(def, await models.loadModel(source, format));
    },

    async dance(def) {
      const url = def.url;
      if (!url) throw new Error(`"${def.name}" has no file.`);
      if (def.format === 'json') {
        const source = await sourceOf(url, def.name);
        const text = 'blob' in source ? await source.blob.text() : await (await fetch(source.url)).text();
        let scheme;
        try {
          scheme = validateScheme(JSON.parse(text) as unknown);
        } catch (error) {
          throw new Error(`"${def.name}" is not a usable dance scheme: ${error instanceof Error ? error.message : String(error)}`);
        }
        const { clip, rig } = compileScheme(scheme, { name: def.id });
        return { def, clip, rig, duration: clip.duration, bpm: def.bpm ?? scheme.bpm, beats: def.beats ?? scheme.beats };
      }
      const format = modelFormatOf(def);
      const models = await import('./models');
      let pending = danceSources.get(url);
      if (!pending) {
        pending = sourceOf(url, def.name)
          .then((source) => models.loadModel(source, format))
          .then((model) => models.buildDanceSource(model, def.name));
        danceSources.set(url, pending);
        pending.catch(() => {
          if (danceSources.get(url) === pending) danceSources.delete(url);
        });
      }
      return models.buildDanceAsset(def, await pending);
    },

    async song(def) {
      if (!def.url) throw new Error(`"${def.title}" has no audio source.`);
      const fileId = uploadFileId(def.url);
      if (fileId !== null) {
        const blob = await options.uploadBlob?.(fileId);
        if (!blob) throw new Error(`"${def.title}" cannot be played: the uploaded file is no longer stored on this device.`);
        return blob.arrayBuffer();
      }
      const response = await fetch(def.url);
      if (!response.ok) throw new Error(`Could not download "${def.title}" (HTTP ${response.status}).`);
      return response.arrayBuffer();
    },

    forget(url) {
      danceSources.delete(url);
    },
  };
}
