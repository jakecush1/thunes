/// <reference path="./node-shim.d.ts" />
/**
 * Vite plugin: the drop-in asset folders.
 *
 * Exposes the virtual module 'virtual:thunes-assets', which lists the files
 * under public/assets/characters, public/assets/dances and public/assets/music
 * (see DiscoveredAssets in src/assets/discovered.ts). On the dev server,
 * adding, removing or changing a file there invalidates the module and
 * reloads the page, so new files simply appear.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { CHARACTER_EXTENSIONS, DANCE_EXTENSIONS, MUSIC_EXTENSIONS, extensionOf } from '../../src/assets/formats.ts';
import type { DiscoveredAssets, DiscoveredFile } from '../../src/assets/discovered';

export const VIRTUAL_ID = 'virtual:thunes-assets';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

/** JSON files (schemes, patterns, sidecars) larger than this are not inlined. */
const MAX_JSON_BYTES = 1024 * 1024;
/** Upper bound for the JSON chunk of a .glb / the size of a .gltf that is read to list clip names. */
const MAX_GLTF_JSON_BYTES = 64 * 1024 * 1024;

const KINDS = [
  { key: 'characters', dir: 'characters', extensions: CHARACTER_EXTENSIONS },
  { key: 'dances', dir: 'dances', extensions: DANCE_EXTENSIONS },
  { key: 'music', dir: 'music', extensions: MUSIC_EXTENSIONS },
] as const;

export interface ScanOptions {
  /** URL prefix of the assets folder, e.g. "/assets/" or "/thunes/assets/". */
  baseUrl: string;
  /** Receives readable warnings (bad sidecars, unreadable files). Default: ignore. */
  warn?: (message: string) => void;
}

function isIgnoredName(name: string): boolean {
  if (name.startsWith('.') || name.startsWith('_')) return true;
  if (/^readme(\.|$)/i.test(name)) return true;
  if (/\.meta\.json$/i.test(name)) return true;
  return false;
}

function walk(dir: string, prefix: string, out: { relative: string; absolute: string }[]): void {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const absolute = path.join(dir, entry.name);
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) walk(absolute, relative, out);
    else if (entry.isFile()) out.push({ relative, absolute });
  }
}

function readJson(file: string, size: number): unknown {
  if (size > MAX_JSON_BYTES) throw new Error(`larger than ${MAX_JSON_BYTES / 1024} KB`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
}

function clipNamesFromGltfJson(json: unknown): string[] {
  const animations = (json as { animations?: unknown } | null)?.animations;
  if (!Array.isArray(animations)) return [];
  return animations.map((animation) => {
    const name = (animation as { name?: unknown } | null)?.name;
    return typeof name === 'string' ? name : '';
  });
}

/**
 * Animation clip names of a .glb or .gltf file, read from its JSON only (the
 * binary payload is never loaded). Unnamed clips are ''. Returns undefined
 * when the file cannot be read as glTF.
 */
export function readGltfClipNames(file: string, ext: string, size: number): string[] | undefined {
  try {
    if (ext === 'gltf') {
      if (size > MAX_GLTF_JSON_BYTES) return undefined;
      return clipNamesFromGltfJson(JSON.parse(fs.readFileSync(file, 'utf8')));
    }
    const fd = fs.openSync(file, 'r');
    try {
      const header = new Uint8Array(20);
      if (fs.readSync(fd, header, 0, 20, 0) < 20) return undefined;
      const view = new DataView(header.buffer);
      // "glTF", version 2, first chunk of type "JSON".
      if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(16, true) !== 0x4e4f534a) return undefined;
      const length = view.getUint32(12, true);
      if (length > MAX_GLTF_JSON_BYTES) return undefined;
      const chunk = new Uint8Array(length);
      if (fs.readSync(fd, chunk, 0, length, 20) < length) return undefined;
      return clipNamesFromGltfJson(JSON.parse(new TextDecoder().decode(chunk)));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

function encodeUrlPath(relative: string): string {
  return relative.split('/').map(encodeURIComponent).join('/');
}

/**
 * Lists the asset files under `assetsDir` (the public/assets folder).
 * Recursive; skips dotfiles, READMEs, "*.meta.json" sidecars and anything with
 * an extension the folder does not accept (.bin buffers, textures…). Missing
 * folders yield empty lists. Results are sorted by path.
 */
export function scanAssets(assetsDir: string, options: ScanOptions): DiscoveredAssets {
  const warn = options.warn ?? (() => {});
  const baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`;
  const result: DiscoveredAssets = { characters: [], dances: [], music: [] };

  for (const kind of KINDS) {
    const found: { relative: string; absolute: string }[] = [];
    walk(path.join(assetsDir, kind.dir), kind.dir, found);
    for (const { relative, absolute } of found) {
      const name = relative.slice(relative.lastIndexOf('/') + 1);
      if (isIgnoredName(name)) continue;
      const ext = extensionOf(name);
      if (!kind.extensions.includes(ext)) continue;
      let size: number;
      try {
        size = fs.statSync(absolute).size;
      } catch {
        continue;
      }
      const entry: DiscoveredFile = { file: relative, url: baseUrl + encodeUrlPath(relative), ext, size };

      const sidecar = `${absolute}.meta.json`;
      if (fs.existsSync(sidecar)) {
        try {
          const meta = readJson(sidecar, fs.statSync(sidecar).size);
          if (meta && typeof meta === 'object' && !Array.isArray(meta)) entry.meta = meta;
          else warn(`${relative}.meta.json is ignored: it must contain a JSON object.`);
        } catch (error) {
          warn(`${relative}.meta.json is ignored: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (ext === 'json') {
        try {
          entry.json = readJson(absolute, size);
        } catch (error) {
          warn(`${relative} is ignored: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
      } else if (kind.key === 'dances' && (ext === 'glb' || ext === 'gltf')) {
        const clips = readGltfClipNames(absolute, ext, size);
        if (clips) {
          entry.clips = clips;
          if (clips.length === 0) warn(`${relative} contains no animation clips, so it cannot be used as a dance.`);
        }
      }
      result[kind.key].push(entry);
    }
  }
  return result;
}

/** Source text of the virtual module for a scan result. */
export function renderModule(assets: DiscoveredAssets): string {
  return `export default ${JSON.stringify(assets)};\n`;
}

/** The plugin. Register it in vite.config.ts: `plugins: [thunesAssets()]`. */
export function thunesAssets(): Plugin {
  let assetsDir = path.resolve('public', 'assets');
  let baseUrl = '/assets/';
  let warn: (message: string) => void = (message) => console.warn(`[thunes-assets] ${message}`);

  return {
    name: 'thunes-assets',
    configResolved(config) {
      const publicDir = config.publicDir || path.resolve(config.root, 'public');
      assetsDir = path.join(publicDir, 'assets');
      baseUrl = `${config.base.endsWith('/') ? config.base : `${config.base}/`}assets/`;
      warn = (message) => config.logger.warn(`[thunes-assets] ${message}`);
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      return renderModule(scanAssets(assetsDir, { baseUrl, warn }));
    },
    configureServer(server) {
      const prefix = assetsDir + path.sep;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const refresh = (file: string): void => {
        if (!file.startsWith(prefix)) return;
        const name = path.basename(file);
        if (name.startsWith('.')) return;
        // Several files usually arrive together (a model and its sidecar): reload once.
        clearTimeout(timer);
        timer = setTimeout(() => {
          for (const environment of Object.values(server.environments)) {
            const module = environment.moduleGraph.getModuleById(RESOLVED_ID);
            if (module) environment.moduleGraph.invalidateModule(module);
          }
          server.ws.send({ type: 'full-reload', path: '*' });
        }, 120);
      };
      // Vite already watches the project root (which contains public/); adding the folder is harmless and covers custom public dirs.
      const watcher = server.watcher as unknown as { add(path: string): void; on(event: string, listener: (file: string) => void): void };
      watcher.add(assetsDir);
      watcher.on('add', refresh);
      watcher.on('unlink', refresh);
      watcher.on('change', refresh);
    },
  };
}

export default thunesAssets;
