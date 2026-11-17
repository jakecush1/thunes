import { describe, expect, it } from 'vitest';
import { formatDuration, formatBpm, levelBarHeights, levelStep, LEVEL_FLOOR, LEVEL_STEPS, musicSummary, songVibe } from '../../../src/ui/panels/music/model';
import { describeUploadReport, listNames } from '../../../src/ui/panels/uploads/report';
import { alternativeAngles, validateTitle } from '../../../src/ui/panels/saveDialog/angles';
import { dancerCount, formatRelative } from '../../../src/ui/panels/libraryDialog/relative';
import { describeLinkLength, findUploadedAssets, hasUploads, uploadWarning } from '../../../src/ui/panels/shareDialog/assets';
import { BACKDROP_GROUPS, presetsOfKind, sceneSummary, strobeConsentMessage, strobePromptMessage } from '../../../src/ui/panels/scene/model';
import { BACKGROUNDS } from '../../../src/stage/backgrounds';
import { SCENE_DEFAULTS } from '../../../src/config';
import type { SongDef, UploadReport } from '../../../src/types';

const song = (over: Partial<SongDef> = {}): SongDef => ({ id: 'builtin:x', source: 'builtin', title: 'X', ...over });

describe('music model', () => {
  it('formats durations and tempos', () => {
    expect(formatDuration(168)).toBe('2:48');
    expect(formatDuration(59.6)).toBe('1:00');
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration(Number.NaN)).toBe('');
    expect(formatBpm(117.6)).toBe('118');
    expect(formatBpm(undefined)).toBe('');
  });

  it('describes a song', () => {
    expect(songVibe(song({ vibe: 'Synthwave' }))).toBe('Synthwave');
    expect(songVibe(song({ vibe: 'Funk', artist: 'Me' }))).toBe('Funk · Me');
    expect(songVibe(song({ source: 'upload' }))).toBe('Your upload');
  });

  it('summarises status for the pill', () => {
    const s = song({ id: 'a', bpm: 104 });
    expect(musicSummary({ song: s, songId: 'a', status: { state: 'playing', songId: 'a', bpm: 104 }, muted: false, entered: true })).toMatchObject({
      meta: 'Now playing · 104 bpm',
      live: true,
    });
    expect(musicSummary({ song: s, songId: 'a', status: { state: 'loading', songId: 'a' }, muted: false, entered: true }).meta).toBe('Loading…');
    expect(musicSummary({ song: s, songId: 'a', status: { state: 'error', songId: 'a', message: 'x' }, muted: false, entered: true }).meta).toBe('Could not play');
    expect(musicSummary({ song: s, songId: 'a', status: { state: 'playing', songId: 'a', bpm: 104 }, muted: true, entered: true })).toMatchObject({ live: false, meta: 'Muted · 104 bpm' });
    // A status for another song does not count.
    expect(musicSummary({ song: s, songId: 'a', status: { state: 'playing', songId: 'b', bpm: 90 }, muted: false, entered: true }).live).toBe(false);
    expect(musicSummary({ song: undefined, songId: null, status: { state: 'idle' }, muted: false, entered: true })).toMatchObject({ title: 'No music', live: false });
  });

  it('computes bar heights within range without allocating', () => {
    const out = new Float32Array(7);
    const same = levelBarHeights({ level: 0, bass: 0, mid: 0, treble: 0 }, 1, out);
    expect(same).toBe(out);
    for (const v of out) expect(v).toBeCloseTo(LEVEL_FLOOR, 5);
    levelBarHeights({ level: 1, bass: 1, mid: 1, treble: 1 }, 2, out);
    for (const v of out) {
      expect(v).toBeGreaterThan(0.8);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(levelStep(0)).toBe(0);
    expect(levelStep(1)).toBe(LEVEL_STEPS);
    expect(levelStep(2)).toBe(LEVEL_STEPS);
  });
});

describe('upload report', () => {
  const report = (over: Partial<UploadReport>): UploadReport => ({ characters: [], dances: [], songs: [], problems: [], ...over });
  it('lists names compactly', () => {
    expect(listNames(['a'])).toBe('“a”');
    expect(listNames(['a', 'b'])).toBe('“a” and “b”');
    expect(listNames(['a', 'b', 'c', 'd', 'e'])).toBe('“a”, “b”, “c” and 2 more');
  });
  it('reports what was added and why files were rejected', () => {
    const notices = describeUploadReport(
      report({
        songs: [song({ id: 'upload:1', source: 'upload', title: 'Beat' })],
        problems: [{ file: 'notes.txt', reason: 'This kind of file is not supported.' }],
      }),
    );
    expect(notices).toEqual([
      { kind: 'ok', subject: 'songs', message: 'Added 1 song: “Beat”' },
      { kind: 'warn', subject: 'problems', message: 'notes.txt: This kind of file is not supported.' },
    ]);
    const many = describeUploadReport(report({ problems: [1, 2, 3, 4].map((i) => ({ file: `f${i}`, reason: 'Bad.' })) }));
    expect(many).toHaveLength(1);
    expect(many[0]!.message).toBe('4 files could not be used: f1 (Bad); f2 (Bad); f3 (Bad); and 1 more.');
    expect(describeUploadReport(report({}))[0]!.subject).toBe('empty');
  });
});

describe('save dialog helpers', () => {
  it('validates titles', () => {
    expect(validateTitle('  My   crew ')).toEqual({ ok: true, title: 'My crew' });
    expect(validateTitle('   ').ok).toBe(false);
    expect(validateTitle('x'.repeat(61)).ok).toBe(false);
    expect(validateTitle('x'.repeat(60)).ok).toBe(true);
  });
  it('makes two different angles around the same target', () => {
    const pose = { position: [0, 1.9, 7.5] as [number, number, number], target: [0, 1, 0] as [number, number, number] };
    const [a, b] = alternativeAngles(pose);
    for (const p of [a, b]) {
      expect(p.target).toEqual(pose.target);
      expect(p.position.every(Number.isFinite)).toBe(true);
      expect(p.position[1]).toBeGreaterThan(0.29);
      expect(p.position).not.toEqual(pose.position);
    }
    expect(a.position).not.toEqual(b.position);
    // Side view really is off to the side.
    expect(Math.abs(a.position[0])).toBeGreaterThan(2);
  });
});

describe('library helpers', () => {
  const now = new Date(2026, 10, 17, 15, 0).getTime();
  it('formats relative dates', () => {
    expect(formatRelative(now - 10_000, now)).toBe('just now');
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(formatRelative(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(formatRelative(new Date(2026, 10, 16, 20, 0).getTime(), now)).toBe('yesterday');
    expect(formatRelative(new Date(2026, 10, 13, 9, 0).getTime(), now)).toBe('4 days ago');
    expect(formatRelative(new Date(2026, 2, 12).getTime(), now)).toBe('12 Mar');
    expect(formatRelative(new Date(2025, 2, 12).getTime(), now)).toBe('12 Mar 2025');
  });
  it('counts dancers', () => {
    expect(dancerCount(0)).toBe('Empty stage');
    expect(dancerCount(1)).toBe('1 dancer');
    expect(dancerCount(3)).toBe('3 dancers');
  });
});

describe('share helpers', () => {
  it('finds uploaded assets', () => {
    const doc = {
      dancers: [
        { characterId: 'upload:a', danceId: 'builtin:groove' },
        { characterId: 'upload:a', danceId: 'upload:d' },
        { characterId: 'builtin:mannequin', danceId: 'builtin:groove' },
      ],
      audio: { songId: 'upload:s', beatSync: true },
    } as unknown as Parameters<typeof findUploadedAssets>[0];
    const refs = findUploadedAssets(doc);
    expect(refs).toEqual({ characters: ['upload:a'], dances: ['upload:d'], songs: ['upload:s'] });
    expect(hasUploads(refs)).toBe(true);
    expect(hasUploads(findUploadedAssets({ dancers: [], audio: { songId: null, beatSync: true } }))).toBe(false);
  });
  it('words the warning and length', () => {
    expect(uploadWarning({ characters: ['Bob'], dances: [], songs: ['Hit'] })).toContain('the character “Bob” and the song “Hit”');
    expect(describeLinkLength(1234)).toEqual({ text: '1,234 characters', long: false });
    expect(describeLinkLength(5000).long).toBe(true);
  });
});

describe('scene helpers', () => {
  it('groups every preset exactly once', () => {
    const total = BACKDROP_GROUPS.reduce((n, g) => n + presetsOfKind(BACKGROUNDS, g.kind).length, 0);
    expect(total).toBe(BACKGROUNDS.length);
  });
  it('summarises the scene', () => {
    expect(sceneSummary(SCENE_DEFAULTS, 'Club Haze')).toBe('Club Haze · grid floor');
    expect(sceneSummary({ ...SCENE_DEFAULTS, cameraLoop: true, floorStyle: 'none', strobeIntensity: 0.4 }, 'Ink')).toBe('Ink · no floor · orbit on · strobe');
  });
  it('mentions reduced motion only when asked', () => {
    expect(strobeConsentMessage(false)).not.toMatch(/reduce motion/);
    expect(strobeConsentMessage(true)).toMatch(/reduce motion/);
    expect(strobePromptMessage(true)).toMatch(/reduced motion/);
    expect(strobeConsentMessage(false)).toMatch(/seizures/);
  });
});
