// Dev-only lab page: plays any built-in dance on any built-in character, or
// renders a contact sheet of one loop. See dances.html for the URL parameters.
import * as THREE from 'three';
import { BUILTIN_CHARACTERS, createProceduralCharacter } from '../src/characters';
import { BUILTIN_DANCES, compileScheme } from '../src/dances';
import { DEFAULT_PROPORTIONS, hipHeight, legLength } from '../src/rig/canonical';
import type { CharacterInstance } from '../src/types';

const params = new URLSearchParams(location.search);
const slug = (id: string) => id.split(':')[1];
const danceDef = BUILTIN_DANCES.find((def) => slug(def.id) === params.get('dance')) ?? BUILTIN_DANCES[0];
const characterDef = BUILTIN_CHARACTERS.find((def) => slug(def.id) === params.get('character')) ?? BUILTIN_CHARACTERS[0];
const sheet = params.get('sheet') === '1';
const count = sheet ? Math.max(1, Number(params.get('count') ?? 8)) : 1;
const frozenBeat = params.has('beat') ? Number(params.get('beat')) : null;
const speed = Number(params.get('speed') ?? 1);
const view = params.get('view') ?? 'three';
const showSkeleton = params.get('skeleton') === '1';
const VIEWS: Record<string, number> = { front: 0, three: -35, side: -90, back: 180 };
const DEG = Math.PI / 180;

if (!danceDef.scheme) throw new Error(`${danceDef.id} has no scheme`);
const scheme = danceDef.scheme;
const compiled = compileScheme(scheme, { name: danceDef.id });
const asset = createProceduralCharacter(characterDef);

/**
 * The clip for this character: bone names already match, so only the hips
 * track needs adapting to the character's leg length (a stand-in for the retargeter).
 */
function fitClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const ratio = legLength(asset.proportions) / legLength(DEFAULT_PROPORTIONS);
  const referenceHips = hipHeight(DEFAULT_PROPORTIONS);
  const characterHips = hipHeight(asset.proportions);
  const fitted = clip.clone();
  const track = fitted.tracks.find((candidate) => candidate.name === 'Hips.position');
  if (track) {
    for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] *= ratio;
      track.values[i + 1] = characterHips + (track.values[i + 1] - referenceHips) * ratio;
      track.values[i + 2] *= ratio;
    }
  }
  return fitted;
}
const clip = fitClip(compiled.clip);

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#4a4e5a');
scene.add(new THREE.HemisphereLight('#ffffff', '#5a5f70', 1.5));
const sun = new THREE.DirectionalLight('#fff4e6', 3.0);
sun.position.set(3, 9, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 2048);
sun.shadow.camera.left = -8;
sun.shadow.camera.right = 8;
sun.shadow.camera.top = 4;
sun.shadow.camera.bottom = -4;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 30;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
const rim = new THREE.DirectionalLight('#9fc4ff', 1.1);
rim.position.set(-5, 4, -6);
scene.add(rim);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: '#7b808e', roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(60, 120, '#5d6270', '#6c7180');
grid.position.y = 0.002;
scene.add(grid);

const spacing = Number(params.get('spacing') ?? 1.3);
interface Dancer {
  instance: CharacterInstance;
  mixer: THREE.AnimationMixer;
  beat: number;
}
const from = Number(params.get('from') ?? 0);
const to = Number(params.get('to') ?? scheme.beats);
const secondsPerBeat = 60 / scheme.bpm;
const dancers: Dancer[] = [];
for (let index = 0; index < count; index++) {
  const instance = asset.instantiate();
  instance.root.position.x = (index - (count - 1) / 2) * spacing;
  scene.add(instance.root);
  const mixer = new THREE.AnimationMixer(instance.root);
  mixer.clipAction(clip).play();
  if (showSkeleton) {
    const helper = new THREE.SkeletonHelper(instance.root);
    (helper.material as THREE.Material).depthTest = false;
    scene.add(helper);
  }
  dancers.push({ instance, mixer, beat: sheet ? from + ((to - from) * index) / count : (frozenBeat ?? 0) });
}

const perspective = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
const orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const world = new THREE.Vector3();

function setBeat(dancer: Dancer, beat: number): void {
  dancer.mixer.setTime((((beat % scheme.beats) + scheme.beats) % scheme.beats) * secondsPerBeat);
}

/** Lowest point of the feet bones and the hips height, for numeric checks. */
function measure(dancer: Dancer): { beat: number; hipsY: number; lowestFootBone: number } {
  dancer.instance.root.updateMatrixWorld(true);
  let lowest = Infinity;
  for (const name of ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'] as const) {
    lowest = Math.min(lowest, dancer.instance.bones[name]!.getWorldPosition(world).y);
  }
  return { beat: dancer.beat, hipsY: dancer.instance.bones.Hips!.getWorldPosition(world).y, lowestFootBone: lowest };
}

function renderSheet(): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  renderer.setScissorTest(true);
  const bandHeight = height / 2;
  const halfWidth = (count * spacing) / 2 + 0.1;
  const halfHeight = halfWidth * (bandHeight / width);
  orthographic.left = -halfWidth;
  orthographic.right = halfWidth;
  orthographic.top = halfHeight;
  orthographic.bottom = -halfHeight;
  const lookY = halfHeight - 0.22;
  orthographic.position.set(0, lookY + 3.2, 20);
  orthographic.lookAt(0, lookY, 0);
  orthographic.updateProjectionMatrix();
  [0, -90].forEach((heading, band) => {
    for (const dancer of dancers) dancer.instance.root.rotation.y = heading * DEG;
    const y = height - (band + 1) * bandHeight;
    renderer.setViewport(0, y, width, bandHeight);
    renderer.setScissor(0, y, width, bandHeight);
    renderer.clear();
    renderer.render(scene, orthographic);
  });
  renderer.setScissorTest(false);
}

function renderSingle(): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  renderer.setViewport(0, 0, width, height);
  renderer.clear();
  dancers[0].instance.root.rotation.y = (VIEWS[view] ?? VIEWS.three) * DEG;
  perspective.aspect = width / height;
  perspective.position.set(0, 1.5, 7.2);
  perspective.lookAt(0, 0.95, 0);
  perspective.updateProjectionMatrix();
  renderer.render(scene, perspective);
}

const clock = new THREE.Clock();
let playBeat = 0;
function loop(): void {
  const delta = clock.getDelta();
  if (sheet) {
    for (const dancer of dancers) setBeat(dancer, dancer.beat);
    renderSheet();
  } else {
    if (frozenBeat === null) playBeat += (delta * speed) / secondsPerBeat;
    dancers[0].beat = frozenBeat ?? playBeat;
    setBeat(dancers[0], dancers[0].beat);
    renderSingle();
  }
  requestAnimationFrame(loop);
}

const label = document.getElementById('label') as HTMLElement;
label.textContent = `${danceDef.name} (${danceDef.id}), ${scheme.beats} beats at ${scheme.bpm} bpm, on ${characterDef.name}`;

for (const dancer of dancers) setBeat(dancer, dancer.beat);
loop();

declare global {
  interface Window {
    __thunes?: Record<string, unknown>;
  }
}

window.__thunes = {
  ready: true,
  dance: danceDef.id,
  character: characterDef.id,
  beats: scheme.beats,
  bpm: scheme.bpm,
  duration: clip.duration,
  tracks: clip.tracks.length,
  dances: BUILTIN_DANCES.map((def) => def.id),
  characters: BUILTIN_CHARACTERS.map((def) => def.id),
  frames: dancers.map(measure),
  /** Sets the playhead of a frozen single view (for scripted checks). */
  measureAt: (beat: number) => {
    setBeat(dancers[0], beat);
    return measure({ ...dancers[0], beat });
  },
};
