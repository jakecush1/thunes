/**
 * Builds a placeholder character from a ProceduralCharacterSpec: one skinned
 * geometry (shared by every instance) on the canonical skeleton.
 */
import * as THREE from 'three';
import { CHARACTER_HEIGHT } from '../config';
import { CANONICAL_BODY_BONES, DEFAULT_PROPORTIONS, buildCanonicalSkeleton, deriveProportions, restJointPositions, unitScale, withHeight } from '../rig/canonical';
import type { HumanoidProportions } from '../rig/canonical';
import type { CharacterAsset, CharacterDef, CharacterInstance } from '../types';
import { SkinnedGeometryBuilder } from './meshkit';
import type { CharacterPalette, CharacterStyleOptions, ProceduralCharacterSpec } from './spec';
import { STYLES } from './styles';

/** Bones whose geometry is ignored when measuring `radius` (outstretched T-pose arms are not the footprint). */
const ARM_BONES: ReadonlySet<string> = new Set(['LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand']);

/** A procedural character also exposes what it was built from (useful to dances, thumbnails and tests). */
export interface ProceduralCharacterAsset extends CharacterAsset {
  /** Final proportions of the skeleton (height already normalised). */
  proportions: HumanoidProportions;
  /** The geometry every instance shares. */
  geometry: THREE.BufferGeometry;
  /** Triangles in `geometry`. */
  triangles: number;
}

/**
 * The style's own proportions with the spec's overrides applied, at the given
 * skull-top height in metres. (The final character may be slightly smaller:
 * see `createProceduralCharacter`.)
 */
export function resolveProportions(spec: ProceduralCharacterSpec, height: number = CHARACTER_HEIGHT): HumanoidProportions {
  const style = STYLES[spec.style];
  if (!style) throw new Error(`Unknown procedural character style "${String(spec.style)}"`);
  const base = deriveProportions(style.proportions, DEFAULT_PROPORTIONS);
  return withHeight(deriveProportions(spec.proportions, base), height);
}

/**
 * Creates the asset for a code-built character.
 *
 * The character is normalised so that its highest point (including antennae
 * and ears) is exactly `def.height` metres (default CHARACTER_HEIGHT) above
 * the soles, which rest on y = 0. It faces +Z with its left side at +X.
 *
 * Throws a readable Error when `def.procedural` is missing or names an unknown style.
 */
export function createProceduralCharacter(def: CharacterDef): ProceduralCharacterAsset {
  const spec = def.procedural;
  if (!spec) throw new Error(`Character "${def.id}" has no procedural spec, so it cannot be generated in code`);
  const style = STYLES[spec.style];
  if (!style) throw new Error(`Character "${def.id}" uses unknown procedural style "${String(spec.style)}"`);
  const height = def.height ?? CHARACTER_HEIGHT;
  if (!(height > 0) || !Number.isFinite(height)) throw new Error(`Character "${def.id}" has an invalid height (${String(def.height)})`);

  const palette: CharacterPalette = { ...style.palette, ...spec.palette };
  const options: Required<CharacterStyleOptions> = { ...style.options, ...spec.options };

  // Build at skull-top = height, then shrink so that whatever sticks out above the skull fits too.
  const draft = resolveProportions(spec, height);
  const builder = new SkinnedGeometryBuilder();
  style.build({ b: builder, J: restJointPositions(draft), u: unitScale(draft), bulk: options.bulk, p: draft, c: palette });
  const fit = height / builder.maxY();
  const proportions = withHeight(draft, draft.height * fit);
  const { geometry, hasGlow } = builder.build(fit);
  geometry.name = `${def.id}:geometry`;

  const bodyMaterial = new THREE.MeshStandardMaterial({
    name: `${def.id}:body`,
    vertexColors: true,
    roughness: options.roughness,
    metalness: options.metalness,
  });
  const glowMaterial = hasGlow
    ? new THREE.MeshStandardMaterial({
        name: `${def.id}:glow`,
        vertexColors: true,
        roughness: 0.4,
        metalness: 0,
        emissive: new THREE.Color(palette.glow),
        emissiveIntensity: options.glowIntensity,
      })
    : null;

  // The private rest-pose rig; its inverse bind matrices are shared by all instances (read-only).
  const rig = buildCanonicalSkeleton(proportions);
  const boneInverses = CANONICAL_BODY_BONES.map((name) => rig.bones[name].matrixWorld.clone().invert());

  let disposed = false;
  const instantiate = (): CharacterInstance => {
    if (disposed) throw new Error(`Character "${def.id}" was disposed and cannot be instantiated`);
    const skeletonParts = buildCanonicalSkeleton(proportions);
    const skeleton = new THREE.Skeleton(
      CANONICAL_BODY_BONES.map((name) => skeletonParts.bones[name]),
      boneInverses,
    );
    const materials: THREE.Material[] = glowMaterial ? [bodyMaterial.clone(), glowMaterial.clone()] : [bodyMaterial.clone()];
    const mesh = new THREE.SkinnedMesh(geometry, materials.length === 1 ? materials[0] : materials);
    mesh.name = `${def.id}:mesh`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // The bounding volume of a skinned mesh is that of its rest pose; a dancing body leaves it.
    mesh.frustumCulled = false;
    const root = new THREE.Group();
    root.name = def.id;
    root.add(skeletonParts.root);
    root.add(mesh);
    mesh.bind(skeleton, new THREE.Matrix4());
    return {
      root,
      bones: skeletonParts.bones,
      meshes: [mesh],
      materials,
      dispose() {
        root.removeFromParent();
        skeleton.dispose();
        for (const material of materials) material.dispose();
      },
    };
  };

  return {
    def,
    rig: { root: rig.root, bones: rig.bones },
    height,
    radius: footprintRadius(geometry),
    proportions,
    geometry,
    triangles: (geometry.index?.count ?? 0) / 3,
    instantiate,
    dispose() {
      disposed = true;
      geometry.dispose();
      bodyMaterial.dispose();
      glowMaterial?.dispose();
    },
  };
}

/**
 * Largest horizontal distance from the vertical axis of any vertex that does
 * not belong to an arm, metres: the body's footprint with the arms down.
 */
function footprintRadius(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  const skinIndex = geometry.getAttribute('skinIndex');
  let best = 0;
  for (let i = 0; i < position.count; i++) {
    if (ARM_BONES.has(CANONICAL_BODY_BONES[skinIndex.getX(i)])) continue;
    best = Math.max(best, Math.hypot(position.getX(i), position.getZ(i)));
  }
  return best;
}
