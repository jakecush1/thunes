import type * as THREE from 'three';

export interface LoadedAsset {
  root: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

/** Directory named by the THUNES_FIXTURES environment variable, or null. */
export const FIXTURES: string | null;

/** Loads a .glb, .fbx or .bvh file from the fixtures directory (textures are skipped). */
export function loadAsset(name: string): Promise<LoadedAsset>;
