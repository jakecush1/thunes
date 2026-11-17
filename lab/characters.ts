// Dev-only lab page: every built-in character in a row, in rest and stress
// poses, rendered as horizontal bands (one "pose:view" per band). See the
// comment in characters.html for the URL parameters.
import * as THREE from 'three';
import { BUILTIN_CHARACTERS, createProceduralCharacter } from '../src/characters';
import type { ProceduralCharacterAsset } from '../src/characters';
import { CANONICAL_BODY_BONES } from '../src/rig/canonical';
import type { CanonicalBodyBone } from '../src/rig/canonical';
import type { CharacterInstance } from '../src/types';

type Rotation = readonly [x: number, y: number, z: number];
type Pose = Partial<Record<CanonicalBodyBone, Rotation>> & { ground?: boolean };

/** Local rotations in degrees (Euler order YXZ) applied on top of the rest pose. */
const POSES: Record<string, Pose> = {
  rest: {},
  armsDown: { LeftArm: [0, 0, -85], RightArm: [0, 0, 85] },
  bend90: {
    LeftArm: [0, 0, -45],
    LeftForeArm: [0, -90, 0],
    RightArm: [0, 0, 45],
    RightForeArm: [0, 90, 0],
    LeftUpLeg: [-90, 0, 0],
    LeftLeg: [90, 0, 0],
  },
  bend140: {
    LeftArm: [0, 0, -60],
    LeftForeArm: [0, -140, 0],
    RightForeArm: [0, 0, -140],
    LeftUpLeg: [-70, 0, 0],
    LeftLeg: [140, 0, 0],
    RightUpLeg: [-20, 0, 0],
    RightLeg: [40, 0, 0],
    RightFoot: [-20, 0, 0],
  },
  squat: {
    ground: true,
    LeftUpLeg: [-105, 0, 12],
    RightUpLeg: [-105, 0, -12],
    LeftLeg: [140, 0, 0],
    RightLeg: [140, 0, 0],
    LeftFoot: [-35, 0, 0],
    RightFoot: [-35, 0, 0],
    Spine: [10, 0, 0],
    Spine1: [10, 0, 0],
    LeftArm: [0, -80, 0],
    RightArm: [0, 80, 0],
  },
  twist: {
    Spine: [22, 20, 0],
    Spine1: [22, 20, 0],
    Spine2: [22, 20, 0],
    Neck: [-20, 15, 0],
    LeftArm: [0, 0, -70],
    RightArm: [0, 0, 70],
  },
  bow: {
    Spine: [30, 0, 0],
    Spine1: [30, 0, 0],
    Spine2: [30, 0, 0],
    Neck: [-25, 0, 0],
    LeftArm: [0, 0, -80],
    RightArm: [0, 0, 80],
  },
  headTurn: {
    Neck: [0, 45, 0],
    Head: [8, 45, 0],
    LeftShoulder: [0, 0, 22],
    RightShoulder: [0, 0, -22],
    LeftArm: [0, 0, -78],
    RightArm: [0, 0, 78],
    LeftHand: [0, 0, -40],
    RightHand: [0, -50, 0],
  },
  overhead: {
    LeftArm: [0, 0, 82],
    RightArm: [0, 0, -82],
    LeftForeArm: [0, 0, 25],
    Neck: [-30, 0, 0],
    Head: [-30, 0, 0],
    RightUpLeg: [-90, 0, 0],
    RightToeBase: [-40, 0, 0],
    LeftFoot: [0, 0, 0],
  },
};

/** Heading of every character, degrees about Y (0 = facing the camera). */
const VIEWS: Record<string, number> = { front: 0, three: -38, side: -90, back: 180 };

const params = new URLSearchParams(location.search);
const rows = (params.get('rows') ?? 'rest:front')
  .split(',')
  .map((entry) => entry.trim().split(':'))
  .map(([pose, view]) => ({ pose: pose in POSES ? pose : 'rest', view: view && view in VIEWS ? view : 'front' }));
const only = params.get('only')?.split(',') ?? null;
/** With ?cols=poseA,poseB,… the first selected character is repeated once per pose, and each band only picks the view. */
const columnPoses = params.get('cols')?.split(',').filter((pose) => pose in POSES) ?? null;
const spacing = Number(params.get('spacing') ?? 2);
const showSkeleton = params.get('skeleton') === '1';
/** Visible height in metres and the height the camera looks at (for close-ups of feet, heads…). */
const fitMetres = Number(params.get('fit') ?? 2.5);
const lookY = Number(params.get('lookY') ?? 0.95);

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
const sun = new THREE.DirectionalLight('#fff4e6', 3.2);
sun.position.set(4, 9, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 2048);
sun.shadow.camera.left = -9;
sun.shadow.camera.right = 9;
sun.shadow.camera.top = 4;
sun.shadow.camera.bottom = -4;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 30;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
const rim = new THREE.DirectionalLight('#9fc4ff', 1.2);
rim.position.set(-5, 4, -6);
scene.add(rim);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: '#7b808e', roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const defs = BUILTIN_CHARACTERS.filter((def) => !only || only.includes(def.id.split(':')[1]));
const uniqueAssets: ProceduralCharacterAsset[] = defs.map((def) => createProceduralCharacter(def));
const assets: ProceduralCharacterAsset[] = columnPoses ? columnPoses.map(() => uniqueAssets[0]) : uniqueAssets;
const instances: CharacterInstance[] = assets.map((asset, index) => {
  const instance = asset.instantiate();
  instance.root.position.x = (index - (assets.length - 1) / 2) * spacing;
  scene.add(instance.root);
  if (showSkeleton) {
    const helper = new THREE.SkeletonHelper(instance.root);
    (helper.material as THREE.Material).depthTest = false;
    scene.add(helper);
  }
  return instance;
});
const restHips = instances.map((instance) => instance.bones.Hips!.position.clone());

const euler = new THREE.Euler();
const worldPosition = new THREE.Vector3();
const DEG = Math.PI / 180;

function applyPose(poseName: string, viewName: string): void {
  instances.forEach((instance, index) => {
    const pose = POSES[columnPoses ? columnPoses[index] : poseName];
    for (const name of CANONICAL_BODY_BONES) {
      const bone = instance.bones[name]!;
      const rotation = pose[name];
      if (rotation) bone.quaternion.setFromEuler(euler.set(rotation[0] * DEG, rotation[1] * DEG, rotation[2] * DEG, 'YXZ'));
      else bone.quaternion.identity();
    }
    instance.bones.Hips!.position.copy(restHips[index]);
    instance.root.rotation.y = VIEWS[viewName] * DEG;
    if (pose.ground) {
      // Drop the hips so the lower ankle is back at its rest height.
      instance.root.updateMatrixWorld(true);
      const restAnkle = assets[index].rig.bones.LeftFoot!.getWorldPosition(worldPosition).y;
      const left = instance.bones.LeftFoot!.getWorldPosition(worldPosition).y;
      const right = instance.bones.RightFoot!.getWorldPosition(worldPosition).y;
      instance.bones.Hips!.position.y -= Math.min(left, right) - restAnkle;
    }
  });
}

const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 200);

function render(): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  renderer.setScissorTest(true);
  const bandHeight = height / rows.length;
  rows.forEach((row, index) => {
    applyPose(row.pose, row.view);
    const y = height - (index + 1) * bandHeight;
    renderer.setViewport(0, y, width, bandHeight);
    renderer.setScissor(0, y, width, bandHeight);
    renderer.clear();
    camera.aspect = width / bandHeight;
    const halfV = (camera.fov * DEG) / 2;
    const fitWidth = params.has('fit') ? 0 : (assets.length * spacing + 0.3) / 2 / (Math.tan(halfV) * camera.aspect);
    const fitHeight = fitMetres / 2 / Math.tan(halfV);
    const distance = Math.max(fitWidth, fitHeight);
    camera.position.set(0, lookY + distance * 0.16, distance);
    camera.lookAt(0, lookY, 0);
    camera.near = Math.max(0.1, distance - 8);
    camera.far = distance + 30;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  });
  renderer.setScissorTest(false);
}

function boundsOf(asset: ProceduralCharacterAsset): { min: number[]; max: number[] } {
  const box = asset.geometry.boundingBox ?? new THREE.Box3();
  return { min: box.min.toArray(), max: box.max.toArray() };
}

function loop(): void {
  render();
  requestAnimationFrame(loop);
}
loop();

declare global {
  interface Window {
    __thunes?: Record<string, unknown>;
  }
}

window.__thunes = {
  ready: true,
  rows,
  characters: uniqueAssets.map((asset) => ({
    id: asset.def.id,
    name: asset.def.name,
    triangles: asset.triangles,
    height: asset.height,
    radius: asset.radius,
    bounds: boundsOf(asset),
  })),
  poses: Object.keys(POSES),
  views: Object.keys(VIEWS),
};
