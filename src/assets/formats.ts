/**
 * File extensions (lower case, without the dot) accepted per kind of asset.
 * Kept free of imports: the Vite plugin loads this file at build time.
 */
export const CHARACTER_EXTENSIONS: readonly string[] = ['glb', 'gltf', 'fbx'];
export const DANCE_EXTENSIONS: readonly string[] = ['glb', 'gltf', 'fbx', 'bvh', 'json'];
export const AUDIO_EXTENSIONS: readonly string[] = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'];
export const MUSIC_EXTENSIONS: readonly string[] = [...AUDIO_EXTENSIONS, 'json'];
export const MODEL_EXTENSIONS: readonly string[] = ['glb', 'gltf', 'fbx', 'bvh'];

/** Lower-case extension of a file name without the dot ('' when there is none). */
export function extensionOf(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}
