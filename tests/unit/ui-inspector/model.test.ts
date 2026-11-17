import { describe, expect, it } from 'vitest';
import { DANCER_DEFAULTS, DANCER_FIELDS } from '../../../src/config';
import {
  BODY_SHAKE_SLIDERS,
  BODY_SIZE_SLIDERS,
  danceNote,
  danceShortlist,
  isTabAtDefaults,
  MOTION_SLIDERS,
  MOVE_SLIDERS,
  resetPatch,
  TAB_RESET_KEYS,
  WARP_SLIDERS,
} from '../../../src/ui/panels/inspector/model';
import { categoryOptions, filterItems, lastUsedDance, summarizeUpload } from '../../../src/ui/panels/picker/model';

describe('inspector model', () => {
  it('builds every slider from the config fields', () => {
    const specs = [...MOVE_SLIDERS, ...MOTION_SLIDERS, ...BODY_SIZE_SLIDERS, ...BODY_SHAKE_SLIDERS, ...WARP_SLIDERS];
    expect(new Set(specs.map((s) => s.key)).size).toBe(Object.keys(DANCER_FIELDS).length);
    for (const spec of specs) expect(spec.field).toBe(DANCER_FIELDS[spec.key]);
  });

  it('resets a tab to DANCER_DEFAULTS and keeps the floor position', () => {
    expect(resetPatch('look')).toEqual({ shine: null, metal: null, tint: null });
    expect(resetPatch('move')).toEqual({ rotation: 0, scale: 1, y: 0 });
    expect(resetPatch('warp').warpMode).toBe('wave');
    const all = Object.values(TAB_RESET_KEYS).flat();
    expect(all).not.toContain('x');
    expect(all).not.toContain('z');
  });

  it('knows when a tab is already at its defaults', () => {
    expect(isTabAtDefaults('motion', DANCER_DEFAULTS)).toBe(true);
    expect(isTabAtDefaults('motion', { ...DANCER_DEFAULTS, mirror: true })).toBe(false);
    expect(isTabAtDefaults('move', { ...DANCER_DEFAULTS, x: 3 })).toBe(true);
    expect(isTabAtDefaults('look', { ...DANCER_DEFAULTS, shine: 0.5 })).toBe(false);
  });

  it('keeps the current dance visible in the shortlist', () => {
    const dances = 'abcdefghij'.split('').map((id) => ({ id }));
    expect(danceShortlist(dances, 'b', 7, 5).map((d) => d.id).join('')).toBe('abcdefg');
    expect(danceShortlist(dances, 'f', 7, 5).map((d) => d.id).join('')).toBe('fabcdeg');
    expect(danceShortlist(dances, 'j', 7, 5).map((d) => d.id).join('')).toBe('jabcdef');
    expect(danceShortlist(dances, 'zz', 3).map((d) => d.id).join('')).toBe('abc');
    expect(danceShortlist(dances, null, 2).length).toBe(2);
  });

  it('describes a dance length', () => {
    expect(danceNote({ beats: 8, bpm: 120 })).toBe('8 beats');
    expect(danceNote({ bpm: 101.6 })).toBe('102 bpm');
    expect(danceNote(undefined)).toBe('');
  });
});

describe('picker model', () => {
  const items = [
    { id: 'builtin:a', name: 'Two-Step Groove', source: 'builtin', category: 'Groove' },
    { id: 'builtin:b', name: 'Robot', source: 'builtin', category: 'Silly' },
    { id: 'builtin:c', name: 'Knee Bounce', source: 'builtin', category: 'Groove' },
    { id: 'upload:x', name: 'My Robot Walk', source: 'upload', category: 'Silly' },
  ];

  it('lists categories with counts and an uploads chip', () => {
    expect(categoryOptions(items)).toEqual([
      { value: 'all', label: 'All', count: 4 },
      { value: 'cat:Groove', label: 'Groove', count: 2 },
      { value: 'cat:Silly', label: 'Silly', count: 1 },
      { value: 'uploads', label: 'My uploads', count: 1 },
    ]);
    expect(categoryOptions(items.slice(0, 2)).map((o) => o.value)).toEqual(['all', 'cat:Groove', 'cat:Silly']);
  });

  it('filters by category and every search word, ignoring case and accents', () => {
    expect(filterItems(items, 'all', 'robot').map((i) => i.id)).toEqual(['builtin:b', 'upload:x']);
    expect(filterItems(items, 'uploads', '').map((i) => i.id)).toEqual(['upload:x']);
    expect(filterItems(items, 'cat:Groove', '').map((i) => i.id)).toEqual(['builtin:a', 'builtin:c']);
    expect(filterItems(items, 'all', 'GROOVE knee').map((i) => i.id)).toEqual(['builtin:c']);
    expect(filterItems(items, 'all', 'rôbot walk').map((i) => i.id)).toEqual(['upload:x']);
    expect(filterItems(items, 'cat:Silly', 'groove')).toEqual([]);
  });

  it('summarises an upload report', () => {
    const empty = { characters: [], dances: [], songs: [], problems: [] };
    expect(summarizeUpload(empty)).toBe('Nothing was added.');
    expect(summarizeUpload({ ...empty, characters: [{ id: 'upload:1', source: 'upload', name: 'A' }] })).toBe('Added 1 character.');
    expect(
      summarizeUpload({
        ...empty,
        characters: [{ id: 'upload:1', source: 'upload', name: 'A' }],
        dances: [
          { id: 'upload:2', source: 'upload', name: 'B' },
          { id: 'upload:3', source: 'upload', name: 'C' },
        ],
        problems: [{ file: 'x.txt', reason: 'Not a model.' }],
      }),
    ).toBe('Added 1 character and 2 dances. 1 file could not be used.');
  });

  it('remembers the dance most recently used on stage', () => {
    const a = { id: '1', danceId: 'd1' };
    const b = { id: '2', danceId: 'd2' };
    expect(lastUsedDance(undefined, [a, b], null)).toBe('d2');
    expect(lastUsedDance(undefined, [], 'd9')).toBe('d9');
    expect(lastUsedDance([a, b], [{ ...a, danceId: 'd3' }, b], 'd2')).toBe('d3');
    expect(lastUsedDance([a], [a, { id: '3', danceId: 'd4' }], 'd1')).toBe('d4');
    expect(lastUsedDance([a, b], [a], 'd2')).toBe('d2');
  });
});
