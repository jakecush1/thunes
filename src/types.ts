/**
 * Shared data contracts.
 *
 * Three layers:
 *   1. State        — plain serialisable data owned by the store (what is on stage, how it looks).
 *   2. Definitions  — catalogue entries for characters, dances and songs (what CAN be put on stage).
 *   3. Services     — the interfaces the modules expose to each other (store, registry, audio, stage…).
 *
 * State and definitions are JSON-compatible. Runtime objects (three.js scenes,
 * audio buffers) only appear behind the service interfaces.
 */

import type * as THREE from 'three';
import type { CanonicalBone } from './rig/bones';
import type { Rig } from './rig/rig';
import type { DanceScheme } from './dances/scheme';
import type { SongPattern } from './audio/pattern';
import type { ProceduralCharacterSpec } from './characters/spec';

// ───────────────────────────────────────────────────────────── 1. State ──

export type Axis = 'x' | 'y' | 'z';
export type WarpMode = 'wave' | 'pulse';
/** Graphic patterns ('grid', 'checker', 'tiles'), no pattern ('none'), or a textured ground. */
export type FloorStyle = 'grid' | 'checker' | 'tiles' | 'none' | 'grass' | 'concrete' | 'dirt' | 'sand';
export type InteractionMode = 'look' | 'grab' | 'both';
export type Quality = 'low' | 'medium' | 'high';

/** Everything adjustable about one dancer. Ranges and defaults live in config.ts. */
export interface DancerSettings {
  // Placement
  /** Position on the floor, metres. +X is stage right as seen from the default camera, +Z is toward the camera. */
  x: number;
  z: number;
  /** Lift above the floor, metres. */
  y: number;
  /** Heading in degrees about the vertical axis. 0 faces +Z (the default camera). */
  rotation: number;
  /** Multiplier on the character's normalised height. */
  scale: number;

  // Motion
  /** Playback-rate multiplier. 0 freezes the pose. */
  speed: number;
  /** Phase offset as a fraction of the (trimmed) loop, 0..1. Lets clones dance in canon. */
  offset: number;
  /** The loop plays the clip between these fractions (0..1) of its length. */
  trimStart: number;
  trimEnd: number;
  /** Swap left and right. */
  mirror: boolean;

  // Look — null keeps the character's own material values
  /** 0 = matte … 1 = glossy. */
  shine: number | null;
  /** 0 = dielectric … 1 = metal. */
  metal: number | null;
  /** '#rrggbb' colour multiplied into the surface colour. */
  tint: string | null;

  // Body
  headSize: number;
  handSize: number;
  footSize: number;
  /** Procedural shake layered on top of the dance, 0..1 per body region. */
  shakeBody: number;
  shakeArms: number;
  shakeNeck: number;
  shakeSpeed: number;

  // Warp — a travelling vertex wave
  /** 0 disables the effect. */
  warpAmount: number;
  warpSpeed: number;
  /** Number of wave cycles along the body. */
  warpWaves: number;
  /** 'wave' offsets vertices along warpEffect; 'pulse' scales them (swelling and pinching). */
  warpMode: WarpMode;
  /** Axis (character space) the wave travels along. */
  warpAlong: Axis;
  /** Axis (character space) the vertices move along. */
  warpEffect: Axis;
}

export interface DancerState extends DancerSettings {
  /** Unique within the scene. */
  id: string;
  /** Registry id of the character, e.g. 'builtin:mannequin', 'library:robot', 'upload:1f3a…'. */
  characterId: string;
  /** Registry id of the dance. */
  danceId: string;
}

export interface SceneSettings {
  /** Background preset id (see stage/backgrounds.ts), or 'custom' for a solid backgroundColor. */
  background: string;
  /** '#rrggbb', used when background === 'custom'. */
  backgroundColor: string;
  floorStyle: FloorStyle;
  /** '#rrggbb' for the floor lines/tiles, or null to follow the background preset. */
  floorColor: string | null;
  /** Light multiplier. */
  brightness: number;
  /** Tone-mapping exposure. */
  exposure: number;
  /** 0 = clear … 1 = thick. */
  fog: number;
  /** 0 = off … 1 = full white flashes. */
  strobeIntensity: number;
  /** Flashes per minute when strobeSync is off (the stage never exceeds three flashes per second). */
  strobeBpm: number;
  /** Flash on the song's beat instead of at strobeBpm. */
  strobeSync: boolean;
  /** When synced: flash once every this many beats. */
  strobeDivision: 1 | 2 | 4;
  /** Auto-orbiting camera. While on, pointer interaction with the stage is disabled. */
  cameraLoop: boolean;
  /** Seconds per orbit. */
  cameraLoopPeriod: number;
  cameraLoopHeight: number;
  cameraLoopTargetHeight: number;
  cameraLoopDistance: number;
}

export interface AudioSettings {
  /** Registry id of the song, or null for silence. */
  songId: string | null;
  muted: boolean;
  /** 0..1 */
  volume: number;
  /** Dancers (whose dance has a tempo) and the strobe follow the song's beat. */
  beatSync: boolean;
}

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

/** Session/UI state. Never saved in a scene, never part of undo history. */
export interface UiState {
  selectedId: string | null;
  mode: InteractionMode;
  quality: Quality;
  uiHidden: boolean;
  /** The splash screen has been dismissed (so audio may play). */
  entered: boolean;
  /** The viewer has agreed to flashing lights this session. Strobe never runs while false. */
  strobeAllowed: boolean;
  /**
   * A shared scene was opened and the visitor has not chosen to edit it yet:
   * the editing UI is hidden behind a "Remix" button and the stage ignores
   * selection and dragging (orbiting still works).
   */
  viewOnly: boolean;
}

export interface AppState {
  title: string;
  dancers: readonly DancerState[];
  scene: SceneSettings;
  audio: AudioSettings;
  camera: CameraPose;
  ui: UiState;
}

/** A saved or shared scene: the serialisable subset of AppState. */
export interface SceneDocument {
  version: 1;
  title: string;
  dancers: DancerState[];
  scene: SceneSettings;
  audio: Pick<AudioSettings, 'songId' | 'beatSync'>;
  camera: CameraPose;
}

// ─────────────────────────────────────────────────────── 2. Definitions ──

/**
 * Where an asset comes from:
 *   builtin — generated in code, always available (the placeholders).
 *   library — a file in public/assets/, discovered automatically.
 *   upload  — a file added in the browser, kept in IndexedDB on this device.
 */
export type AssetSource = 'builtin' | 'library' | 'upload';

export type ModelFormat = 'glb' | 'gltf' | 'fbx' | 'bvh';

interface AssetDefBase {
  /** `${source}:${slug}` — stable across sessions, used in saved scenes. */
  id: string;
  source: AssetSource;
  /** Picker grouping, free text. */
  category?: string;
}

export interface CharacterDef extends AssetDefBase {
  name: string;
  /** Normalised height in metres (default config.CHARACTER_HEIGHT). */
  height?: number;
  /** Exactly one of `procedural` or `url` is set. */
  procedural?: ProceduralCharacterSpec;
  url?: string;
  format?: ModelFormat;
}

export interface DanceDef extends AssetDefBase {
  name: string;
  /** Native tempo. With `beats` it enables beat sync. */
  bpm?: number;
  /** Loop length in beats. For file dances with a bpm this defaults to duration × bpm / 60. */
  beats?: number;
  /** Remove horizontal travel so the dancer stays on its spot. */
  inPlace?: boolean;
  /** Exactly one of `scheme` or `url` is set. */
  scheme?: DanceScheme;
  url?: string;
  format?: ModelFormat | 'json';
  /** Which animation clip inside the file (name or index). Default: the first. */
  clip?: string | number;
}

export interface SongDef extends AssetDefBase {
  title: string;
  artist?: string;
  /** Short mood/genre label shown in the list. */
  vibe?: string;
  /** Tempo. If absent it is estimated when the song is first played. */
  bpm?: number;
  /** Seconds, if known. */
  duration?: number;
  /** Exactly one of `pattern` or `url` is set. */
  pattern?: SongPattern;
  url?: string;
}

// ────────────────────────────────────────────────────────── 3. Services ──

// — Store —

export interface UpdateOptions {
  /**
   * Part of a continuous gesture (slider drag, dancer drag). Transient updates
   * are applied immediately but collapsed into a single undo step when
   * `store.commit()` is called at the end of the gesture.
   */
  transient?: boolean;
}

export type StoreListener = (state: AppState, previous: AppState) => void;

/**
 * The single source of truth. State is immutable: every change produces a new
 * AppState in which unchanged branches keep their identity, so consumers can
 * diff by reference (`state.dancers !== previous.dancers`).
 */
export interface Store {
  getState(): AppState;
  /** Listeners run synchronously after every change, in subscription order. */
  subscribe(listener: StoreListener): () => void;

  // Dancers
  /** Adds a dancer (settings default from config; placed on a free spot unless x/z are given) and selects it. Returns null when the stage is full. */
  addDancer(init: Partial<DancerState> & Pick<DancerState, 'characterId' | 'danceId'>): DancerState | null;
  /** Removes a dancer; if it was selected, selection is cleared. */
  removeDancer(id: string): void;
  /** Duplicates a dancer with all settings onto a free spot next to it and selects the copy. Returns null when the stage is full. */
  cloneDancer(id: string): DancerState | null;
  /** Patches a dancer. Values are clamped to the config ranges; trimStart/trimEnd are kept at least MIN_TRIM_SPAN apart. */
  updateDancer(id: string, patch: Partial<DancerSettings & Pick<DancerState, 'characterId' | 'danceId'>>, options?: UpdateOptions): void;
  /** Removes every dancer. */
  clearDancers(): void;

  // Scene, audio, camera, UI
  updateScene(patch: Partial<SceneSettings>, options?: UpdateOptions): void;
  /** Not undoable. */
  updateAudio(patch: Partial<AudioSettings>): void;
  /** Not undoable. */
  setCamera(pose: CameraPose): void;
  /** Not undoable. */
  updateUi(patch: Partial<UiState>): void;
  select(id: string | null): void;
  setTitle(title: string): void;

  // Documents
  /** Snapshot of the current scene for saving/sharing. */
  getDocument(): SceneDocument;
  /** Replaces the scene with a (sanitised) document, clears selection and resets history. */
  loadDocument(document: SceneDocument): void;

  // History (covers dancers and scene settings)
  /** Ends a transient gesture, recording one undo step if anything changed. */
  commit(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

// — Assets —

/** A loaded character: a template that can be instantiated any number of times. */
export interface CharacterAsset {
  def: CharacterDef;
  /** Rest-pose description of the character's skeleton, shared by all instances. Retargeting targets this. */
  rig: Rig;
  /** Normalised height in metres. */
  height: number;
  /** Approximate horizontal half-extent in rest pose, metres (for pick proxies and spacing). */
  radius: number;
  /**
   * A fresh, independent copy in rest pose with its own skeleton and its own
   * materials, normalised: feet on y = 0, centred on the origin, facing +Z,
   * `height` metres tall. Bone names match `rig`, so one retargeted clip can
   * drive every instance.
   */
  instantiate(): CharacterInstance;
  dispose(): void;
}

export interface CharacterInstance {
  /** Add this under the dancer's anchor. */
  root: THREE.Object3D;
  /** Canonical bone → this instance's node (only bones the rig has). */
  bones: Partial<Record<CanonicalBone, THREE.Object3D>>;
  /** Every renderable mesh (skinned or rigid). */
  meshes: THREE.Mesh[];
  /** Unique materials owned by this instance (safe to mutate per dancer). */
  materials: THREE.Material[];
  /** Frees the instance's own GPU resources (materials, skeleton textures). Shared geometry stays with the asset. */
  dispose(): void;
}

/** A loaded dance: a clip plus the skeleton it was authored on. */
export interface DanceAsset {
  def: DanceDef;
  clip: THREE.AnimationClip;
  /** The rig `clip` animates. Retargeting reads the motion from here. */
  rig: Rig;
  /** Seconds. */
  duration: number;
  /** Native tempo, when known. */
  bpm: number | null;
  /** Loop length in beats, when known (bpm given). */
  beats: number | null;
}

export interface RetargetRequest {
  danceId: string;
  characterId: string;
  mirror: boolean;
}

/** Audio data for a song, ready for the audio engine to decode or render. */
export type SongSource = { kind: 'pattern'; pattern: SongPattern } | { kind: 'encoded'; data: ArrayBuffer };

export interface UploadReport {
  characters: CharacterDef[];
  dances: DanceDef[];
  songs: SongDef[];
  /** Human-readable reasons for files that could not be used. */
  problems: { file: string; reason: string }[];
}

/**
 * The catalogue of everything that can be put on stage, and the loader/cache
 * for the heavy runtime objects behind each entry.
 */
export interface AssetRegistry {
  listCharacters(): CharacterDef[];
  listDances(): DanceDef[];
  listSongs(): SongDef[];
  getCharacter(id: string): CharacterDef | undefined;
  getDance(id: string): DanceDef | undefined;
  getSong(id: string): SongDef | undefined;

  /** Cached. Rejects with a readable Error if the asset is missing or unusable. */
  loadCharacter(id: string): Promise<CharacterAsset>;
  loadDance(id: string): Promise<DanceAsset>;
  loadSong(id: string): Promise<SongSource>;
  /**
   * The dance retargeted onto the character's rig. The clip's tracks are bound
   * by bone name, so it drives every instance of that character. Cached per
   * (dance, character, mirror).
   */
  loadRetargetedClip(request: RetargetRequest): Promise<THREE.AnimationClip>;

  /** Remember a tempo estimated at playback time for a song that had none. */
  setSongBpm(id: string, bpm: number): void;

  /** Add files chosen or dropped by the user: models become characters and/or dances, audio becomes songs. Persisted on this device. */
  addUploads(files: File[]): Promise<UploadReport>;
  /** Delete an uploaded asset (id starts with 'upload:'). */
  removeUpload(id: string): Promise<void>;

  /** Fires whenever the catalogue changes (uploads added/removed, library discovered, bpm learned). */
  subscribe(listener: () => void): () => void;
}

// — Audio —

/**
 * The shared musical clock, sampled once per frame.
 * The engine reuses one snapshot object (and one levels object) between
 * frames: read the values, do not hold on to the object.
 */
export interface ClockSnapshot {
  /** Seconds since the app started; monotonic; keeps running without music. */
  time: number;
  /** Seconds since the previous snapshot. */
  delta: number;
  /** Continuous beat counter. Follows the song while one is audible, otherwise advances at DEFAULT_BPM. */
  beat: number;
  /** Current tempo. */
  bpm: number;
}

export interface AudioLevels {
  /** Smoothed 0..1 loudness overall and per band. All zeros when silent. */
  level: number;
  bass: number;
  mid: number;
  treble: number;
}

export type AudioStatus =
  | { state: 'idle' }
  | { state: 'loading'; songId: string }
  | { state: 'playing'; songId: string; bpm: number }
  | { state: 'error'; songId: string; message: string };

export interface AudioEngine {
  /** Start the audio context. Must be called from a user gesture (the Enter button). Safe to call repeatedly. */
  unlock(): Promise<void>;
  readonly unlocked: boolean;
  /** Follow the audio settings in the store (song, mute, volume). Call on every store change. */
  sync(audio: AudioSettings): void;
  /** Advance and read the shared clock. Call exactly once per rendered frame. */
  tick(): ClockSnapshot;
  /** The most recent snapshot without advancing. */
  readonly clock: ClockSnapshot;
  levels(): AudioLevels;
  readonly status: AudioStatus;
  /** Fires when `status` changes. */
  subscribe(listener: (status: AudioStatus) => void): () => void;
  dispose(): void;
}

// — Stage —

export interface CaptureOptions {
  /** Output size in pixels (default: current canvas size). */
  width?: number;
  height?: number;
  type?: 'image/png' | 'image/jpeg' | 'image/webp';
  quality?: number;
  /** Render from this viewpoint instead of the live camera (the live camera is not moved). */
  camera?: CameraPose;
}

/** What the stage needs from the rest of the app. */
export interface StageDeps {
  /** The stage appends its canvas here and fills the element. */
  container: HTMLElement;
  store: Store;
  registry: AssetRegistry;
  /** The stage calls `tick()` exactly once per rendered frame. */
  audio: Pick<AudioEngine, 'tick' | 'levels'>;
}

export interface Stage {
  readonly canvas: HTMLCanvasElement;
  /** Begin the render loop. */
  start(): void;
  stop(): void;
  /** Current camera position/target (also committed to the store when the user stops orbiting). */
  getCameraPose(): CameraPose;
  /** Render the scene as it is now (without selection gizmos) and return a data URL. */
  capture(options?: CaptureOptions): string;
  /** Restart every dancer's loop from the shared beat, so dancers whose speed was changed fall back in step. */
  resync(): void;
  /** Frames per second, smoothed. */
  readonly fps: number;
  /** Introspection for tests and debugging. */
  debug(): StageDebugInfo;
  dispose(): void;
}

export interface StageDebugInfo {
  dancers: {
    id: string;
    /** 'loading' while assets are fetched, 'ready' when dancing, 'error' when the fallback is shown. */
    status: 'loading' | 'ready' | 'error';
    characterId: string;
    danceId: string;
    /** Seconds into the current clip. */
    clipTime: number;
    /** World positions of a few landmark bones (present once ready). */
    landmarks: Partial<Record<'Hips' | 'Head' | 'LeftHand' | 'RightHand' | 'LeftFoot' | 'RightFoot', [number, number, number]>>;
  }[];
  drawCalls: number;
  triangles: number;
  fps: number;
}

// — Thumbnails —

export interface Thumbnailer {
  /** Square preview of a character (data URL). Cached. */
  character(characterId: string): Promise<string>;
  /** A characteristic pose of the dance, performed by the given character (default: the fallback mannequin). Cached. */
  dance(danceId: string, characterId?: string): Promise<string>;
  dispose(): void;
}

// — Saved scenes —

export interface SavedScene {
  id: string;
  title: string;
  /** Epoch milliseconds. */
  savedAt: number;
  /** Small JPEG data URL. */
  thumbnail: string;
  document: SceneDocument;
}

export interface SceneLibrary {
  list(): SavedScene[];
  save(entry: { title: string; thumbnail: string; document: SceneDocument; id?: string }): SavedScene;
  remove(id: string): void;
  subscribe(listener: () => void): () => void;
}

/** Everything the UI needs, bundled. */
export interface AppServices {
  store: Store;
  registry: AssetRegistry;
  audio: AudioEngine;
  stage: Stage;
  thumbnails: Thumbnailer;
  library: SceneLibrary;
  /** How this session began. */
  startup: {
    /** The page was opened from a share link and that scene is loaded (the UI starts in view-only mode). */
    sharedScene: boolean;
    /** A share link was present but could not be read; the message is fit to show to the user. */
    shareError: string | null;
  };
}
