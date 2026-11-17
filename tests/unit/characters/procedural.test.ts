import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILTIN_CHARACTERS, CHARACTER_STYLES, createProceduralCharacter } from '../../../src/characters';
import { CHARACTER_HEIGHT, FALLBACK_CHARACTER_ID } from '../../../src/config';
import { BODY_BONES } from '../../../src/rig/bones';
import { CANONICAL_BODY_BONES } from '../../../src/rig/canonical';
import type { CharacterDef } from '../../../src/types';

const TRIANGLE_BUDGET = 8000;

describe('BUILTIN_CHARACTERS', () => {
  it('lists six placeholders with unique builtin ids, one per style, including the fallback', () => {
    expect(BUILTIN_CHARACTERS).toHaveLength(6);
    const ids = BUILTIN_CHARACTERS.map((def) => def.id);
    expect(new Set(ids).size).toBe(6);
    expect(ids).toContain(FALLBACK_CHARACTER_ID);
    for (const def of BUILTIN_CHARACTERS) {
      expect(def.id).toMatch(/^builtin:[a-z0-9-]+$/);
      expect(def.source).toBe('builtin');
      expect(def.category).toBeTruthy();
      expect(def.name).toBeTruthy();
      expect(def.url).toBeUndefined();
      expect(JSON.parse(JSON.stringify(def))).toEqual(def);
    }
    expect(new Set(BUILTIN_CHARACTERS.map((def) => def.procedural?.style))).toEqual(new Set(CHARACTER_STYLES));
  });
});

describe('createProceduralCharacter', () => {
  it('throws readable errors for unusable definitions', () => {
    expect(() => createProceduralCharacter({ id: 'library:x', source: 'library', name: 'X', url: 'x.glb' })).toThrow(/no procedural spec/);
    const bogus = { id: 'builtin:bogus', source: 'builtin', name: 'Bogus', procedural: { style: 'nope' } } as unknown as CharacterDef;
    expect(() => createProceduralCharacter(bogus)).toThrow(/unknown procedural style "nope"/);
    expect(() => createProceduralCharacter({ ...BUILTIN_CHARACTERS[0], height: -1 })).toThrow(/invalid height/);
  });
});

describe.each(BUILTIN_CHARACTERS.map((def) => [def.id, def] as const))('%s', (_id, def) => {
  const asset = createProceduralCharacter(def);
  const geometry = asset.geometry;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  const index = geometry.getIndex()!;

  it('has complete, finite vertex data', () => {
    for (const name of ['position', 'normal', 'color', 'skinIndex', 'skinWeight']) {
      const attribute = geometry.getAttribute(name);
      expect(attribute, name).toBeDefined();
      expect(attribute.count).toBe(position.count);
      for (const value of Array.from(attribute.array)) if (!Number.isFinite(value)) throw new Error(`${name} has a non-finite value`);
    }
    for (let i = 0; i < position.count; i++) {
      const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
      if (Math.abs(length - 1) > 1e-3) throw new Error(`normal ${i} has length ${length}`);
    }
    for (const value of Array.from(index.array)) if (value >= position.count) throw new Error('index out of range');
  });

  it('skin weights sum to 1 and skin indices are valid bones', () => {
    for (let i = 0; i < position.count; i++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const weight = skinWeight.getComponent(i, k);
        const bone = skinIndex.getComponent(i, k);
        if (weight < 0 || weight > 1 + 1e-6) throw new Error(`vertex ${i} has weight ${weight}`);
        if (!Number.isInteger(bone) || bone < 0 || bone >= CANONICAL_BODY_BONES.length) throw new Error(`vertex ${i} has bone ${bone}`);
        // End markers never carry skin.
        if (weight > 0 && CANONICAL_BODY_BONES[bone].endsWith('_End')) throw new Error(`vertex ${i} is skinned to an end marker`);
        sum += weight;
      }
      if (Math.abs(sum - 1) > 1e-5) throw new Error(`vertex ${i} weights sum to ${sum}`);
    }
  });

  it('every animatable bone moves some geometry', () => {
    // Clavicles may carry no skin of their own (the arm hangs off them in the hierarchy).
    const optional = new Set(['LeftShoulder', 'RightShoulder']);
    const used = new Set<string>();
    for (let i = 0; i < position.count; i++) {
      for (let k = 0; k < 4; k++) if (skinWeight.getComponent(i, k) > 0.2) used.add(CANONICAL_BODY_BONES[skinIndex.getComponent(i, k)]);
    }
    for (const bone of BODY_BONES) if (!optional.has(bone)) expect(used.has(bone), bone).toBe(true);
  });

  it('faces are wound to agree with the vertex normals', () => {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    const face = new THREE.Vector3();
    let flipped = 0;
    let counted = 0;
    for (let i = 0; i < index.count; i += 3) {
      const [ia, ib, ic] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      a.fromBufferAttribute(position, ia);
      b.fromBufferAttribute(position, ib);
      c.fromBufferAttribute(position, ic);
      face.crossVectors(b.sub(a), c.sub(a));
      if (face.length() < 1e-10) continue; // degenerate sliver at a pole
      n.fromBufferAttribute(normal, ia).add(new THREE.Vector3().fromBufferAttribute(normal, ib)).add(new THREE.Vector3().fromBufferAttribute(normal, ic));
      counted++;
      if (face.dot(n) <= 0) flipped++;
    }
    expect(counted).toBeGreaterThan(100);
    expect(flipped).toBe(0);
  });

  it('stands on the floor, is the requested height, centred and symmetric in extent', () => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(asset.height).toBe(CHARACTER_HEIGHT);
    expect(box.max.y).toBeGreaterThan(CHARACTER_HEIGHT * 0.98);
    expect(box.max.y).toBeLessThan(CHARACTER_HEIGHT * 1.0001);
    expect(Math.abs(box.min.y)).toBeLessThan(0.005);
    expect(box.max.x).toBeCloseTo(-box.min.x, 3);
    // Faces +Z: the feet reach further forward than back.
    expect(box.max.z).toBeGreaterThan(0);
    expect(asset.radius).toBeGreaterThan(0.1);
    expect(asset.radius).toBeLessThan(0.6);
    // The skull top of the rig is at or just below the highest point (antennae, ears).
    const top = asset.rig.bones.HeadTop_End!.getWorldPosition(new THREE.Vector3()).y;
    expect(top).toBeLessThanOrEqual(CHARACTER_HEIGHT + 1e-9);
    expect(top).toBeGreaterThan(CHARACTER_HEIGHT * 0.85);
  });

  it('respects the triangle budget', () => {
    expect(asset.triangles).toBe(index.count / 3);
    expect(asset.triangles).toBeGreaterThan(100);
    expect(asset.triangles).toBeLessThanOrEqual(TRIANGLE_BUDGET);
  });

  it('exposes a rest-pose rig with the canonical bones', () => {
    for (const name of CANONICAL_BODY_BONES) {
      const bone = asset.rig.bones[name]!;
      expect(bone.name).toBe(name);
      expect(bone.quaternion.equals(new THREE.Quaternion())).toBe(true);
    }
    expect(asset.rig.root.parent).toBeNull();
  });

  it('instantiates independent instances that share the geometry', () => {
    const first = asset.instantiate();
    const second = asset.instantiate();
    for (const instance of [first, second]) {
      expect(instance.meshes).toHaveLength(1);
      const mesh = instance.meshes[0] as THREE.SkinnedMesh;
      expect(mesh).toBeInstanceOf(THREE.SkinnedMesh);
      expect(mesh.geometry).toBe(geometry);
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
      expect(mesh.frustumCulled).toBe(false);
      expect(mesh.skeleton.bones).toHaveLength(CANONICAL_BODY_BONES.length);
      expect(mesh.skeleton.bones.map((bone) => bone.name)).toEqual([...CANONICAL_BODY_BONES]);
      expect(instance.root.position.length()).toBe(0);
      const used = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      expect(used).toEqual(instance.materials);
      expect(used.length).toBe(Math.max(1, geometry.groups.length));
      // Bone names and rest positions match the asset's rig.
      instance.root.updateMatrixWorld(true);
      for (const name of CANONICAL_BODY_BONES) {
        const bone = instance.bones[name]!;
        expect(bone.name).toBe(name);
        const rest = asset.rig.bones[name]!.getWorldPosition(new THREE.Vector3());
        expect(bone.getWorldPosition(new THREE.Vector3()).distanceTo(rest)).toBeLessThan(1e-9);
        expect(bone).not.toBe(asset.rig.bones[name]);
      }
    }
    expect(first.root).not.toBe(second.root);
    expect(first.meshes[0]).not.toBe(second.meshes[0]);
    expect((first.meshes[0] as THREE.SkinnedMesh).skeleton).not.toBe((second.meshes[0] as THREE.SkinnedMesh).skeleton);
    for (const name of CANONICAL_BODY_BONES) expect(first.bones[name]).not.toBe(second.bones[name]);
    first.materials.forEach((material, i) => expect(material).not.toBe(second.materials[i]));

    // Posing or recolouring one leaves the other and the rig untouched.
    first.bones.LeftArm!.rotation.z = -1.2;
    (first.materials[0] as THREE.MeshStandardMaterial).color.set('#ff0000');
    expect(second.bones.LeftArm!.rotation.z).toBe(0);
    expect(asset.rig.bones.LeftArm!.rotation.z).toBe(0);
    expect((second.materials[0] as THREE.MeshStandardMaterial).color.getHexString()).toBe('ffffff');
    expect((first.materials[0] as THREE.MeshStandardMaterial).vertexColors).toBe(true);

    // In the rest pose the skinning is the identity: bone matrices cancel their inverses.
    const mesh = first.meshes[0] as THREE.SkinnedMesh;
    first.bones.LeftArm!.rotation.z = 0;
    first.root.updateMatrixWorld(true);
    mesh.skeleton.update();
    const skinned = new THREE.Vector3();
    const original = new THREE.Vector3();
    for (let i = 0; i < position.count; i += 97) {
      mesh.getVertexPosition(i, skinned);
      original.fromBufferAttribute(position, i);
      expect(skinned.distanceTo(original)).toBeLessThan(1e-5);
    }

    // Disposing an instance frees its own materials only.
    let disposedGeometry = false;
    geometry.addEventListener('dispose', () => (disposedGeometry = true));
    let disposedMaterial = false;
    first.materials[0].addEventListener('dispose', () => (disposedMaterial = true));
    const parent = new THREE.Group();
    parent.add(first.root);
    first.dispose();
    expect(disposedMaterial).toBe(true);
    expect(disposedGeometry).toBe(false);
    expect(first.root.parent).toBeNull();
    second.dispose();
  });

  it('honours def.height', () => {
    for (const height of [1, 2.6]) {
      const scaled = createProceduralCharacter({ ...def, height });
      scaled.geometry.computeBoundingBox();
      expect(scaled.height).toBe(height);
      expect(scaled.geometry.boundingBox!.max.y).toBeCloseTo(height, 4);
      expect(Math.abs(scaled.geometry.boundingBox!.min.y)).toBeLessThan(0.005 * height);
      expect(scaled.radius / asset.radius).toBeCloseTo(height / CHARACTER_HEIGHT, 4);
      const hips = scaled.rig.bones.Hips!.getWorldPosition(new THREE.Vector3()).y;
      const reference = asset.rig.bones.Hips!.getWorldPosition(new THREE.Vector3()).y;
      expect(hips / reference).toBeCloseTo(height / CHARACTER_HEIGHT, 6);
      scaled.dispose();
    }
  });

  it('applies spec overrides', () => {
    const custom = createProceduralCharacter({
      ...def,
      procedural: { ...def.procedural!, proportions: { thighLength: 0.7, shinLength: 0.7 }, palette: { primary: '#ff00ff' }, options: { roughness: 0.11 } },
    });
    expect(custom.proportions.thighLength).toBe(0.7);
    const legs = (bones: typeof custom.rig.bones) =>
      bones.LeftUpLeg!.getWorldPosition(new THREE.Vector3()).y - bones.LeftFoot!.getWorldPosition(new THREE.Vector3()).y;
    expect(legs(custom.rig.bones)).toBeGreaterThan(legs(asset.rig.bones));
    const instance = custom.instantiate();
    expect((instance.materials[0] as THREE.MeshStandardMaterial).roughness).toBe(0.11);
    instance.dispose();
    custom.dispose();
  });

  it('dispose frees the shared geometry and blocks further instances', () => {
    const throwaway = createProceduralCharacter(def);
    let disposed = false;
    throwaway.geometry.addEventListener('dispose', () => (disposed = true));
    throwaway.dispose();
    expect(disposed).toBe(true);
    expect(() => throwaway.instantiate()).toThrow(/disposed/);
  });
});
