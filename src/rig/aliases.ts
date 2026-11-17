/**
 * Bone-name data for humanoid recognition (see humanoid.ts).
 *
 * To support another naming convention, add a row to CONVENTIONS (or extend an
 * existing one); no code changes are needed.
 *
 * Every alias is a NORMALISED CORE: the node name after
 *   1. removing namespaces ("ns:", "Armature|") and junk prefix tokens (JUNK_PREFIX_TOKENS),
 *   2. removing the side marker (Left / Right / L / R in any position),
 *   3. removing end-marker and digit tokens,
 *   4. lower-casing and deleting every non-letter.
 * So "mixamorig:LeftForeArm", "DEF-forearm.L" and "Bip01 L Forearm" all have
 * the core "forearm"; "spine_03", "Spine2" and "spine.001" all have "spine".
 *
 * Roles are deliberately coarse. Which spine bone is Spine / Spine1 / Spine2,
 * which neck bone is Neck, and where a limb chain starts are decided from the
 * hierarchy, not from these names.
 */

/** Roles of bones on the body's centre line (names without a side marker). */
export type CenterRole = 'hips' | 'spine' | 'neck' | 'head';

/**
 * Roles of sided bones.
 *  - clavicle: unambiguous collar bone.
 *  - shoulder: "shoulder" is a collar bone in most rigs but the upper arm in some BVH files; resolved by position.
 *  - ignore: known sided bones that are never mapped (they may sit inside a limb chain).
 */
export type SideRole =
  | 'clavicle'
  | 'shoulder'
  | 'upperArm'
  | 'foreArm'
  | 'hand'
  | 'upLeg'
  | 'leg'
  | 'foot'
  | 'toe'
  | 'eye'
  | 'ignore';

export interface Convention {
  /** Reported as HumanoidMapping.convention. */
  id: string;
  /** Lower-case first tokens that identify this convention outright ("mixamorig", "bip"). */
  prefixes?: readonly string[];
  center: Partial<Record<CenterRole, readonly string[]>>;
  side: Partial<Record<SideRole, readonly string[]>>;
}

/**
 * Exact-alias table. Earlier rows win when two conventions disagree about an
 * alias (they currently never do).
 */
export const CONVENTIONS: readonly Convention[] = [
  {
    // Mixamo ("mixamorig:Hips", "mixamorigHips", "mixamorig1Hips"), Ready Player Me and our canonical names.
    id: 'mixamo',
    prefixes: ['mixamorig'],
    center: { hips: ['hips'], spine: ['spine'], neck: ['neck'], head: ['head'] },
    side: {
      shoulder: ['shoulder'],
      upperArm: ['arm'],
      foreArm: ['forearm'],
      hand: ['hand'],
      upLeg: ['upleg'],
      leg: ['leg'],
      foot: ['foot'],
      toe: ['toebase'],
      eye: ['eye'],
    },
  },
  {
    // VRM 0.x / 1.0 humanoid bone names, Unity Humanoid (Mecanim) names, VRoid "J_Bip_L_UpperArm".
    id: 'vrm',
    center: { hips: ['hips'], spine: ['spine', 'chest', 'upperchest'], neck: ['neck'], head: ['head'] },
    side: {
      shoulder: ['shoulder'],
      upperArm: ['upperarm'],
      foreArm: ['lowerarm'],
      hand: ['hand'],
      upLeg: ['upperleg'],
      leg: ['lowerleg'],
      foot: ['foot'],
      toe: ['toes', 'toebase'],
      eye: ['eye', 'faceeye'],
    },
  },
  {
    // Unreal Engine mannequins: UE4 (spine_01..03) and UE5 Manny/Quinn, MetaHuman (spine_01..05, neck_01..02).
    id: 'unreal',
    center: { hips: ['pelvis'], spine: ['spine'], neck: ['neck'], head: ['head'] },
    side: {
      clavicle: ['clavicle'],
      upperArm: ['upperarm'],
      foreArm: ['lowerarm'],
      hand: ['hand'],
      upLeg: ['thigh'],
      leg: ['calf'],
      foot: ['foot'],
      toe: ['ball'],
    },
  },
  {
    // Blender-style names (".L" / "_L" / ".l"), Rigify metarigs and DEF- bones, MakeHuman / MPFB game rigs.
    id: 'blender',
    prefixes: ['def'],
    center: { hips: ['hips', 'pelvis'], spine: ['spine', 'chest', 'torso'], neck: ['neck'], head: ['head'] },
    side: {
      clavicle: ['clavicle'],
      shoulder: ['shoulder'],
      upperArm: ['upperarm'],
      foreArm: ['forearm'],
      hand: ['hand'],
      upLeg: ['thigh', 'upperleg'],
      leg: ['shin', 'lowerleg'],
      foot: ['foot'],
      toe: ['toe'],
      eye: ['eye'],
      ignore: ['pelvis', 'breast', 'heel'],
    },
  },
  {
    // 3ds Max Biped / Character Studio ("Bip01 L UpperArm"), Rocketbox ("Bip01 L Clavicle"), ValveBiped.
    id: 'biped',
    prefixes: ['bip', 'biped', 'valvebiped'],
    center: { hips: ['pelvis'], spine: ['spine'], neck: ['neck'], head: ['head'] },
    side: {
      clavicle: ['clavicle'],
      upperArm: ['upperarm'],
      foreArm: ['forearm'],
      hand: ['hand'],
      upLeg: ['thigh'],
      leg: ['calf'],
      foot: ['foot'],
      toe: ['toe'],
    },
  },
  {
    // BVH in the CMU / MotionBuilder style ("Hips, LeftUpLeg, LeftLeg...") and CMU ASF names
    // ("lfemur, ltibia"), plus the joint-named variants ("LeftHip, LeftKnee, LeftAnkle, LeftElbow, LeftWrist").
    id: 'bvh-cmu',
    center: {
      hips: ['hips'],
      spine: ['spine', 'lowerback', 'upperback', 'thorax', 'chest'],
      neck: ['neck', 'lowerneck', 'upperneck'],
      head: ['head'],
    },
    side: {
      clavicle: ['clavicle', 'collar'],
      shoulder: ['shoulder'],
      upperArm: ['arm', 'uparm', 'humerus'],
      foreArm: ['forearm', 'lowarm', 'radius', 'elbow'],
      hand: ['hand', 'wrist'],
      upLeg: ['upleg', 'femur', 'hip'],
      leg: ['leg', 'lowleg', 'tibia', 'knee'],
      foot: ['foot', 'ankle'],
      toe: ['toebase', 'toes', 'toe'],
      ignore: ['hipjoint', 'fingerbase', 'fingers'],
    },
  },
  {
    // BVH in the Poser / DAZ / Second Life style ("hip, abdomen, chest, lCollar, lShldr, lForeArm, lThigh, lShin")
    // and DAZ Genesis 3/8 bones ("lShldrBend", "abdomenLower", "chestUpper").
    id: 'bvh-poser',
    center: {
      hips: ['hip'],
      spine: ['abdomen', 'chest', 'abdomenlower', 'abdomenupper', 'chestlower', 'chestupper'],
      neck: ['neck', 'necklower', 'neckupper'],
      head: ['head'],
    },
    side: {
      clavicle: ['collar'],
      upperArm: ['shldr', 'shldrbend'],
      foreArm: ['forearm', 'forearmbend'],
      hand: ['hand'],
      upLeg: ['thigh', 'thighbend'],
      leg: ['shin'],
      foot: ['foot'],
      toe: ['toe'],
      eye: ['eye'],
      ignore: ['buttock', 'metatarsals'],
    },
  },
];

/**
 * Pattern heuristics, tried in order when no exact alias matches. They run on
 * the same normalised core, so they also catch names with unknown glued
 * prefixes or suffixes ("ctNeck", "arm_upper").
 */
export const CENTER_PATTERNS: readonly (readonly [RegExp, CenterRole])[] = [
  [/hips|pelvis/, 'hips'],
  [/^head|(?<!fore)head$/, 'head'],
  [/neck|cervical/, 'neck'],
  [/spine|chest|abdomen|torso|thorax|waist|stomach|ribcage|lowerback|upperback/, 'spine'],
];

export const SIDE_PATTERNS: readonly (readonly [RegExp, SideRole])[] = [
  [/clavicle|collar|scapula/, 'clavicle'],
  [/forearm|lowerarm|lowarm|armlower|elbow|radius/, 'foreArm'],
  [/upperarm|uparm|armupper|humerus/, 'upperArm'],
  [/hand|wrist/, 'hand'],
  [/thigh|upleg|upperleg|legupper|femur/, 'upLeg'],
  [/shin|calf|lowerleg|lowleg|leglower|knee|tibia/, 'leg'],
  [/toe|ball/, 'toe'],
  [/foot|ankle/, 'foot'],
  [/shoulder/, 'shoulder'],
  [/arm/, 'upperArm'],
  [/leg/, 'leg'],
  [/eye/, 'eye'],
];

/** Finger kinds in canonical order; a "Finger<n>" bone (Biped) uses n as the index into this list. */
export const FINGER_KINDS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const;
export type FingerKind = (typeof FINGER_KINDS)[number];

/** Tokens (or token prefixes of glued names such as "handindex") that mark a finger bone. */
export const FINGER_WORDS: Readonly<Record<string, FingerKind>> = {
  thumb: 'Thumb',
  index: 'Index',
  middle: 'Middle',
  mid: 'Middle',
  ring: 'Ring',
  pinky: 'Pinky',
  pinkie: 'Pinky',
  little: 'Pinky',
};

/** Tokens that mark a hand bone which is neither the hand nor a finger segment 1..3. */
export const PALM_WORDS: readonly string[] = ['palm', 'metacarpal', 'carpal'];

/** Leading tokens that carry no meaning (a digit token right after one is dropped too: "Bip01", "mixamorig1"). */
export const JUNK_PREFIX_TOKENS: readonly string[] = [
  'mixamorig',
  'armature',
  'bip',
  'biped',
  'valve',
  'valvebiped',
  'def',
  'bn',
  'bone',
  'jnt',
  'joint',
  'j',
  'b',
  'cc',
  'base',
  'rig',
  'skel',
  'skeleton',
  'genesis',
  'character',
];

/** A token from this list anywhere in a name marks a helper bone that is never mapped. */
export const HELPER_TOKENS: readonly string[] = [
  'twist',
  'roll',
  'ik',
  'fk',
  'pole',
  'ctrl',
  'control',
  'controller',
  'helper',
  'target',
  'mch',
  'org',
  'tweak',
  'parent',
  'socket',
  'offset',
  'attach',
  'attachment',
  'prop',
  'weapon',
  'adjust',
  'corrective',
  'driver',
  'drv',
  'dummy',
  'aim',
  'goal',
  'footsteps',
  'heel',
  'sec',
  'spring',
  'jiggle',
  'physics',
];

/** A token from this list marks an end marker (leaf with no skin of its own). */
export const END_TOKENS: readonly string[] = ['end', 'nub', 'site', 'endsite', 'tip', 'effector', 'eff'];

/** Tokens that select a side. A lone "c" / "center" token is a centre marker and is dropped. */
export const LEFT_TOKENS: readonly string[] = ['left', 'l', 'lft', 'lt'];
export const RIGHT_TOKENS: readonly string[] = ['right', 'r', 'rgt', 'rt'];
export const CENTER_TOKENS: readonly string[] = ['c', 'center', 'centre'];
