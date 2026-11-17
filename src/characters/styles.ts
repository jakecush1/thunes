/**
 * The six placeholder body styles.
 *
 * Each style is a recipe: its own proportions, palette and surface defaults,
 * plus a `build` function that places primitives around the rest-pose joints
 * and weights them to the canonical bones.
 *
 * How joints survive dancing:
 *   - Limbs are rigid segments (one bone each). Smooth styles use capsules
 *     whose spherical ends are centred on the joints, so neighbouring segments
 *     stay joined at any angle (ball joints). Boxy styles overlap around the
 *     joint or hide the seam behind a ball.
 *   - Torsos that bend (smooth lofts, the voxel block) blend their weights
 *     along the spine, so a lean or twist is spread over four bones.
 *
 * All sizes below are in authoring units (metres on a 1.75 m adult) and are
 * multiplied by `ctx.u` when placed.
 */
import * as THREE from 'three';
import { CANONICAL_BODY_BONES, heelZ } from '../rig/canonical';
import type { CanonicalBodyBone, HumanoidProportions } from '../rig/canonical';
import type { BoneWeights, LoftRing, SkinnedGeometryBuilder, WeightSpec } from './meshkit';
import type { CharacterPalette, CharacterStyle, CharacterStyleOptions } from './spec';

export interface BuildContext {
  b: SkinnedGeometryBuilder;
  /** Rest joint positions, metres. */
  J: Record<CanonicalBodyBone, THREE.Vector3>;
  /** Metres per authoring unit. */
  u: number;
  /** Thickness multiplier (CharacterStyleOptions.bulk). */
  bulk: number;
  /** The resolved proportions the joints were computed from. */
  p: HumanoidProportions;
  c: CharacterPalette;
}

export interface StyleDefinition {
  /** Overrides on DEFAULT_PROPORTIONS. */
  proportions: Partial<HumanoidProportions>;
  palette: CharacterPalette;
  options: Required<CharacterStyleOptions>;
  build(ctx: BuildContext): void;
}

const BONE_INDEX = Object.fromEntries(CANONICAL_BODY_BONES.map((name, index) => [name, index])) as Record<CanonicalBodyBone, number>;

/** Skin index of a canonical bone. */
export function boneIndex(name: CanonicalBodyBone): number {
  return BONE_INDEX[name];
}

const SIDES = [
  ['Left', 1],
  ['Right', -1],
] as const;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Joint position plus an offset in authoring units. */
function at(ctx: BuildContext, bone: CanonicalBodyBone, dx = 0, dy = 0, dz = 0): THREE.Vector3 {
  const j = ctx.J[bone];
  return V(j.x + dx * ctx.u, j.y + dy * ctx.u, j.z + dz * ctx.u);
}

function smoothstep(x: number, lo: number, hi: number): number {
  if (hi <= lo) return x >= hi ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/**
 * Blended weights for torso geometry: Hips → Spine → Spine1 → Spine2 by
 * height, each joint blending over half of its neighbouring segments. With
 * `shoulders`, the outer top of the chest also follows the clavicle bones so
 * a shrug lifts the shoulder line.
 */
function torsoWeights(ctx: BuildContext, shoulders = false): WeightSpec {
  const { J, u } = ctx;
  const joints = [J.Spine.y, J.Spine1.y, J.Spine2.y];
  const lengths = [J.Spine.y - J.Hips.y, J.Spine1.y - J.Spine.y, J.Spine2.y - J.Spine1.y, J.Neck.y - J.Spine2.y];
  const half = joints.map((_, i) => 0.5 * Math.min(lengths[i], lengths[i + 1]));
  const bones = [BONE_INDEX.Hips, BONE_INDEX.Spine, BONE_INDEX.Spine1, BONE_INDEX.Spine2];
  const rootX = J.LeftShoulder.x;
  const armX = J.LeftArm.x;
  const shoulderY = J.LeftArm.y;
  return (x, y) => {
    const t0 = smoothstep(y, joints[0] - half[0], joints[0] + half[0]);
    const t1 = smoothstep(y, joints[1] - half[1], joints[1] + half[1]);
    const t2 = smoothstep(y, joints[2] - half[2], joints[2] + half[2]);
    const weights: [number, number][] = [
      [bones[0], 1 - t0],
      [bones[1], t0 * (1 - t1)],
      [bones[2], t0 * t1 * (1 - t2)],
      [bones[3], t0 * t1 * t2],
    ];
    if (shoulders) {
      const s = 0.75 * smoothstep(Math.abs(x), rootX, armX) * smoothstep(y, shoulderY - 0.16 * u, shoulderY - 0.03 * u);
      if (s > 0) {
        for (const w of weights) w[1] *= 1 - s;
        weights.push([x > 0 ? BONE_INDEX.LeftShoulder : BONE_INDEX.RightShoulder, s]);
      }
    }
    return weights as BoneWeights;
  };
}

/** A torso cross-section: height as a joint plus an offset, half width and half depth (authoring units). */
type TorsoControl = readonly [anchor: CanonicalBodyBone, dy: number, rx: number, rz: number, e?: number];

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** A smooth torso lofted through the control sections (bottom to top), with domed ends. */
function torsoLoft(ctx: BuildContext, controls: readonly TorsoControl[], options: { dome?: number; radial?: number; z?: number } = {}): void {
  const { b, u, bulk } = ctx;
  const dome = (options.dome ?? 0.04) * u;
  const z = (options.z ?? 0) * u;
  const points = controls.map(([anchor, dy, rx, rz, e]) => ({ y: ctx.J[anchor].y + dy * u, rx: rx * u * bulk, rz: rz * u * bulk, e: e ?? 2 }));
  const rings: LoftRing[] = [];
  const first = points[0];
  const last = points[points.length - 1];
  for (const angle of [80, 55, 28]) {
    const a = (angle * Math.PI) / 180;
    rings.push({ x: 0, y: first.y - dome * Math.sin(a), z, rx: first.rx * Math.cos(a), rz: first.rz * Math.cos(a), e: first.e });
  }
  const steps = 3;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      rings.push({
        x: 0,
        y: p1.y + (p2.y - p1.y) * t,
        z,
        rx: Math.max(0.2 * Math.min(p1.rx, p2.rx), catmull(p0.rx, p1.rx, p2.rx, p3.rx, t)),
        rz: Math.max(0.2 * Math.min(p1.rz, p2.rz), catmull(p0.rz, p1.rz, p2.rz, p3.rz, t)),
        e: p1.e + (p2.e - p1.e) * t,
      });
    }
  }
  rings.push({ x: 0, y: last.y, z, rx: last.rx, rz: last.rz, e: last.e });
  for (const angle of [28, 55, 80]) {
    const a = (angle * Math.PI) / 180;
    rings.push({ x: 0, y: last.y + dome * Math.sin(a), z, rx: last.rx * Math.cos(a), rz: last.rz * Math.cos(a), e: last.e });
  }
  b.loft(rings, { radial: options.radial ?? 20 });
}

/** Z of the front surface of an ellipsoid at the given x / y offsets from its centre (all in metres). */
function frontOf(center: THREE.Vector3, radii: THREE.Vector3, dx: number, dy: number): number {
  const q = 1 - (dx / radii.x) ** 2 - (dy / radii.y) ** 2;
  return center.z + radii.z * Math.sqrt(Math.max(0, q));
}

interface LimbLook {
  /** Radii at shoulder, elbow, wrist. */
  arm: readonly [number, number, number];
  /** Radii at hip, knee, ankle. */
  leg: readonly [number, number, number];
  /** Swell of the shafts, as a fraction of the radius. */
  bulge?: number;
  /** Ball radius relative to the limb radius at each joint; 0 = no balls. */
  joint?: number;
  limbColor: string;
  jointColor: string;
  radial?: number;
}

/** Capsule arms and legs with optional ball joints. Feet and hands are separate. */
function smoothLimbs(ctx: BuildContext, look: LimbLook): void {
  const { b, J, u, bulk } = ctx;
  const k = u * bulk;
  const radial = look.radial ?? 12;
  const bulge = look.bulge ?? 0;
  const joint = look.joint ?? 0;
  for (const [side] of SIDES) {
    const [rs, re, rw] = look.arm;
    const [rh, rk, ra] = look.leg;
    const segments: [CanonicalBodyBone, CanonicalBodyBone, number, number][] = [
      [`${side}Arm`, `${side}ForeArm`, rs, re],
      [`${side}ForeArm`, `${side}Hand`, re, rw],
      [`${side}UpLeg`, `${side}Leg`, rh, rk],
      [`${side}Leg`, `${side}Foot`, rk, ra],
    ];
    b.paint(look.limbColor);
    for (const [from, to, r0, r1] of segments) {
      b.bind(BONE_INDEX[from]).capsule(J[from], J[to], r0 * k, r1 * k, { radial, bulge: bulge * Math.max(r0, r1) * k });
    }
    if (joint > 0) {
      b.paint(look.jointColor);
      const balls: [CanonicalBodyBone, number][] = [
        [`${side}Arm`, rs],
        [`${side}ForeArm`, re],
        [`${side}Hand`, rw],
        [`${side}Leg`, rk],
        [`${side}Foot`, ra],
      ];
      for (const [bone, r] of balls) b.bind(BONE_INDEX[bone]).ball(J[bone], r * joint * k, { radial, rings: 6 });
    }
  }
}

/** A mitten: a flattened ellipsoid from the wrist to the fingertips, plus a thumb pointing forward. */
function mittenHands(ctx: BuildContext, look: { width: number; thick: number; color: string; thumb?: boolean }): void {
  const { b, u, p } = ctx;
  const length = p.handLength;
  for (const [side, sx] of SIDES) {
    const bone: CanonicalBodyBone = `${side}Hand`;
    b.paint(look.color).bind(BONE_INDEX[bone]);
    b.ellipsoid(at(ctx, bone, sx * length * 0.5, 0, 0), V(length * 0.52 * u, look.thick * u, look.width * 0.5 * u), { radial: 12, rings: 8 });
    if (look.thumb !== false) {
      b.capsule(
        at(ctx, bone, sx * length * 0.22, -look.thick * 0.2, look.width * 0.25),
        at(ctx, bone, sx * length * 0.5, -look.thick * 0.3, look.width * 0.68),
        look.thick * 0.75 * u,
        look.thick * 0.6 * u,
        { radial: 8, capRings: 3 },
      );
    }
  }
}

/**
 * Rounded shoes: a heel-to-ball capsule and an instep (Foot bone) plus a toe
 * capsule (ToeBase bone) that share a ball joint at the ball of the foot.
 * Keep `ankle` clearly smaller or clearly larger than the shin's ankle radius:
 * two nearly equal low-poly spheres in different colours intersect raggedly.
 */
function smoothFeet(ctx: BuildContext, look: { width: number; heel: number; ankle: number; color: string; toe?: number }): void {
  const { b, J, u, p, bulk } = ctx;
  const back = heelZ(p);
  for (const [side] of SIDES) {
    const foot: CanonicalBodyBone = `${side}Foot`;
    const toeBase: CanonicalBodyBone = `${side}ToeBase`;
    const ball = J[toeBase];
    const tip = J[`${side}Toe_End`];
    // Every capsule's centre line is one radius above the floor, so the soles touch y = 0 exactly.
    const rBall = ball.y;
    const rHeel = look.heel * u;
    const rTip = rBall * (look.toe ?? 0.85);
    const options = { radial: 12, scaleX: look.width * bulk, hint: V(0, 1, 0) };
    b.paint(look.color).bind(BONE_INDEX[foot]);
    b.capsule(V(ball.x, rHeel, back + rHeel), ball, rHeel, rBall, options);
    b.capsule(J[foot], V(ball.x, rBall * 1.15, ball.z * 0.55), look.ankle * u * bulk, rBall * 0.95, { radial: 12 });
    b.bind(BONE_INDEX[toeBase]);
    b.capsule(ball, V(tip.x, rTip, tip.z - rTip), rBall, rTip, options);
  }
}

/** A neck capsule that reaches into both the chest and the head. */
function neck(ctx: BuildContext, radius: number, color: string, reach = 0.03): void {
  const { b, u, bulk } = ctx;
  b.paint(color).bind(BONE_INDEX.Neck);
  b.capsule(at(ctx, 'Neck', 0, -reach, 0), at(ctx, 'Head', 0, reach, 0), radius * u * bulk, radius * u * bulk, { radial: 12 });
}

/** Two eyes sitting on the front of an ellipsoidal head. Sizes in metres. */
function eyesOn(
  ctx: BuildContext,
  center: THREE.Vector3,
  radii: THREE.Vector3,
  look: { dx: number; dy: number; size: THREE.Vector3; color: string; sink?: number; highlight?: string },
): void {
  const { b } = ctx;
  for (const [, sx] of SIDES) {
    const z = frontOf(center, radii, look.dx, look.dy) - (look.sink ?? 0.3) * look.size.z;
    const eye = V(center.x + sx * look.dx, center.y + look.dy, z);
    b.paint(look.color).ellipsoid(eye, look.size, { radial: 10, rings: 6 });
    if (look.highlight) {
      b.paint(look.highlight).ball(V(eye.x + look.size.x * 0.3, eye.y + look.size.y * 0.35, eye.z + look.size.z * 0.75), look.size.x * 0.3, {
        radial: 6,
        rings: 4,
      });
    }
  }
}

// ───────────────────────────────────────────────────────────── mannequin ──

const mannequin: StyleDefinition = {
  proportions: {},
  palette: {
    primary: '#eadfcd',
    secondary: '#d9c9b0',
    accent: '#f07a3a',
    dark: '#2a2530',
    light: '#ffffff',
    skin: '#eadfcd',
    hair: '#d9c9b0',
    glow: '#ffffff',
  },
  options: { roughness: 0.55, metalness: 0, glowIntensity: 1, bulk: 1 },
  build(ctx) {
    const { b, c, u, p } = ctx;
    // Torso: one smooth hourglass, blended along the spine.
    b.paint(c.primary).bind(torsoWeights(ctx, true));
    torsoLoft(ctx, [
      ['LeftUpLeg', -0.045, 0.105, 0.085],
      ['LeftUpLeg', 0.035, 0.162, 0.108],
      ['Spine', 0.07, 0.122, 0.088],
      ['Spine2', 0.03, 0.15, 0.108],
      ['LeftArm', -0.005, 0.158, 0.094],
      ['Neck', 0.02, 0.085, 0.068],
    ]);
    neck(ctx, 0.042, c.secondary);
    smoothLimbs(ctx, { arm: [0.05, 0.04, 0.031], leg: [0.078, 0.056, 0.04], bulge: 0.14, joint: 1.14, limbColor: c.primary, jointColor: c.accent });
    mittenHands(ctx, { width: 0.085, thick: 0.026, color: c.primary });
    smoothFeet(ctx, { width: 1.3, heel: 0.042, ankle: 0.04, color: c.primary });

    // Head: an egg, narrower at the chin, with a nose ridge and two eyes.
    const hh = p.headHeight * u;
    const radii = V(0.094 * u, hh * 0.56, 0.104 * u);
    const center = at(ctx, 'Head', 0, 0, 0.012).setY(ctx.J.Head.y + hh - radii.y);
    b.paint(c.primary).bind(BONE_INDEX.Head);
    const start = b.vertexCount;
    b.ellipsoid(center, radii, { radial: 20, rings: 14 });
    b.deform(start, (position) => {
      const down = Math.max(0, (center.y - position.y) / radii.y);
      const squeeze = 1 - 0.26 * down * down;
      position.x = center.x + (position.x - center.x) * squeeze;
      position.z = center.z + (position.z - center.z) * (1 - 0.16 * down * down) + 0.012 * u * down;
    });
    const noseY = -0.03 * u;
    b.ellipsoid(V(center.x, center.y + noseY, frontOf(center, radii, 0, noseY) - 0.004 * u), V(0.013 * u, 0.026 * u, 0.02 * u), { radial: 8, rings: 6 });
    eyesOn(ctx, center, radii, { dx: 0.038 * u, dy: 0.012 * u, size: V(0.015 * u, 0.021 * u, 0.009 * u), color: c.dark });
    // A round emblem on the chest in the accent colour, so front and back differ at a glance.
    b.paint(c.accent).bind(BONE_INDEX.Spine2);
    b.ellipsoid(at(ctx, 'Spine2', 0, 0.065, 0.088 * ctx.bulk), V(0.034 * u, 0.034 * u, 0.022 * u), { radial: 14, rings: 8 });
  },
};

// ───────────────────────────────────────────────────────────────── robot ──

const robot: StyleDefinition = {
  proportions: {
    headHeight: 0.25,
    neckLength: 0.06,
    shoulderWidth: 0.46,
    shoulderDrop: 0.05,
    hipsToSpine: 0.08,
    spineToSpine1: 0.09,
    spine1ToSpine2: 0.09,
    spine2ToNeck: 0.22,
    upperArmLength: 0.25,
    forearmLength: 0.26,
    handLength: 0.15,
    hipWidth: 0.2,
    hipDrop: 0.06,
    thighLength: 0.34,
    shinLength: 0.36,
    ankleHeight: 0.11,
    footLength: 0.3,
  },
  palette: {
    primary: '#f4bf2f',
    secondary: '#d5dbe2',
    accent: '#3a4050',
    dark: '#1d2029',
    light: '#ffffff',
    skin: '#d5dbe2',
    hair: '#3a4050',
    glow: '#5ef0ff',
  },
  options: { roughness: 0.38, metalness: 0.35, glowIntensity: 2.2, bulk: 1 },
  build(ctx) {
    const { b, c, J, u, p, bulk } = ctx;
    const k = u * bulk;
    const round = { radius: 0.022 * u, bevel: 1 };

    // Pelvis, ribbed waist (one capsule per spine bone), chest.
    b.paint(c.secondary).bind(BONE_INDEX.Hips);
    b.box(at(ctx, 'Hips', 0, -0.035, 0), V(0.31 * k, 0.15 * u, 0.19 * k), { radius: 0.035 * u, bevel: 2 });
    b.paint(c.accent);
    b.bind(BONE_INDEX.Hips).capsule(J.Hips, J.Spine, 0.078 * k);
    b.bind(BONE_INDEX.Spine).capsule(J.Spine, J.Spine1, 0.078 * k);
    b.bind(BONE_INDEX.Spine1).capsule(J.Spine1, J.Spine2, 0.078 * k);
    const chestBottom = J.Spine2.y - 0.035 * u;
    const chestTop = J.Neck.y + 0.005 * u;
    const chestWidth = (p.shoulderWidth - 0.11) * u;
    const chestDepth = 0.225 * k;
    const chestCentre = V(0, (chestBottom + chestTop) / 2, 0.005 * u);
    b.paint(c.primary).bind(BONE_INDEX.Spine2);
    b.box(chestCentre, V(chestWidth, chestTop - chestBottom, chestDepth), { radius: 0.04 * u, bevel: 2 });
    // Chest light: a glowing core in a dark bezel, and a row of rivets on the back.
    const front = chestCentre.z + chestDepth / 2;
    const coreY = chestCentre.y + 0.02 * u;
    b.paint(c.accent).cylinder(V(0, coreY, front - 0.01 * u), V(0, coreY, front + 0.008 * u), 0.058 * u, 0.052 * u, { radial: 16 });
    b.paint(c.glow).material(1).cylinder(V(0, coreY, front), V(0, coreY, front + 0.013 * u), 0.038 * u, 0.034 * u, { radial: 16 });
    b.material(0).paint(c.accent);
    b.box(V(0, chestCentre.y, chestCentre.z - chestDepth / 2 - 0.004 * u), V(chestWidth * 0.55, 0.11 * u, 0.02 * u), round);

    // Neck and head.
    b.paint(c.accent).bind(BONE_INDEX.Neck).cylinder(at(ctx, 'Neck', 0, -0.02, 0), at(ctx, 'Head', 0, 0.03, 0), 0.04 * k, 0.04 * k, { radial: 12 });
    const hh = p.headHeight * u;
    const headSize = V(0.28 * u, hh - 0.012 * u, 0.235 * u);
    const head = V(0, J.Head.y + 0.012 * u + headSize.y / 2, 0.01 * u);
    b.bind(BONE_INDEX.Head);
    b.paint(c.primary).box(head, headSize, { radius: 0.045 * u, bevel: 3 });
    const face = head.z + headSize.z / 2;
    b.paint(c.dark).box(V(0, head.y + 0.018 * u, face - 0.004 * u), V(0.225 * u, 0.1 * u, 0.02 * u), { radius: 0.009 * u, bevel: 2 });
    b.material(1).paint(c.glow);
    for (const [, sx] of SIDES) {
      b.box(V(sx * 0.055 * u, head.y + 0.02 * u, face + 0.004 * u), V(0.058 * u, 0.05 * u, 0.012 * u), { radius: 0.0055 * u, bevel: 2 });
    }
    b.material(0).paint(c.dark);
    b.box(V(0, head.y - 0.075 * u, face - 0.002 * u), V(0.09 * u, 0.014 * u, 0.01 * u));
    b.paint(c.accent);
    for (const [, sx] of SIDES) {
      b.cylinder(V(sx * (headSize.x / 2 - 0.005 * u), head.y, head.z), V(sx * (headSize.x / 2 + 0.028 * u), head.y, head.z), 0.045 * u, 0.036 * u, { radial: 12 });
    }
    const top = head.y + headSize.y / 2;
    b.cylinder(V(0, top - 0.005 * u, 0), V(0, top + 0.012 * u, 0), 0.03 * u, 0.022 * u, { radial: 10 });
    b.cylinder(V(0, top, 0), V(0, top + 0.085 * u, 0), 0.007 * u, 0.007 * u, { radial: 6 });
    b.material(1).paint(c.glow).ball(V(0, top + 0.095 * u, 0), 0.022 * u, { radial: 10, rings: 6 });
    b.material(0);

    for (const [side, sx] of SIDES) {
      const arm: CanonicalBodyBone = `${side}Arm`;
      const foreArm: CanonicalBodyBone = `${side}ForeArm`;
      const hand: CanonicalBodyBone = `${side}Hand`;
      const upLeg: CanonicalBodyBone = `${side}UpLeg`;
      const leg: CanonicalBodyBone = `${side}Leg`;
      const foot: CanonicalBodyBone = `${side}Foot`;
      const toeBase: CanonicalBodyBone = `${side}ToeBase`;

      // Ball joints.
      b.paint(c.accent);
      b.bind(BONE_INDEX[`${side}Shoulder`]).ball(J[arm], 0.072 * k, { radial: 12, rings: 6 });
      b.bind(BONE_INDEX[foreArm]).ball(J[foreArm], 0.054 * k, { radial: 12, rings: 6 });
      b.bind(BONE_INDEX[hand]).ball(J[hand], 0.042 * k, { radial: 12, rings: 6 });
      b.bind(BONE_INDEX[upLeg]).ball(J[upLeg], 0.07 * k, { radial: 12, rings: 6 });
      b.bind(BONE_INDEX[leg]).ball(J[leg], 0.062 * k, { radial: 12, rings: 6 });
      b.bind(BONE_INDEX[foot]).ball(J[foot], 0.055 * k, { radial: 12, rings: 6 });

      // Arm: slim upper arm, chunky forearm, two-pronged gripper.
      b.paint(c.secondary).bind(BONE_INDEX[arm]).boxBetween(J[arm], J[foreArm], 0.086 * k, 0.086 * k, -0.04 * u, -0.035 * u, round);
      b.paint(c.primary).bind(BONE_INDEX[foreArm]).boxBetween(J[foreArm], J[hand], 0.108 * k, 0.108 * k, -0.038 * u, -0.022 * u, round);
      b.paint(c.accent).bind(BONE_INDEX[hand]);
      b.box(at(ctx, hand, sx * 0.05, 0, 0), V(0.06 * u, 0.05 * u, 0.1 * u), round);
      for (const dz of [-0.036, 0.036]) {
        b.box(at(ctx, hand, sx * 0.108, 0, dz), V(0.085 * u, 0.04 * u, 0.028 * u), { radius: 0.012 * u, bevel: 1 });
      }

      // Leg: thigh, big boot.
      b.paint(c.secondary).bind(BONE_INDEX[upLeg]).boxBetween(J[upLeg], J[leg], 0.108 * k, 0.108 * k, -0.045 * u, -0.04 * u, round);
      b.paint(c.primary).bind(BONE_INDEX[leg]).boxBetween(J[leg], J[foot], 0.132 * k, 0.132 * k, -0.045 * u, -0.01 * u, round);
      const ankle = J[foot];
      const ballZ = J[toeBase].z;
      const tipZ = J[`${side}Toe_End`].z;
      const back = heelZ(p) - 0.01 * u;
      const footWidth = 0.15 * k;
      const footHeight = ankle.y * 0.95;
      b.paint(c.accent).bind(BONE_INDEX[foot]);
      b.box(V(ankle.x, footHeight / 2, (back + ballZ + 0.02 * u) / 2), V(footWidth, footHeight, ballZ + 0.02 * u - back), { radius: 0.025 * u, bevel: 1 });
      b.bind(BONE_INDEX[toeBase]);
      b.box(V(ankle.x, footHeight * 0.4, (ballZ - 0.03 * u + tipZ) / 2), V(footWidth, footHeight * 0.8, tipZ - ballZ + 0.03 * u), { radius: 0.025 * u, bevel: 1 });
    }
  },
};

// ─────────────────────────────────────────────────────────────────── toy ──

const toy: StyleDefinition = {
  proportions: {
    headHeight: 0.5,
    neckLength: 0.03,
    shoulderWidth: 0.47,
    shoulderDrop: 0.07,
    hipsToSpine: 0.07,
    spineToSpine1: 0.08,
    spine1ToSpine2: 0.08,
    spine2ToNeck: 0.12,
    upperArmLength: 0.14,
    forearmLength: 0.13,
    handLength: 0.11,
    hipWidth: 0.2,
    hipDrop: 0.04,
    thighLength: 0.13,
    shinLength: 0.13,
    ankleHeight: 0.13,
    footLength: 0.25,
  },
  palette: {
    primary: '#46c9b0',
    secondary: '#fff0d6',
    accent: '#ff8fa3',
    dark: '#2b2233',
    light: '#ffffff',
    skin: '#fff0d6',
    hair: '#46c9b0',
    glow: '#ffffff',
  },
  options: { roughness: 0.62, metalness: 0, glowIntensity: 1, bulk: 1 },
  build(ctx) {
    const { b, c, J, u, p, bulk } = ctx;
    const weights = torsoWeights(ctx, true);
    b.paint(c.primary).bind(weights);
    torsoLoft(
      ctx,
      [
        ['LeftUpLeg', -0.06, 0.13, 0.11],
        ['Hips', 0.0, 0.2, 0.165],
        ['Spine1', 0.0, 0.19, 0.16],
        ['Spine2', 0.06, 0.17, 0.13],
        ['Neck', 0.0, 0.11, 0.09],
      ],
      { dome: 0.06, radial: 22 },
    );
    // Belly patch and a round tail.
    b.paint(c.secondary);
    b.ellipsoid(at(ctx, 'Spine', 0, 0.035, 0.112 * bulk), V(0.105 * u * bulk, 0.105 * u, 0.075 * u * bulk), { radial: 20, rings: 12 });
    b.paint(c.primary).bind(BONE_INDEX.Hips).ball(at(ctx, 'Hips', 0, -0.03, -0.165 * bulk), 0.05 * u, { radial: 12, rings: 6 });
    neck(ctx, 0.085, c.primary, 0.03);
    smoothLimbs(ctx, { arm: [0.07, 0.066, 0.062], leg: [0.09, 0.086, 0.08], limbColor: c.primary, jointColor: c.primary, radial: 16 });
    // Paws.
    for (const [side, sx] of SIDES) {
      const hand: CanonicalBodyBone = `${side}Hand`;
      b.paint(c.secondary).bind(BONE_INDEX[hand]);
      b.ellipsoid(at(ctx, hand, sx * 0.045, 0, 0), V(0.075 * u, 0.068 * u, 0.074 * u), { radial: 14, rings: 10 });
    }
    smoothFeet(ctx, { width: 1.45, heel: 0.06, ankle: 0.05, color: c.secondary, toe: 0.95 });

    // Big round head with ears, snout, eyes and cheeks.
    const hh = p.headHeight * u;
    const radii = V(0.248 * u, hh * 0.5, 0.232 * u);
    const center = V(0, J.Head.y + hh - radii.y, 0.012 * u);
    b.bind(BONE_INDEX.Head);
    b.paint(c.primary).ellipsoid(center, radii, { radial: 28, rings: 18 });
    for (const [, sx] of SIDES) {
      const ear = V(sx * 0.175 * u, center.y + 0.175 * u, center.z - 0.02 * u);
      b.paint(c.primary).ellipsoid(ear, V(0.078 * u, 0.078 * u, 0.045 * u), { radial: 14, rings: 10 });
      b.paint(c.accent).ellipsoid(V(ear.x, ear.y, ear.z + 0.026 * u), V(0.048 * u, 0.048 * u, 0.025 * u), { radial: 12, rings: 8 });
    }
    const snoutY = -0.07 * u;
    const snout = V(0, center.y + snoutY, frontOf(center, radii, 0, snoutY) - 0.02 * u);
    b.paint(c.secondary).ellipsoid(snout, V(0.088 * u, 0.064 * u, 0.06 * u), { radial: 14, rings: 10 });
    b.paint(c.dark).ellipsoid(V(0, snout.y + 0.028 * u, snout.z + 0.05 * u), V(0.03 * u, 0.02 * u, 0.018 * u), { radial: 10, rings: 6 });
    eyesOn(ctx, center, radii, { dx: 0.105 * u, dy: 0.01 * u, size: V(0.031 * u, 0.036 * u, 0.018 * u), color: c.dark, highlight: c.light });
    for (const [, sx] of SIDES) {
      const dx = 0.165 * u;
      const dy = -0.065 * u;
      b.paint(c.accent).ellipsoid(V(sx * dx, center.y + dy, frontOf(center, radii, dx, dy) - 0.006 * u), V(0.036 * u, 0.024 * u, 0.012 * u), {
        radial: 10,
        rings: 6,
      });
    }
  },
};

// ───────────────────────────────────────────────────────────────── stick ──

const stick: StyleDefinition = {
  proportions: {
    headHeight: 0.27,
    neckLength: 0.07,
    shoulderWidth: 0.26,
    shoulderDrop: 0.02,
    hipsToSpine: 0.1,
    spineToSpine1: 0.12,
    spine1ToSpine2: 0.13,
    spine2ToNeck: 0.13,
    upperArmLength: 0.27,
    forearmLength: 0.26,
    handLength: 0.09,
    hipWidth: 0.12,
    hipDrop: 0.04,
    thighLength: 0.39,
    shinLength: 0.39,
    ankleHeight: 0.085,
    footLength: 0.21,
  },
  palette: {
    primary: '#f6f2ea',
    secondary: '#f6f2ea',
    accent: '#ff4d5e',
    dark: '#221f2a',
    light: '#ffffff',
    skin: '#f6f2ea',
    hair: '#f6f2ea',
    glow: '#ffffff',
  },
  options: { roughness: 0.5, metalness: 0, glowIntensity: 1, bulk: 1 },
  build(ctx) {
    const { b, c, J, u, p, bulk } = ctx;
    const r = 0.03 * u * bulk;
    const line = { radial: 10, capRings: 3 };
    b.paint(c.primary);
    // Spine: one capsule per bone, all the same radius, so every joint is a ball joint.
    const chain: CanonicalBodyBone[] = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'];
    for (let i = 0; i < chain.length - 1; i++) b.bind(BONE_INDEX[chain[i]]).capsule(J[chain[i]], J[chain[i + 1]], r, r, line);
    const collar = V(0, J.LeftArm.y, 0);
    for (const [side] of SIDES) {
      b.bind(BONE_INDEX.Hips).capsule(J.Hips, J[`${side}UpLeg`], r, r, line);
      b.bind(BONE_INDEX.Spine2).capsule(collar, J[`${side}Shoulder`], r, r, line);
      b.bind(BONE_INDEX[`${side}Shoulder`]).capsule(J[`${side}Shoulder`], J[`${side}Arm`], r, r, line);
    }
    const limb = 0.03;
    smoothLimbs(ctx, { arm: [limb, limb, limb], leg: [limb, limb, limb], limbColor: c.primary, jointColor: c.primary, radial: 10 });
    // Cartoon gloves and sneakers.
    for (const [side, sx] of SIDES) {
      const hand: CanonicalBodyBone = `${side}Hand`;
      b.paint(c.accent).bind(BONE_INDEX[hand]);
      b.ellipsoid(at(ctx, hand, sx * 0.04, 0, 0), V(0.055 * u, 0.042 * u, 0.05 * u), { radial: 12, rings: 8 });
      b.capsule(at(ctx, hand, sx * 0.03, 0, 0.03), at(ctx, hand, sx * 0.055, 0, 0.06), 0.02 * u, 0.017 * u, { radial: 8, capRings: 3 });
    }
    smoothFeet(ctx, { width: 1.25, heel: 0.04, ankle: 0.043, color: c.accent, toe: 0.9 });

    // Round head with tall cartoon eyes.
    const hh = p.headHeight * u;
    const radius = hh * 0.5;
    const radii = V(radius, radius, radius);
    const center = V(0, J.Head.y + hh - radius, 0);
    b.bind(BONE_INDEX.Head);
    b.paint(c.primary).ellipsoid(center, radii, { radial: 24, rings: 16 });
    eyesOn(ctx, center, radii, { dx: 0.045 * u, dy: 0.012 * u, size: V(0.017 * u, 0.034 * u, 0.012 * u), color: c.dark, sink: 0.45 });

    // Bow tie.
    const knot = V(0, J.LeftArm.y - 0.012 * u, r + 0.008 * u);
    b.paint(c.accent).bind(BONE_INDEX.Spine2);
    b.ball(knot, 0.02 * u, { radial: 8, rings: 6 });
    for (const [, sx] of SIDES) {
      b.cylinder(knot, V(sx * 0.075 * u, knot.y, knot.z), 0.012 * u, 0.042 * u, { radial: 10, scaleZ: 0.45, hint: V(0, 0, 1) });
    }
  },
};

// ───────────────────────────────────────────────────────────────── voxel ──

const voxel: StyleDefinition = {
  proportions: {
    headHeight: 0.36,
    neckLength: 0.03,
    shoulderWidth: 0.37,
    shoulderDrop: 0.055,
    hipsToSpine: 0.1,
    spineToSpine1: 0.12,
    spine1ToSpine2: 0.12,
    spine2ToNeck: 0.14,
    upperArmLength: 0.21,
    forearmLength: 0.2,
    handLength: 0.1,
    hipWidth: 0.13,
    hipDrop: 0.04,
    thighLength: 0.27,
    shinLength: 0.27,
    ankleHeight: 0.08,
    footLength: 0.24,
  },
  // A fox cub: orange coat, cream belly and muzzle, dark socks, a white-tipped tail.
  palette: {
    primary: '#ef8a2b',
    secondary: '#d9701c',
    accent: '#fff4e2',
    dark: '#2c1c16',
    light: '#ffffff',
    skin: '#f39a3d',
    hair: '#4a2a1c',
    glow: '#ffffff',
  },
  options: { roughness: 0.8, metalness: 0, glowIntensity: 1, bulk: 1 },
  build(ctx) {
    const { b, c, J, u, p } = ctx;
    const legHalf = (p.hipWidth / 2) * u;
    const torsoHalf = 2 * legHalf;
    const armHalf = J.LeftArm.x - torsoHalf;
    const depth = 0.15 * u;
    const eps = 0.003 * u;

    // Torso: one block (two shades) with blended weights, so it leans and twists without cracking.
    const weights = torsoWeights(ctx);
    const crotch = J.LeftUpLeg.y;
    const belt = J.Hips.y + 0.03 * u;
    const top = J.Neck.y;
    b.bind(weights);
    b.paint(c.secondary).box(V(0, (crotch + belt) / 2, 0), V(torsoHalf * 2, belt - crotch, depth), { segments: [1, 2, 1] });
    b.paint(c.primary).box(V(0, (belt + top) / 2, 0), V(torsoHalf * 2, top - belt, depth), { segments: [1, 8, 1] });
    // Cream belly: a raised panel down the front, widest at the chest.
    const bellyTop = top - 0.035 * u;
    const bellyBottom = crotch + 0.03 * u;
    b.paint(c.accent).box(V(0, (bellyTop + bellyBottom) / 2, depth / 2 + eps), V(torsoHalf * 1.15, bellyTop - bellyBottom, eps * 2), { segments: [1, 8, 1] });

    // Tail: three blocks rising behind the hips, the last one white.
    b.bind(BONE_INDEX.Hips);
    const tail0 = V(0, J.Hips.y + 0.01 * u, -depth / 2 + 0.02 * u);
    const tail1 = V(0, tail0.y + 0.1 * u, tail0.z - 0.13 * u);
    const tail2 = V(0, tail1.y + 0.15 * u, tail1.z - 0.07 * u);
    const tail3 = V(0, tail2.y + 0.1 * u, tail2.z + 0.005 * u);
    b.paint(c.secondary).boxBetween(tail0, tail1, 0.07 * u, 0.07 * u, 0, 0.02 * u);
    b.paint(c.primary).boxBetween(tail1, tail2, 0.12 * u, 0.12 * u, 0.03 * u, 0);
    b.paint(c.light).boxBetween(tail2, tail3, 0.1 * u, 0.1 * u, 0.01 * u, 0);

    // Neck and head.
    b.paint(c.primary).bind(BONE_INDEX.Neck);
    b.box(V(0, (J.Neck.y + J.Head.y) / 2, 0), V(0.12 * u, J.Head.y - J.Neck.y + 0.04 * u, 0.1 * u));
    const hh = p.headHeight * u;
    const headHalf = hh * 0.5;
    const head = V(0, J.Head.y + headHalf, 0.01 * u);
    b.bind(BONE_INDEX.Head);
    b.paint(c.skin).box(head, V(hh, hh, hh * 0.94));
    const faceZ = head.z + headHalf * 0.94;
    // Cream cheeks across the lower face and a muzzle block with a dark nose.
    const cheekTop = head.y - 0.03 * u;
    const cheekBottom = head.y - headHalf;
    b.paint(c.accent).box(V(0, (cheekTop + cheekBottom) / 2, faceZ + eps), V(hh, cheekTop - cheekBottom, eps * 2));
    const muzzle = V(0, head.y - 0.095 * u, faceZ + 0.04 * u);
    b.box(muzzle, V(0.16 * u, 0.11 * u, 0.08 * u));
    b.paint(c.dark).box(V(0, muzzle.y + 0.035 * u, muzzle.z + 0.04 * u), V(0.06 * u, 0.045 * u, 0.02 * u));
    b.box(V(0, muzzle.y - 0.025 * u, muzzle.z + 0.04 * u + eps), V(0.07 * u, 0.012 * u, eps * 2));
    for (const [, sx] of SIDES) {
      // Eyes: a dark pixel with a white glint.
      b.paint(c.dark).box(V(sx * 0.105 * u, head.y + 0.035 * u, faceZ + eps), V(0.05 * u, 0.06 * u, eps * 2));
      b.paint(c.light).box(V(sx * 0.115 * u, head.y + 0.05 * u, faceZ + eps * 2), V(0.02 * u, 0.02 * u, eps * 2));
      // Pointed ears: blocks pinched to a tip, with a dark inner face.
      const earHeight = 0.15 * u;
      const earBase = head.y + headHalf - eps;
      const earX = sx * (headHalf - 0.065 * u);
      const pinch =
        (centreX: number, base: number, height: number) =>
        (position: THREE.Vector3): void => {
          const k = 1 - 0.92 * Math.min(1, Math.max(0, (position.y - base) / height));
          position.x = centreX + (position.x - centreX) * k;
        };
      let from = b.vertexCount;
      b.paint(c.secondary).box(V(earX, earBase + earHeight / 2, head.z - 0.02 * u), V(0.13 * u, earHeight, 0.06 * u));
      b.deform(from, pinch(earX, earBase, earHeight));
      from = b.vertexCount;
      b.paint(c.hair).box(V(earX, earBase + earHeight * 0.36, head.z + 0.01 * u + eps), V(0.075 * u, earHeight * 0.6, eps * 2));
      b.deform(from, pinch(earX, earBase + earHeight * 0.06, earHeight * 0.6));
    }

    for (const [side, sx] of SIDES) {
      const arm: CanonicalBodyBone = `${side}Arm`;
      const foreArm: CanonicalBodyBone = `${side}ForeArm`;
      const hand: CanonicalBodyBone = `${side}Hand`;
      const upLeg: CanonicalBodyBone = `${side}UpLeg`;
      const leg: CanonicalBodyBone = `${side}Leg`;
      const foot: CanonicalBodyBone = `${side}Foot`;
      const toeBase: CanonicalBodyBone = `${side}ToeBase`;
      const armSize = armHalf * 2;
      // Arms: each block reaches half a thickness past its joints, so elbows mitre cleanly at 90°. Dark socks from the elbow down.
      b.paint(c.primary).bind(BONE_INDEX[arm]).boxBetween(J[arm], J[foreArm], armSize, armSize, armHalf, armHalf);
      // (The socks are sleeves over the lower part of the segment, clear of the joint overlap.)
      b.paint(c.primary).bind(BONE_INDEX[foreArm]).boxBetween(J[foreArm], J[hand], armSize - eps * 2, armSize - eps * 2, armHalf - eps, armHalf * 0.6);
      b.paint(c.hair).boxBetween(J[foreArm].clone().lerp(J[hand], 0.45), J[hand], armSize, armSize, 0, armHalf * 0.6 + eps);
      b.paint(c.dark).bind(BONE_INDEX[hand]).boxBetween(J[hand], at(ctx, hand, sx * p.handLength, 0, 0), armSize - eps * 4, armSize - eps * 4, armHalf * 0.6, 0);
      // Legs: orange thighs, dark socks from the knee down.
      const legSize = legHalf * 2 - eps;
      b.paint(c.secondary).bind(BONE_INDEX[upLeg]).boxBetween(J[upLeg], J[leg], legSize, legSize, legHalf, legHalf);
      b.bind(BONE_INDEX[leg]).boxBetween(J[leg], J[foot], legSize - eps * 2, legSize - eps * 2, legHalf - eps, 0);
      b.paint(c.hair).boxBetween(J[leg].clone().lerp(J[foot], 0.42), J[foot], legSize, legSize, 0, 0);
      // Paws.
      const ankle = J[foot];
      const ballZ = J[toeBase].z;
      const tipZ = J[`${side}Toe_End`].z;
      const back = -legHalf - eps;
      const shoe = legSize + eps * 2;
      b.paint(c.dark).bind(BONE_INDEX[foot]);
      b.box(V(ankle.x, ankle.y / 2, (back + ballZ) / 2), V(shoe, ankle.y, ballZ - back));
      b.bind(BONE_INDEX[toeBase]);
      b.box(V(ankle.x, ankle.y * 0.45 + eps, (ballZ - 0.03 * u + tipZ) / 2), V(shoe - eps * 2, ankle.y * 0.9, tipZ - ballZ + 0.03 * u));
    }
  },
};

// ───────────────────────────────────────────────────────────────── lanky ──

const lanky: StyleDefinition = {
  proportions: {
    headHeight: 0.18,
    neckLength: 0.13,
    shoulderWidth: 0.3,
    shoulderDrop: 0.035,
    hipsToSpine: 0.08,
    spineToSpine1: 0.09,
    spine1ToSpine2: 0.1,
    spine2ToNeck: 0.13,
    upperArmLength: 0.36,
    forearmLength: 0.36,
    handLength: 0.2,
    hipWidth: 0.15,
    hipDrop: 0.04,
    thighLength: 0.5,
    shinLength: 0.5,
    ankleHeight: 0.085,
    footLength: 0.31,
  },
  palette: {
    primary: '#8a63ff',
    secondary: '#b9a4ff',
    accent: '#ffd23f',
    dark: '#1f1a33',
    light: '#ffffff',
    skin: '#8a63ff',
    hair: '#ffd23f',
    glow: '#ffffff',
  },
  options: { roughness: 0.45, metalness: 0, glowIntensity: 1, bulk: 1 },
  build(ctx) {
    const { b, c, J, u, p, bulk } = ctx;
    b.paint(c.primary).bind(torsoWeights(ctx, true));
    torsoLoft(ctx, [
      ['LeftUpLeg', -0.04, 0.075, 0.065],
      ['Hips', 0.0, 0.128, 0.1],
      ['Spine1', 0.0, 0.1, 0.085],
      ['Spine2', 0.04, 0.1, 0.082],
      ['LeftArm', 0.0, 0.112, 0.074],
      ['Neck', 0.015, 0.055, 0.048],
    ]);
    // A lighter belly oval.
    b.paint(c.secondary).bind(torsoWeights(ctx));
    b.ellipsoid(at(ctx, 'Spine', 0, 0.02, 0.066 * bulk), V(0.058 * u * bulk, 0.075 * u, 0.04 * u * bulk), { radial: 16, rings: 10 });
    neck(ctx, 0.027, c.primary, 0.03);
    // Knobbly elbows and knees in the body colour.
    smoothLimbs(ctx, { arm: [0.034, 0.026, 0.022], leg: [0.044, 0.032, 0.026], joint: 1.3, limbColor: c.primary, jointColor: c.primary, radial: 12 });
    mittenHands(ctx, { width: 0.1, thick: 0.03, color: c.accent });
    smoothFeet(ctx, { width: 1.4, heel: 0.04, ankle: 0.024, color: c.accent, toe: 0.95 });

    // Small head, one big eye, two feelers.
    const hh = p.headHeight * u;
    const radii = V(0.098 * u, hh * 0.5, 0.092 * u);
    const center = V(0, J.Head.y + hh - radii.y, 0.008 * u);
    b.bind(BONE_INDEX.Head);
    b.paint(c.primary).ellipsoid(center, radii, { radial: 20, rings: 14 });
    const eye = V(0, center.y + 0.012 * u, center.z + radii.z - 0.03 * u);
    const eyeRadius = 0.05 * u;
    b.paint(c.light).ball(eye, eyeRadius, { radial: 16, rings: 10 });
    b.paint(c.dark).ellipsoid(V(0, eye.y, eye.z + eyeRadius - 0.008 * u), V(0.024 * u, 0.024 * u, 0.012 * u), { radial: 12, rings: 6 });
    b.paint(c.light).ball(V(0.009 * u, eye.y + 0.01 * u, eye.z + eyeRadius + 0.002 * u), 0.006 * u, { radial: 6, rings: 4 });
    for (const [, sx] of SIDES) {
      const base = V(sx * 0.04 * u, center.y + radii.y * 0.8, center.z - 0.01 * u);
      const tip = V(sx * 0.075 * u, center.y + radii.y + 0.065 * u, center.z - 0.02 * u);
      b.paint(c.primary).capsule(base, tip, 0.009 * u, 0.007 * u, { radial: 6, capRings: 2 });
      b.paint(c.accent).ball(tip, 0.02 * u, { radial: 10, rings: 6 });
    }
  },
};

/** Recipes by style name. */
export const STYLES: Record<CharacterStyle, StyleDefinition> = { mannequin, robot, toy, stick, voxel, lanky };
