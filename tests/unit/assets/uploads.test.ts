import { describe, expect, it, vi } from 'vitest';
import { createAppRegistry } from '../../../src/assets';
import { createMemoryUploadStore } from '../../../src/assets/idb';
import type { UploadStore } from '../../../src/assets/idb';
import { UPLOAD_URL_PREFIX, createFileLoaders, uploadFileId } from '../../../src/assets/loaders';
import { createRegistry } from '../../../src/assets/registry';
import { UPLOAD_LIMITS, createUploads } from '../../../src/assets/uploads';
import type { UploadsOptions } from '../../../src/assets/uploads';
import { BUILTIN_SONGS } from '../../../src/audio/songs';
import { BUILTIN_DANCES } from '../../../src/dances';

const ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,95}$/;

/** A memory store that claims to be persistent, like IndexedDB, and counts blob reads. */
function fakeIdb(): UploadStore & { blobReads: number; size(): Promise<number> } {
  const inner = createMemoryUploadStore();
  const store = {
    ...inner,
    persistent: true,
    blobReads: 0,
    async getBlob(id: string) {
      store.blobReads++;
      return inner.getBlob(id);
    },
    size: async () => (await inner.list()).length,
  };
  return store;
}

function setup(overrides: Partial<UploadsOptions> = {}, store: UploadStore | null = fakeIdb()) {
  const registry = createRegistry();
  let n = 0;
  const forgotten: string[] = [];
  const uploads = createUploads({
    registry,
    store,
    newId: () => `f${++n}`,
    now: () => 1000 + n,
    analyseModel: async (_file, name) => {
      if (name.startsWith('robot')) throw new Error(`"${name}" cannot be used: its skeleton is not a complete humanoid: the bones Spine, LeftArm could not be found.`);
      if (name.startsWith('anim')) return { character: false, clips: [{ index: 0, name: 'mixamo.com', duration: 3 }] };
      if (name.startsWith('both')) return { character: true, clips: [{ index: 0, name: 'Idle', duration: 2 }, { index: 2, name: '', duration: 2 }] };
      if (name.startsWith('bare')) return { character: false, clips: [] };
      return { character: true, clips: [] };
    },
    analyseAudio: async (_file, name) => {
      if (name.startsWith('noise')) throw new Error(`"${name}" could not be decoded as audio.`);
      return name.startsWith('beat') ? { duration: 12, bpm: 120 } : { duration: 30 };
    },
    onForget: (url) => forgotten.push(url),
    ...overrides,
  });
  registry.setUploads(uploads);
  return { registry, uploads, store, forgotten };
}

const f = (name: string, content: string | Uint8Array<ArrayBuffer> = 'data', type = ''): File => new File([content], name, { type });

describe('uploads', () => {
  it('turns model files into characters and dances, audio into songs, JSON into schemes and patterns', async () => {
    const { registry, uploads } = setup();
    let notified = 0;
    registry.subscribe(() => notified++);
    const report = await registry.addUploads([
      f('Cool_Guy.glb'),
      f('anim-samba dancing.fbx'),
      f('both.GLB'),
      f('beat_one.wav', 'x', 'audio/wav'),
      f('my-move.json', JSON.stringify(BUILTIN_DANCES[0]!.scheme)),
      f('my-loop.json', JSON.stringify(BUILTIN_SONGS[0]!.pattern)),
    ]);
    expect(report.problems).toEqual([]);
    expect(report.characters).toEqual([
      { id: 'upload:f1', source: 'upload', name: 'Cool Guy', url: `${UPLOAD_URL_PREFIX}f1`, format: 'glb' },
      { id: 'upload:f3', source: 'upload', name: 'Both', url: `${UPLOAD_URL_PREFIX}f3`, format: 'glb' },
    ]);
    expect(report.dances.map((d) => [d.id, d.name, d.clip, d.format])).toEqual([
      ['upload:f2.1', 'Anim Samba Dancing', 0, 'fbx'],
      ['upload:f3.1', 'Both · Idle', 0, 'glb'],
      ['upload:f3.2', 'Both · Clip 2', 2, 'glb'],
      ['upload:f5', 'My Move', undefined, undefined],
    ]);
    expect(report.dances[3]!.scheme).toEqual(BUILTIN_DANCES[0]!.scheme);
    expect(report.songs.map((s) => [s.id, s.title, s.bpm, s.duration])).toEqual([
      ['upload:f4', 'Beat One', 120, 12],
      ['upload:f6', 'My Loop', BUILTIN_SONGS[0]!.pattern!.bpm, undefined],
    ]);
    for (const def of [...report.characters, ...report.dances, ...report.songs]) {
      expect(def.id).toMatch(ID);
      expect(def.source).toBe('upload');
    }
    expect(registry.getCharacter('upload:f1')).toBeDefined();
    expect(registry.getDance('upload:f3.2')).toBeDefined();
    expect(registry.getSong('upload:f4')).toBeDefined();
    expect(notified).toBeGreaterThanOrEqual(6);
    expect((report as { persisted?: boolean }).persisted).toBe(true);
    expect(uploads.records().map((r) => r.name)).toEqual(['Cool_Guy.glb', 'anim-samba dancing.fbx', 'both.GLB', 'beat_one.wav', 'my-move.json', 'my-loop.json']);
    // JSON content lives in the definition; a pattern song loads without any file.
    expect(await registry.loadSong('upload:f6')).toEqual({ kind: 'pattern', pattern: BUILTIN_SONGS[0]!.pattern });
    expect((await registry.loadDance('upload:f5')).duration).toBeGreaterThan(0);
  });

  it('explains every file it cannot use', async () => {
    const { registry } = setup();
    const big = f('huge.wav');
    Object.defineProperty(big, 'size', { value: UPLOAD_LIMITS.audio + 1 });
    const report = await registry.addUploads([
      f('robot.glb'),
      f('picture.png'),
      f('noext'),
      f('empty.glb', ''),
      big,
      f('noise.mp3'),
      f('bare.bvh'),
      f('broken.json', '{ nope'),
      f('other.json', '{"hello":1}'),
      f('bad-scheme.json', JSON.stringify({ format: 'thunes-dance@1', beats: 0, bpm: 120 })),
      f('bad-song.json', JSON.stringify({ format: 'thunes-song@1', bpm: 120 })),
    ]);
    expect(report.characters).toEqual([]);
    expect(report.dances).toEqual([]);
    expect(report.songs).toEqual([]);
    const reason = (file: string): string => report.problems.find((p) => p.file === file)!.reason;
    expect(report.problems).toHaveLength(11);
    expect(reason('robot.glb')).toMatch(/not a complete humanoid: the bones Spine, LeftArm/);
    expect(reason('picture.png')).toMatch(/Unsupported file type "\.png"/);
    expect(reason('noext')).toMatch(/Unsupported file type\./);
    expect(reason('empty.glb')).toMatch(/empty/);
    expect(reason('huge.wav')).toMatch(/too large \(100 MB\); the limit for music is 100 MB/);
    expect(reason('noise.mp3')).toMatch(/could not be decoded/);
    expect(reason('bare.bvh')).toMatch(/neither a mesh .* nor an animation/);
    expect(reason('broken.json')).toMatch(/Not valid JSON/);
    expect(reason('other.json')).toMatch(/neither a dance scheme .* nor a song pattern/);
    expect(reason('bad-scheme.json')).toMatch(/Invalid dance scheme/);
    expect(reason('bad-song.json')).toMatch(/bars/);
    expect(registry.listCharacters().some((d) => d.source === 'upload')).toBe(false);
  });

  it('stores the bytes once and restores definitions after a "reload" without reading them', async () => {
    const store = fakeIdb();
    const first = setup({}, store);
    await first.registry.addUploads([f('both.glb', 'MODEL-BYTES'), f('beat.wav', 'AUDIO')]);
    expect(await store.size()).toBe(2);

    const second = setup({ newId: () => 'g1' }, store);
    let notified = 0;
    second.registry.subscribe(() => notified++);
    expect(second.registry.getCharacter('upload:f1')).toBeUndefined();
    await second.uploads.restore();
    expect(notified).toBe(1);
    expect(second.registry.getCharacter('upload:f1')).toMatchObject({ name: 'Both', source: 'upload' });
    expect(second.registry.listDances().filter((d) => d.source === 'upload').map((d) => d.id)).toEqual(['upload:f1.1', 'upload:f1.2']);
    expect(second.registry.getSong('upload:f2')).toMatchObject({ title: 'Beat', bpm: 120 });
    expect(store.blobReads).toBe(0);
    // Bytes are read on first use only.
    expect(await (await second.uploads.blob('f1'))!.text()).toBe('MODEL-BYTES');
    expect(store.blobReads).toBe(1);
    expect(await second.uploads.blob('nope')).toBeUndefined();
    // Restoring again changes nothing.
    await second.uploads.restore();
    expect(notified).toBe(1);
  });

  it('removes one definition at a time and deletes the bytes with the last one', async () => {
    const store = fakeIdb();
    const { registry, uploads, forgotten } = setup({}, store);
    await registry.addUploads([f('both.glb'), f('song.mp3')]);
    await registry.removeUpload('upload:f1.1');
    expect(registry.getDance('upload:f1.1')).toBeUndefined();
    expect(registry.getDance('upload:f1.2')).toBeDefined();
    expect(registry.getCharacter('upload:f1')).toBeDefined();
    expect(await store.getBlob('f1')).toBeDefined();
    expect((await store.list()).find((r) => r.id === 'f1')!.dances.map((d) => d.id)).toEqual(['upload:f1.2']);
    await registry.removeUpload('upload:f1');
    await registry.removeUpload('upload:f1.2');
    expect(registry.getCharacter('upload:f1')).toBeUndefined();
    expect(await store.getBlob('f1')).toBeUndefined();
    expect((await store.list()).map((r) => r.id)).toEqual(['f2']);
    expect(forgotten).toEqual([`${UPLOAD_URL_PREFIX}f1`]);
    expect(uploads.records().map((r) => r.id)).toEqual(['f2']);
    await registry.removeUpload('upload:f2');
    expect(registry.getSong('upload:f2')).toBeUndefined();
    expect(await store.size()).toBe(0);
    // Unknown ids are ignored.
    await expect(registry.removeUpload('upload:nope')).resolves.toBeUndefined();
    await expect(registry.removeUpload('builtin:mannequin')).resolves.toBeUndefined();
    expect(registry.getCharacter('builtin:mannequin')).toBeDefined();
  });

  it('persists a tempo learned at playback time', async () => {
    const store = fakeIdb();
    const { registry } = setup({}, store);
    await registry.addUploads([f('slow.ogg')]);
    expect(registry.getSong('upload:f1')!.bpm).toBeUndefined();
    registry.setSongBpm('upload:f1', 97);
    expect(registry.getSong('upload:f1')!.bpm).toBe(97);
    await Promise.resolve();
    expect((await store.list())[0]!.songs[0]!.bpm).toBe(97);
    const reloaded = setup({}, store);
    await reloaded.uploads.restore();
    expect(reloaded.registry.getSong('upload:f1')!.bpm).toBe(97);
  });

  it('keeps uploads for the session when there is no persistent storage, and says so', async () => {
    for (const store of [null, Promise.reject(new Error('blocked')) as unknown as UploadStore]) {
      const { registry, uploads } = setup({}, store);
      const report = await registry.addUploads([f('guy.glb', 'BYTES'), f('picture.png')]);
      expect(report.characters.map((d) => d.id)).toEqual(['upload:f1']);
      expect(report.problems).toHaveLength(2);
      expect(report.problems[0]).toEqual({ file: 'guy.glb', reason: expect.stringMatching(/this session only.*gone after a reload/) });
      expect((report as { persisted?: boolean }).persisted).toBe(false);
      expect(await uploads.persistent()).toBe(false);
      expect(await (await uploads.blob('f1'))!.text()).toBe('BYTES');
      await registry.removeUpload('upload:f1');
      expect(registry.getCharacter('upload:f1')).toBeUndefined();
    }
  });

  it('falls back to the session when storing fails (storage full)', async () => {
    const store = fakeIdb();
    store.put = async () => {
      throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    };
    const { registry, uploads } = setup({}, store);
    const report = await registry.addUploads([f('guy.glb', 'BYTES')]);
    expect(report.characters).toHaveLength(1);
    expect(report.problems[0]!.reason).toMatch(/storage of this browser is full/);
    expect(await (await uploads.blob('f1'))!.text()).toBe('BYTES');
    store.put = async () => {
      throw new Error('disk on fire');
    };
    const second = await registry.addUploads([f('gal.glb')]);
    expect(second.problems[0]!.reason).toMatch(/could not be saved on this device \(disk on fire\)/);
  });

  it('ignores damaged stored records', async () => {
    const store = fakeIdb();
    await store.put({ id: 'ok', name: 'a.glb', size: 1, type: '', addedAt: 1, characters: [{ id: 'upload:ok', source: 'upload', name: 'A', url: 'thunes-upload:ok', format: 'glb' }], dances: [], songs: [] }, null);
    await store.put({ id: 'bad', name: 'b.glb', size: 1, type: '', addedAt: 2, characters: [{ id: 'builtin:mannequin', source: 'upload', name: 'Evil' }], dances: 'x', songs: [null] } as never, null);
    const { registry, uploads } = setup({}, store);
    await uploads.restore();
    expect(registry.getCharacter('upload:ok')).toBeDefined();
    expect(registry.getCharacter('builtin:mannequin')!.name).not.toBe('Evil');
    expect(uploads.records().map((r) => r.id)).toEqual(['ok']);
  });
});

describe('file loaders', () => {
  it('recognises upload URLs', () => {
    expect(uploadFileId('thunes-upload:abc')).toBe('abc');
    expect(uploadFileId('/assets/characters/a.glb')).toBeNull();
    expect(uploadFileId(undefined)).toBeNull();
  });

  it('fails readably when an uploaded file is gone or the type is unknown', async () => {
    const loaders = createFileLoaders({ uploadBlob: async () => undefined });
    await expect(loaders.character({ id: 'upload:x', source: 'upload', name: 'Gone', url: 'thunes-upload:x', format: 'glb' })).rejects.toThrow(/"Gone" cannot be loaded: the uploaded file is no longer stored/);
    await expect(loaders.song({ id: 'upload:x', source: 'upload', title: 'Gone', url: 'thunes-upload:x' })).rejects.toThrow(/no longer stored/);
    await expect(loaders.character({ id: 'library:x', source: 'library', name: 'Odd', url: '/assets/characters/odd.xyz' })).rejects.toThrow(/unsupported file type "xyz"/);
    await expect(loaders.dance({ id: 'library:x', source: 'library', name: 'None' })).rejects.toThrow(/has no file/);
  });

  it('loads an uploaded JSON dance and an uploaded song from their bytes', async () => {
    const scheme = BUILTIN_DANCES[1]!.scheme!;
    const blobs: Record<string, Blob> = { d: new Blob([JSON.stringify(scheme)]), s: new Blob(['AUDIO']), bad: new Blob(['{}']) };
    const loaders = createFileLoaders({ uploadBlob: async (id) => blobs[id] });
    const dance = await loaders.dance({ id: 'upload:d', source: 'upload', name: 'D', url: 'thunes-upload:d', format: 'json' });
    expect(dance.bpm).toBe(scheme.bpm);
    expect(dance.beats).toBe(scheme.beats);
    expect(dance.clip.tracks.length).toBeGreaterThan(10);
    expect(new TextDecoder().decode(await loaders.song({ id: 'upload:s', source: 'upload', title: 'S', url: 'thunes-upload:s' }))).toBe('AUDIO');
    await expect(loaders.dance({ id: 'upload:bad', source: 'upload', name: 'Bad', url: 'thunes-upload:bad', format: 'json' })).rejects.toThrow(/"Bad" is not a usable dance scheme/);
  });
});

describe('createAppRegistry', () => {
  it('serves built-ins, the library and uploads', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = fakeIdb();
    await store.put({ id: 'old', name: 'old.mp3', size: 1, type: '', addedAt: 1, characters: [], dances: [], songs: [{ id: 'upload:old', source: 'upload', title: 'Old', url: 'thunes-upload:old' }] }, new Blob(['OLD']));
    const registry = createAppRegistry({
      uploadStore: store,
      discovered: {
        characters: [{ file: 'characters/hero.glb', url: '/assets/characters/hero.glb', ext: 'glb', size: 1 }],
        dances: [{ file: 'dances/x.json', url: '/assets/dances/x.json', ext: 'json', size: 1, json: BUILTIN_DANCES[0]!.scheme }, { file: 'dances/bad.json', url: '', ext: 'json', size: 1, json: {} }],
        music: [{ file: 'music/tune.mp3', url: '/assets/music/tune.mp3', ext: 'mp3', size: 1, meta: { bpm: 100 } }],
      },
    });
    expect(registry.getCharacter('builtin:mannequin')).toBeDefined();
    expect(registry.getCharacter('library:hero')).toMatchObject({ name: 'Hero', source: 'library' });
    expect(registry.getDance('library:x')).toBeDefined();
    expect(registry.getSong('library:tune')).toMatchObject({ bpm: 100 });
    expect(registry.libraryProblems.map((p) => p.file)).toEqual(['dances/bad.json']);
    expect(warn).toHaveBeenCalled();
    expect((await registry.loadDance('library:x')).beats).toBe(BUILTIN_DANCES[0]!.scheme!.beats);

    let notified = 0;
    registry.subscribe(() => notified++);
    await registry.uploadsRestored;
    expect(notified).toBe(1);
    expect(registry.getSong('upload:old')).toBeDefined();
    const source = await registry.loadSong('upload:old');
    expect(source.kind === 'encoded' && new TextDecoder().decode(source.data)).toBe('OLD');
    await registry.removeUpload('upload:old');
    expect(registry.getSong('upload:old')).toBeUndefined();
    warn.mockRestore();
  });

  it('works with the real library listing and without IndexedDB (Node)', async () => {
    const registry = createAppRegistry();
    await registry.uploadsRestored;
    expect(registry.getDance('library:example-side-sway')).toMatchObject({ name: 'Example Side Sway', bpm: 110 });
    expect(await registry.uploads.persistent()).toBe(false);
    expect(registry.listCharacters().length).toBeGreaterThanOrEqual(6);
  });
});
