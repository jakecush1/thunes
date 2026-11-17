import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mapHumanoid } from '../../../src/rig/humanoid';
import { normalizeHumanoid } from '../../../src/rig/normalize';
import { retargetClip } from '../../../src/rig/retarget';
import type { CanonicalBone } from '../../../src/rig/bones';
import type { Rig } from '../../../src/rig/rig';
import { degBetween, jointPosition, makeDance, makeRig, modelMatrices, poseAt } from './helpers';
import type { RigOptions } from './helpers';

/** A synthetic character mapped by name and normalised; `mess` un-normalises its root first. */
function normalised(options: RigOptions, mess: (root: THREE.Object3D) => void, height = 1.7): { rig: Rig; result: ReturnType<typeof normalizeHumanoid>; inner: THREE.Object3D } {
  const made = makeRig(options);
  mess(made.root);
  const mapping = mapHumanoid(made.root);
  expect(mapping.isHumanoid).toBe(true);
  const result = normalizeHumanoid(made.root, mapping, { height });
  return { rig: { root: result.root, bones: mapping.bones }, result, inner: made.root };
}

/** Asserts the normalised conventions on joints. */
function expectUpright(rig: Rig, height: number): void {
  const m = modelMatrices(rig);
  const at = (bone: CanonicalBone): THREE.Vector3 => jointPosition(rig, bone, m);
  expect(at('Hips').x).toBeCloseTo(0, 6);
  expect(at('Hips').z).toBeCloseTo(0, 6);
  // Left is +X, up is +Y, toes point to +Z.
  expect(at('LeftHand').x).toBeGreaterThan(0.3 * height);
  expect(at('RightHand').x).toBeLessThan(-0.3 * height);
  expect(at('LeftHand').x).toBeCloseTo(-at('RightHand').x, 5);
  expect(at('Head').y).toBeGreaterThan(at('Hips').y + 0.2 * height);
  expect(at('Head').x).toBeCloseTo(0, 5);
  expect(degBetween(at('LeftHand').sub(at('LeftArm')), new THREE.Vector3(1, 0, 0))).toBeLessThan(0.01);
  expect(degBetween(at('Head').sub(at('Hips')), new THREE.Vector3(0, 1, 0))).toBeLessThan(2);
  if (rig.bones.LeftToeBase) expect(at('LeftToeBase').z).toBeGreaterThan(at('LeftFoot').z + 0.03 * height);
}

describe('normalizeHumanoid', () => {
  it('wraps the root without modifying it and returns an identity wrapper', () => {
    const made = makeRig();
    made.root.position.set(3, 2, 1);
    made.root.rotation.set(0.1, 2, 0.3);
    made.root.scale.setScalar(42);
    const before = [made.root.position.clone(), made.root.quaternion.clone(), made.root.scale.clone()];
    const scene = new THREE.Group();
    scene.add(made.root);
    const mapping = mapHumanoid(made.root);
    const result = normalizeHumanoid(made.root, mapping, { height: 1.7 });
    expect(result.root.parent).toBe(scene);
    expect(result.root.children.length).toBe(1);
    expect(result.root.children[0]!.children[0]).toBe(made.root);
    expect(result.root.position.length()).toBe(0);
    expect(result.root.quaternion.equals(new THREE.Quaternion())).toBe(true);
    expect(result.root.scale.equals(new THREE.Vector3(1, 1, 1))).toBe(true);
    expect(made.root.position.equals(before[0] as THREE.Vector3)).toBe(true);
    expect(made.root.quaternion.equals(before[1] as THREE.Quaternion)).toBe(true);
    expect(made.root.scale.equals(before[2] as THREE.Vector3)).toBe(true);
    expect(result.height).toBeCloseTo(1.7, 6);
    expect(() => normalizeHumanoid(new THREE.Group(), mapHumanoid(new THREE.Group()), { height: 1.7 })).toThrow(/Hips/);
  });

  it.each([
    ['already normal', (_root: THREE.Object3D) => {}],
    ['facing -Z', (root: THREE.Object3D) => root.rotation.set(0, Math.PI, 0)],
    ['facing +X, off-centre', (root: THREE.Object3D) => (root.rotation.set(0, Math.PI / 2, 0), root.position.set(5, -3, 2))],
    ['yawed 40 degrees', (root: THREE.Object3D) => root.rotation.set(0, THREE.MathUtils.degToRad(40), 0)],
    ['Z-up (Blender axes)', (root: THREE.Object3D) => root.rotation.set(Math.PI / 2, 0, 0)],
    ['Z-up, facing -Y... and in centimetres', (root: THREE.Object3D) => (root.rotation.set(Math.PI / 2, 0, Math.PI), root.scale.setScalar(100))],
    ['X-up, tiny', (root: THREE.Object3D) => (root.rotation.set(0.0, 1.0, -Math.PI / 2), root.scale.setScalar(0.003))],
  ] as const)('%s: upright, facing +Z, centred, on the ground, the requested height', (_name, mess) => {
    for (const height of [1.7, 1.2]) {
      const { rig, result } = normalised({}, mess, height);
      expectUpright(rig, height);
      const m = modelMatrices(rig);
      // No geometry: the toe ends define the ground and the head top the height.
      expect(Math.min(jointPosition(rig, 'LeftToe_End', m).y, jointPosition(rig, 'LeftToeBase', m).y)).toBeCloseTo(0, 6);
      expect(jointPosition(rig, 'HeadTop_End', m).y).toBeCloseTo(height, 6);
      expect(result.height).toBeCloseTo(height, 6);
      expect(result.radius).toBeGreaterThan(0.09 * height);
      expect(result.radius).toBeLessThan(0.22 * height);
    }
  });

  it('centimetre skeleton under a rotated, scaled armature (FBX / glTF exporter layout)', () => {
    const { rig } = normalised({ armature: { rotation: new THREE.Euler(-Math.PI / 2, 0, 0), scale: 0.01 }, randomAxes: 3, prefix: 'mixamorig' }, (root) => root.rotation.set(0, Math.PI, 0));
    expectUpright(rig, 1.7);
    expect(jointPosition(rig, 'HeadTop_End').y).toBeCloseTo(1.7, 6);
  });

  it('a small asymmetry of the rest pose does not yaw the model', () => {
    const { rig } = normalised({}, (root) => {
      const arm = root.getObjectByName('LeftArm')!;
      arm.position.z += 0.05;
    });
    const m = modelMatrices(rig);
    expect(jointPosition(rig, 'RightHand', m).z).toBeCloseTo(jointPosition(rig, 'RightArm', m).z, 6);
    expect(jointPosition(rig, 'LeftToeBase', m).x).toBeCloseTo(jointPosition(rig, 'LeftFoot', m).x, 6);
  });

  it('without toe and head-top joints: allowances for soles and skull', () => {
    const { rig } = normalised({ omit: ['HeadTop_End', 'LeftToeBase', 'RightToeBase', 'LeftToe_End', 'RightToe_End'] }, () => {});
    const m = modelMatrices(rig);
    const ankle = jointPosition(rig, 'LeftFoot', m).y;
    const head = jointPosition(rig, 'Head', m).y;
    expect(ankle).toBeGreaterThan(0.04);
    expect(ankle).toBeLessThan(0.1);
    expect(head).toBeGreaterThan(1.4);
    expect(head).toBeLessThan(1.55);
  });

  it('measures the posed geometry of skinned meshes, also when the skeleton is not under the mesh', () => {
    const made = makeRig({ armature: { rotation: new THREE.Euler(-Math.PI / 2, 0, 0), scale: 0.01 }, randomAxes: 5 });
    // A skinned "body": the lowest vertex 3 cm below the toes follows the left foot, the highest 10 cm above the
    // head top follows the head, one vertex far to the side follows a hand.
    made.root.updateMatrixWorld(true);
    const bones = [made.bones.LeftFoot!, made.bones.Head!, made.bones.LeftHand!] as THREE.Bone[];
    const top = jointPosition(made, 'HeadTop_End').y;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0.1, -0.03, 0.05, 0, top + 0.1, 0, 0.9, 1.4, 0], 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0], 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    mesh.name = 'Body';
    made.root.add(mesh); // sibling of the armature: the bones are not below the mesh
    mesh.bind(new THREE.Skeleton(bones));
    // Now move the whole asset somewhere odd.
    made.root.rotation.set(0, 2.5, 0);
    made.root.position.set(10, 4, -3);
    made.root.scale.setScalar(2);

    const mapping = mapHumanoid(made.root);
    expect(mapping.isHumanoid).toBe(true);
    const result = normalizeHumanoid(made.root, mapping, { height: 1.8 });
    const rig: Rig = { root: result.root, bones: mapping.bones };
    expectUpright(rig, 1.8);
    result.root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const vertex = (i: number): THREE.Vector3 => mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).clone();
    expect(vertex(0).y).toBeCloseTo(0, 5);
    expect(vertex(1).y).toBeCloseTo(1.8, 5);
    // The joints sit inside the geometry bounds.
    expect(jointPosition(rig, 'LeftToeBase').y).toBeGreaterThan(0.02);
    expect(jointPosition(rig, 'HeadTop_End').y).toBeLessThan(1.75);
  });

  it('a normalised odd rig retargets like a clean one', () => {
    const source = makeRig();
    const { rig: target } = normalised({ armature: { rotation: new THREE.Euler(-Math.PI / 2, 0, 0), scale: 0.01 }, randomAxes: 9, legs: 1.2 }, (root) => (root.rotation.set(Math.PI / 2, 0.3, 2), root.scale.setScalar(7)));
    const clip = makeDance(source, { travel: 0.4 });
    const baked = retargetClip(clip, source, target);
    const rest = jointPosition(target, 'Hips');
    poseAt(source, clip, 1.3);
    poseAt(target, baked, 1.3);
    const ms = modelMatrices(source);
    const mt = modelMatrices(target);
    for (const [bone, child] of [
      ['LeftArm', 'LeftForeArm'],
      ['RightForeArm', 'RightHand'],
      ['LeftUpLeg', 'LeftLeg'],
      ['RightLeg', 'RightFoot'],
    ] as const) {
      expect(degBetween(jointPosition(source, child, ms).sub(jointPosition(source, bone, ms)), jointPosition(target, child, mt).sub(jointPosition(target, bone, mt)))).toBeLessThan(0.05);
    }
    // The hips move in model metres, upwards is still +Y.
    const moved = jointPosition(target, 'Hips', mt).sub(rest);
    expect(moved.length()).toBeGreaterThan(0.05);
    expect(moved.length()).toBeLessThan(1);
  });
});
