/**
 * The environment system: backdrop, floor, lights, reflections and fog,
 * all derived from state.scene and state.ui.quality.
 */
import * as THREE from 'three';
import type { AppState } from '../types';
import { createBackdrop } from './backdrop';
import { resolveBackground } from './backgrounds';
import type { BackgroundPreset } from './backgrounds';
import { createFloor } from './floor';
import { createEnvironmentTarget, createLightRig, exposureGain, fogDensity, fogVeil } from './lighting';
import { qualitySettings } from './quality';
import type { FrameContext, StageContext, StageSystem } from './system';

/** Builds the backdrop, floor, light rig, environment map and fog, and keeps them in step with the store. */
export function createEnvironmentSystem(context: StageContext): StageSystem {
  const { scene, renderer } = context;

  const backdrop = createBackdrop();
  const floor = createFloor();
  const lights = createLightRig();
  scene.add(backdrop.object, floor.object, lights.object);

  const fog = new THREE.FogExp2(0x000000, 0);
  scene.fog = fog;

  let environment: THREE.WebGLRenderTarget | null = createEnvironmentTarget(renderer);
  scene.environment = environment.texture;

  let preset: BackgroundPreset | null = null;
  let gain = 1;
  let veil = 0;
  let time = 0;
  const fogBase = new THREE.Color();

  function apply(state: AppState): void {
    const settings = state.scene;
    preset = resolveBackground(settings);
    const density = fogDensity(settings.fog);
    gain = exposureGain(settings.exposure);
    veil = fogVeil(density);

    backdrop.setPreset(preset);
    backdrop.setParams(time, gain, veil);
    floor.setLook(settings.floorStyle, settings.floorColor, preset);
    floor.setAtmosphere(density, gain);
    lights.setLook(preset, settings.brightness);
    scene.environmentIntensity = preset.light.envIntensity * Math.max(0, settings.brightness);

    // Fog is mixed in after tone mapping, in display space: scaling the colour by
    // the same gain as the backdrop keeps distant dancers and the horizon matched.
    fogBase.set(preset.fog);
    fog.color.copy(fogBase).convertLinearToSRGB().multiplyScalar(gain).convertSRGBToLinear();
    fog.density = density;
    renderer.setClearColor(fog.color, 1);
  }

  return {
    sync(state, previous) {
      if (!previous || state.scene !== previous.scene) apply(state);
      if (!previous || state.ui.quality !== previous.ui.quality) {
        const quality = qualitySettings(state.ui.quality, 1);
        lights.setShadows(quality.shadows, quality.shadowMapSize);
      }
    },
    update(frame: FrameContext) {
      time = frame.clock.time;
      backdrop.setParams(time, gain, veil);
      floor.setBeat(frame.clock.beat, frame.levels);
    },
    contextRestored() {
      // Render-target contents do not survive a lost context.
      environment?.dispose();
      environment = createEnvironmentTarget(renderer);
      scene.environment = environment.texture;
    },
    dispose() {
      if (scene.fog === fog) scene.fog = null;
      if (environment && scene.environment === environment.texture) scene.environment = null;
      environment?.dispose();
      environment = null;
      backdrop.dispose();
      floor.dispose();
      lights.dispose();
    },
  };
}
