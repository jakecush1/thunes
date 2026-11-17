/**
 * The light rig: hemisphere fill, a shadow-casting key light and a coloured
 * rim light, tinted per background preset and scaled by scene.brightness, plus
 * a code-generated environment map for reflections and the fog mapping.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { STAGE_RADIUS } from '../config';
import type { BackgroundPreset } from './backgrounds';

/** Half-size (metres) of the key light's square shadow frustum: the stage disc plus room for limbs and shadows. */
export const SHADOW_HALF_EXTENT = STAGE_RADIUS + 3;

/** Where the key light sits relative to the stage centre (front-left, high). Unit vector. */
const KEY_DIRECTION = new THREE.Vector3(-5.5, 11, 7).normalize();
const KEY_DISTANCE = 24;
/** Where the rim light sits (behind and well to the right, so it catches the dancers' edges as seen from the front). Unit vector. */
const RIM_DIRECTION = new THREE.Vector3(6.5, 4.5, -5.5).normalize();

/**
 * Exponential-squared fog density (per metre) for the scene.fog slider.
 * 0 → 0 (clear); 0.2 → a faint depth cue; 1 → dancers 8 m away are mostly haze.
 */
export function fogDensity(fog: number): number {
  const f = Math.min(1, Math.max(0, Number.isFinite(fog) ? fog : 0));
  return 0.15 * Math.pow(f, 1.5);
}

/**
 * How much (0..1) the fog hides the backdrop, treating it as `distance` metres away.
 */
export function fogVeil(density: number, distance = 25): number {
  const x = density * distance;
  return 1 - Math.exp(-x * x);
}

/**
 * Display-space gain for the un-tone-mapped graphic layers (backdrop, floor
 * pattern, fog colour) so they follow the exposure slider: 1 at exposure 1.
 */
export function exposureGain(exposure: number): number {
  return Math.pow(Math.max(0, exposure), 1 / 2.2);
}

/**
 * Prefiltered studio-room environment for image-based reflections.
 * The caller owns the returned target and must dispose it.
 */
export function createEnvironmentTarget(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const generator = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const target = generator.fromScene(room, 0.04);
  room.dispose();
  generator.dispose();
  return target;
}

export interface LightRig {
  readonly object: THREE.Object3D;
  readonly key: THREE.DirectionalLight;
  readonly rim: THREE.DirectionalLight;
  readonly fill: THREE.HemisphereLight;
  /** Tint and intensities. `brightness` multiplies every light. */
  setLook(preset: BackgroundPreset, brightness: number): void;
  /** Turn the key light's shadows on/off and (re)size the shadow map (texels per edge). */
  setShadows(enabled: boolean, mapSize: number): void;
  dispose(): void;
}

export function createLightRig(): LightRig {
  const object = new THREE.Group();
  object.name = 'lights';

  const fill = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  fill.name = 'fill';
  object.add(fill);

  const key = new THREE.DirectionalLight(0xffffff, 1);
  key.name = 'key';
  key.position.copy(KEY_DIRECTION).multiplyScalar(KEY_DISTANCE);
  key.target.position.set(0, 0, 0);
  const shadowCamera = key.shadow.camera;
  shadowCamera.left = -SHADOW_HALF_EXTENT;
  shadowCamera.right = SHADOW_HALF_EXTENT;
  shadowCamera.top = SHADOW_HALF_EXTENT;
  shadowCamera.bottom = -SHADOW_HALF_EXTENT;
  shadowCamera.near = 4;
  shadowCamera.far = KEY_DISTANCE + SHADOW_HALF_EXTENT + 8;
  shadowCamera.updateProjectionMatrix();
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.015;
  key.shadow.mapSize.set(2048, 2048);
  object.add(key, key.target);

  const rim = new THREE.DirectionalLight(0xffffff, 1);
  rim.name = 'rim';
  rim.position.copy(RIM_DIRECTION).multiplyScalar(KEY_DISTANCE);
  rim.target.position.set(0, 1, 0);
  object.add(rim, rim.target);

  return {
    object,
    key,
    rim,
    fill,
    setLook(preset, brightness) {
      const hints = preset.light;
      const b = Math.max(0, brightness);
      key.color.set(hints.key);
      key.intensity = hints.keyIntensity * b;
      fill.color.set(hints.fill);
      fill.groundColor.set(hints.bounce);
      fill.intensity = hints.fillIntensity * b;
      rim.color.set(hints.rim);
      rim.intensity = hints.rimIntensity * b;
    },
    setShadows(enabled, mapSize) {
      key.castShadow = enabled;
      if (!enabled) {
        key.shadow.map?.dispose();
        key.shadow.map = null;
        return;
      }
      // Keep the penumbra about the same physical width at every resolution.
      key.shadow.radius = (2.5 * mapSize) / 2048;
      if (key.shadow.mapSize.x !== mapSize) {
        key.shadow.mapSize.set(mapSize, mapSize);
        key.shadow.map?.dispose();
        key.shadow.map = null;
      }
    },
    dispose() {
      key.shadow.map?.dispose();
      key.shadow.map = null;
      key.dispose();
      rim.dispose();
      fill.dispose();
      object.removeFromParent();
    },
  };
}
