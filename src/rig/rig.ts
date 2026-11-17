/**
 * PROVISIONAL — finalised once the retargeting research lands.
 *
 * A Rig is the rest-pose description of one humanoid skeleton: a private
 * hierarchy that is never rendered, plus the mapping from canonical bone names
 * to its nodes. Characters expose the rig that retargeting writes to; dances
 * expose the rig their clip animates.
 */
import type * as THREE from 'three';
import type { CanonicalBone } from './bones';

export interface Rig {
  /** Root of the rest-pose hierarchy, in normalised model space (Y up, facing +Z, feet on y = 0). */
  root: THREE.Object3D;
  /** Canonical bone → node under `root`. */
  bones: Partial<Record<CanonicalBone, THREE.Object3D>>;
}
