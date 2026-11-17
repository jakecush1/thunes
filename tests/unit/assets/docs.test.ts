/// <reference path="../../../scripts/vite/node-shim.d.ts" />
// The JSON examples in docs/ADDING-ASSETS.md must be valid: the owner will copy them.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { discoveredToDefs } from '../../../src/assets/discovered';
import { validateSongPattern } from '../../../src/assets/songPattern';
import { compileScheme, validateScheme } from '../../../src/dances';

const text = fs.readFileSync(path.resolve('docs/ADDING-ASSETS.md'), 'utf8');
const blocks = [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]!) as Record<string, unknown>);

describe('docs/ADDING-ASSETS.md', () => {
  it('has a sidecar, a dance scheme and a song pattern example', () => {
    expect(blocks).toHaveLength(3);
  });

  it('shows a sidecar whose fields are all accepted', () => {
    const meta = blocks.find((block) => block.format === undefined)!;
    const defs = discoveredToDefs({ characters: [], dances: [{ file: 'dances/hip_hop-01.fbx', url: '/assets/dances/hip_hop-01.fbx', ext: 'fbx', size: 1, meta }], music: [] });
    expect(defs.problems).toEqual([]);
    expect(defs.dances[0]).toMatchObject({ id: 'library:hip-hop-01', name: meta.name, category: meta.category, bpm: meta.bpm, beats: meta.beats, inPlace: meta.inPlace });
  });

  it('shows a dance scheme that validates and compiles', () => {
    const scheme = validateScheme(blocks.find((block) => block.format === 'thunes-dance@1'));
    const { clip } = compileScheme(scheme, { name: 'doc example' });
    expect(clip.duration).toBeCloseTo((scheme.beats * 60) / scheme.bpm, 6);
  });

  it('shows a song pattern that validates', () => {
    const pattern = validateSongPattern(blocks.find((block) => block.format === 'thunes-song@1'));
    expect(pattern.bars).toBe(4);
  });
});
