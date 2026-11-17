/**
 * Loading GLB / FBX / BVH files in Node (no DOM) for the real-asset validation.
 * Plain JavaScript because the project has no Node type declarations; the
 * types are in nodeLoaders.d.mts.
 *
 * GLB: images and textures are stripped from the glTF JSON before parsing, so
 * GLTFLoader never decodes an image. FBX: a minimal document stub lets texture
 * loading fail silently. Files are only parsed as data.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';

/** Directory named by the THUNES_FIXTURES environment variable, or null. */
export const FIXTURES = process.env.THUNES_FIXTURES || null;

function installDomStubs() {
  const g = globalThis;
  if (g.self === undefined) g.self = globalThis;
  if (g.window === undefined) g.window = globalThis;
  if (g.document === undefined) {
    const element = () => ({ style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {}, getContext: () => null, src: '' });
    g.document = { createElementNS: element, createElement: element };
  }
}

function stripGlbTextures(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(buffer.subarray(20, 20 + jsonLength)));
  delete json.images;
  delete json.textures;
  delete json.samplers;
  const scrub = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      const child = value[key];
      if (child && typeof child === 'object' && typeof child.index === 'number' && /texture/i.test(key)) delete value[key];
      else scrub(child);
    }
  };
  scrub(json.materials);
  let text = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (text.length % 4)) % 4;
  if (pad) {
    const padded = new Uint8Array(text.length + pad).fill(0x20);
    padded.set(text);
    text = padded;
  }
  const rest = buffer.subarray(20 + jsonLength);
  const out = new Uint8Array(20 + text.length + rest.length);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, 0x46546c67, true);
  outView.setUint32(4, 2, true);
  outView.setUint32(8, out.length, true);
  outView.setUint32(12, text.length, true);
  outView.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  out.set(rest, 20 + text.length);
  return out.buffer;
}

/** Loads a .glb, .fbx or .bvh file from the fixtures directory the way the app's loaders would see it (minus textures). */
export async function loadAsset(name) {
  if (!FIXTURES) throw new Error('THUNES_FIXTURES is not set');
  const file = path.join(FIXTURES, name);
  const extension = path.extname(file).toLowerCase();
  const data = fs.readFileSync(file);
  if (extension === '.glb') {
    installDomStubs();
    const gltf = await new GLTFLoader().parseAsync(stripGlbTextures(new Uint8Array(data)), '');
    return { root: gltf.scene, clips: gltf.animations };
  }
  if (extension === '.fbx') {
    installDomStubs();
    const warn = console.warn;
    const error = console.error;
    console.warn = () => {};
    console.error = () => {};
    try {
      const root = new FBXLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
      return { root, clips: root.animations };
    } finally {
      console.warn = warn;
      console.error = error;
    }
  }
  if (extension === '.bvh') {
    const result = new BVHLoader().parse(data.toString('utf8'));
    const root = new THREE.Group();
    root.name = 'BVHRoot';
    root.add(result.skeleton.bones[0]);
    return { root, clips: [result.clip] };
  }
  throw new Error(`unsupported file type: ${file}`);
}
