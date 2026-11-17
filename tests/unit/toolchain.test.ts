import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

describe('toolchain', () => {
  it('runs three math in node', () => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const v = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    expect(v.z).toBeCloseTo(-1, 6);
  });
});
