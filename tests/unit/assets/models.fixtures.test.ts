/**
 * Real-file validation of the model pipeline. Skipped unless THUNES_FIXTURES
 * points at a directory holding Xbot.glb, Michelle.glb, Soldier.glb,
 * "Samba Dancing.fbx", RobotExpressive.glb and pirouette.bvh:
 *
 *   THUNES_FIXTURES=/path/to/fixtures npx vitest run tests/unit/assets/models.fixtures
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILTIN_CHARACTERS, createProceduralCharacter } from '../../../src/characters';
import { BUILTIN_DANCES, compileScheme } from '../../../src/dances';
import { applyBindPose, buildCharacterAsset, buildDanceAsset, buildDanceSource, danceClips, describeNotHumanoid } from '../../../src/assets/models';
import type { LoadedModel } from '../../../src/assets/models';
import { mapHumanoid } from '../../../src/rig/humanoid';
import { retargetClip } from '../../../src/rig/retarget';
import type { CanonicalBone } from '../../../src/rig/bones';
import type { CharacterDef, DanceDef, ModelFormat } from '../../../src/types';
import { FIXTURES, loadAsset } from '../rig/nodeLoaders.mjs';

async function model(file: string): Promise<LoadedModel> {
  const asset = await loadAsset(file);
  return { root: asset.root, animations: asset.clips, format: file.split('.').pop()!.toLowerCase() as ModelFormat };
}

const characterDef = (name: string): CharacterDef => ({ id: `upload:${name.toLowerCase()}`, source: 'upload', name, url: 'x', format: 'glb' });
const danceDef = (name: string, extra: Partial<DanceDef> = {}): DanceDef => ({ id: `upload:${name.toLowerCase()}`, source: 'upload', name, url: 'x', format: 'glb', ...extra });

function worldOf(node: THREE.Object3D): THREE.Vector3 {
  return new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
}

/** Largest change of any local rotation (degrees) and position (relative to the largest bone offset) caused by applyBindPose. */
function bindPoseChange(root: THREE.Object3D): { degrees: number; position: number } {
  const before = new Map<THREE.Object3D, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  root.traverse((node) => before.set(node, { q: node.quaternion.clone(), p: node.position.clone() }));
  applyBindPose(root);
  let degrees = 0;
  let position = 0;
  let scale = 1e-9;
  root.traverse((node) => (scale = Math.max(scale, node.position.length())));
  root.traverse((node) => {
    const was = before.get(node)!;
    degrees = Math.max(degrees, THREE.MathUtils.radToDeg(was.q.angleTo(node.quaternion)));
    position = Math.max(position, was.p.distanceTo(node.position) / scale);
  });
  return { degrees, position };
}

describe.skipIf(!FIXTURES)('model files (fixtures)', () => {
  it('reports how far each file\'s loaded pose is from its bind pose', async () => {
    for (const file of ['Xbot.glb', 'Michelle.glb', 'Soldier.glb', 'Samba Dancing.fbx']) {
      const loaded = await model(file);
      loaded.root.updateMatrixWorld(true);
      const change = bindPoseChange(loaded.root);
      console.log(`${file.padEnd(20)} loaded pose vs bind pose: ${change.degrees.toFixed(2)}° max rotation, ${(change.position * 100).toFixed(2)} % max offset`);
      // Applying it twice changes nothing.
      const again = bindPoseChange(loaded.root);
      expect(again.degrees).toBeLessThan(0.1);
      expect(again.position).toBeLessThan(1e-3);
    }
  });

  for (const file of ['Xbot.glb', 'Michelle.glb', 'Soldier.glb']) {
    it(`${file} becomes a character in T-pose, 1.75 m tall, standing on the floor`, async () => {
      const asset = buildCharacterAsset(characterDef(file), await model(file));
      expect(asset.height).toBeCloseTo(1.75, 3);
      expect(asset.radius).toBeGreaterThan(0.1);
      expect(asset.radius).toBeLessThan(0.6);
      const bones = asset.rig.bones;
      asset.rig.root.updateMatrixWorld(true);
      const hips = worldOf(bones.Hips!);
      expect(Math.hypot(hips.x, hips.z)).toBeLessThan(1e-3);
      expect(hips.y).toBeGreaterThan(0.8);
      expect(hips.y).toBeLessThan(1.2);
      expect(worldOf(bones.Head!).y).toBeGreaterThan(1.4);
      // Facing +Z: the character's left hand is at +X, toes point to +Z.
      expect(worldOf(bones.LeftHand!).x).toBeGreaterThan(0.3);
      expect(worldOf(bones.RightHand!).x).toBeLessThan(-0.3);
      if (bones.LeftToeBase) expect(worldOf(bones.LeftToeBase).z).toBeGreaterThan(worldOf(bones.LeftFoot!).z);
      // T-pose (or close): hands near shoulder height.
      expect(Math.abs(worldOf(bones.LeftHand!).y - worldOf(bones.LeftArm!).y)).toBeLessThan(0.35);
      // Lowest vertex on the floor.
      let minY = Infinity;
      let maxY = -Infinity;
      const v = new THREE.Vector3();
      asset.rig.root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        const position = mesh.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i += 7) {
          mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
          minY = Math.min(minY, v.y);
          maxY = Math.max(maxY, v.y);
        }
      });
      expect(Math.abs(minY)).toBeLessThan(0.02);
      expect(maxY).toBeGreaterThan(1.7);
      expect(maxY).toBeLessThan(1.77);

      // Instances: independent nodes with identical names, own materials, shared geometry.
      const a = asset.instantiate();
      const b = asset.instantiate();
      expect(a.root).not.toBe(asset.rig.root);
      expect(a.meshes.length).toBeGreaterThan(0);
      expect(a.materials.length).toBeGreaterThan(0);
      for (const material of a.materials) expect(b.materials).not.toContain(material);
      expect(a.meshes[0]!.geometry).toBe(b.meshes[0]!.geometry);
      for (const [bone, node] of Object.entries(bones) as [CanonicalBone, THREE.Object3D][]) {
        const copy = a.bones[bone]!;
        expect(copy, bone).toBeDefined();
        expect(copy).not.toBe(node);
        expect(copy.name).toBe(node.name);
        expect(THREE.PropertyBinding.findNode(a.root, node.name)).toBe(copy);
      }
      for (const mesh of a.meshes) {
        expect(mesh.castShadow).toBe(true);
        const skinned = mesh as THREE.SkinnedMesh;
        if (skinned.isSkinnedMesh) {
          expect(skinned.frustumCulled).toBe(false);
          for (const bone of skinned.skeleton.bones) {
            let inside = false;
            bone.traverseAncestors((ancestor) => (inside ||= ancestor === a.root));
            expect(inside).toBe(true);
          }
        }
      }

      // A built-in dance retargets onto the rig and drives an instance by name.
      const compiled = compileScheme(BUILTIN_DANCES[0]!.scheme!, { name: 'test' });
      const clip = retargetClip(compiled.clip, compiled.rig, asset.rig);
      expect(clip.tracks.length).toBeGreaterThan(15);
      const mixer = new THREE.AnimationMixer(a.root);
      mixer.clipAction(clip).play();
      const restHand = worldOf(a.bones.LeftHand!);
      a.root.updateMatrixWorld(true);
      restHand.copy(worldOf(a.bones.LeftHand!));
      let moved = 0;
      let lowestFoot = Infinity;
      for (let i = 1; i <= 8; i++) {
        mixer.setTime((clip.duration * i) / 9);
        a.root.updateMatrixWorld(true);
        moved = Math.max(moved, worldOf(a.bones.LeftHand!).distanceTo(restHand));
        lowestFoot = Math.min(lowestFoot, worldOf(a.bones.LeftFoot!).y, worldOf(a.bones.RightFoot!).y);
        expect(worldOf(a.bones.Head!).y).toBeGreaterThan(1.1);
      }
      expect(moved).toBeGreaterThan(0.2);
      expect(lowestFoot).toBeGreaterThan(-0.05);
      expect(lowestFoot).toBeLessThan(0.3);
      a.dispose();
      b.dispose();
      asset.dispose();
    });
  }

  it('RobotExpressive is refused with a readable reason', async () => {
    const loaded = await model('RobotExpressive.glb');
    const mapping = mapHumanoid(loaded.root);
    console.log('RobotExpressive:', describeNotHumanoid(mapping));
    expect(() => buildCharacterAsset(characterDef('Robot'), loaded)).toThrow(/"Robot" cannot be used: .*(humanoid|bones)/);
  });

  it('a BVH skeleton cannot be a character (no mesh)', async () => {
    const loaded = await model('pirouette.bvh');
    expect(() => buildCharacterAsset(characterDef('Pirouette'), loaded)).toThrow(/no mesh/);
  });

  const mannequin = createProceduralCharacter(BUILTIN_CHARACTERS[0]!);
  for (const [file, clipName] of [
    ['Michelle.glb', undefined],
    ['Samba Dancing.fbx', undefined],
    ['pirouette.bvh', undefined],
    ['Soldier.glb', 'Walk'],
  ] as const) {
    it(`${file} becomes a dance that plays on the built-in mannequin`, async () => {
      const loaded = await model(file);
      console.log(`${file.padEnd(20)} clips: ${loaded.animations.map((c) => `${c.name} (${c.duration.toFixed(2)} s)`).join(', ')}`);
      const source = buildDanceSource(loaded, file);
      expect(danceClips(source.clips).length).toBeGreaterThan(0);
      const asset = buildDanceAsset(danceDef(file, clipName ? { clip: clipName, bpm: 100 } : {}), source);
      expect(asset.duration).toBeGreaterThan(0.5);
      if (clipName) {
        expect(asset.clip.name).toBe(clipName);
        expect(asset.bpm).toBe(100);
        expect(asset.beats).toBeCloseTo((asset.duration * 100) / 60, 6);
      } else {
        expect(asset.bpm).toBeNull();
        expect(asset.beats).toBeNull();
      }
      // The source rig rests upright, on the floor, facing +Z.
      const bones = asset.rig.bones;
      asset.rig.root.updateMatrixWorld(true);
      expect(worldOf(bones.Hips!).y).toBeGreaterThan(0.7);
      expect(worldOf(bones.Head!).y).toBeGreaterThan(1.3);
      expect(worldOf(bones.LeftArm!).x).toBeGreaterThan(0.05);
      let meshes = 0;
      asset.rig.root.traverse((node) => (meshes += (node as THREE.Mesh).isMesh ? 1 : 0));
      expect(meshes).toBe(0);

      const clip = retargetClip(asset.clip, asset.rig, mannequin.rig, { inPlace: true });
      const instance = mannequin.instantiate();
      const mixer = new THREE.AnimationMixer(instance.root);
      mixer.clipAction(clip).play();
      const positions: THREE.Vector3[] = [];
      let minHead = Infinity;
      let minFoot = Infinity;
      let maxFoot = -Infinity;
      for (let i = 0; i <= 12; i++) {
        mixer.setTime((clip.duration * i) / 12.5);
        instance.root.updateMatrixWorld(true);
        positions.push(worldOf(instance.bones.LeftHand!));
        minHead = Math.min(minHead, worldOf(instance.bones.Head!).y);
        const foot = Math.min(worldOf(instance.bones.LeftFoot!).y, worldOf(instance.bones.RightFoot!).y);
        minFoot = Math.min(minFoot, foot);
        maxFoot = Math.max(maxFoot, foot);
      }
      const travel = positions.reduce((sum, p, i) => (i === 0 ? 0 : sum + p.distanceTo(positions[i - 1]!)), 0);
      console.log(`${file.padEnd(20)} on mannequin: hand travel ${travel.toFixed(2)} m, head ≥ ${minHead.toFixed(2)} m, lowest ankle ${minFoot.toFixed(3)} … ${maxFoot.toFixed(3)} m`);
      expect(travel).toBeGreaterThan(0.3);
      expect(minHead).toBeGreaterThan(1.0);
      expect(minFoot).toBeGreaterThan(-0.08);
      expect(minFoot).toBeLessThan(0.25);
      instance.dispose();
    });
  }

  it('picks clips by index and name, and explains a wrong choice', async () => {
    const source = buildDanceSource(await model('Soldier.glb'), 'Soldier.glb');
    expect(buildDanceAsset(danceDef('S', { clip: 1 }), source).clip).toBe(source.clips[1]);
    expect(buildDanceAsset(danceDef('S', { clip: 'run' }), source).clip.name).toBe('Run');
    expect(() => buildDanceAsset(danceDef('S', { clip: 'Moonwalk' }), source)).toThrow(/no animation clip named "Moonwalk" \(it has /);
    expect(() => buildDanceAsset(danceDef('S', { clip: 99 }), source)).toThrow(/no clip number 99/);
  });
});
