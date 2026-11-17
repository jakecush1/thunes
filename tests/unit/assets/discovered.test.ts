import { describe, expect, it } from 'vitest';
import { discoveredToDefs, prettifyName, sanitizeMeta, slugify } from '../../../src/assets/discovered';
import type { DiscoveredFile } from '../../../src/assets/discovered';
import { validateSongPattern } from '../../../src/assets/songPattern';
import { BUILTIN_SONGS } from '../../../src/audio/songs';
import { BUILTIN_DANCES } from '../../../src/dances';

const ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,95}$/;

function file(path: string, extra: Partial<DiscoveredFile> = {}): DiscoveredFile {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return { file: path, url: `/assets/${path}`, ext, size: 1, ...extra };
}

describe('slugify', () => {
  it('lower-cases and turns runs of other characters into single dashes', () => {
    expect(slugify('Hip Hop_01')).toBe('hip-hop-01');
    expect(slugify('  --Weird!!  Name??--')).toBe('weird-name');
    expect(slugify('street/Hip Hop')).toBe('street-hip-hop');
    expect(slugify('Ünïcödé Café')).toBe('unicode-cafe');
    expect(slugify('日本語')).toBe('');
    expect(slugify('a'.repeat(200))).toHaveLength(80);
    expect(slugify(`${'a'.repeat(79)}-b`)).toBe('a'.repeat(79));
  });
});

describe('prettifyName', () => {
  it('makes readable names from file names', () => {
    expect(prettifyName('hip_hop-01.fbx')).toBe('Hip Hop 01');
    expect(prettifyName('dances/street/hip_hop-01.fbx')).toBe('Hip Hop 01');
    expect(prettifyName('Samba Dancing.fbx')).toBe('Samba Dancing');
    expect(prettifyName('robotExpressive.glb')).toBe('Robot Expressive');
    expect(prettifyName('my.cool.song.mp3')).toBe('My Cool Song');
    expect(prettifyName('XBot.glb')).toBe('XBot');
    expect(prettifyName('___.glb')).toBe('Untitled');
    expect(prettifyName(`${'long '.repeat(40)}.wav`).length).toBeLessThanOrEqual(80);
  });
});

describe('sanitizeMeta', () => {
  it('keeps valid fields', () => {
    const meta = { name: '  Neon   Robot ', category: 'Bots', height: 2.1, bpm: 128, beats: 16, inPlace: true, clip: 'Dance', title: 'T', artist: 'A', vibe: 'V' };
    expect(sanitizeMeta(meta)).toEqual({ ...meta, name: 'Neon Robot' });
    expect(sanitizeMeta({ clip: 2 })).toEqual({ clip: 2 });
  });

  it('drops out-of-range numbers, wrong types and unknown fields', () => {
    expect(sanitizeMeta({ bpm: 29.9, height: 0.29 })).toEqual({});
    expect(sanitizeMeta({ bpm: 300.1, height: 5.01 })).toEqual({});
    expect(sanitizeMeta({ bpm: 30, height: 5 })).toEqual({ bpm: 30, height: 5 });
    expect(sanitizeMeta({ bpm: '120', height: NaN, beats: -4, inPlace: 'yes', clip: -1, name: 42, title: '', artist: '   ', extra: 1 })).toEqual({});
    expect(sanitizeMeta({ clip: 1.5 })).toEqual({});
    expect(sanitizeMeta(null)).toEqual({});
    expect(sanitizeMeta('name')).toEqual({});
    expect(sanitizeMeta([{ name: 'x' }])).toEqual({});
  });

  it('cuts strings to their limits', () => {
    const meta = sanitizeMeta({ name: 'n'.repeat(500), category: 'c'.repeat(500), vibe: 'v'.repeat(500), artist: 'a'.repeat(500), clip: 'k'.repeat(500) });
    expect(meta.name).toHaveLength(80);
    expect(meta.category).toHaveLength(40);
    expect(meta.vibe).toHaveLength(40);
    expect(meta.artist).toHaveLength(80);
    expect(meta.clip).toHaveLength(120);
  });
});

describe('discoveredToDefs', () => {
  it('accepts an empty or partial listing', () => {
    expect(discoveredToDefs({})).toEqual({ characters: [], dances: [], songs: [], problems: [] });
  });

  it('builds character definitions', () => {
    const { characters, problems } = discoveredToDefs({
      characters: [file('characters/pack/Knight_02.gltf'), file('characters/Robo Kid.glb', { meta: { name: 'Robo', height: 1.2, category: 'Bots', bpm: 999 } }), file('characters/guy.FBX', { ext: 'fbx' })],
    });
    expect(problems).toEqual([]);
    expect(characters).toEqual([
      { id: 'library:robo-kid', source: 'library', name: 'Robo', url: '/assets/characters/Robo Kid.glb', format: 'glb', category: 'Bots', height: 1.2 },
      { id: 'library:guy', source: 'library', name: 'Guy', url: '/assets/characters/guy.FBX', format: 'fbx' },
      { id: 'library:pack-knight-02', source: 'library', name: 'Knight 02', url: '/assets/characters/pack/Knight_02.gltf', format: 'gltf' },
    ]);
  });

  it('builds dance definitions with metadata', () => {
    const { dances } = discoveredToDefs({
      dances: [file('dances/hip_hop-01.fbx', { meta: { bpm: 96, beats: 32, inPlace: true, category: 'Street' } }), file('dances/spin.bvh'), file('dances/one.glb', { clips: ['Only'] })],
    });
    expect(dances).toEqual([
      { id: 'library:hip-hop-01', source: 'library', name: 'Hip Hop 01', category: 'Street', inPlace: true, url: '/assets/dances/hip_hop-01.fbx', format: 'fbx', bpm: 96, beats: 32 },
      { id: 'library:one', source: 'library', name: 'One', url: '/assets/dances/one.glb', format: 'glb' },
      { id: 'library:spin', source: 'library', name: 'Spin', url: '/assets/dances/spin.bvh', format: 'bvh' },
    ]);
  });

  it('yields one dance per clip of a multi-clip file, unless the sidecar picks one', () => {
    const multi = file('dances/Party Pack.glb', { clips: ['Wave', '', 'Spin Jump', 'Wave'], meta: { bpm: 120 } });
    const { dances } = discoveredToDefs({ dances: [multi] });
    expect(dances.map((d) => [d.id, d.name, d.clip, d.bpm])).toEqual([
      ['library:party-pack.wave', 'Party Pack · Wave', 0, 120],
      ['library:party-pack.clip-2', 'Party Pack · Clip 2', 1, 120],
      ['library:party-pack.spin-jump', 'Party Pack · Spin Jump', 2, 120],
      ['library:party-pack.wave-2', 'Party Pack · Wave', 3, 120],
    ]);
    const picked = discoveredToDefs({ dances: [{ ...multi, meta: { clip: 'Spin Jump', name: 'Spinner' } }] }).dances;
    expect(picked).toEqual([{ id: 'library:party-pack', source: 'library', name: 'Spinner', url: multi.url, format: 'glb', clip: 'Spin Jump' }]);
    expect(discoveredToDefs({ dances: [{ ...multi, meta: { clip: 3 } }] }).dances[0]!.clip).toBe(3);
  });

  it('reports dance files without clips and invalid schemes', () => {
    const { dances, problems } = discoveredToDefs({
      dances: [file('dances/still.glb', { clips: [] }), file('dances/bad.json', { json: { format: 'thunes-dance@1', beats: -1 } }), file('dances/odd.xyz')],
    });
    expect(dances).toEqual([]);
    expect(problems.map((p) => p.file)).toEqual(['dances/bad.json', 'dances/odd.xyz', 'dances/still.glb']);
    expect(problems[0]!.reason).toMatch(/Not a usable dance scheme/);
    expect(problems[2]!.reason).toMatch(/no animation clips/);
  });

  it('inlines valid dance schemes and song patterns', () => {
    const scheme = BUILTIN_DANCES[0]!.scheme!;
    const pattern = BUILTIN_SONGS[0]!.pattern!;
    const { dances, songs, problems } = discoveredToDefs({
      dances: [file('dances/my-move.json', { json: JSON.parse(JSON.stringify(scheme)), meta: { name: 'Mine', bpm: 90 } })],
      music: [file('music/my-loop.json', { json: JSON.parse(JSON.stringify(pattern)), meta: { artist: 'Me', vibe: 'calm' } })],
    });
    expect(problems).toEqual([]);
    expect(dances[0]).toMatchObject({ id: 'library:my-move', name: 'Mine', bpm: 90, beats: scheme.beats });
    expect(dances[0]!.scheme).toEqual(scheme);
    expect(dances[0]!.url).toBeUndefined();
    expect(songs[0]).toMatchObject({ id: 'library:my-loop', title: 'My Loop', artist: 'Me', vibe: 'calm', bpm: pattern.bpm });
    expect(songs[0]!.pattern).toEqual(pattern);
    expect(songs[0]!.url).toBeUndefined();
  });

  it('builds song definitions', () => {
    const { songs, problems } = discoveredToDefs({
      music: [
        file('music/Night Bus (demo).mp3', { meta: { title: 'Night Bus', artist: 'Someone', bpm: 124, vibe: 'late', category: 'Mine' } }),
        file('music/loop_01.wav'),
        file('music/named.ogg', { meta: { name: 'By Name', bpm: 10 } }),
        file('music/cover.jpg'),
        file('music/broken.json', { json: { format: 'thunes-song@1', bpm: 120 } }),
      ],
    });
    expect(songs).toEqual([
      { id: 'library:night-bus-demo', source: 'library', title: 'Night Bus', category: 'Mine', artist: 'Someone', vibe: 'late', url: '/assets/music/Night Bus (demo).mp3', bpm: 124 },
      { id: 'library:loop-01', source: 'library', title: 'Loop 01', url: '/assets/music/loop_01.wav' },
      { id: 'library:named', source: 'library', title: 'By Name', url: '/assets/music/named.ogg' },
    ]);
    expect(problems.map((p) => p.file)).toEqual(['music/broken.json', 'music/cover.jpg']);
  });

  it('gives unique, stable, well-formed ids', () => {
    const list = [
      file('characters/Robot.glb'),
      file('characters/robot.fbx'),
      file('characters/ROBOT.gltf'),
      file('characters/日本語.glb'),
      file('characters/ё.glb'),
      file(`characters/${'x'.repeat(120)}.glb`),
      file(`characters/${'x'.repeat(120)}y.glb`),
      file('characters/-.-.glb'),
    ];
    const a = discoveredToDefs({ characters: list }).characters;
    const b = discoveredToDefs({ characters: [...list].reverse() }).characters;
    expect(a).toEqual(b);
    const ids = a.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(ID);
      expect(id.length).toBeLessThanOrEqual('library:'.length + 80);
    }
    expect(ids).toContain('library:robot');
    expect(ids).toContain('library:robot-2');
    expect(ids).toContain('library:robot-3');
    expect(ids).toContain('library:asset');
    // Adding an unrelated file does not change existing ids.
    const more = discoveredToDefs({ characters: [...list, file('characters/zebra.glb'), file('characters/alpha.glb')] }).characters;
    for (const def of a) expect(more.find((d) => d.url === def.url)!.id).toBe(def.id);
    // Clip ids stay inside the pattern too.
    const clips = discoveredToDefs({ dances: [file(`dances/${'d'.repeat(120)}.glb`, { clips: ['A really long clip name that goes on and on', 'B'] })] }).dances;
    for (const def of clips) {
      expect(def.id).toMatch(ID);
      expect(def.id.length).toBeLessThanOrEqual('library:'.length + 80);
    }
    expect(new Set(clips.map((d) => d.id)).size).toBe(2);
  });

  it('keeps ids of the three kinds independent', () => {
    const defs = discoveredToDefs({ characters: [file('characters/samba.glb')], dances: [file('dances/samba.fbx')], music: [file('music/samba.mp3')] });
    expect([defs.characters[0]!.id, defs.dances[0]!.id, defs.songs[0]!.id]).toEqual(['library:samba', 'library:samba', 'library:samba']);
  });
});

describe('validateSongPattern', () => {
  it('accepts every built-in pattern', () => {
    for (const song of BUILTIN_SONGS) expect(validateSongPattern(JSON.parse(JSON.stringify(song.pattern)))).toBeTruthy();
  });

  it('explains what is wrong', () => {
    const good = JSON.parse(JSON.stringify(BUILTIN_SONGS[0]!.pattern)) as Record<string, unknown>;
    expect(() => validateSongPattern(null)).toThrow(/JSON object/);
    expect(() => validateSongPattern({ ...good, format: 'x' })).toThrow(/thunes-song@1/);
    expect(() => validateSongPattern({ ...good, bpm: 1000 })).toThrow(/bpm/);
    expect(() => validateSongPattern({ ...good, bars: 2.5 })).toThrow(/bars/);
    expect(() => validateSongPattern({ ...good, tracks: {} })).toThrow(/tracks/);
    expect(() => validateSongPattern({ ...good, tracks: { a: { kind: 'kazoo' } } })).toThrow(/track "a"/);
    expect(() => validateSongPattern({ ...good, arrangement: ['nope'] })).toThrow(/nope/);
    expect(() => validateSongPattern({ ...good, bars: (good.bars as number) + 1 })).toThrow(/bars/);
    expect(() => validateSongPattern({ ...good, sections: { a: { bars: 1, parts: { ghost: 'x...' } } }, arrangement: ['a'] })).toThrow(/unknown track "ghost"/);
  });
});
