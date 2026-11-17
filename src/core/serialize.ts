/**
 * Scene documents: sanitising (the security boundary for shared links and
 * saved scenes), compact URL-safe encoding, and share URLs.
 *
 * Encoded payload = one format character + base64url bytes:
 *   'z' — deflate-raw compressed JSON (CompressionStream)
 *   'j' — plain UTF-8 JSON (fallback where CompressionStream is missing)
 * The JSON omits every value equal to its default.
 */

import {
  AUDIO_DEFAULTS,
  DANCER_DEFAULTS,
  FALLBACK_CHARACTER_ID,
  FALLBACK_DANCE_ID,
  MAX_DANCERS,
  SCENE_DEFAULTS,
} from '../config';
import type { DancerState, SceneDocument } from '../types';
import {
  AUDIO_VALIDATORS,
  DANCER_ID_RE,
  SCENE_VALIDATORS,
  applyDancerPatch,
  applyPatch,
  cameraEqual,
  cleanTitle,
  defaultCamera,
  isRecord,
  sanitizeCamera,
  validAssetId,
} from './validate';

/** Longest encoded payload accepted by decodeDocument, characters. */
export const MAX_ENCODED_LENGTH = 32 * 1024;
/** Largest decoded JSON accepted by decodeDocument, bytes (guards against decompression bombs). */
export const MAX_DECODED_BYTES = 256 * 1024;

const FORMAT_DEFLATE = 'z';
const FORMAT_JSON = 'j';

// ──────────────────────────────────────────────────────────── sanitising ──

/** A document with no dancers and default settings. */
export function emptyDocument(): SceneDocument {
  return {
    version: 1,
    title: '',
    dancers: [],
    scene: { ...SCENE_DEFAULTS },
    audio: { songId: AUDIO_DEFAULTS.songId, beatSync: AUDIO_DEFAULTS.beatSync },
    camera: defaultCamera(),
  };
}

/** A dancer with default settings. */
export function defaultDancer(id: string, characterId: string, danceId: string): DancerState {
  return { ...DANCER_DEFAULTS, id, characterId, danceId };
}

function uniqueId(base: string, used: Set<string>): string {
  let n = used.size + 1;
  let id = `${base}${n}`;
  while (used.has(id)) id = `${base}${++n}`;
  return id;
}

/**
 * Sanitises one dancer record. Non-objects give null. Invalid or duplicate
 * ids are replaced (and added to `usedIds`); invalid asset ids fall back to
 * FALLBACK_CHARACTER_ID / FALLBACK_DANCE_ID; every field is validated.
 */
export function sanitizeDancer(raw: unknown, usedIds: Set<string>): DancerState | null {
  if (!isRecord(raw)) return null;
  const rawId = Object.prototype.hasOwnProperty.call(raw, 'id') ? raw.id : undefined;
  const id = typeof rawId === 'string' && DANCER_ID_RE.test(rawId) && !usedIds.has(rawId) ? rawId : uniqueId('d', usedIds);
  usedIds.add(id);
  const characterId = validAssetId(raw.characterId) ?? FALLBACK_CHARACTER_ID;
  const danceId = validAssetId(raw.danceId) ?? FALLBACK_DANCE_ID;
  const base = defaultDancer(id, characterId, danceId);
  const next = applyDancerPatch(base, raw);
  // The patch may not override identity or the asset fallbacks.
  return next.id === id && next.characterId === characterId && next.danceId === danceId
    ? next
    : { ...next, id, characterId, danceId };
}

function sanitizeUnsafe(input: unknown): SceneDocument {
  const doc = emptyDocument();
  if (!isRecord(input)) return doc;
  doc.title = cleanTitle(input.title);
  const dancers = input.dancers;
  if (Array.isArray(dancers)) {
    const used = new Set<string>();
    const n = dancers.length;
    for (let i = 0; i < n && doc.dancers.length < MAX_DANCERS; i++) {
      const d = sanitizeDancer(dancers[i], used);
      if (d) doc.dancers.push(d);
    }
  }
  doc.scene = { ...applyPatch(doc.scene, input.scene, SCENE_VALIDATORS) };
  const audio = applyPatch({ ...AUDIO_DEFAULTS }, input.audio, AUDIO_VALIDATORS);
  doc.audio = { songId: audio.songId, beatSync: audio.beatSync };
  doc.camera = sanitizeCamera(input.camera) ?? defaultCamera();
  return doc;
}

/**
 * Turns any input into a valid, independent SceneDocument. Never throws:
 * garbage in, defaults out. Only known own keys are read; numbers are
 * clamped, enums/colours/ids validated, dancers capped at MAX_DANCERS with
 * unique ids, the title cleaned and the camera checked.
 */
export function sanitizeDocument(input: unknown): SceneDocument {
  try {
    return sanitizeUnsafe(input);
  } catch {
    // Hostile objects (throwing getters, proxies): fall back to defaults.
    return emptyDocument();
  }
}

// ────────────────────────────────────────────────────────────── encoding ──

function roundNum(v: number): number {
  const r = Math.round(v * 1e4) / 1e4;
  return r === 0 ? 0 : r;
}

function diff<T extends object>(value: T, defaults: T, omit?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value) as (keyof T & string)[]) {
    if (key === omit) continue;
    const v = value[key];
    if (v === defaults[key]) continue;
    out[key] = typeof v === 'number' ? roundNum(v) : v;
  }
  return out;
}

/** The compact JSON-ready form of a document (defaults omitted, numbers rounded to 1e-4). */
export function compactDocument(doc: SceneDocument): Record<string, unknown> {
  const clean = sanitizeDocument(doc);
  const out: Record<string, unknown> = { version: 1 };
  if (clean.title) out.title = clean.title;
  if (clean.dancers.length) {
    out.dancers = clean.dancers.map((d) => {
      const o: Record<string, unknown> = { id: d.id, characterId: d.characterId, danceId: d.danceId };
      Object.assign(o, diff(d as unknown as Record<string, unknown>, DANCER_DEFAULTS as unknown as Record<string, unknown>));
      return o;
    });
  }
  const scene = diff(clean.scene, SCENE_DEFAULTS);
  if (Object.keys(scene).length) out.scene = scene;
  const audio = diff(clean.audio, { songId: AUDIO_DEFAULTS.songId, beatSync: AUDIO_DEFAULTS.beatSync });
  if (Object.keys(audio).length) out.audio = audio;
  if (!cameraEqual(clean.camera, defaultCamera())) {
    out.camera = { position: clean.camera.position.map(roundNum), target: clean.camera.target.map(roundNum) };
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_LOOKUP = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

/** Bytes → unpadded base64url. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[n >> 18] + B64[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63];
  }
  return out;
}

/** Unpadded (or padded) base64url → bytes. Throws a readable Error on invalid input. */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const s = text.replace(/=+$/, '');
  if (s.length % 4 === 1) throw damaged();
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? B64_LOOKUP[c] : -1;
    if (v < 0) throw damaged();
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

function damaged(): Error {
  return new Error('This scene link is damaged or incomplete. Ask for the link again, and make sure it was copied in full.');
}
function tooLarge(): Error {
  return new Error('This scene link is too large to open.');
}

async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

class LimitError extends Error {}

/** Inflates deflate-raw bytes, aborting as soon as the output exceeds `cap` bytes. */
async function inflateRaw(bytes: Uint8Array<ArrayBuffer>, cap: number): Promise<Uint8Array<ArrayBuffer>> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const writing = writer
    .write(bytes)
    .then(() => writer.close())
    .catch(() => undefined);
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) throw new LimitError();
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    await writing;
    if (err instanceof LimitError) throw tooLarge();
    throw damaged();
  }
  await writing;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

/** True when this runtime can compress with deflate-raw. */
function canCompress(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

/**
 * Encodes a document as a compact URL-safe string (sanitised first; defaults
 * omitted; numbers rounded to 1e-4). Uses deflate-raw when available and
 * shorter, otherwise plain JSON.
 */
export async function encodeDocument(doc: SceneDocument): Promise<string> {
  const json = JSON.stringify(compactDocument(doc));
  const bytes = new TextEncoder().encode(json);
  const plain = FORMAT_JSON + toBase64Url(bytes);
  if (!canCompress()) return plain;
  try {
    const packed = FORMAT_DEFLATE + toBase64Url(await deflateRaw(bytes));
    return packed.length < plain.length ? packed : plain;
  } catch {
    return plain;
  }
}

/**
 * Decodes a string from encodeDocument. Throws an Error with a readable
 * message when the payload is malformed, too large (more than
 * MAX_ENCODED_LENGTH characters or MAX_DECODED_BYTES once inflated) or from
 * a newer format. The result always passes through sanitizeDocument.
 */
export async function decodeDocument(text: string): Promise<SceneDocument> {
  if (typeof text !== 'string') throw damaged();
  const s = text.trim();
  if (s.length > MAX_ENCODED_LENGTH) throw tooLarge();
  if (s.length < 2) throw damaged();
  const format = s[0];
  if (format !== FORMAT_DEFLATE && format !== FORMAT_JSON) throw damaged();
  const bytes = fromBase64Url(s.slice(1));
  let raw: Uint8Array;
  if (format === FORMAT_JSON) {
    if (bytes.byteLength > MAX_DECODED_BYTES) throw tooLarge();
    raw = bytes;
  } else {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('This browser cannot open compressed scene links. Try a recent version of Chrome, Firefox or Safari.');
    }
    raw = await inflateRaw(bytes, MAX_DECODED_BYTES);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    throw damaged();
  }
  if (!isRecord(parsed)) throw damaged();
  const version = parsed.version;
  if (typeof version === 'number' && version > 1) {
    throw new Error('This scene was made with a newer version of the app. Reload the page and try again.');
  }
  return sanitizeDocument(parsed);
}

// ─────────────────────────────────────────────────────────── share URLs ──

/** Hash parameter that carries the encoded scene. */
export const SHARE_PARAM = 's';

/** `<base without its hash>#s=<encoded document>`. */
export async function buildShareUrl(doc: SceneDocument, base: string | URL): Promise<string> {
  const url = new URL(String(base));
  url.hash = '';
  const href = url.href.replace(/#$/, '');
  return `${href}#${SHARE_PARAM}=${await encodeDocument(doc)}`;
}

/**
 * Reads a shared scene from a URL's hash. Returns null when there is no
 * `s` parameter (or the URL cannot be parsed); throws the readable decode
 * error when the parameter is present but broken.
 */
export async function readShareUrl(url: string | URL): Promise<SceneDocument | null> {
  let hash: string;
  try {
    hash = new URL(String(url)).hash;
  } catch {
    return null;
  }
  if (hash.length < 2) return null;
  const value = new URLSearchParams(hash.slice(1)).get(SHARE_PARAM);
  if (value === null) return null;
  return decodeDocument(value);
}
