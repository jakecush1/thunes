/**
 * The app's asset registry: the built-in placeholders, the files dropped into
 * public/assets (listed at build time by scripts/vite/thunes-assets.ts) and
 * the files uploaded in the browser (kept in IndexedDB on this device).
 */
import discovered from 'virtual:thunes-assets';
import { discoveredToDefs } from './discovered';
import type { DiscoveredAssets } from './discovered';
import { openIdbUploadStore } from './idb';
import type { UploadStore } from './idb';
import { createFileLoaders } from './loaders';
import { createRegistry } from './registry';
import type { RegistryHandle } from './registry';
import { createUploads } from './uploads';
import type { Uploads } from './uploads';

export interface AppRegistryOptions {
  /** Library listing (default: the files found in public/assets at build time). */
  discovered?: Partial<DiscoveredAssets>;
  /** Upload storage (default: IndexedDB, falling back to memory for the session). */
  uploadStore?: UploadStore | null | Promise<UploadStore | null>;
}

/** The registry plus access to the upload backend. */
export interface AppRegistry extends RegistryHandle {
  readonly uploads: Uploads;
  /** Settles when the uploads stored on this device have been registered (subscribers are notified as they appear). */
  readonly uploadsRestored: Promise<void>;
  /** Library files that were skipped, with readable reasons. */
  readonly libraryProblems: readonly { file: string; reason: string }[];
}

/**
 * Creates the registry with built-ins, library files, file loaders and
 * uploads. Stored uploads are registered asynchronously.
 */
export function createAppRegistry(options: AppRegistryOptions = {}): AppRegistry {
  const registry = createRegistry();

  const library = discoveredToDefs(options.discovered ?? discovered);
  for (const problem of library.problems) console.warn(`[assets] public/assets/${problem.file} was skipped: ${problem.reason}`);
  registry.register({ characters: library.characters, dances: library.dances, songs: library.songs });

  const uploads: Uploads = createUploads({
    registry,
    store: options.uploadStore !== undefined ? options.uploadStore : openIdbUploadStore(),
    onForget: (url) => loaders.forget(url),
  });
  const loaders = createFileLoaders({ uploadBlob: (fileId) => uploads.blob(fileId) });
  registry.setLoaders(loaders);
  registry.setUploads(uploads);

  const uploadsRestored = uploads.restore().catch((error: unknown) => {
    console.warn('[assets] stored uploads could not be restored', error);
  });

  return Object.assign(registry, { uploads, uploadsRestored, libraryProblems: library.problems });
}

export { createRegistry } from './registry';
export type { RegistryHandle, RegistryLoaders, RegistryOptions, RegistryUploads } from './registry';
export { discoveredToDefs } from './discovered';
export type { AssetMeta, DiscoveredAssets, DiscoveredFile, LibraryDefs } from './discovered';
export type { DetailedUploadReport, Uploads } from './uploads';
export type { UploadRecord, UploadStore } from './idb';
