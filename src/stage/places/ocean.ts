/**
 * The ocean: a sailboat (the dancers stand on its deck) on reflective water.
 */
import * as THREE from 'three';
import type { StageContext } from '../system';
import { Water } from 'three/addons/objects/Water.js';
import logoUrl from '../../ui/brand/thunes-logo.webp';
import waterNormalsUrl from '../textures/waternormals.jpg';
import { DAY_SUN, createBin, instanced, mulberry32, sceneryMaterial, smooth, spot, tinted } from './shared';
import type { Place, Spot } from './shared';

// ─────────────────────────────────────────────────────────────── ocean ──

/**
 * Boat dimensions, metres, in the boat's own space: the bow points along -Z and
 * port is -X. The deck is the stage floor (y = 0). The whole boat is then
 * turned a quarter turn (see build) so the bow points to stage left and the
 * camera, on +Z, looks at the port side.
 */
const STERN_Z = 4.6;
const BOW_Z = -6;
const MAST_Z = -3.4;
const WATER_Y = -1;
/** How far the top of the bow reaches forward of its keel. */
const BOW_RAKE = 1.1;
const HULL_TOP = 0.3;
const HULL_BOTTOM = -1.9;
const BEAM = 1.75;
const MAST_TOP = 11.3;

/** Half the hull's width at `t` (0 = stern, 1 = bow). */
function halfBeam(t: number): number {
  if (t < 0.36) return BEAM * (0.78 + 0.22 * smooth(t / 0.36));
  const u = (t - 0.36) / 0.64;
  return BEAM * Math.pow(Math.max(0, 1 - Math.pow(u, 2.3)), 0.8);
}
/** Forward shift of a hull point at height `y`, growing toward the bow (a raked stem). */
function rake(t: number, y: number): number {
  return smooth((t - 0.7) / 0.3) * BOW_RAKE * ((y - HULL_BOTTOM) / (HULL_TOP - HULL_BOTTOM));
}

function buildHull(): THREE.BufferGeometry {
  const STATIONS = 30;
  // One side, gunwale to keel: height, width factor, colour. Doubled rows give crisp paint lines.
  const cream = new THREE.Color(0xf3e9d2);
  const red = new THREE.Color(0xb8452f);
  const navy = new THREE.Color(0x1c2630);
  const rows: [number, number, THREE.Color][] = [
    [HULL_TOP, 1.02, cream],
    [0.1, 1, cream],
    [0.09, 1, red],
    [WATER_Y + 0.15, 0.9, red],
    [WATER_Y + 0.14, 0.9, navy],
    [-1.5, 0.55, navy],
    [HULL_BOTTOM, 0, navy],
  ];
  // Around the ring: port side top → keel → starboard side top.
  const ring: [number, number, THREE.Color, number][] = [
    ...rows.map(([y, f, c]) => [y, f, c, -1] as [number, number, THREE.Color, number]),
    ...rows
      .slice(0, -1)
      .reverse()
      .map(([y, f, c]) => [y, f, c, 1] as [number, number, THREE.Color, number]),
  ];
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const z = STERN_Z + (BOW_Z - STERN_Z) * t;
    const half = halfBeam(t);
    for (const [y, factor, color, side] of ring) {
      positions.push(side * half * factor, y, z - rake(t, y));
      colors.push(color.r, color.g, color.b);
    }
  }
  const per = ring.length;
  for (let i = 0; i < STATIONS; i++) {
    for (let k = 0; k < per - 1; k++) {
      const a = i * per + k;
      const b = a + 1;
      const c = a + per;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  // Transom: close the stern, including the low wall above the deck.
  const centre = positions.length / 3;
  positions.push(0, -0.55, STERN_Z);
  colors.push(red.r, red.g, red.b);
  for (let k = 0; k < per; k++) indices.push(k, (k + 1) % per, centre);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildDeck(): THREE.BufferGeometry {
  const STATIONS = 30;
  const shape = new THREE.Shape();
  const edge: [number, number][] = [];
  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const z = STERN_Z + (BOW_Z - STERN_Z) * t - rake(t, 0);
    edge.push([halfBeam(t) * 0.985, z]);
  }
  // Shape y is -z, so that laying the shape flat (rotate -90° about X) restores z.
  shape.moveTo(edge[0]![0], -edge[0]![1]);
  for (let i = 1; i < edge.length; i++) shape.lineTo(edge[i]![0], -edge[i]![1]);
  for (let i = edge.length - 2; i >= 0; i--) shape.lineTo(-edge[i]![0], -edge[i]![1]);
  shape.closePath();
  return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
}

/** Wooden planks running fore and aft; one tile covers 2 m × 2 m. */
function plankTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const rng = mulberry32(5);
  const planks = 10;
  const width = size / planks;
  for (let i = 0; i < planks; i++) {
    const tone = 0.86 + rng() * 0.28;
    ctx.fillStyle = `rgb(${Math.round(176 * tone)}, ${Math.round(137 * tone)}, ${Math.round(92 * tone)})`;
    ctx.fillRect(i * width, 0, width, size);
    // Grain.
    for (let g = 0; g < 9; g++) {
      ctx.fillStyle = `rgba(${rng() < 0.5 ? '70, 45, 22' : '230, 200, 150'}, ${0.05 + rng() * 0.07})`;
      ctx.fillRect(i * width + rng() * width, 0, 1 + rng() * 1.5, size);
    }
    // A butt joint somewhere along the plank.
    ctx.fillStyle = 'rgba(40, 26, 14, 0.75)';
    ctx.fillRect(i * width, Math.floor(rng() * size), width, 2);
    // Seam.
    ctx.fillRect(i * width, 0, 2, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(0.5, 0.5);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * A triangular sail between three corners, with a belly. UVs: u runs from
 * `tack` to `clew`, v from `tack` to `head`.
 */
function buildSail(tack: THREE.Vector3, clew: THREE.Vector3, head: THREE.Vector3, belly: number, toward: THREE.Vector3): THREE.BufferGeometry {
  const N = 10;
  const normal = new THREE.Vector3().subVectors(clew, tack).cross(new THREE.Vector3().subVectors(head, tack)).normalize();
  if (normal.dot(toward) < 0) normal.negate();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const index: number[][] = [];
  const point = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    index.push([]);
    for (let j = 0; j <= N - i; j++) {
      const b = i / N;
      const c = j / N;
      const a = 1 - b - c;
      point.set(0, 0, 0).addScaledVector(tack, a).addScaledVector(clew, b).addScaledVector(head, c);
      point.addScaledVector(normal, belly * Math.pow(Math.max(0, 27 * a * b * c), 0.75));
      index[i]!.push(positions.length / 3);
      positions.push(point.x, point.y, point.z);
      uvs.push(b, c);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N - i; j++) {
      indices.push(index[i]![j]!, index[i + 1]![j]!, index[i]![j + 1]!);
      if (j < N - i - 1) indices.push(index[i + 1]![j]!, index[i + 1]![j + 1]!, index[i]![j + 1]!);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Cream sailcloth with The Thunes' logo painted on it in red (drawn once the logo image has loaded). */
function mainsailTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 2048;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#f3e9d2';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Seams across the cloth.
  ctx.fillStyle = 'rgba(120, 100, 70, 0.16)';
  for (let y = 0; y < canvas.height; y += 128) ctx.fillRect(0, y, canvas.width, 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const image = new Image();
  image.onload = () => {
    // The logo is white on transparent: tint it, then paint it low on the sail near the mast.
    const stamp = document.createElement('canvas');
    stamp.width = image.naturalWidth;
    stamp.height = image.naturalHeight;
    const sctx = stamp.getContext('2d');
    if (!sctx) return;
    sctx.drawImage(image, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = '#c2452d';
    sctx.fillRect(0, 0, stamp.width, stamp.height);
    // About 1.9 m wide and 2.7 m tall on the lower half of the sail.
    const u0 = 0.08;
    const u1 = 0.46;
    const v0 = 0.08;
    const v1 = 0.4;
    ctx.drawImage(stamp, u0 * canvas.width, (1 - v1) * canvas.height, (u1 - u0) * canvas.width, (v1 - v0) * canvas.height);
    texture.needsUpdate = true;
  };
  image.src = logoUrl;
  return texture;
}

export function build(_context: StageContext): Place {
  const rng = mulberry32(55);
  const bin = createBin();
  const group = new THREE.Group();
  group.name = 'place-ocean';

  // ── Water: three.js' reflective ocean ──
  const waterNormals = bin.add(new THREE.TextureLoader().load(waterNormalsUrl));
  waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;
  const waterGeometry = bin.add(new THREE.PlaneGeometry(6000, 6000));
  const water = new Water(waterGeometry, {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals,
    sunDirection: DAY_SUN.clone(),
    sunColor: 0xfff2d8,
    waterColor: 0x0a5878,
    distortionScale: 2.2,
    fog: true,
  });
  water.name = 'ocean-water';
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  bin.add(water.material);
  group.add(water);

  // ── The boat ──
  // Built bow-forward along -Z, then turned so the bow points to stage left (-X)
  // and the port side faces the camera.
  const boat = new THREE.Group();
  boat.name = 'ocean-boat';
  boat.rotation.y = Math.PI / 2;
  group.add(boat);
  const add = (mesh: THREE.Object3D, shadow = true) => {
    mesh.castShadow = shadow;
    boat.add(mesh);
    return mesh;
  };

  const hullMaterial = bin.add(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.42, metalness: 0 }));
  add(new THREE.Mesh(bin.add(buildHull()), hullMaterial), false).name = 'boat-hull';

  const planks = plankTexture();
  if (planks) bin.add(planks);
  const deckMaterial = bin.add(new THREE.MeshStandardMaterial({ map: planks, color: planks ? 0xffffff : 0xb08a5a, roughness: 0.82, metalness: 0 }));
  const deck = new THREE.Mesh(bin.add(buildDeck()), deckMaterial);
  deck.name = 'boat-deck';
  deck.receiveShadow = true;
  boat.add(deck);

  const wood = bin.add(new THREE.MeshStandardMaterial({ color: 0x7a5533, roughness: 0.6 }));
  const metal = bin.add(new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.35, metalness: 0.9 }));
  add(new THREE.Mesh(bin.add(new THREE.CylinderGeometry(0.07, 0.1, MAST_TOP, 12).translate(0, MAST_TOP / 2, MAST_Z)), wood)).name = 'boat-mast';

  // The boom swings out to starboard (away from the camera), above the dancers' heads.
  const BOOM_ANGLE = 0.3;
  const BOOM_Y = 2.9;
  const BOOM_LENGTH = 5;
  const along = new THREE.Vector3(Math.sin(BOOM_ANGLE), 0, Math.cos(BOOM_ANGLE));
  const boom = new THREE.Mesh(bin.add(new THREE.CylinderGeometry(0.05, 0.05, BOOM_LENGTH + 0.3, 8).rotateX(Math.PI / 2)), wood);
  boom.position.set(0, BOOM_Y - 0.1, MAST_Z).addScaledVector(along, BOOM_LENGTH / 2 + 0.1);
  boom.rotation.y = BOOM_ANGLE;
  add(boom).name = 'boat-boom';

  const leeward = new THREE.Vector3(Math.cos(BOOM_ANGLE), 0, -Math.sin(BOOM_ANGLE));
  const tack = new THREE.Vector3(0, BOOM_Y, MAST_Z).addScaledVector(along, 0.12);
  const clew = tack.clone().addScaledVector(along, BOOM_LENGTH);
  const head = new THREE.Vector3(0, MAST_TOP - 0.4, MAST_Z);
  const sailCloth = mainsailTexture();
  if (sailCloth) bin.add(sailCloth);
  const mainMaterial = bin.add(new THREE.MeshStandardMaterial({ map: sailCloth, color: sailCloth ? 0xffffff : 0xf3e9d2, side: THREE.DoubleSide, roughness: 0.9 }));
  add(new THREE.Mesh(bin.add(buildSail(tack, clew, head, 0.45, leeward)), mainMaterial)).name = 'boat-mainsail';

  const bowTip = BOW_Z - rake(1, 0);
  const jibMaterial = bin.add(new THREE.MeshStandardMaterial({ color: 0xf3e9d2, side: THREE.DoubleSide, roughness: 0.9 }));
  const jib = buildSail(new THREE.Vector3(0, 0.55, bowTip + 0.45), new THREE.Vector3(0.9, 1.25, MAST_Z + 0.4), new THREE.Vector3(0, MAST_TOP - 1.6, MAST_Z - 0.18), 0.35, leeward);
  add(new THREE.Mesh(bin.add(jib), jibMaterial)).name = 'boat-jib';

  // Helm at the stern: a pedestal and a spoked wheel.
  const helm = new THREE.Group();
  helm.name = 'boat-helm';
  helm.position.set(0, 0, STERN_Z - 0.9);
  const pedestal = new THREE.Mesh(bin.add(new THREE.CylinderGeometry(0.07, 0.1, 0.95, 10).translate(0, 0.475, 0)), wood);
  const rim = new THREE.Mesh(bin.add(new THREE.TorusGeometry(0.32, 0.025, 8, 24)), wood);
  rim.position.set(0, 1.0, -0.12);
  helm.add(pedestal, rim);
  const spoke = bin.add(new THREE.CylinderGeometry(0.014, 0.014, 0.74, 6));
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(spoke, metal);
    s.position.copy(rim.position);
    s.rotation.z = (i * Math.PI) / 4;
    helm.add(s);
  }
  helm.traverse((part) => {
    part.castShadow = true;
  });
  boat.add(helm);

  // Standing rigging.
  const mastBeam = halfBeam((STERN_Z - MAST_Z) / (STERN_Z - BOW_Z)) * 0.98;
  const top = [0, MAST_TOP, MAST_Z];
  const stays = [
    [0, 0.45, bowTip + 0.2],
    [0, 0.4, STERN_Z - 0.1],
    [mastBeam, HULL_TOP, MAST_Z + 0.3],
    [-mastBeam, HULL_TOP, MAST_Z + 0.3],
  ];
  const rigging = bin.add(new THREE.BufferGeometry());
  rigging.setAttribute('position', new THREE.Float32BufferAttribute(stays.flatMap((end) => [...top, ...end]), 3));
  const rope = bin.add(new THREE.LineBasicMaterial({ color: 0x2a2622 }));
  boat.add(new THREE.LineSegments(rigging, rope));

  // ── Islets on the horizon ──
  const islet = bin.add(tinted(new THREE.IcosahedronGeometry(1, 1), 0x4a6350));
  const isletMaterial = bin.add(sceneryMaterial());
  const islets: Spot[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI + (i - 2.5) * 0.55 + (rng() - 0.5) * 0.3;
    const distance = 210 + rng() * 150;
    const s = spot(Math.sin(angle) * distance, Math.cos(angle) * distance, 1, rng() * Math.PI, new THREE.Color().setScalar(0.8 + rng() * 0.4));
    s.sx = 22 + rng() * 30;
    s.sz = 16 + rng() * 20;
    s.sy = 5 + rng() * 9;
    s.y = WATER_Y - 1;
    islets.push(s);
  }
  const isletMesh = bin.add(instanced(islet, isletMaterial, islets, 'ocean-islets'));
  group.add(isletMesh);

  return {
    object: group,
    ownsGround: true,
    update(seconds) {
      water.material.uniforms.time!.value = (seconds % 3600) * 0.6;
    },
    dispose: () => bin.dispose(),
  };
}
