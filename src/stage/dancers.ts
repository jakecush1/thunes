/**
 * The dancer system: keeps one 3D entity per DancerState in the store.
 *
 *   anchor (x, y, z, heading, scale)
 *     └─ body (foot-size lift)
 *          └─ CharacterInstance.root, animated by an AnimationMixer whose clip
 *             time is set explicitly every frame from the shared clock.
 *
 * Assets load asynchronously; every load carries a token so that a result that
 * arrives after a newer request (or after the dancer was removed) is dropped
 * before anything is instantiated.
 */
import * as THREE from 'three';
import { CHARACTER_HEIGHT, DANCE_CROSSFADE, FALLBACK_CHARACTER_ID, FALLBACK_DANCE_ID } from '../config';
import type { CanonicalBone } from '../rig/bones';
import type { AppState, CharacterAsset, CharacterInstance, DanceAsset, DancerState, StageDebugInfo } from '../types';
import { ease } from './cameraPath';
import { stageHub } from './hub';
import { sizeProxy } from './picking';
import type { PickProxy } from './picking';
import type { FrameContext, StageSystem, StageSystemFactory } from './system';
import { advanceTravel, clipTimeAt, hashUnit, initialTravel, resolveTempo } from './timing';
import type { ClockLike, DanceTempo } from './timing';
import { WARP_CYCLES_PER_SECOND, createWarp } from './warp';
import type { Warp } from './warp';

// ── Shake tuning ──

/** Wobbles per second at shakeSpeed = 1. */
const SHAKE_HZ = 2.4;
/** Per-axis frequency ratios (incommensurate, so the wobble never visibly repeats). */
const SHAKE_RATIO = [1, 1.37, 0.79] as const;

type ShakeRegion = 'body' | 'arms' | 'neck';

/** Bones that shake, with the peak rotation (radians at amount 1) about the model's X, Y and Z axes. */
const SHAKE_BONES: readonly { bone: CanonicalBone; region: ShakeRegion; x: number; y: number; z: number }[] = [
  { bone: 'Spine', region: 'body', x: 0.16, y: 0.22, z: 0.16 },
  { bone: 'Spine1', region: 'body', x: 0.14, y: 0.2, z: 0.14 },
  { bone: 'Spine2', region: 'body', x: 0.14, y: 0.2, z: 0.14 },
  { bone: 'LeftArm', region: 'arms', x: 0.35, y: 0.5, z: 0.55 },
  { bone: 'RightArm', region: 'arms', x: 0.35, y: 0.5, z: 0.55 },
  { bone: 'LeftForeArm', region: 'arms', x: 0.2, y: 0.6, z: 0.45 },
  { bone: 'RightForeArm', region: 'arms', x: 0.2, y: 0.6, z: 0.45 },
  { bone: 'Neck', region: 'neck', x: 0.22, y: 0.3, z: 0.22 },
  { bone: 'Head', region: 'neck', x: 0.26, y: 0.36, z: 0.26 },
];

const LANDMARKS = ['Hips', 'Head', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot'] as const;

/** Height of the selection rings above the floor (metres). */
const RING_Y = 0.02;

interface ShakeBone {
  node: THREE.Object3D;
  region: ShakeRegion;
  /** Rest orientation in model space and its inverse: maps model-axis rotations into the bone's own frame. */
  rest: THREE.Quaternion;
  restInverse: THREE.Quaternion;
  /** The dance's own rotation this frame (the wobble is layered on top and removed again next frame). */
  base: THREE.Quaternion;
  shaken: boolean;
  ax: number;
  ay: number;
  az: number;
  px: number;
  py: number;
  pz: number;
}

interface SizedBone {
  node: THREE.Object3D;
  rest: THREE.Vector3;
  part: 'head' | 'hand' | 'foot';
}

interface MaterialLook {
  material: THREE.Material;
  color: THREE.Color | null;
  roughness: number | null;
  metalness: number | null;
}

/** One playing clip. Two exist during a crossfade. */
interface Layer {
  action: THREE.AnimationAction;
  clip: THREE.AnimationClip;
  /** The dance the dancer asked for when this layer was made (not the fallback that may be playing). */
  danceId: string;
  dance: DanceAsset;
  tempo: DanceTempo;
  travel: number;
  /** Travel is (re)initialised from the clock on the next frame. */
  pending: boolean;
  time: number;
}

interface Loaded {
  character: CharacterAsset;
  dance: DanceAsset;
  clip: THREE.AnimationClip;
  failed: boolean;
}

interface Entity {
  id: string;
  state: DancerState;
  removed: boolean;
  status: 'loading' | 'ready' | 'error';
  token: number;
  anchor: THREE.Group;
  body: THREE.Group;
  placeholder: THREE.Mesh;
  asset: CharacterAsset | null;
  instance: CharacterInstance | null;
  mixer: THREE.AnimationMixer | null;
  current: Layer | null;
  previous: Layer | null;
  /** Crossfade progress 0..1 from `previous` to `current`. */
  fade: number;
  looks: MaterialLook[];
  sized: SizedBone[];
  shake: ShakeBone[];
  shakeTime: number;
  warp: Warp | null;
  warpPhase: number;
  /** Rest height of the ankles in character space (for the foot-size lift). */
  ankleHeight: number;
}

const _euler = new THREE.Euler();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _color = new THREE.Color();

/** The part of a material the look overrides touch; any of it may be missing. */
type LookMaterial = THREE.Material & { color?: unknown; roughness?: unknown; metalness?: unknown };

function isColor(value: unknown): value is THREE.Color {
  return typeof value === 'object' && value !== null && (value as { isColor?: boolean }).isColor === true;
}

/** The dancer system factory (see the file comment). */
export const createDancerSystem: StageSystemFactory = (context) => {
  const { scene, registry } = context;
  const hub = stageHub(context);

  const group = new THREE.Group();
  group.name = 'dancers';
  scene.add(group);

  const entities: Entity[] = [];
  const byId = new Map<string, Entity>();
  const warned = new Set<string>();

  // ── Shared placeholder and selection visuals ──
  const ghostGeometry = new THREE.CapsuleGeometry(0.24, CHARACTER_HEIGHT - 0.48, 4, 12);
  ghostGeometry.translate(0, CHARACTER_HEIGHT / 2, 0);
  const ghostMaterial = new THREE.MeshBasicMaterial({ name: 'dancer-ghost', color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });

  const ringGeometry = new THREE.RingGeometry(0.88, 1, 72);
  ringGeometry.rotateX(-Math.PI / 2);
  function makeRing(name: string, opacity: number): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> {
    const material = new THREE.MeshBasicMaterial({ name, color: 0xffffff, transparent: true, opacity, depthWrite: false, fog: false, toneMapped: false });
    const ring = new THREE.Mesh(ringGeometry, material);
    ring.name = name;
    ring.renderOrder = -10;
    ring.visible = false;
    group.add(ring);
    return ring;
  }
  const selectRing = makeRing('selection-ring', 0.95);
  const hoverRing = makeRing('hover-ring', 0.4);

  let selectedId: string | null = null;
  let gizmosAllowed = true;
  let capturing = false;
  let beatSync = true;

  // The clock as of the latest frame (used for timing; the frame's own object must not be kept).
  const clock: ClockLike = { time: 0, delta: 0, beat: 0 };
  let previousBeat = 0;
  let hasClock = false;

  function warnOnce(key: string, message: string, error: unknown): void {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`[dancers] ${message}`, error instanceof Error ? error.message : error);
  }

  // ── Loading ──

  async function load(characterId: string, danceId: string, mirror: boolean): Promise<Loaded> {
    let failed = false;
    let effectiveCharacter = characterId;
    let character: CharacterAsset;
    try {
      character = await registry.loadCharacter(characterId);
    } catch (error) {
      warnOnce(`character:${characterId}`, `Character "${characterId}" could not be loaded; showing the fallback.`, error);
      failed = true;
      effectiveCharacter = FALLBACK_CHARACTER_ID;
      character = await registry.loadCharacter(FALLBACK_CHARACTER_ID);
    }
    let effectiveDance = danceId;
    let dance: DanceAsset;
    let clip: THREE.AnimationClip;
    try {
      dance = await registry.loadDance(danceId);
      clip = await registry.loadRetargetedClip({ danceId, characterId: effectiveCharacter, mirror });
    } catch (error) {
      if (danceId === FALLBACK_DANCE_ID) throw error;
      warnOnce(`dance:${danceId}:${effectiveCharacter}`, `Dance "${danceId}" could not be loaded; playing the fallback.`, error);
      failed = true;
      effectiveDance = FALLBACK_DANCE_ID;
      dance = await registry.loadDance(effectiveDance);
      clip = await registry.loadRetargetedClip({ danceId: effectiveDance, characterId: effectiveCharacter, mirror });
    }
    return { character, dance, clip, failed };
  }

  function request(entity: Entity): void {
    const token = ++entity.token;
    const { characterId, danceId, mirror } = entity.state;
    entity.status = 'loading';
    load(characterId, danceId, mirror).then(
      (loaded) => {
        if (entity.removed || entity.token !== token) return;
        try {
          applyLoaded(entity, loaded, danceId);
        } catch (error) {
          entity.status = 'error';
          warnOnce(`apply:${characterId}:${danceId}`, `Dancer with "${characterId}" / "${danceId}" could not be set up.`, error);
        }
      },
      (error: unknown) => {
        if (entity.removed || entity.token !== token) return;
        entity.status = 'error';
        warnOnce(`fatal:${characterId}:${danceId}`, `Dancer with "${characterId}" / "${danceId}" could not be loaded at all.`, error);
      },
    );
  }

  // ── Layers ──

  function makeLayer(entity: Entity, loaded: Loaded, danceId: string, travelFrom: Layer | null): Layer {
    const action = entity.mixer!.clipAction(loaded.clip);
    action.enabled = true;
    action.paused = false;
    action.play();
    const tempo = resolveTempo(loaded.dance, beatSync, { beatDriven: false, nativeBpm: 120, loopBeats: 1, duration: 1 });
    return {
      action,
      clip: loaded.clip,
      danceId,
      dance: loaded.dance,
      tempo,
      travel: travelFrom ? travelFrom.travel : 0,
      pending: travelFrom ? travelFrom.pending : true,
      time: travelFrom ? travelFrom.time : 0,
    };
  }

  function dropLayer(entity: Entity, layer: Layer): void {
    layer.action.stop();
    entity.mixer?.uncacheAction(layer.clip);
  }

  function applyLoaded(entity: Entity, loaded: Loaded, danceId: string): void {
    const current = entity.current;
    // The loop position survives everything except a change of dance.
    const keep = current !== null && current.danceId === danceId ? current : null;
    if (entity.asset !== loaded.character || !entity.instance) {
      // New character: rebuild the instance. The carried-over travel is copied before the old layer goes.
      const carried = keep ? { travel: keep.travel, time: keep.time, pending: keep.pending } : null;
      destroyInstance(entity);
      buildInstance(entity, loaded.character);
      const layer = makeLayer(entity, loaded, danceId, null);
      if (carried) {
        layer.travel = carried.travel;
        layer.time = carried.time;
        layer.pending = carried.pending;
      }
      entity.current = layer;
      entity.previous = null;
      entity.fade = 1;
    } else if (current && current.clip !== loaded.clip) {
      if (entity.previous && entity.previous.clip === loaded.clip) {
        // Back to the clip we were fading away from: reverse the blend.
        const back = entity.previous;
        entity.previous = current;
        entity.current = back;
        back.danceId = danceId;
        entity.fade = 1 - entity.fade;
      } else {
        if (entity.previous) dropLayer(entity, entity.previous);
        entity.previous = current;
        entity.current = makeLayer(entity, loaded, danceId, keep);
        entity.fade = 0;
      }
    } else if (current) {
      current.danceId = danceId;
    }
    entity.status = loaded.failed ? 'error' : 'ready';
  }

  // ── Instances ──

  function buildInstance(entity: Entity, asset: CharacterAsset): void {
    const instance = asset.instantiate();
    entity.asset = asset;
    entity.instance = instance;
    entity.body.add(instance.root);
    entity.placeholder.visible = false;
    entity.mixer = new THREE.AnimationMixer(instance.root);

    entity.looks = instance.materials.map((material) => {
      const m = material as LookMaterial;
      return {
        material,
        color: isColor(m.color) ? m.color.clone() : null,
        roughness: typeof m.roughness === 'number' ? m.roughness : null,
        metalness: typeof m.metalness === 'number' ? m.metalness : null,
      };
    });

    entity.sized = [];
    const sizedParts: readonly [CanonicalBone, SizedBone['part']][] = [
      ['Head', 'head'],
      ['LeftHand', 'hand'],
      ['RightHand', 'hand'],
      ['LeftFoot', 'foot'],
      ['RightFoot', 'foot'],
    ];
    for (const [bone, part] of sizedParts) {
      const node = instance.bones[bone];
      if (node) entity.sized.push({ node, rest: node.scale.clone(), part });
    }

    // Rest orientations come from the asset's rest-pose rig (model space).
    asset.rig.root.updateWorldMatrix(true, true);
    entity.shake = [];
    SHAKE_BONES.forEach((spec, index) => {
      const node = instance.bones[spec.bone];
      const restNode = asset.rig.bones[spec.bone];
      if (!node || !restNode) return;
      const rest = restNode.getWorldQuaternion(new THREE.Quaternion());
      entity.shake.push({
        node,
        region: spec.region,
        rest,
        restInverse: rest.clone().invert(),
        base: node.quaternion.clone(),
        shaken: false,
        ax: spec.x,
        ay: spec.y,
        az: spec.z,
        px: hashUnit(entity.id, index * 3) * Math.PI * 2,
        py: hashUnit(entity.id, index * 3 + 1) * Math.PI * 2,
        pz: hashUnit(entity.id, index * 3 + 2) * Math.PI * 2,
      });
    });

    let ankle = 0;
    let ankles = 0;
    for (const bone of ['LeftFoot', 'RightFoot'] as const) {
      const restNode = asset.rig.bones[bone];
      if (!restNode) continue;
      ankle += restNode.getWorldPosition(_v).y;
      ankles++;
    }
    entity.ankleHeight = ankles > 0 ? Math.max(0, ankle / ankles) : 0;

    entity.warp = createWarp(instance.meshes, instance.materials);
    applyLook(entity);
    applyBody(entity);
    applyWarp(entity);
  }

  function destroyInstance(entity: Entity): void {
    if (entity.mixer && entity.instance) {
      entity.mixer.stopAllAction();
      entity.mixer.uncacheRoot(entity.instance.root);
    }
    entity.mixer = null;
    entity.current = null;
    entity.previous = null;
    entity.warp?.dispose();
    entity.warp = null;
    if (entity.instance) {
      entity.instance.root.removeFromParent();
      entity.instance.dispose();
    }
    entity.instance = null;
    entity.asset = null;
    entity.looks = [];
    entity.sized = [];
    entity.shake = [];
  }

  // ── Settings ──

  function applyPlacement(entity: Entity): void {
    const s = entity.state;
    entity.anchor.position.set(s.x, s.y, s.z);
    entity.anchor.rotation.set(0, (s.rotation * Math.PI) / 180, 0);
    entity.anchor.scale.setScalar(s.scale);
  }

  function applyLook(entity: Entity): void {
    const s = entity.state;
    for (const look of entity.looks) {
      const m = look.material as LookMaterial;
      if (look.color && isColor(m.color)) {
        m.color.copy(look.color);
        if (s.tint !== null) m.color.multiply(_color.set(s.tint));
      }
      if (look.roughness !== null) m.roughness = s.shine === null ? look.roughness : 1 - s.shine;
      if (look.metalness !== null) m.metalness = s.metal === null ? look.metalness : s.metal;
    }
  }

  function applyBody(entity: Entity): void {
    const s = entity.state;
    for (const sized of entity.sized) {
      const k = sized.part === 'head' ? s.headSize : sized.part === 'hand' ? s.handSize : s.footSize;
      sized.node.scale.copy(sized.rest).multiplyScalar(k);
    }
    // Feet grow and shrink around the ankle: lift the body so the soles stay on the floor.
    entity.body.position.y = entity.ankleHeight * (s.footSize - 1);
  }

  function applyWarp(entity: Entity): void {
    if (entity.warp && entity.asset) entity.warp.configure(entity.state, entity.asset.height);
  }

  function applySettings(entity: Entity, next: DancerState): void {
    const prev = entity.state;
    entity.state = next;
    if (next.x !== prev.x || next.y !== prev.y || next.z !== prev.z || next.rotation !== prev.rotation || next.scale !== prev.scale) applyPlacement(entity);
    if (next.characterId !== prev.characterId || next.danceId !== prev.danceId || next.mirror !== prev.mirror) request(entity);
    if (!entity.instance) return;
    if (next.shine !== prev.shine || next.metal !== prev.metal || next.tint !== prev.tint) applyLook(entity);
    if (next.headSize !== prev.headSize || next.handSize !== prev.handSize || next.footSize !== prev.footSize) applyBody(entity);
    if (
      next.warpAmount !== prev.warpAmount ||
      next.warpWaves !== prev.warpWaves ||
      next.warpMode !== prev.warpMode ||
      next.warpAlong !== prev.warpAlong ||
      next.warpEffect !== prev.warpEffect
    ) {
      applyWarp(entity);
    }
  }

  // ── Reconciliation ──

  function createEntity(state: DancerState): Entity {
    const anchor = new THREE.Group();
    anchor.name = `dancer:${state.id}`;
    const body = new THREE.Group();
    body.name = 'body';
    const placeholder = new THREE.Mesh(ghostGeometry, ghostMaterial);
    placeholder.name = 'placeholder';
    anchor.add(body, placeholder);
    group.add(anchor);
    const entity: Entity = {
      id: state.id,
      state,
      removed: false,
      status: 'loading',
      token: 0,
      anchor,
      body,
      placeholder,
      asset: null,
      instance: null,
      mixer: null,
      current: null,
      previous: null,
      fade: 1,
      looks: [],
      sized: [],
      shake: [],
      shakeTime: hashUnit(state.id, 101) * 10,
      warp: null,
      warpPhase: 0,
      ankleHeight: 0,
    };
    applyPlacement(entity);
    request(entity);
    return entity;
  }

  function destroyEntity(entity: Entity): void {
    entity.removed = true;
    entity.token++;
    destroyInstance(entity);
    entity.anchor.removeFromParent();
  }

  function reconcile(dancers: readonly DancerState[]): void {
    // Remove entities whose dancer is gone.
    for (let i = entities.length - 1; i >= 0; i--) {
      const entity = entities[i]!;
      let found = false;
      for (let j = 0; j < dancers.length; j++) {
        if (dancers[j]!.id === entity.id) {
          found = true;
          break;
        }
      }
      if (found) continue;
      destroyEntity(entity);
      entities.splice(i, 1);
      byId.delete(entity.id);
      if (hub.hoveredId === entity.id) hub.hoveredId = null;
    }
    for (let j = 0; j < dancers.length; j++) {
      const state = dancers[j]!;
      const entity = byId.get(state.id);
      if (!entity) {
        const created = createEntity(state);
        entities.push(created);
        byId.set(state.id, created);
      } else if (entity.state !== state) {
        applySettings(entity, state);
      }
    }
  }

  function restartTravel(): void {
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]!;
      if (entity.current) entity.current.pending = true;
      if (entity.previous) entity.previous.pending = true;
    }
  }

  function retempo(): void {
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]!;
      if (entity.current) resolveTempo(entity.current.dance, beatSync, entity.current.tempo);
      if (entity.previous) resolveTempo(entity.previous.dance, beatSync, entity.previous.tempo);
    }
    restartTravel();
  }

  // ── Frame ──

  function advanceLayer(layer: Layer, state: DancerState, beatDelta: number): void {
    if (layer.pending) {
      layer.travel = initialTravel(layer.tempo, clock, state.speed);
      layer.pending = false;
    } else {
      layer.travel = advanceTravel(layer.travel, layer.tempo, clock, beatDelta, state.speed);
    }
    layer.time = clipTimeAt(layer.travel, layer.tempo, state);
    layer.action.time = layer.time;
  }

  function updateEntity(entity: Entity, beatDelta: number): void {
    const mixer = entity.mixer;
    const current = entity.current;
    if (!mixer || !current) return;
    const state = entity.state;

    // Take last frame's wobble off again: the mixer only rewrites a bone when its own result changes.
    const shake = entity.shake;
    for (let i = 0; i < shake.length; i++) {
      const bone = shake[i]!;
      if (bone.shaken) {
        bone.node.quaternion.copy(bone.base);
        bone.shaken = false;
      }
    }

    advanceLayer(current, state, beatDelta);
    const previous = entity.previous;
    if (previous) {
      advanceLayer(previous, state, beatDelta);
      entity.fade += clock.delta / DANCE_CROSSFADE;
      if (entity.fade >= 1) {
        entity.fade = 1;
        dropLayer(entity, previous);
        entity.previous = null;
        current.action.setEffectiveWeight(1);
      } else {
        const w = ease(entity.fade);
        current.action.setEffectiveWeight(w);
        previous.action.setEffectiveWeight(1 - w);
      }
    } else {
      current.action.setEffectiveWeight(1);
    }
    mixer.update(0);

    if (state.shakeBody > 0 || state.shakeArms > 0 || state.shakeNeck > 0) {
      entity.shakeTime += clock.delta * state.shakeSpeed;
      const t = entity.shakeTime * SHAKE_HZ * Math.PI * 2;
      for (let i = 0; i < shake.length; i++) {
        const bone = shake[i]!;
        const amount = bone.region === 'body' ? state.shakeBody : bone.region === 'arms' ? state.shakeArms : state.shakeNeck;
        if (amount <= 0) continue;
        bone.base.copy(bone.node.quaternion);
        _euler.set(
          amount * bone.ax * Math.sin(t * SHAKE_RATIO[0] + bone.px),
          amount * bone.ay * Math.sin(t * SHAKE_RATIO[1] + bone.py),
          amount * bone.az * Math.sin(t * SHAKE_RATIO[2] + bone.pz),
        );
        _q.setFromEuler(_euler);
        _q2.copy(bone.restInverse).multiply(_q).multiply(bone.rest);
        bone.node.quaternion.multiply(_q2);
        bone.shaken = true;
      }
    }

    const warp = entity.warp;
    if (warp && warp.active) {
      entity.warpPhase += clock.delta * state.warpSpeed * WARP_CYCLES_PER_SECOND;
      if (entity.warpPhase > 1024) entity.warpPhase -= 1024;
      entity.body.updateWorldMatrix(true, false);
      warp.update(entity.warpPhase, entity.body.matrixWorld);
    }
  }

  function placeRing(ring: THREE.Mesh, id: string | null): void {
    const entity = id !== null ? byId.get(id) : undefined;
    if (!entity || !gizmosAllowed || capturing) {
      ring.visible = false;
      return;
    }
    const radius = Math.max(0.24, (entity.asset?.radius ?? 0.26) * 1.15) * entity.state.scale + 0.14;
    ring.position.set(entity.state.x, RING_Y, entity.state.z);
    ring.scale.set(radius, 1, radius);
    ring.visible = true;
  }

  function updateRings(): void {
    placeRing(selectRing, selectedId);
    placeRing(hoverRing, hub.hoveredId !== selectedId ? hub.hoveredId : null);
  }

  hub.refreshProxies = () => {
    const proxies = hub.proxies;
    while (proxies.length < entities.length) proxies.push({ x: 0, z: 0, y0: 0, y1: 0, radius: 0 } satisfies PickProxy);
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]!;
      const s = entity.state;
      const hips = entity.instance?.bones.Hips;
      // The hips wander while dancing: the proxy follows them (as of the last rendered frame).
      const x = hips ? hips.matrixWorld.elements[12]! : s.x;
      const z = hips ? hips.matrixWorld.elements[14]! : s.z;
      sizeProxy(proxies[i]!, x, s.y, z, entity.asset?.height ?? CHARACTER_HEIGHT, entity.asset?.radius ?? 0.26, s.scale);
      hub.ids[i] = entity.id;
    }
    hub.count = entities.length;
  };

  const system: StageSystem = {
    sync(state: AppState, previous: AppState | null) {
      const syncChanged = state.audio.beatSync !== beatSync;
      beatSync = state.audio.beatSync;
      if (!previous || state.dancers !== previous.dancers) reconcile(state.dancers);
      if (syncChanged) retempo();
      // A whole new document: everybody starts from the shared beat again.
      else if (previous && state.dancers !== previous.dancers && state.scene !== previous.scene && state.camera !== previous.camera) restartTravel();
      selectedId = state.ui.selectedId;
      gizmosAllowed = !state.ui.viewOnly && !state.ui.uiHidden;
      updateRings();
    },
    update(frame: FrameContext) {
      const c = frame.clock;
      clock.time = c.time;
      clock.delta = c.delta > 0 ? Math.min(c.delta, 0.25) : 0;
      clock.beat = c.beat;
      const beatDelta = hasClock ? c.beat - previousBeat : 0;
      previousBeat = c.beat;
      hasClock = true;

      ghostMaterial.opacity = 0.13 + 0.07 * Math.sin(c.time * 5);
      for (let i = 0; i < entities.length; i++) updateEntity(entities[i]!, beatDelta);
      updateRings();
    },
    beforeCapture() {
      capturing = true;
      updateRings();
    },
    afterCapture() {
      capturing = false;
      updateRings();
    },
    resync() {
      restartTravel();
    },
    debug(info: StageDebugInfo) {
      for (const entity of entities) {
        const landmarks: StageDebugInfo['dancers'][number]['landmarks'] = {};
        if (entity.instance) {
          entity.anchor.updateWorldMatrix(true, true);
          for (const name of LANDMARKS) {
            const node = entity.instance.bones[name];
            if (!node) continue;
            node.getWorldPosition(_v);
            landmarks[name] = [_v.x, _v.y, _v.z];
          }
        }
        info.dancers.push({
          id: entity.id,
          status: entity.status,
          characterId: entity.state.characterId,
          danceId: entity.state.danceId,
          clipTime: entity.current ? entity.current.time : 0,
          landmarks,
        });
      }
    },
    dispose() {
      for (const entity of entities) destroyEntity(entity);
      entities.length = 0;
      byId.clear();
      hub.count = 0;
      hub.refreshProxies = () => {};
      ghostGeometry.dispose();
      ghostMaterial.dispose();
      ringGeometry.dispose();
      selectRing.material.dispose();
      hoverRing.material.dispose();
      group.removeFromParent();
    },
  };
  return system;
};
