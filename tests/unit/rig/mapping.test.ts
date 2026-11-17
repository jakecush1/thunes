import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { analyseBoneName, mapHumanoid } from '../../../src/rig/humanoid';
import { BODY_BONES, CANONICAL_BONES } from '../../../src/rig/bones';
import type { CanonicalBone } from '../../../src/rig/bones';
import { build, chain, n, names } from './helpers';
import type { Spec } from './helpers';

type Expected = Partial<Record<CanonicalBone, string>>;

/** Expands { Arm: '@Arm' } style tables: keys get Left/Right, '@' in values is replaced per side. */
function bothSides(table: Record<string, string>, left: string, right: string): Expected {
  const out: Expected = {};
  for (const [bone, name] of Object.entries(table)) {
    out[`Left${bone}` as CanonicalBone] = name.replaceAll('@', left);
    out[`Right${bone}` as CanonicalBone] = name.replaceAll('@', right);
  }
  return out;
}

function check(spec: Spec, expected: Expected, options: { sanitize?: boolean; convention?: string } = {}): void {
  const root = build(n('Scene', n('Armature', spec)), options);
  const mapping = mapHumanoid(root);
  const want: Expected = {};
  for (const [bone, name] of Object.entries(expected)) want[bone as CanonicalBone] = options.sanitize ? THREE.PropertyBinding.sanitizeNodeName(name) : name;
  expect(names(mapping.bones)).toEqual(want);
  expect(mapping.missingRequired).toEqual([]);
  expect(mapping.isHumanoid).toBe(true);
  if (options.convention) expect(mapping.convention).toBe(options.convention);
  // No node is used twice.
  const nodes = Object.values(mapping.bones);
  expect(new Set(nodes).size).toBe(nodes.length);
}

// ————————————————————————————————————————————————————————————————————————
// Mixamo (bone list of the Xbot / Michelle / Soldier fixtures and of "Samba Dancing.fbx")

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];

function mixamo(p: string, withEyes = false): Spec {
  const arm = (s: string): Spec =>
    chain([`${p}${s}Shoulder`, `${p}${s}Arm`, `${p}${s}ForeArm`, `${p}${s}Hand`], ...FINGERS.map((f) => chain([1, 2, 3, 4].map((i) => `${p}${s}Hand${f}${i}`))));
  const leg = (s: string): Spec => chain([`${p}${s}UpLeg`, `${p}${s}Leg`, `${p}${s}Foot`, `${p}${s}ToeBase`, `${p}${s}Toe_End`]);
  return n(
    `${p}Hips`,
    chain(
      [`${p}Spine`, `${p}Spine1`, `${p}Spine2`],
      chain([`${p}Neck`, `${p}Head`], n(`${p}HeadTop_End`), ...(withEyes ? [n(`${p}LeftEye`), n(`${p}RightEye`)] : [])),
      arm('Left'),
      arm('Right'),
    ),
    leg('Left'),
    leg('Right'),
  );
}

function mixamoExpected(p: string): Expected {
  const out: Expected = {};
  for (const bone of CANONICAL_BONES) out[bone] = p + bone;
  return out;
}

describe('mapHumanoid: Mixamo and Ready Player Me', () => {
  it.each([
    ['mixamorig:', false],
    ['mixamorig:', true],
    ['mixamorig', false],
    ['mixamorig1:', true],
    ['mixamorig1', false],
    ['mixamorig9_', false],
    ['Armature|mixamorig:', false],
  ] as const)('prefix %s (sanitised: %s)', (prefix, sanitize) => {
    check(mixamo(prefix, true), mixamoExpected(prefix), { sanitize, convention: 'mixamo' });
  });

  it('Ready Player Me / canonical names without prefix', () => {
    check(mixamo('', true), mixamoExpected(''), { convention: 'mixamo' });
  });

  it('prefers the first of two nodes sharing a name (FBXLoader twin bones)', () => {
    // three's FBXLoader gives every Mixamo bone an identically named child.
    const twin = (spec: Spec): Spec => n(spec.name, n(spec.name), ...spec.children.map(twin));
    const root = build(n('', twin(mixamo('mixamorig'))));
    const mapping = mapHumanoid(root);
    expect(mapping.isHumanoid).toBe(true);
    for (const bone of BODY_BONES) {
      const node = mapping.bones[bone]!;
      expect(node.name).toBe(`mixamorig${bone}`);
      expect(node.parent!.name).not.toBe(node.name);
      expect(THREE.PropertyBinding.findNode(root, node.name)).toBe(node);
    }
  });
});

// ————————————————————————————————————————————————————————————————————————
// VRM / Unity

describe('mapHumanoid: VRM and Unity Humanoid', () => {
  const vrmFingers = (s: string): Spec[] => [
    chain([`${s}ThumbMetacarpal`, `${s}ThumbProximal`, `${s}ThumbDistal`]),
    ...['Index', 'Middle', 'Ring', 'Little'].map((f) => chain([`${s}${f}Proximal`, `${s}${f}Intermediate`, `${s}${f}Distal`])),
  ];
  const vrm = (upperChest: boolean): Spec =>
    n(
      'hips',
      chain(
        upperChest ? ['spine', 'chest', 'upperChest'] : ['spine', 'chest'],
        chain(['neck', 'head'], n('leftEye'), n('rightEye'), n('jaw')),
        chain(['leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'], ...vrmFingers('left')),
        chain(['rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand'], ...vrmFingers('right')),
      ),
      chain(['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes']),
      chain(['rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes']),
    );
  const limbs = (l: string, r: string): Expected => ({
    ...bothSides(
      {
        Shoulder: '@Shoulder',
        Arm: '@UpperArm',
        ForeArm: '@LowerArm',
        Hand: '@Hand',
        UpLeg: '@UpperLeg',
        Leg: '@LowerLeg',
        Foot: '@Foot',
        ToeBase: '@Toes',
        HandThumb1: '@ThumbMetacarpal',
        HandThumb2: '@ThumbProximal',
        HandThumb3: '@ThumbDistal',
        HandIndex1: '@IndexProximal',
        HandIndex2: '@IndexIntermediate',
        HandIndex3: '@IndexDistal',
        HandMiddle1: '@MiddleProximal',
        HandMiddle2: '@MiddleIntermediate',
        HandMiddle3: '@MiddleDistal',
        HandRing1: '@RingProximal',
        HandRing2: '@RingIntermediate',
        HandRing3: '@RingDistal',
        HandPinky1: '@LittleProximal',
        HandPinky2: '@LittleIntermediate',
        HandPinky3: '@LittleDistal',
      },
      l,
      r,
    ),
  });

  it('VRM 1.0 names with upperChest', () => {
    check(vrm(true), { Hips: 'hips', Spine: 'spine', Spine1: 'chest', Spine2: 'upperChest', Neck: 'neck', Head: 'head', ...limbs('left', 'right') }, { convention: 'vrm' });
  });

  it('VRM without upperChest: the chest carries the shoulders, so it is Spine2', () => {
    check(vrm(false), { Hips: 'hips', Spine: 'spine', Spine2: 'chest', Neck: 'neck', Head: 'head', ...limbs('left', 'right') }, { convention: 'vrm' });
  });

  it('Unity Humanoid names with spaces', () => {
    const spec = n(
      'Hips',
      chain(
        ['Spine', 'Chest', 'Upper Chest'],
        chain(['Neck', 'Head'], n('Left Eye'), n('Right Eye'), n('Jaw')),
        chain(['Left Shoulder', 'Left Upper Arm', 'Left Lower Arm', 'Left Hand'], chain(['Left Index Proximal', 'Left Index Intermediate', 'Left Index Distal'])),
        chain(['Right Shoulder', 'Right Upper Arm', 'Right Lower Arm', 'Right Hand'], chain(['Right Index Proximal', 'Right Index Intermediate', 'Right Index Distal'])),
      ),
      chain(['Left Upper Leg', 'Left Lower Leg', 'Left Foot', 'Left Toes']),
      chain(['Right Upper Leg', 'Right Lower Leg', 'Right Foot', 'Right Toes']),
    );
    const expected: Expected = {
      Hips: 'Hips',
      Spine: 'Spine',
      Spine1: 'Chest',
      Spine2: 'Upper Chest',
      Neck: 'Neck',
      Head: 'Head',
      ...bothSides(
        {
          Shoulder: '@ Shoulder',
          Arm: '@ Upper Arm',
          ForeArm: '@ Lower Arm',
          Hand: '@ Hand',
          UpLeg: '@ Upper Leg',
          Leg: '@ Lower Leg',
          Foot: '@ Foot',
          ToeBase: '@ Toes',
          HandIndex1: '@ Index Proximal',
          HandIndex2: '@ Index Intermediate',
          HandIndex3: '@ Index Distal',
        },
        'Left',
        'Right',
      ),
    };
    check(spec, expected, { convention: 'vrm' });
    check(spec, expected, { sanitize: true, convention: 'vrm' });
  });

  it('VRoid J_Bip names with secondary (spring) bones', () => {
    const arm = (s: string): Spec =>
      chain([`J_Bip_${s}_Shoulder`, `J_Bip_${s}_UpperArm`, `J_Bip_${s}_LowerArm`, `J_Bip_${s}_Hand`], chain([`J_Bip_${s}_Index1`, `J_Bip_${s}_Index2`, `J_Bip_${s}_Index3`]), n(`J_Sec_${s}_SleeveHand`));
    const leg = (s: string): Spec => chain([`J_Bip_${s}_UpperLeg`, `J_Bip_${s}_LowerLeg`, `J_Bip_${s}_Foot`, `J_Bip_${s}_ToeBase`]);
    const spec = n(
      'Root',
      n(
        'J_Bip_C_Hips',
        chain(['J_Bip_C_Spine', 'J_Bip_C_Chest', 'J_Bip_C_UpperChest'], chain(['J_Bip_C_Neck', 'J_Bip_C_Head'], n('J_Adj_L_FaceEye'), n('J_Adj_R_FaceEye'), n('J_Sec_Hair1_01')), arm('L'), arm('R'), n('J_Sec_L_Bust1')),
        leg('L'),
        leg('R'),
        n('J_Sec_C_SkirtBack_01'),
      ),
    );
    check(spec, {
      Hips: 'J_Bip_C_Hips',
      Spine: 'J_Bip_C_Spine',
      Spine1: 'J_Bip_C_Chest',
      Spine2: 'J_Bip_C_UpperChest',
      Neck: 'J_Bip_C_Neck',
      Head: 'J_Bip_C_Head',
      ...bothSides(
        {
          Shoulder: 'J_Bip_@_Shoulder',
          Arm: 'J_Bip_@_UpperArm',
          ForeArm: 'J_Bip_@_LowerArm',
          Hand: 'J_Bip_@_Hand',
          HandIndex1: 'J_Bip_@_Index1',
          HandIndex2: 'J_Bip_@_Index2',
          HandIndex3: 'J_Bip_@_Index3',
          UpLeg: 'J_Bip_@_UpperLeg',
          Leg: 'J_Bip_@_LowerLeg',
          Foot: 'J_Bip_@_Foot',
          ToeBase: 'J_Bip_@_ToeBase',
        },
        'L',
        'R',
      ),
    });
  });
});

// ————————————————————————————————————————————————————————————————————————
// Unreal

describe('mapHumanoid: Unreal mannequins', () => {
  const fingers = (s: string, metacarpals: boolean): Spec[] => [
    chain([`thumb_01_${s}`, `thumb_02_${s}`, `thumb_03_${s}`]),
    ...['index', 'middle', 'ring', 'pinky'].map((f) => chain([...(metacarpals ? [`${f}_metacarpal_${s}`] : []), `${f}_01_${s}`, `${f}_02_${s}`, `${f}_03_${s}`])),
  ];
  const arm = (s: string, ue5: boolean): Spec =>
    n(
      `clavicle_${s}`,
      n(
        `upperarm_${s}`,
        n(`upperarm_twist_01_${s}`),
        ...(ue5 ? [n(`upperarm_twist_02_${s}`), n(`upperarm_correctiveRoot_${s}`)] : []),
        n(`lowerarm_${s}`, n(`lowerarm_twist_01_${s}`), n(`hand_${s}`, ...fingers(s, ue5))),
      ),
      ...(ue5 ? [n(`clavicle_pec_${s}`)] : []),
    );
  const leg = (s: string): Spec => n(`thigh_${s}`, n(`thigh_twist_01_${s}`), n(`calf_${s}`, n(`calf_twist_01_${s}`), chain([`foot_${s}`, `ball_${s}`])));
  const ik = [n('ik_foot_root', n('ik_foot_l'), n('ik_foot_r')), n('ik_hand_root', n('ik_hand_gun', n('ik_hand_l'), n('ik_hand_r')))];
  const limbs: Expected = bothSides(
    {
      Shoulder: 'clavicle_@',
      Arm: 'upperarm_@',
      ForeArm: 'lowerarm_@',
      Hand: 'hand_@',
      UpLeg: 'thigh_@',
      Leg: 'calf_@',
      Foot: 'foot_@',
      ToeBase: 'ball_@',
      HandThumb1: 'thumb_01_@',
      HandThumb2: 'thumb_02_@',
      HandThumb3: 'thumb_03_@',
      HandIndex1: 'index_01_@',
      HandIndex2: 'index_02_@',
      HandIndex3: 'index_03_@',
      HandMiddle1: 'middle_01_@',
      HandMiddle2: 'middle_02_@',
      HandMiddle3: 'middle_03_@',
      HandRing1: 'ring_01_@',
      HandRing2: 'ring_02_@',
      HandRing3: 'ring_03_@',
      HandPinky1: 'pinky_01_@',
      HandPinky2: 'pinky_02_@',
      HandPinky3: 'pinky_03_@',
    },
    'l',
    'r',
  );

  it('UE4 mannequin (three spine bones, twist and IK bones)', () => {
    const spec = n('root', n('pelvis', chain(['spine_01', 'spine_02', 'spine_03'], arm('l', false), arm('r', false), chain(['neck_01', 'head'])), leg('l'), leg('r')), ...ik);
    check(spec, { Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03', Neck: 'neck_01', Head: 'head', ...limbs }, { convention: 'unreal' });
  });

  it('UE5 Manny (five spine bones, two necks, metacarpals, corrective bones)', () => {
    const spec = n(
      'root',
      n('pelvis', chain(['spine_01', 'spine_02', 'spine_03', 'spine_04', 'spine_05'], arm('l', true), arm('r', true), chain(['neck_01', 'neck_02', 'head'])), leg('l'), leg('r')),
      ...ik,
    );
    check(spec, { Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_03', Spine2: 'spine_05', Neck: 'neck_01', Head: 'head', ...limbs }, { convention: 'unreal' });
  });
});

// ————————————————————————————————————————————————————————————————————————
// Blender

describe('mapHumanoid: Blender-style names', () => {
  const simple = (l: string, r: string): Spec => {
    const arm = (s: string): Spec => chain([`shoulder${s}`, `upper_arm${s}`, `forearm${s}`, `hand${s}`], chain([`thumb.01${s}`, `thumb.02${s}`, `thumb.03${s}`]), chain([`palm.01${s}`, `f_index.01${s}`, `f_index.02${s}`, `f_index.03${s}`]));
    const leg = (s: string): Spec => chain([`thigh${s}`, `shin${s}`, `foot${s}`], n(`toe${s}`), n(`heel.02${s}`));
    return n('hips', chain(['spine', 'chest'], chain(['neck', 'head']), arm(l), arm(r)), leg(l), leg(r));
  };
  const expected = (l: string, r: string): Expected => ({
    Hips: 'hips',
    Spine: 'spine',
    Spine2: 'chest',
    Neck: 'neck',
    Head: 'head',
    ...bothSides(
      {
        Shoulder: 'shoulder@',
        Arm: 'upper_arm@',
        ForeArm: 'forearm@',
        Hand: 'hand@',
        UpLeg: 'thigh@',
        Leg: 'shin@',
        Foot: 'foot@',
        ToeBase: 'toe@',
        HandThumb1: 'thumb.01@',
        HandThumb2: 'thumb.02@',
        HandThumb3: 'thumb.03@',
        HandIndex1: 'f_index.01@',
        HandIndex2: 'f_index.02@',
        HandIndex3: 'f_index.03@',
      },
      l,
      r,
    ),
  });

  it.each([
    ['.L', '.R'],
    ['_L', '_R'],
    ['.l', '.r'],
    ['_l', '_r'],
    ['-L', '-R'],
    [' L', ' R'],
  ])('suffixes %s / %s, raw and sanitised', (l, r) => {
    check(simple(l, r), expected(l, r), { convention: 'blender' });
    check(simple(l, r), expected(l, r), { sanitize: true, convention: 'blender' });
  });

  it('prefix forms L_ / R_ and l_ / r_', () => {
    for (const [l, r] of [
      ['L_', 'R_'],
      ['l_', 'r_'],
      ['Left_', 'Right_'],
    ]) {
      const arm = (s: string): Spec => chain([`${s}shoulder`, `${s}upper_arm`, `${s}forearm`, `${s}hand`]);
      const leg = (s: string): Spec => chain([`${s}thigh`, `${s}shin`, `${s}foot`, `${s}toe`]);
      const spec = n('pelvis', chain(['spine', 'chest'], chain(['neck', 'head']), arm(l!), arm(r!)), leg(l!), leg(r!));
      check(spec, {
        Hips: 'pelvis',
        Spine: 'spine',
        Spine2: 'chest',
        Neck: 'neck',
        Head: 'head',
        ...bothSides({ Shoulder: '@shoulder', Arm: '@upper_arm', ForeArm: '@forearm', Hand: '@hand', UpLeg: '@thigh', Leg: '@shin', Foot: '@foot', ToeBase: '@toe' }, l!, r!),
      });
    }
  });

  it('Rigify DEF- bones: numbered spine, no bone named head or hips, split limb segments', () => {
    const arm = (s: string): Spec =>
      chain(
        [`DEF-shoulder.${s}`, `DEF-upper_arm.${s}`, `DEF-upper_arm.${s}.001`, `DEF-forearm.${s}`, `DEF-forearm.${s}.001`, `DEF-hand.${s}`],
        chain([`DEF-thumb.01.${s}`, `DEF-thumb.02.${s}`, `DEF-thumb.03.${s}`]),
        chain([`DEF-palm.01.${s}`, `DEF-f_index.01.${s}`, `DEF-f_index.02.${s}`, `DEF-f_index.03.${s}`]),
        chain([`DEF-palm.02.${s}`, `DEF-f_middle.01.${s}`, `DEF-f_middle.02.${s}`, `DEF-f_middle.03.${s}`]),
        chain([`DEF-palm.03.${s}`, `DEF-f_ring.01.${s}`, `DEF-f_ring.02.${s}`, `DEF-f_ring.03.${s}`]),
        chain([`DEF-palm.04.${s}`, `DEF-f_pinky.01.${s}`, `DEF-f_pinky.02.${s}`, `DEF-f_pinky.03.${s}`]),
      );
    const leg = (s: string): Spec => n(`DEF-pelvis.${s}`, chain([`DEF-thigh.${s}`, `DEF-thigh.${s}.001`, `DEF-shin.${s}`, `DEF-shin.${s}.001`, `DEF-foot.${s}`, `DEF-toe.${s}`]));
    const spec = n(
      'DEF-spine',
      chain(
        ['DEF-spine.001', 'DEF-spine.002', 'DEF-spine.003'],
        chain(['DEF-spine.004', 'DEF-spine.005', 'DEF-spine.006'], n('DEF-jaw'), n('DEF-nose'), n('DEF-eye.L'), n('DEF-eye.R')),
        arm('L'),
        arm('R'),
        n('DEF-breast.L'),
        n('DEF-breast.R'),
      ),
      leg('L'),
      leg('R'),
    );
    const expected: Expected = {
      Hips: 'DEF-spine',
      Spine: 'DEF-spine.001',
      Spine1: 'DEF-spine.002',
      Spine2: 'DEF-spine.003',
      Neck: 'DEF-spine.004',
      Head: 'DEF-spine.006',
      ...bothSides(
        {
          Shoulder: 'DEF-shoulder.@',
          Arm: 'DEF-upper_arm.@',
          ForeArm: 'DEF-forearm.@',
          Hand: 'DEF-hand.@',
          UpLeg: 'DEF-thigh.@',
          Leg: 'DEF-shin.@',
          Foot: 'DEF-foot.@',
          ToeBase: 'DEF-toe.@',
          HandThumb1: 'DEF-thumb.01.@',
          HandThumb2: 'DEF-thumb.02.@',
          HandThumb3: 'DEF-thumb.03.@',
          HandIndex1: 'DEF-f_index.01.@',
          HandIndex2: 'DEF-f_index.02.@',
          HandIndex3: 'DEF-f_index.03.@',
          HandMiddle1: 'DEF-f_middle.01.@',
          HandMiddle2: 'DEF-f_middle.02.@',
          HandMiddle3: 'DEF-f_middle.03.@',
          HandRing1: 'DEF-f_ring.01.@',
          HandRing2: 'DEF-f_ring.02.@',
          HandRing3: 'DEF-f_ring.03.@',
          HandPinky1: 'DEF-f_pinky.01.@',
          HandPinky2: 'DEF-f_pinky.02.@',
          HandPinky3: 'DEF-f_pinky.03.@',
        },
        'L',
        'R',
      ),
    };
    check(spec, expected, { convention: 'blender' });
    check(spec, expected, { sanitize: true, convention: 'blender' });
  });
});

// ————————————————————————————————————————————————————————————————————————
// BVH

describe('mapHumanoid: BVH variants', () => {
  it('CMU / MotionBuilder style with hip joints and finger bases', () => {
    const arm = (s: string): Spec => chain([`${s}Shoulder`, `${s}Arm`, `${s}ForeArm`, `${s}Hand`], chain([`${s}FingerBase`, `${s}HandIndex1`]), n(`${s[0]}Thumb`));
    const leg = (s: string): Spec => chain([`${s[0]}HipJoint`, `${s}UpLeg`, `${s}Leg`, `${s}Foot`, `${s}ToeBase`]);
    const spec = n('Hips', leg('Left'), leg('Right'), chain(['LowerBack', 'Spine', 'Spine1'], chain(['Neck', 'Neck1', 'Head']), arm('Left'), arm('Right')));
    check(
      spec,
      {
        Hips: 'Hips',
        Spine: 'LowerBack',
        Spine1: 'Spine',
        Spine2: 'Spine1',
        Neck: 'Neck',
        Head: 'Head',
        ...bothSides({ Shoulder: '@Shoulder', Arm: '@Arm', ForeArm: '@ForeArm', Hand: '@Hand', UpLeg: '@UpLeg', Leg: '@Leg', Foot: '@Foot', ToeBase: '@ToeBase', HandIndex1: '@HandIndex1' }, 'Left', 'Right'),
        LeftHandThumb1: 'LThumb',
        RightHandThumb1: 'RThumb',
      },
      { convention: 'bvh-cmu' },
    );
  });

  it('Poser / DAZ style: hip, abdomen, chest, lCollar, lShldr... (pirouette.bvh)', () => {
    const arm = (s: string): Spec =>
      chain(
        [`${s}Collar`, `${s}Shldr`, `${s}ForeArm`, `${s}Hand`],
        ...['Thumb', 'Index', 'Mid', 'Ring', 'Pinky'].map((f) => chain([`${s}${f}1`, `${s}${f}2`, 'ENDSITE'])),
      );
    const leg = (s: string): Spec => chain([`${s}Buttock`, `${s}Thigh`, `${s}Shin`, `${s}Foot`, 'ENDSITE']);
    const spec = n('hip', chain(['abdomen', 'chest'], chain(['neck', 'head'], n('leftEye', n('ENDSITE')), n('rightEye', n('ENDSITE'))), arm('r'), arm('l')), leg('r'), leg('l'));
    check(
      spec,
      {
        Hips: 'hip',
        Spine: 'abdomen',
        Spine2: 'chest',
        Neck: 'neck',
        Head: 'head',
        ...bothSides(
          {
            Shoulder: '@Collar',
            Arm: '@Shldr',
            ForeArm: '@ForeArm',
            Hand: '@Hand',
            UpLeg: '@Thigh',
            Leg: '@Shin',
            Foot: '@Foot',
            HandThumb1: '@Thumb1',
            HandThumb2: '@Thumb2',
            HandIndex1: '@Index1',
            HandIndex2: '@Index2',
            HandMiddle1: '@Mid1',
            HandMiddle2: '@Mid2',
            HandRing1: '@Ring1',
            HandRing2: '@Ring2',
            HandPinky1: '@Pinky1',
            HandPinky2: '@Pinky2',
          },
          'l',
          'r',
        ),
      },
      { convention: 'bvh-poser' },
    );
  });

  it('joint-named BVH: "Shoulder" is the upper arm, "Hip" the thigh', () => {
    const arm = (s: string): Spec => chain([`${s}Collar`, `${s}Shoulder`, `${s}Elbow`, `${s}Wrist`]);
    const leg = (s: string): Spec => chain([`${s}Hip`, `${s}Knee`, `${s}Ankle`, `${s}Toe`]);
    const spec = n('Hips', chain(['Chest', 'Chest2'], chain(['Neck', 'Head']), arm('Left'), arm('Right')), leg('Left'), leg('Right'));
    check(spec, {
      Hips: 'Hips',
      Spine: 'Chest',
      Spine2: 'Chest2',
      Neck: 'Neck',
      Head: 'Head',
      ...bothSides({ Shoulder: '@Collar', Arm: '@Shoulder', ForeArm: '@Elbow', Hand: '@Wrist', UpLeg: '@Hip', Leg: '@Knee', Foot: '@Ankle', ToeBase: '@Toe' }, 'Left', 'Right'),
    });
  });

  it('CMU ASF single-case names: "lhumerus", "rtibia", and "lowerback" is not a left bone', () => {
    const arm = (s: string): Spec => chain([`${s}clavicle`, `${s}humerus`, `${s}radius`, `${s}wrist`, `${s}hand`], n(`${s}fingers`), n(`${s}thumb`));
    const leg = (s: string): Spec => chain([`${s}hipjoint`, `${s}femur`, `${s}tibia`, `${s}foot`, `${s}toes`]);
    const spec = n('root', leg('l'), leg('r'), chain(['lowerback', 'upperback', 'thorax'], chain(['lowerneck', 'upperneck', 'head']), arm('l'), arm('r')));
    check(spec, {
      Hips: 'root',
      Spine: 'lowerback',
      Spine1: 'upperback',
      Spine2: 'thorax',
      Neck: 'lowerneck',
      Head: 'head',
      ...bothSides({ Shoulder: '@clavicle', Arm: '@humerus', ForeArm: '@radius', Hand: '@wrist', UpLeg: '@femur', Leg: '@tibia', Foot: '@foot', ToeBase: '@toes', HandThumb1: '@thumb' }, 'l', 'r'),
    });
  });
});

// ————————————————————————————————————————————————————————————————————————
// 3ds Max Biped

describe('mapHumanoid: 3ds Max Biped', () => {
  const biped = (p: string, thighsUnderSpine: boolean): Spec => {
    const arm = (s: string): Spec =>
      chain(
        [`${p} ${s} Clavicle`, `${p} ${s} UpperArm`, `${p} ${s} Forearm`, `${p} ${s} Hand`],
        chain([`${p} ${s} Finger0`, `${p} ${s} Finger01`, `${p} ${s} Finger02`, `${p} ${s} Finger0Nub`]),
        chain([`${p} ${s} Finger1`, `${p} ${s} Finger11`, `${p} ${s} Finger12`, `${p} ${s} Finger1Nub`]),
        chain([`${p} ${s} Finger2`, `${p} ${s} Finger21`, `${p} ${s} Finger22`, `${p} ${s} Finger2Nub`]),
      );
    const leg = (s: string): Spec => chain([`${p} ${s} Thigh`, `${p} ${s} Calf`, `${p} ${s} Foot`, `${p} ${s} Toe0`, `${p} ${s} Toe0Nub`]);
    const legs = [leg('L'), leg('R')];
    const upper = chain([`${p} Spine1`, `${p} Spine2`], chain([`${p} Neck`, `${p} Head`], n(`${p} HeadNub`)), arm('L'), arm('R'));
    return n(p, n(`${p} Footsteps`), n(`${p} Pelvis`, n(`${p} Spine`, upper, ...(thighsUnderSpine ? legs : [])), ...(thighsUnderSpine ? [] : legs)));
  };
  const expected = (p: string): Expected => ({
    Hips: `${p} Pelvis`,
    Spine: `${p} Spine`,
    Spine1: `${p} Spine1`,
    Spine2: `${p} Spine2`,
    Neck: `${p} Neck`,
    Head: `${p} Head`,
    HeadTop_End: `${p} HeadNub`,
    ...bothSides(
      {
        Shoulder: `${p} @ Clavicle`,
        Arm: `${p} @ UpperArm`,
        ForeArm: `${p} @ Forearm`,
        Hand: `${p} @ Hand`,
        UpLeg: `${p} @ Thigh`,
        Leg: `${p} @ Calf`,
        Foot: `${p} @ Foot`,
        ToeBase: `${p} @ Toe0`,
        Toe_End: `${p} @ Toe0Nub`,
        HandThumb1: `${p} @ Finger0`,
        HandThumb2: `${p} @ Finger01`,
        HandThumb3: `${p} @ Finger02`,
        HandIndex1: `${p} @ Finger1`,
        HandIndex2: `${p} @ Finger11`,
        HandIndex3: `${p} @ Finger12`,
        HandMiddle1: `${p} @ Finger2`,
        HandMiddle2: `${p} @ Finger21`,
        HandMiddle3: `${p} @ Finger22`,
      },
      'L',
      'R',
    ),
  });

  it.each(['Bip01', 'Bip001'])('%s, thighs below the pelvis, raw and sanitised', (p) => {
    check(biped(p, false), expected(p), { convention: 'biped' });
    check(biped(p, false), expected(p), { sanitize: true, convention: 'biped' });
  });

  it('thighs parented to the first spine bone (classic Character Studio layout)', () => {
    check(biped('Bip01', true), expected('Bip01'), { convention: 'biped' });
  });
});

// ————————————————————————————————————————————————————————————————————————
// Traps and non-humanoids

describe('mapHumanoid: traps', () => {
  it('twist bones inside a limb chain are skipped (DAZ Genesis 8)', () => {
    const arm = (s: string): Spec => chain([`${s}Collar`, `${s}ShldrBend`, `${s}ShldrTwist`, `${s}ForearmBend`, `${s}ForearmTwist`, `${s}Hand`], chain([`${s}Carpal1`, `${s}Index1`, `${s}Index2`, `${s}Index3`]), chain([`${s}Thumb1`, `${s}Thumb2`, `${s}Thumb3`]));
    const leg = (s: string): Spec => chain([`${s}ThighBend`, `${s}ThighTwist`, `${s}Shin`, `${s}Foot`, `${s}Metatarsals`, `${s}Toe`], n(`${s}BigToe`), n(`${s}SmallToe1`));
    const spec = n('hip', n('pelvis', leg('l'), leg('r')), chain(['abdomenLower', 'abdomenUpper', 'chestLower', 'chestUpper'], chain(['neckLower', 'neckUpper', 'head']), arm('l'), arm('r'), n('lPectoral'), n('rPectoral')));
    check(spec, {
      Hips: 'hip',
      Spine: 'abdomenLower',
      Spine1: 'abdomenUpper',
      Spine2: 'chestUpper',
      Neck: 'neckLower',
      Head: 'head',
      ...bothSides(
        {
          Shoulder: '@Collar',
          Arm: '@ShldrBend',
          ForeArm: '@ForearmBend',
          Hand: '@Hand',
          UpLeg: '@ThighBend',
          Leg: '@Shin',
          Foot: '@Foot',
          ToeBase: '@Toe',
          HandIndex1: '@Index1',
          HandIndex2: '@Index2',
          HandIndex3: '@Index3',
          HandThumb1: '@Thumb1',
          HandThumb2: '@Thumb2',
          HandThumb3: '@Thumb3',
        },
        'l',
        'r',
      ),
    });
  });

  it('four spine bones: first, middle and last are used', () => {
    const arm = (s: string): Spec => chain([`${s}Shoulder`, `${s}Arm`, `${s}ForeArm`, `${s}Hand`]);
    const leg = (s: string): Spec => chain([`${s}UpLeg`, `${s}Leg`, `${s}Foot`]);
    const spec = n('Hips', chain(['Spine', 'Spine1', 'Spine2', 'Spine3'], chain(['Neck', 'Head']), arm('Left'), arm('Right')), leg('Left'), leg('Right'));
    const mapping = mapHumanoid(build(spec));
    expect(names(mapping.bones)).toMatchObject({ Spine: 'Spine', Spine1: 'Spine1', Spine2: 'Spine3', Neck: 'Neck', Head: 'Head' });
    expect(mapping.isHumanoid).toBe(true);
  });

  it('a single spine bone is Spine; missing shoulders, neck and toes stay unmapped', () => {
    const arm = (s: string): Spec => chain([`${s}Arm`, `${s}ForeArm`, `${s}Hand`]);
    const leg = (s: string): Spec => chain([`${s}UpLeg`, `${s}Leg`, `${s}Foot`]);
    const spec = n('Hips', n('Spine', n('Head'), arm('Left'), arm('Right')), leg('Left'), leg('Right'));
    const mapping = mapHumanoid(build(spec));
    expect(mapping.isHumanoid).toBe(true);
    expect(Object.keys(mapping.bones).sort()).toEqual(
      ['Hips', 'Spine', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'].sort(),
    );
  });

  it('fingers, end markers, IK and roll bones never take the place of a body bone', () => {
    const arm = (s: string): Spec =>
      n(
        `${s}Shoulder`,
        n(
          `${s}Arm`,
          n(`${s}ArmRoll`),
          n(`${s}ForeArm`, n(`${s}ForeArmRoll`), n(`${s}ForeArmTwist`), n(`${s}Hand`, n(`${s}HandIndex1`, n(`${s}HandIndex1_End`)), n(`${s}Hand_End`), n(`${s}HandIK`))),
        ),
      );
    const leg = (s: string): Spec => n(`${s}UpLeg`, n(`${s}UpLegRoll`), n(`${s}Leg`, n(`${s}Foot`, n(`${s}Foot_End`), n(`${s}ToeBase`, n(`${s}ToeBase_End`)))));
    const spec = n(
      'Reference',
      n('Hips', n('Hips_End'), chain(['Spine', 'Spine1'], chain(['Neck', 'Head'], n('Head_End'), n('HeadIK')), arm('Left'), arm('Right')), leg('Left'), leg('Right')),
      n('LeftHandIKTarget'),
      n('RightHandIKTarget'),
      n('LeftFootIK'),
      n('RightFootIK'),
      n('LeftHand_Pole'),
    );
    const mapping = mapHumanoid(build(spec));
    expect(mapping.isHumanoid).toBe(true);
    expect(names(mapping.bones)).toEqual({
      Hips: 'Hips',
      Spine: 'Spine',
      Spine2: 'Spine1',
      Neck: 'Neck',
      Head: 'Head',
      HeadTop_End: 'Head_End',
      ...bothSides(
        { Shoulder: '@Shoulder', Arm: '@Arm', ForeArm: '@ForeArm', Hand: '@Hand', HandIndex1: '@HandIndex1', UpLeg: '@UpLeg', Leg: '@Leg', Foot: '@Foot', ToeBase: '@ToeBase', Toe_End: '@ToeBase_End' },
        'Left',
        'Right',
      ),
    });
  });

  it('works on plain Object3D nodes and prefers bones over same-role meshes', () => {
    const arm = (s: string): Spec => chain([`${s}Shoulder`, `${s}Arm`, `${s}ForeArm`, `${s}Hand`]);
    const leg = (s: string): Spec => chain([`${s}UpLeg`, `${s}Leg`, `${s}Foot`]);
    const spec = n('Hips', chain(['Spine', 'Spine1'], chain(['Neck', 'Head']), arm('Left'), arm('Right')), leg('Left'), leg('Right'));
    const plain = build(spec, { bones: false });
    expect(mapHumanoid(plain).isHumanoid).toBe(true);

    const root = new THREE.Group();
    const decoy = new THREE.Mesh();
    decoy.name = 'Head_1';
    root.add(decoy, build(spec));
    const mapping = mapHumanoid(root);
    expect(mapping.bones.Head!.name).toBe('Head');
    expect((mapping.bones.Head as THREE.Bone).isBone).toBe(true);
  });

  it('the root itself may be the hips', () => {
    const arm = (s: string): Spec => chain([`${s}Arm`, `${s}ForeArm`, `${s}Hand`]);
    const leg = (s: string): Spec => chain([`${s}UpLeg`, `${s}Leg`, `${s}Foot`]);
    const root = build(n('Hips', chain(['Spine', 'Chest'], n('Head'), arm('Left'), arm('Right')), leg('Left'), leg('Right')));
    const mapping = mapHumanoid(root);
    expect(mapping.bones.Hips).toBe(root);
    expect(mapping.isHumanoid).toBe(true);
  });

  it('RobotExpressive (IK rig: feet outside the legs, no hands) is not a humanoid', () => {
    const arm = (s: string): Spec =>
      n(
        `Shoulder${s}`,
        n(
          `UpperArm${s}`,
          n(`LowerArm${s}`, n(`Palm2${s}`, chain([`Middle1${s}`, `Middle2${s}`, `Middle2${s}_end`])), chain([`Thumb${s}`, `Thumb2${s}`, `Thumb2${s}_end`]), n(`Palm1${s}`, chain([`Index${s}`, `Index2${s}`])), n(`Palm3${s}`, chain([`Ring1${s}`, `Ring2${s}`]))),
        ),
      );
    const leg = (s: string): Spec => chain([`UpperLeg${s}`, `LowerLeg${s}`, `LowerLeg${s}_end`]);
    const spec = n(
      'RootNode',
      n(
        'RobotArmature',
        n(
          'Bone',
          n('FootL', n('FootL_end')),
          n('Body', n('Torso'), n('Hips', chain(['Abdomen', 'Torso_1'], chain(['Neck', 'Head'], n('Head_1'), n('Head_end')), arm('L'), arm('R'))), leg('L'), leg('R')),
          n('PoleTargetL', n('PoleTargetL_end')),
          n('FootR', n('FootR_end')),
          n('PoleTargetR', n('PoleTargetR_end')),
        ),
      ),
      n('HandR', n('HandR_1'), n('HandR_2')),
      n('HandL', n('HandL_1'), n('HandL_2')),
    );
    const mapping = mapHumanoid(build(spec));
    expect(mapping.isHumanoid).toBe(false);
    expect(mapping.missingRequired).toEqual(expect.arrayContaining(['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot']));
    const nodes = Object.values(mapping.bones);
    expect(new Set(nodes).size).toBe(nodes.length);
  });

  it('props, cameras and an empty scene are not humanoids', () => {
    expect(mapHumanoid(new THREE.Group())).toEqual({ bones: {}, missingRequired: expect.any(Array), isHumanoid: false, convention: null });
    const quadruped = build(n('Root', n('Pelvis', chain(['Spine', 'Neck', 'Head']), chain(['Tail1', 'Tail2']), chain(['FrontLeg1', 'FrontLeg2']), chain(['BackLeg1', 'BackLeg2']))));
    expect(mapHumanoid(quadruped).isHumanoid).toBe(false);
  });
});

describe('analyseBoneName', () => {
  it.each([
    ['mixamorig:LeftForeArm', 'left', 'forearm'],
    ['mixamorig1RightUpLeg', 'right', 'upleg'],
    ['DEF-upper_arm.L.001', 'left', 'upperarm'],
    ['DEF-upper_armL001', 'left', 'upperarm'],
    ['Bip01 R Forearm', 'right', 'forearm'],
    ['Bip01_R_Forearm', 'right', 'forearm'],
    ['lowerarm_twist_01_r', 'right', 'lowerarmtwist'],
    ['lShldr', 'left', 'shldr'],
    ['rhumerus', 'right', 'humerus'],
    ['lowerback', null, 'lowerback'],
    ['LHipJoint', 'left', 'hipjoint'],
    ['hand.R', 'right', 'hand'],
    ['handR', 'right', 'hand'],
    ['Left Upper Leg', 'left', 'upperleg'],
    ['J_Bip_C_UpperChest', null, 'upperchest'],
    ['ValveBiped.Bip01_L_Calf', 'left', 'calf'],
    ['CC_Base_R_Thigh', 'right', 'thigh'],
    ['Character1_Hips', null, 'hips'],
  ] as const)('%s → side %s, core %s', (name, side, core) => {
    const info = analyseBoneName(name);
    expect(info.side).toBe(side);
    expect(info.core).toBe(core);
  });

  it('flags helpers, end markers and fingers', () => {
    expect(analyseBoneName('upperarm_twist_01_l').helper).toBe(true);
    expect(analyseBoneName('ik_foot_r').helper).toBe(true);
    expect(analyseBoneName('LeftForeArmRoll').helper).toBe(true);
    expect(analyseBoneName('kick_l').helper).toBe(false);
    expect(analyseBoneName('mixamorigHeadTop_End')).toMatchObject({ end: true, core: 'head', centerRole: 'head' });
    expect(analyseBoneName('ENDSITE').end).toBe(true);
    expect(analyseBoneName('LeftHandIndex1')).toMatchObject({ finger: 'Index', sideRole: null });
    expect(analyseBoneName('lefthandring2')).toMatchObject({ finger: 'Ring', side: 'left' });
    expect(analyseBoneName('spring_tail').finger).toBe(null);
    expect(analyseBoneName('RightForeArm')).toMatchObject({ sideRole: 'foreArm', finger: null });
    expect(analyseBoneName('LeftToeBase').sideRole).toBe('toe');
    expect(analyseBoneName('LeftFoot').sideRole).toBe('foot');
    expect(analyseBoneName('forehead.L').centerRole).toBe(null);
  });
});
