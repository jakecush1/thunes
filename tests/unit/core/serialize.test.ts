import { describe, expect, it } from 'vitest';
import {
  AUDIO_DEFAULTS,
  DANCER_DEFAULTS,
  DEFAULT_CAMERA,
  FALLBACK_CHARACTER_ID,
  FALLBACK_DANCE_ID,
  MAX_DANCERS,
  SCENE_DEFAULTS,
} from '../../../src/config';
import {
  MAX_DECODED_BYTES,
  MAX_ENCODED_LENGTH,
  buildShareUrl,
  decodeDocument,
  emptyDocument,
  encodeDocument,
  fromBase64Url,
  readShareUrl,
  sanitizeDocument,
  toBase64Url,
} from '../../../src/core/serialize';
import type { DancerState, SceneDocument } from '../../../src/types';

/** Rounds to 1e-2 (the encoder keeps 1e-4). */
const r2 = (v: number) => Math.round(v * 100) / 100;

function fullDocument(): SceneDocument {
  const dancers: DancerState[] = [];
  for (let i = 0; i < MAX_DANCERS; i++) {
    dancers.push({
      id: `dancer-${i}`,
      characterId: `library:char-${i}`,
      danceId: `upload:dance.${i}`,
      x: r2(-3 + i * 0.85),
      z: r2(-1.25 - i * 0.1),
      y: 0.35,
      rotation: r2(-170 + i * 11),
      scale: 1.25,
      speed: r2(1.5 + i * 0.01),
      offset: r2(0.125 * i + 0.01),
      trimStart: 0.1,
      trimEnd: 0.85,
      mirror: true,
      shine: 0.75,
      metal: 0.6,
      tint: '#a1b2c3',
      headSize: 1.6,
      handSize: 0.7,
      footSize: 2.2,
      shakeBody: 0.3,
      shakeArms: 0.4,
      shakeNeck: 0.5,
      shakeSpeed: 2.5,
      warpAmount: 0.45,
      warpSpeed: 3.2,
      warpWaves: 7.5,
      warpMode: 'pulse',
      warpAlong: 'x',
      warpEffect: 'z',
    });
  }
  return {
    version: 1,
    title: 'Full house — 🎉 party',
    dancers,
    scene: {
      background: 'custom',
      backgroundColor: '#010203',
      floorStyle: 'checker',
      floorColor: '#ffeedd',
      brightness: 1.4,
      exposure: 1.8,
      fog: 0.55,
      strobeIntensity: 0.6,
      strobeBpm: 128,
      strobeSync: false,
      strobeDivision: 2,
      cameraLoop: true,
      cameraLoopPeriod: 40,
      cameraLoopHeight: 3.3,
      cameraLoopTargetHeight: 1.4,
      cameraLoopDistance: 12.5,
    },
    audio: { songId: null, beatSync: false },
    camera: { position: [3.25, 2.5, -6.75], target: [0.5, 1.2, -0.25] },
  };
}

describe('sanitizeDocument', () => {
  it('returns defaults for garbage', () => {
    for (const input of [null, undefined, 42, 'x', [], true, () => 1, Symbol('s'), new Date()]) {
      expect(sanitizeDocument(input)).toEqual(emptyDocument());
    }
  });

  it('keeps a valid document unchanged', () => {
    const doc = fullDocument();
    expect(sanitizeDocument(doc)).toEqual(doc);
    expect(sanitizeDocument(doc).dancers[0]).not.toBe(doc.dancers[0]);
  });

  it('handles wrong types, NaN and Infinity field by field', () => {
    const doc = sanitizeDocument({
      title: 12,
      dancers: [
        { id: 'a', characterId: 'library:x', danceId: 'library:y', x: Number.NaN, y: Infinity, scale: '2', speed: 99, tint: 'blue', warpMode: 'x', mirror: 'true', rotation: 400 },
        'not a dancer',
        null,
        [1, 2],
        { id: 'b', characterId: 5, danceId: 'has space' },
      ],
      scene: { fog: -Infinity, floorStyle: 7, strobeDivision: 8, backgroundColor: '#GGGGGG', brightness: 1.5 },
      audio: { songId: 3, beatSync: 'no' },
      camera: { position: [0, Number.NaN, 0], target: [0, 0, 0] },
    });
    expect(doc.title).toBe('');
    expect(doc.dancers).toHaveLength(2);
    expect(doc.dancers[0]).toMatchObject({ id: 'a', x: 0, y: 0, scale: 1, speed: 3, tint: null, warpMode: 'wave', mirror: false, rotation: 40 });
    expect(doc.dancers[1]).toMatchObject({ id: 'b', characterId: FALLBACK_CHARACTER_ID, danceId: FALLBACK_DANCE_ID });
    expect(doc.scene).toEqual({ ...SCENE_DEFAULTS, brightness: 1.5 });
    expect(doc.audio).toEqual({ songId: AUDIO_DEFAULTS.songId, beatSync: AUDIO_DEFAULTS.beatSync });
    expect(doc.camera).toEqual(DEFAULT_CAMERA);
  });

  it('de-duplicates and repairs dancer ids, caps at MAX_DANCERS even for 10 000 dancers', () => {
    const many = Array.from({ length: 10_000 }, () => ({ id: 'same', characterId: 'builtin:a', danceId: 'builtin:b' }));
    const doc = sanitizeDocument({ dancers: many });
    expect(doc.dancers).toHaveLength(MAX_DANCERS);
    expect(new Set(doc.dancers.map((d) => d.id)).size).toBe(MAX_DANCERS);
    expect(doc.dancers[0].id).toBe('same');
    const bad = sanitizeDocument({ dancers: [{ id: '<img src=x>' }, { id: 'x'.repeat(100) }, { id: 'd1' }] });
    expect(new Set(bad.dancers.map((d) => d.id)).size).toBe(3);
    for (const d of bad.dancers) expect(d.id).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });

  it('restricts asset ids and background ids', () => {
    const long = 'a'.repeat(97);
    const doc = sanitizeDocument({
      dancers: [
        { characterId: long, danceId: 'javascript:alert(1)' },
        { characterId: 'a/../../b', danceId: 'ok:fine_1.2-3' },
        { characterId: ':leading', danceId: '' },
      ],
      scene: { background: 'url(http://x)' },
      audio: { songId: 'a'.repeat(96) },
    });
    // 'javascript:alert(1)' contains parentheses, so it is rejected.
    expect(doc.dancers[0]).toMatchObject({ characterId: FALLBACK_CHARACTER_ID, danceId: FALLBACK_DANCE_ID });
    expect(doc.dancers[1]).toMatchObject({ characterId: FALLBACK_CHARACTER_ID, danceId: 'ok:fine_1.2-3' });
    expect(doc.dancers[2]).toMatchObject({ characterId: FALLBACK_CHARACTER_ID, danceId: FALLBACK_DANCE_ID });
    expect(doc.scene.background).toBe(SCENE_DEFAULTS.background);
    expect(doc.audio.songId).toBe('a'.repeat(96));
  });

  it('cleans titles', () => {
    expect(sanitizeDocument({ title: '  hello\t\n  world\u0007 ' }).title).toBe('hello world');
    expect(sanitizeDocument({ title: 'x'.repeat(1_000_000) }).title).toHaveLength(60);
    expect(Array.from(sanitizeDocument({ title: '😀'.repeat(100) }).title)).toHaveLength(60);
    expect(sanitizeDocument({ title: '‮evil​' }).title).toBe('evil');
  });

  it('ignores prototype-pollution keys', () => {
    const json = '{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},"title":"ok","dancers":[{"__proto__":{"x":5},"constructor":1,"id":"a","x":1}],"scene":{"__proto__":{"fog":1}}}';
    const doc = sanitizeDocument(JSON.parse(json));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(doc)).toBe(Object.prototype);
    expect(Object.keys(doc).sort()).toEqual(['audio', 'camera', 'dancers', 'scene', 'title', 'version']);
    expect(doc.dancers[0].x).toBe(1);
    expect(Object.keys(doc.dancers[0]).sort()).toEqual(Object.keys({ ...DANCER_DEFAULTS, id: '', characterId: '', danceId: '' }).sort());
    expect(doc.scene.fog).toBe(SCENE_DEFAULTS.fog);
    expect(Object.prototype.hasOwnProperty.call(doc.dancers[0], 'constructor')).toBe(false);
  });

  it('survives deep nesting, throwing getters and proxies', () => {
    let deep: unknown = {};
    for (let i = 0; i < 100_000; i++) deep = { dancers: [deep], scene: deep };
    expect(sanitizeDocument(deep).dancers.length).toBeLessThanOrEqual(1);
    const evil = {
      title: 'ok',
      get dancers(): never {
        throw new Error('gotcha');
      },
    };
    expect(sanitizeDocument(evil)).toEqual(emptyDocument());
    const proxy = new Proxy({}, { get: () => { throw new Error('x'); }, has: () => true, ownKeys: () => { throw new Error('y'); } });
    expect(sanitizeDocument(proxy)).toEqual(emptyDocument());
  });

  it('validates cameras', () => {
    const bad = [
      { position: [0, 0, 0], target: [0, 0, 0] },
      { position: [0, 1e7, 0], target: [0, 0, 0] },
      { position: [0, 1], target: [0, 0, 0] },
      { position: '1,2,3', target: [0, 0, 0] },
      { position: [0, 1, Infinity], target: [0, 0, 0] },
    ];
    for (const camera of bad) expect(sanitizeDocument({ camera }).camera).toEqual(DEFAULT_CAMERA);
    expect(sanitizeDocument({ camera: { position: [1, 2, 3], target: [0, 1, 0] } }).camera).toEqual({ position: [1, 2, 3], target: [0, 1, 0] });
  });

  it('keeps the trim invariant', () => {
    const doc = sanitizeDocument({ dancers: [{ trimStart: 0.9, trimEnd: 0.2 }] });
    expect(doc.dancers[0].trimEnd - doc.dancers[0].trimStart).toBeGreaterThanOrEqual(0.05 - 1e-9);
  });
});

describe('encode / decode', () => {
  it('round-trips an empty scene compactly', async () => {
    const text = await encodeDocument(emptyDocument());
    expect(text.length).toBeLessThan(30);
    expect(text).toMatch(/^[zj][A-Za-z0-9_-]+$/);
    expect(await decodeDocument(text)).toEqual(emptyDocument());
  });

  it('round-trips a full 8-dancer scene with every field non-default', async () => {
    const doc = fullDocument();
    const text = await encodeDocument(doc);
    expect(text).toMatch(/^z[A-Za-z0-9_-]+$/);
    expect(await decodeDocument(text)).toEqual(doc);
    console.info(`[serialize] full 8-dancer scene encodes to ${text.length} characters`);
    expect(text.length).toBeLessThan(2000);
  });

  it('decodes the uncompressed fallback format', async () => {
    const doc = fullDocument();
    const json = JSON.stringify(doc);
    const text = 'j' + toBase64Url(new TextEncoder().encode(json));
    expect(await decodeDocument(text)).toEqual(doc);
  });

  it('base64url round-trips all lengths', () => {
    for (let n = 0; n < 20; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + n) & 255);
      expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('fails with a readable error for truncated or corrupted payloads', async () => {
    const text = await encodeDocument(fullDocument());
    const cases = [
      '',
      'z',
      'q' + text.slice(1),
      text.slice(0, Math.floor(text.length / 2)),
      text.slice(0, -3),
      text.slice(0, 20) + '!!!' + text.slice(23),
      text.slice(0, 40) + (text[40] === 'A' ? 'B' : 'A') + text.slice(41),
      'j' + toBase64Url(new TextEncoder().encode('{"title": ')),
      'j' + toBase64Url(new TextEncoder().encode('[1,2,3]')),
      'j' + toBase64Url(Uint8Array.from([0xff, 0xfe, 0x00])),
    ];
    for (const c of cases) {
      let error: unknown = null;
      try {
        const doc = await decodeDocument(c);
        // A single flipped bit may still inflate to valid JSON: then it must at least be sanitised.
        expect(sanitizeDocument(doc)).toEqual(doc);
        continue;
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/scene link/i);
    }
    await expect(decodeDocument(text.slice(0, Math.floor(text.length / 2)))).rejects.toThrow(/damaged or incomplete/);
  });

  it('refuses oversized payloads, including decompression bombs', async () => {
    await expect(decodeDocument('j' + 'A'.repeat(MAX_ENCODED_LENGTH + 10))).rejects.toThrow(/too large/);
    // ~4 MB of spaces compresses to a few kB.
    const huge = new TextEncoder().encode('{"title":"x"' + ' '.repeat(4 * 1024 * 1024) + '}');
    const stream = new Blob([huge]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const packed = new Uint8Array(await new Response(stream).arrayBuffer());
    const bomb = 'z' + toBase64Url(packed);
    expect(bomb.length).toBeLessThan(MAX_ENCODED_LENGTH);
    await expect(decodeDocument(bomb)).rejects.toThrow(/too large/);
    const plain = 'j' + toBase64Url(new Uint8Array(MAX_DECODED_BYTES + 1).fill(32));
    expect(plain.length).toBeGreaterThan(MAX_ENCODED_LENGTH);
    await expect(decodeDocument(plain)).rejects.toThrow(/too large/);
  });

  it('refuses documents from a newer version', async () => {
    const text = 'j' + toBase64Url(new TextEncoder().encode('{"version":2}'));
    await expect(decodeDocument(text)).rejects.toThrow(/newer version/);
  });

  it('sanitises hostile decoded content', async () => {
    const hostile = { __proto__: null, title: 'a\u0000b', dancers: Array.from({ length: 50 }, () => ({ x: 1e9 })) };
    const text = 'j' + toBase64Url(new TextEncoder().encode(JSON.stringify(hostile)));
    const doc = await decodeDocument(text);
    expect(doc.title).toBe('a b');
    expect(doc.dancers).toHaveLength(MAX_DANCERS);
    expect(doc.dancers[0].x).toBe(6);
  });
});

describe('share URLs', () => {
  it('round-trips through a URL and replaces an existing hash', async () => {
    const doc = fullDocument();
    const url = await buildShareUrl(doc, 'https://example.test/app/?q=1#old=2');
    expect(url.startsWith('https://example.test/app/?q=1#s=')).toBe(true);
    expect(await readShareUrl(url)).toEqual(doc);
    expect(await readShareUrl(new URL(url))).toEqual(doc);
  });

  it('returns null without an s parameter and throws readably when it is broken', async () => {
    expect(await readShareUrl('https://example.test/')).toBeNull();
    expect(await readShareUrl('https://example.test/#x=1')).toBeNull();
    expect(await readShareUrl('not a url')).toBeNull();
    await expect(readShareUrl('https://example.test/#s=zAAAA')).rejects.toThrow(/scene link/);
  });
});
