/**
 * The stage is a small composition root over "systems". A system owns one
 * concern (environment, strobe, dancers, pointer interaction, camera loop…),
 * receives the shared StageContext when it is created and takes part in the
 * frame through the optional hooks below.
 */
import type * as THREE from 'three';
import type { AppState, AssetRegistry, AudioLevels, ClockSnapshot, StageDebugInfo, Store } from '../types';

/** Per-frame input. The object is reused between frames: read it, do not keep it. */
export interface FrameContext {
  clock: ClockSnapshot;
  levels: AudioLevels;
  state: AppState;
}

export interface StageSystem {
  /** Called once right after creation with `previous === null`, then synchronously on every store change. Diff by reference. */
  sync?(state: AppState, previous: AppState | null): void;
  /** Called once per rendered frame, before the scene is drawn. Must not allocate. */
  update?(frame: FrameContext): void;
  /** Called right before a capture render: hide gizmos, overlays and anything that must not appear in pictures. */
  beforeCapture?(): void;
  /** Called right after a capture render: undo beforeCapture. */
  afterCapture?(): void;
  /** The WebGL context came back after being lost: rebuild render-target contents (three.js re-uploads ordinary textures and buffers itself). */
  contextRestored?(): void;
  /** `stage.resync()` was called: realign anything that keeps its own phase (dancers) to the shared beat. */
  resync?(): void;
  /** Lets a system contribute to `stage.debug()` (for example the dancer list). Mutate `info` in place. */
  debug?(info: StageDebugInfo): void;
  /** Release GPU resources, DOM nodes and listeners. */
  dispose?(): void;
}

/** Everything a system may touch. Created once by createStage. */
export interface StageContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /**
   * The point the camera looks at / orbits (world space, metres). Systems that
   * move the camera (orbit controls, camera loop) update this together with
   * `camera` so `stage.getCameraPose()` stays truthful.
   */
  cameraTarget: THREE.Vector3;
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  store: Store;
  registry: AssetRegistry;
}

/** Builds one system. Factories run in list order; systems update in the same order. */
export type StageSystemFactory = (context: StageContext) => StageSystem;
