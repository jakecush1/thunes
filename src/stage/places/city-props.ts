/**
 * Street furniture: lamp posts with glowing heads, traffic signals at the
 * junction, bollards and bins on the corners, warning lights on the towers,
 * and the soft glows around every lamp.
 */
import * as THREE from 'three';
import type { CarLight } from './city-cars';
import { MeshBuilder } from './city-mesh';
import type { CityPart } from './city-mesh';
import { KERB, ROAD, SIDE_STREETS } from './city-plan';
import { inCorridor } from './shared';

const HALO_VERTEX = /* glsl */ `
attribute vec3 aCentre;
attribute vec3 aColor;
attribute float aSize;
uniform float uFogDensity;
varying vec2 vOffset;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(aCentre, 1.0);
  float distance = length(mv.xyz);
  // Far lamps keep a little size so they still read as points of light.
  mv.xy += position.xy * aSize * (1.0 + distance * 0.014);
  mv.z += min(0.35, distance * 0.2);
  vOffset = position.xy * 2.0;
  vColor = aColor * exp(-uFogDensity * uFogDensity * distance * distance * 0.7);
  gl_Position = projectionMatrix * mv;
}
`;
const HALO_FRAGMENT = /* glsl */ `
varying vec2 vOffset;
varying vec3 vColor;
void main() {
  float d = length(vOffset);
  float glow = pow(max(0.0, 1.0 - d), 2.6) * 0.75 + exp(-d * d * 46.0) * 0.8;
  gl_FragColor = vec4(vColor * glow, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const DARK: [number, number, number] = [0.035, 0.038, 0.042];

/** A lamp post at the origin with its arm along +x. */
function lampPost(): MeshBuilder {
  const b = new MeshBuilder();
  b.tint(...DARK).surface(0.45, 0.7, 0);
  b.cylinder(0, 0, 0, 0.9, 0.13, 0.12, 8, true);
  b.cylinder(0, 0, 0.9, 7.7, 0.085, 0.06, 8, true);
  b.box(-0.05, 1.7, 7.56, 7.64, -0.04, 0.04, 1, true);
  b.box(1.45, 2.25, 7.5, 7.62, -0.15, 0.15, 1, true);
  // The lens, facing down.
  b.tint(1.0, 0.8, 0.52).surface(0.4, 0, 1);
  const y = 7.495;
  const v = (x: number, z: number) => b.vertex(x, y, z, 0, -1, 0);
  b.face(v(1.5, -0.12), v(2.2, -0.12), v(2.2, 0.12), v(1.5, 0.12));
  return b;
}

type Lamp = 'red' | 'amber' | 'green';
const LAMP_COLORS: Record<Lamp, [number, number, number]> = { red: [1.0, 0.07, 0.03], amber: [1.0, 0.5, 0.04], green: [0.08, 1.0, 0.42] };

/** A signal head facing +z, its foot at the origin. */
function signalHead(lit: Lamp): MeshBuilder {
  const b = new MeshBuilder();
  b.tint(0.016, 0.016, 0.018).surface(0.55, 0.2, 0);
  b.box(-0.16, 0.16, 0, 0.96, -0.13, 0.13, 1, true);
  const lamps: [Lamp, number][] = [
    ['red', 0.79],
    ['amber', 0.48],
    ['green', 0.17],
  ];
  for (const [lamp, y] of lamps) {
    const [r, g, bl] = LAMP_COLORS[lamp];
    const on = lamp === lit;
    b.tint(on ? r : r * 0.05, on ? g : g * 0.05, on ? bl : bl * 0.05).surface(0.3, 0, on ? 1 : 0);
    const centre = b.vertex(0, y, 0.135, 0, 0, 1);
    const first = b.vertexCount;
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      b.vertex(Math.cos(a) * 0.105, y + Math.sin(a) * 0.105, 0.135, 0, 0, 1);
    }
    for (let i = 0; i < 10; i++) b.triangle(centre, first + i, first + i + 1);
    // A short hood over each lamp.
    b.tint(0.016, 0.016, 0.018).surface(0.55, 0.2, 0);
    b.box(-0.13, 0.13, y + 0.105, y + 0.125, 0.13, 0.3, 1, true);
  }
  return b;
}

export interface BuiltProps extends CityPart {
  /** Keep the glows in step with the scene's fog. */
  setFog(density: number): void;
}

export function buildProps(detail: THREE.MeshStandardMaterial, masts: readonly { x: number; y: number; z: number }[], carLights: readonly CarLight[]): BuiltProps {
  const halos: CarLight[] = [...carLights];
  const meshes: THREE.Mesh[] = [];

  // ── Lamp posts along the four arms, staggered from side to side ──
  const post = lampPost().build({ color: true, surface: true });
  const spots: { x: number; z: number; yaw: number }[] = [];
  const lateral = ROAD + 0.65;
  for (let along = 12; along <= 138; along += 14) {
    if (SIDE_STREETS.some((street) => Math.abs(along - street) < 7)) continue;
    const side = ((along - 12) / 14) % 2 === 0 ? 1 : -1;
    for (const end of [-1, 1]) {
      // Along the Z street (arm toward the centre line), then along the X street.
      const candidates = [
        { x: side * lateral, z: end * along, yaw: side > 0 ? Math.PI : 0 },
        { x: end * along, z: side * end * lateral, yaw: side * end > 0 ? Math.PI / 2 : -Math.PI / 2 },
      ];
      for (const spot of candidates) if (!inCorridor(spot.x, spot.z)) spots.push(spot);
    }
  }
  const lamps = new THREE.InstancedMesh(post, detail, spots.length);
  lamps.name = 'city-lamps';
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  spots.forEach((spot, i) => {
    rotation.setFromAxisAngle(up, spot.yaw);
    matrix.compose(position.set(spot.x, KERB, spot.z), rotation, scale);
    lamps.setMatrixAt(i, matrix);
    halos.push({ x: spot.x + Math.cos(spot.yaw) * 1.85, y: KERB + 7.44, z: spot.z - Math.sin(spot.yaw) * 1.85, size: 2.3, color: [1.0, 0.72, 0.4] });
  });
  lamps.instanceMatrix.needsUpdate = true;
  lamps.frustumCulled = false;
  lamps.matrixAutoUpdate = false;
  meshes.push(lamps);

  // ── Everything that stands only once ──
  const fixed = new MeshBuilder();
  const heads: Record<Lamp, MeshBuilder> = { red: signalHead('red'), amber: signalHead('amber'), green: signalHead('green') };
  const head = (lamp: Lamp, x: number, y: number, z: number, yaw: number): void => {
    fixed.append(heads[lamp], x, y, z, yaw);
    const lensY = lamp === 'red' ? 0.79 : lamp === 'amber' ? 0.48 : 0.17;
    halos.push({ x: x + Math.sin(yaw) * 0.2, y: y + lensY, z: z + Math.cos(yaw) * 0.2, size: 0.95, color: LAMP_COLORS[lamp] });
  };
  const pole = (x: number, z: number, height: number): void => {
    fixed.tint(...DARK).surface(0.45, 0.7, 0);
    fixed.cylinder(x, z, KERB, KERB + 0.8, 0.14, 0.13, 8, true);
    fixed.cylinder(x, z, KERB + 0.8, KERB + height, 0.095, 0.075, 8, true);
  };
  const corner = ROAD + 1.5;
  const reach = 2.9;
  const armY = KERB + 5.75;
  const FACE_PZ = 0;
  const FACE_NZ = Math.PI;
  const FACE_PX = Math.PI / 2;
  const FACE_NX = -Math.PI / 2;
  // Far right: mast with an arm over the street, facing the traffic that comes from the camera's side.
  pole(corner, -corner, 6.1);
  fixed.box(reach - 0.3, corner, armY, armY + 0.1, -corner - 0.05, -corner + 0.05, 1, true);
  head('green', reach, armY - 0.98, -corner + 0.02, FACE_PZ);
  head('green', corner - 0.02, KERB + 2.5, -corner + 0.22, FACE_PZ);
  head('red', corner - 0.24, KERB + 2.5, -corner, FACE_NX);
  // Far left: mast with its arm over the cross street.
  pole(-corner, -corner, 6.1);
  fixed.tint(...DARK).surface(0.45, 0.7, 0);
  fixed.box(-corner - 0.05, -corner + 0.05, armY, armY + 0.1, -corner, -reach + 0.3, 1, true);
  head('red', -corner + 0.02, armY - 0.98, -reach, FACE_PX);
  head('red', -corner + 0.22, KERB + 2.5, -corner, FACE_PX);
  head('green', -corner, KERB + 2.5, -corner + 0.24, FACE_PZ);
  // Near corners (behind the default camera): the same, mirrored, kept out of the camera corridor.
  pole(-corner, corner, 3.7);
  head('green', -corner, KERB + 2.5, corner - 0.24, FACE_NZ);
  head('red', -corner + 0.24, KERB + 2.5, corner, FACE_PX);
  pole(corner, corner, 6.1);
  fixed.tint(...DARK).surface(0.45, 0.7, 0);
  fixed.box(corner - 0.05, corner + 0.05, armY, armY + 0.1, reach - 0.3, corner, 1, true);
  head('red', corner - 0.02, armY - 0.98, reach, FACE_NX);
  head('green', corner, KERB + 2.5, corner - 0.24, FACE_NZ);

  // Bollards round the four corners and a bin beside each signal.
  const arcCentre = ROAD + 2.5;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const angle = Math.PI + ((i + 0.5) / 5) * (Math.PI / 2);
        const x = sx * (arcCentre + Math.cos(angle) * 1.95);
        const z = sz * (arcCentre + Math.sin(angle) * 1.95);
        if (inCorridor(x, z) || Math.hypot(x - sx * corner, z - sz * corner) < 0.5) continue;
        fixed.tint(0.03, 0.032, 0.035).surface(0.5, 0.6, 0);
        fixed.cylinder(x, z, KERB, KERB + 0.86, 0.075, 0.068, 8, true);
        fixed.tint(0.55, 0.55, 0.52).surface(0.4, 0.1, 0);
        fixed.cylinder(x, z, KERB + 0.66, KERB + 0.74, 0.079, 0.079, 8, false);
      }
      const bx = sx * (ROAD + 3.1);
      const bz = sz * (ROAD + 1.0);
      if (!inCorridor(bx, bz)) {
        fixed.tint(0.03, 0.05, 0.04).surface(0.6, 0.3, 0);
        fixed.cylinder(bx, bz, KERB, KERB + 0.92, 0.27, 0.29, 12, false);
        fixed.tint(0.012, 0.012, 0.012).surface(0.8, 0, 0);
        fixed.cylinder(bx, bz, KERB + 0.92, KERB + 1.0, 0.3, 0.22, 12, true);
      }
    }
  }

  // Red warning lights on the tall buildings.
  for (const mast of masts) {
    fixed.tint(1.0, 0.06, 0.03).surface(0.4, 0, 1);
    fixed.box(mast.x - 0.14, mast.x + 0.14, mast.y, mast.y + 0.3, mast.z - 0.14, mast.z + 0.14, 1, true);
    halos.push({ x: mast.x, y: mast.y + 0.15, z: mast.z, size: 3.2, color: [1.0, 0.1, 0.05] });
  }

  const fixedMesh = new THREE.Mesh(fixed.build({ color: true, surface: true }), detail);
  fixedMesh.name = 'city-street-furniture';
  fixedMesh.frustumCulled = false;
  fixedMesh.matrixAutoUpdate = false;
  meshes.push(fixedMesh);

  // ── Glows: camera-facing quads, added to the picture and faded by the fog ──
  const quad = new THREE.PlaneGeometry(1, 1);
  const glowGeometry = new THREE.InstancedBufferGeometry();
  glowGeometry.setIndex(quad.getIndex());
  glowGeometry.setAttribute('position', quad.getAttribute('position'));
  quad.dispose();
  const centres = new Float32Array(halos.length * 3);
  const colors = new Float32Array(halos.length * 3);
  const sizes = new Float32Array(halos.length);
  halos.forEach((halo, i) => {
    centres.set([halo.x, halo.y, halo.z], i * 3);
    colors.set(halo.color, i * 3);
    sizes[i] = halo.size;
  });
  glowGeometry.setAttribute('aCentre', new THREE.InstancedBufferAttribute(centres, 3));
  glowGeometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
  glowGeometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 1));
  glowGeometry.instanceCount = halos.length;
  const fogDensity = { value: 0 };
  const glowMaterial = new THREE.ShaderMaterial({
    name: 'city-glow',
    uniforms: { uFogDensity: fogDensity },
    vertexShader: HALO_VERTEX,
    fragmentShader: HALO_FRAGMENT,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const glows = new THREE.Mesh(glowGeometry, glowMaterial);
  glows.name = 'city-glows';
  glows.frustumCulled = false;
  glows.matrixAutoUpdate = false;
  glows.renderOrder = 3;
  meshes.push(glows);

  return {
    meshes,
    materials: [glowMaterial],
    setFog(density) {
      fogDensity.value = density;
    },
  };
}
