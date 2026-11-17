/// <reference path="../../../scripts/vite/node-shim.d.ts" />
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import virtualAssets from 'virtual:thunes-assets';
import { readGltfClipNames, renderModule, scanAssets } from '../../../scripts/vite/thunes-assets';
import { discoveredToDefs } from '../../../src/assets/discovered';
import { compileScheme } from '../../../src/dances';

// Temporary directories live in the session scratchpad when it exists, else next to the project's node_modules cache.
const SCRATCH = '/private/tmp/claude-501/-Users-jacob-Desktop-Vibe-coded-thunes/79e4fbc9-0cb2-4b08-bf48-09d48966e477/scratchpad';
const TMP_PARENT = fs.existsSync(SCRATCH) ? SCRATCH : path.resolve('node_modules', '.tmp');

function glb(json: object): Uint8Array {
  let text = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (text.length % 4)) % 4;
  if (pad) {
    const padded = new Uint8Array(text.length + pad).fill(0x20);
    padded.set(text);
    text = padded;
  }
  const out = new Uint8Array(20 + text.length + 16);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, text.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  // A (bogus) binary chunk after the JSON must not be read.
  view.setUint32(20 + text.length, 8, true);
  view.setUint32(24 + text.length, 0x004e4942, true);
  return out;
}

describe('scanAssets', () => {
  let dir = '';
  const write = (relative: string, data: string | Uint8Array = 'x'): void => {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  };

  beforeAll(() => {
    fs.mkdirSync(TMP_PARENT, { recursive: true });
    dir = fs.mkdtempSync(path.join(TMP_PARENT, 'scan-test-'));
    write('characters/.gitkeep', '');
    write('characters/Robo Kid.glb', glb({ asset: { version: '2.0' } }));
    write('characters/Robo Kid.glb.meta.json', JSON.stringify({ name: 'Robo', height: 1.2, category: 'Bots' }));
    write('characters/README.md', '# hello');
    write('characters/pack/knight.gltf', JSON.stringify({ asset: { version: '2.0' } }));
    write('characters/pack/knight.bin', new Uint8Array(12));
    write('characters/pack/knight_diffuse.png', new Uint8Array(12));
    write('characters/pack/.DS_Store', '');
    write('characters/.hidden/secret.glb', glb({}));
    write('characters/notes.txt');
    write('characters/skeleton.bvh', 'HIERARCHY');
    write('dances/hip_hop-01.fbx', new Uint8Array(100));
    write('dances/hip_hop-01.fbx.meta.json', '{ "bpm": 96, broken');
    write('dances/multi.glb', glb({ animations: [{ name: 'Wave' }, {}, { name: 'Spin Jump' }] }));
    write('dances/still.glb', glb({ meshes: [] }));
    write('dances/text.gltf', JSON.stringify({ animations: [{ name: 'OnlyOne' }] }));
    write('dances/garbage.glb', 'not a glb at all, but long enough to have a header');
    write('dances/moves/spin.bvh', 'HIERARCHY');
    write('dances/scheme.json', JSON.stringify({ format: 'thunes-dance@1', beats: 4, bpm: 100 }));
    write('dances/broken.json', '{ nope');
    write('dances/array.json.meta.json', '[1, 2]');
    write('dances/array.json', '{"format":"thunes-dance@1","beats":4,"bpm":120}');
    write('dances/song.mp3');
    write('music/Night Bus (demo).mp3', new Uint8Array(2048));
    write('music/Night Bus (demo).mp3.meta.json', JSON.stringify({ title: 'Night Bus', artist: 'Someone', bpm: 124 }));
    write('music/loop.WAV', new Uint8Array(10));
    write('music/cover.jpg');
    write('music/pattern.json', JSON.stringify({ format: 'thunes-song@1' }));
    write('other/ignored.glb', glb({}));
  });

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lists the accepted files per folder, recursively and sorted, with POSIX paths and sizes', () => {
    const warnings: string[] = [];
    const found = scanAssets(dir, { baseUrl: '/assets/', warn: (m) => warnings.push(m) });
    expect(found.characters.map((f) => f.file)).toEqual(['characters/Robo Kid.glb', 'characters/pack/knight.gltf']);
    expect(found.dances.map((f) => f.file)).toEqual([
      'dances/array.json',
      'dances/garbage.glb',
      'dances/hip_hop-01.fbx',
      'dances/moves/spin.bvh',
      'dances/multi.glb',
      'dances/scheme.json',
      'dances/still.glb',
      'dances/text.gltf',
    ]);
    expect(found.music.map((f) => f.file)).toEqual(['music/Night Bus (demo).mp3', 'music/loop.WAV', 'music/pattern.json']);
    expect(found.music[0]).toMatchObject({ ext: 'mp3', size: 2048, url: '/assets/music/Night%20Bus%20(demo).mp3' });
    expect(found.music[1]!.ext).toBe('wav');
    expect(found.dances.find((f) => f.file === 'dances/hip_hop-01.fbx')!.size).toBe(100);
    expect(warnings.some((w) => w.includes('dances/broken.json'))).toBe(true);
  });

  it('reads sidecars, warns about invalid ones and ignores them', () => {
    const warnings: string[] = [];
    const found = scanAssets(dir, { baseUrl: '/assets/', warn: (m) => warnings.push(m) });
    expect(found.characters[0]!.meta).toEqual({ name: 'Robo', height: 1.2, category: 'Bots' });
    expect(found.characters[1]!.meta).toBeUndefined();
    expect(found.music[0]!.meta).toEqual({ title: 'Night Bus', artist: 'Someone', bpm: 124 });
    expect(found.dances.find((f) => f.file === 'dances/hip_hop-01.fbx')!.meta).toBeUndefined();
    expect(found.dances.find((f) => f.file === 'dances/array.json')!.meta).toBeUndefined();
    expect(warnings.some((w) => w.includes('dances/hip_hop-01.fbx.meta.json is ignored'))).toBe(true);
    expect(warnings.some((w) => w.includes('dances/array.json.meta.json is ignored'))).toBe(true);
  });

  it('lists the clip names of glTF dance files and inlines JSON files', () => {
    const warnings: string[] = [];
    const found = scanAssets(dir, { baseUrl: '/assets/', warn: (m) => warnings.push(m) });
    const dance = (file: string) => found.dances.find((f) => f.file === file)!;
    expect(dance('dances/multi.glb').clips).toEqual(['Wave', '', 'Spin Jump']);
    expect(dance('dances/text.gltf').clips).toEqual(['OnlyOne']);
    expect(dance('dances/still.glb').clips).toEqual([]);
    expect(dance('dances/garbage.glb').clips).toBeUndefined();
    expect(dance('dances/hip_hop-01.fbx').clips).toBeUndefined();
    expect(dance('dances/scheme.json').json).toEqual({ format: 'thunes-dance@1', beats: 4, bpm: 100 });
    expect(found.music[2]!.json).toEqual({ format: 'thunes-song@1' });
    // Characters are not scanned for clips.
    expect(found.characters[0]!.clips).toBeUndefined();
    expect(warnings.some((w) => w.includes('dances/still.glb contains no animation clips'))).toBe(true);
  });

  it('honours the base URL', () => {
    expect(scanAssets(dir, { baseUrl: '/thunes/assets' }).characters[1]!.url).toBe('/thunes/assets/characters/pack/knight.gltf');
    expect(scanAssets(dir, { baseUrl: './assets/' }).dances[3]!.url).toBe('./assets/dances/moves/spin.bvh');
  });

  it('treats missing folders as empty', () => {
    expect(scanAssets(path.join(dir, 'does-not-exist'), { baseUrl: '/assets/' })).toEqual({ characters: [], dances: [], music: [] });
    expect(scanAssets(path.join(dir, 'other'), { baseUrl: '/assets/' })).toEqual({ characters: [], dances: [], music: [] });
  });

  it('reads clip names without loading the binary payload', () => {
    const file = path.join(dir, 'dances/multi.glb');
    expect(readGltfClipNames(file, 'glb', fs.statSync(file).size)).toEqual(['Wave', '', 'Spin Jump']);
    expect(readGltfClipNames(path.join(dir, 'nope.glb'), 'glb', 0)).toBeUndefined();
  });

  it('renders a module that round-trips, and the result feeds discoveredToDefs', () => {
    const found = scanAssets(dir, { baseUrl: '/assets/' });
    const source = renderModule(found);
    expect(source.startsWith('export default ')).toBe(true);
    expect(JSON.parse(source.slice('export default '.length).replace(/;\s*$/, ''))).toEqual(found);
    const defs = discoveredToDefs(found);
    expect(defs.characters.map((d) => d.id)).toEqual(['library:robo-kid', 'library:pack-knight']);
    expect(defs.characters[0]).toMatchObject({ name: 'Robo', height: 1.2, category: 'Bots', format: 'glb' });
    expect(defs.dances.map((d) => d.id)).toEqual([
      'library:array',
      'library:garbage',
      'library:hip-hop-01',
      'library:moves-spin',
      'library:multi.wave',
      'library:multi.clip-2',
      'library:multi.spin-jump',
      'library:scheme',
      'library:text',
    ]);
    expect(defs.songs.map((d) => d.id)).toEqual(['library:night-bus-demo', 'library:loop']);
    expect(defs.problems.map((p) => p.file).sort()).toEqual(['dances/still.glb', 'music/pattern.json']);
  });
});

describe('the virtual module (under vitest)', () => {
  it('lists the project\'s public/assets, including the example dance', () => {
    expect(Array.isArray(virtualAssets.characters)).toBe(true);
    expect(Array.isArray(virtualAssets.music)).toBe(true);
    const example = virtualAssets.dances.find((f) => f.file === 'dances/example-side-sway.json');
    expect(example).toBeDefined();
    expect(example!.url).toBe('/assets/dances/example-side-sway.json');
    const defs = discoveredToDefs(virtualAssets);
    expect(defs.problems).toEqual([]);
    const dance = defs.dances.find((d) => d.id === 'library:example-side-sway')!;
    expect(dance).toMatchObject({ name: 'Example Side Sway', source: 'library', bpm: 110, beats: 8 });
    const compiled = compileScheme(dance.scheme!, { name: dance.id });
    expect(compiled.clip.duration).toBeCloseTo((8 * 60) / 110, 3);
  });
});
