/**
 * Humanoid recognition: finds the canonical bones (bones.ts) in an arbitrary
 * Object3D hierarchy.
 *
 * Names identify a few anchors (head, hands, feet, hips) and give every node a
 * coarse role; the hierarchy decides the rest, because "shoulder", "arm",
 * "leg", "hip" and "spine" mean different bones in different rigs:
 *   1. every node name is normalised (analyseBoneName) and looked up in the
 *      alias table (aliases.ts), then in the pattern heuristics;
 *   2. hands and feet must hang below two bones of their own side, the hips
 *      are the deepest hips-named ancestor of feet and head (else their lowest
 *      common ancestor), the chest is the lowest common ancestor of hands and head;
 *   3. limb chains are read upwards from hand / foot, the spine downwards from
 *      the hips, skipping helper bones (twist, roll, IK...), duplicates and
 *      repeated segments of one bone ("upper_arm.L.001").
 * Works on any Object3D hierarchy; nodes need not be THREE.Bone.
 */
import type * as THREE from 'three';
import { BONE_PARENT, CANONICAL_BONES, REQUIRED_BONES } from './bones';
import type { CanonicalBone } from './bones';
import {
  CENTER_PATTERNS,
  CENTER_TOKENS,
  CONVENTIONS,
  END_TOKENS,
  FINGER_KINDS,
  FINGER_WORDS,
  HELPER_TOKENS,
  JUNK_PREFIX_TOKENS,
  LEFT_TOKENS,
  PALM_WORDS,
  RIGHT_TOKENS,
  SIDE_PATTERNS,
} from './aliases';
import type { CenterRole, FingerKind, SideRole } from './aliases';

/** Result of mapHumanoid. */
export interface HumanoidMapping {
  /** Canonical bone → node. No node appears twice. */
  bones: Partial<Record<CanonicalBone, THREE.Object3D>>;
  /** Required bones (bones.ts REQUIRED_BONES) that were not found. */
  missingRequired: CanonicalBone[];
  /** True when no required bone is missing. */
  isHumanoid: boolean;
  /** Id of the best-matching naming convention (aliases.ts), "generic" when none stands out, null when nothing mapped. */
  convention: string | null;
}

/** What a node name says about a bone, before the hierarchy is consulted. */
export interface BoneNameInfo {
  side: 'left' | 'right' | null;
  /** Normalised core: lower-case letters only, without prefix, side marker, digits and end markers. */
  core: string;
  /** Digit tokens in order of appearance, as written ("01", "2"). */
  nums: string[];
  /** Twist / roll / IK / control... bone: never mapped. */
  helper: boolean;
  /** End marker ("_End", "Nub", BVH end site). */
  end: boolean;
  centerRole: CenterRole | null;
  sideRole: SideRole | null;
  finger: FingerKind | null;
  /** Palm / metacarpal bone. */
  palm: boolean;
  /** Junk prefix tokens that were stripped ("mixamorig", "bip"). */
  prefixes: string[];
}

const SET = (list: readonly string[]): ReadonlySet<string> => new Set(list);
const JUNK = SET(JUNK_PREFIX_TOKENS);
const HELPERS = SET(HELPER_TOKENS);
const ENDS = SET(END_TOKENS);
const LEFTS = SET(LEFT_TOKENS);
const RIGHTS = SET(RIGHT_TOKENS);
const CENTERS = SET(CENTER_TOKENS);
const PALMS = SET(PALM_WORDS);

const CENTER_ALIAS = new Map<string, CenterRole>();
const SIDE_ALIAS = new Map<string, SideRole>();
for (const convention of CONVENTIONS) {
  for (const [role, names] of Object.entries(convention.center) as [CenterRole, readonly string[]][]) {
    for (const name of names) if (!CENTER_ALIAS.has(name)) CENTER_ALIAS.set(name, role);
  }
  for (const [role, names] of Object.entries(convention.side) as [SideRole, readonly string[]][]) {
    for (const name of names) if (!SIDE_ALIAS.has(name)) SIDE_ALIAS.set(name, role);
  }
}

const GLUED_FINGER = /thumb|index|middle|pinky|pinkie|little|^(?:hand|f)?(?:ring|mid)$/;

function tokenize(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());
}

function fingerOf(tokens: readonly string[], core: string, nums: readonly string[]): FingerKind | null {
  for (const token of tokens) {
    const kind = FINGER_WORDS[token];
    if (kind) return kind;
  }
  const glued = GLUED_FINGER.exec(core);
  if (glued) {
    for (const [word, kind] of Object.entries(FINGER_WORDS)) if (glued[0].includes(word)) return kind;
  }
  // Biped "Finger0", "Finger01", "Finger12": the first digit is the finger.
  if (core === 'finger' && nums.length > 0) return FINGER_KINDS[Number(nums[0]![0])] ?? null;
  return null;
}

function lookupSide(core: string): SideRole | null {
  const exact = SIDE_ALIAS.get(core);
  if (exact) return exact;
  for (const [pattern, role] of SIDE_PATTERNS) if (pattern.test(core)) return role;
  return null;
}

function lookupCenter(core: string): CenterRole | null {
  const exact = CENTER_ALIAS.get(core);
  if (exact) return exact;
  for (const [pattern, role] of CENTER_PATTERNS) if (pattern.test(core)) return role;
  return null;
}

/**
 * Normalises one node name and classifies it. Accepts raw names
 * ("mixamorig:LeftHand", "DEF-upper_arm.L", "Bip01 L UpperArm") and what
 * three's PropertyBinding.sanitizeNodeName makes of them ("mixamorigLeftHand",
 * "DEF-upper_armL", "Bip01_L_UpperArm"). Pure.
 */
export function analyseBoneName(rawName: string): BoneNameInfo {
  // Namespaces: keep what follows the last ':' or '|' ("ns:Hips", "Armature|mixamorig:Hips").
  const cut = Math.max(rawName.lastIndexOf(':'), rawName.lastIndexOf('|'));
  const hasNamespace = cut >= 0 && cut < rawName.length - 1;
  let tokens = tokenize(hasNamespace ? rawName.slice(cut + 1) : rawName);
  const prefixes: string[] = hasNamespace ? tokenize(rawName.slice(0, cut)) : [];
  while (tokens.length > 1 && JUNK.has(tokens[0]!)) {
    prefixes.push(tokens[0]!);
    tokens = tokens.slice(1);
    if (tokens.length > 1 && /^\d+$/.test(tokens[0]!)) tokens = tokens.slice(1);
  }

  let side: 'left' | 'right' | null = null;
  const rest: string[] = [];
  for (const token of tokens) {
    if (side === null && LEFTS.has(token)) side = 'left';
    else if (side === null && RIGHTS.has(token)) side = 'right';
    else if (side === null && token.length > 4 && token.startsWith('left')) {
      side = 'left';
      rest.push(token.slice(4));
    } else if (side === null && token.length > 5 && token.startsWith('right')) {
      side = 'right';
      rest.push(token.slice(5));
    } else if (!CENTERS.has(token) || tokens.length === 1) rest.push(token);
  }

  const helper = rest.some((token) => HELPERS.has(token));
  const headTop = rest.includes('head') && rest.includes('top');
  const end = headTop || rest.some((token) => ENDS.has(token));
  const nums = rest.filter((token) => /^\d+$/.test(token));
  const words = rest.filter((token) => !/^\d+$/.test(token) && !ENDS.has(token) && !(headTop && token === 'top'));
  let core = words.join('');

  const finger = fingerOf(words, core, nums);
  const palm = words.some((token) => PALMS.has(token));
  let centerRole: CenterRole | null = null;
  let sideRole: SideRole | null = null;
  if (!finger && !palm) {
    if (side) sideRole = lookupSide(core);
    else {
      const exact = CENTER_ALIAS.get(core);
      if (exact) centerRole = exact;
      else {
        // Glued one-letter side markers in single-case names: "lhand", "rfemur", "handl".
        const head = core[0];
        const tail = core[core.length - 1];
        if ((head === 'l' || head === 'r') && SIDE_ALIAS.has(core.slice(1))) {
          side = head === 'l' ? 'left' : 'right';
          core = core.slice(1);
          sideRole = SIDE_ALIAS.get(core)!;
        } else if ((tail === 'l' || tail === 'r') && SIDE_ALIAS.has(core.slice(0, -1))) {
          side = tail === 'l' ? 'left' : 'right';
          core = core.slice(0, -1);
          sideRole = SIDE_ALIAS.get(core)!;
        } else centerRole = lookupCenter(core);
      }
    }
  }
  return { side, core, nums, helper, end, centerRole, sideRole, finger, palm, prefixes };
}

// ————————————————————————————————————————————————————————————————————————
// Hierarchy

interface Info extends BoneNameInfo {
  node: THREE.Object3D;
  parent: Info | null;
  /** Depth-first pre-order index (the order PropertyBinding.findNode searches in). */
  order: number;
  depth: number;
  /** False for nodes that can never be a joint (skinned meshes, cameras, lights, repeated names). */
  joint: boolean;
  isBone: boolean;
}

type Flagged = THREE.Object3D & { isBone?: boolean; isSkinnedMesh?: boolean; isCamera?: boolean; isLight?: boolean };

function collect(root: THREE.Object3D): Info[] {
  const list: Info[] = [];
  const seen = new Set<string>();
  const visit = (node: Flagged, parent: Info | null, depth: number): void => {
    // A repeated name can never be addressed by an animation track (the first one in this order wins),
    // e.g. the twin child bones three's FBXLoader creates.
    const duplicate = node.name !== '' && seen.has(node.name);
    seen.add(node.name);
    const info: Info = {
      ...analyseBoneName(node.name),
      node,
      parent,
      order: list.length,
      depth,
      joint: !duplicate && !node.isSkinnedMesh && !node.isCamera && !node.isLight,
      isBone: node.isBone === true,
    };
    list.push(info);
    for (const child of node.children) visit(child, info, depth + 1);
  };
  visit(root, null, 0);
  return list;
}

const usable = (info: Info): boolean => info.joint && !info.helper;

function isAncestor(ancestor: Info, info: Info): boolean {
  for (let p = info.parent; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

function lowestCommonAncestor(infos: readonly Info[]): Info | null {
  let candidate: Info | null = infos[0] ?? null;
  while (candidate) {
    const c = candidate;
    if (infos.every((info) => info === c || isAncestor(c, info))) return c;
    candidate = candidate.parent;
  }
  return null;
}

/** Usable ancestors strictly below `stop`, nearest first. */
function chainAbove(info: Info, stop: Info | null): Info[] {
  const chain: Info[] = [];
  for (let p = info.parent; p && p !== stop; p = p.parent) if (usable(p)) chain.push(p);
  return chain;
}

/** Bones first, then hierarchy order. */
function byPreference(a: Info, b: Info): number {
  return Number(b.isBone) - Number(a.isBone) || a.order - b.order;
}

interface Slot {
  bone: CanonicalBone;
  /** Roles that identify the slot by name. */
  roles: readonly SideRole[];
  /** Roles a node may have to fill the slot by position when no name matches (unnamed roles are always allowed). */
  positional: readonly SideRole[];
}

/**
 * Assigns a limb chain (nearest to the hand / foot first) to slots. A slot
 * takes the nearest remaining node with a matching role, else the next node if
 * its name does not contradict. Consecutive segments of one bone
 * ("forearm.L.001" above "forearm.L") collapse to the segment nearest the root.
 */
function assignChain(chain: readonly Info[], side: 'left' | 'right', slots: readonly Slot[], assign: (bone: CanonicalBone, info: Info) => void): void {
  let next = 0;
  for (const slot of slots) {
    let index = -1;
    for (let i = next; i < chain.length; i++) {
      const role = chain[i]!.sideRole;
      if (chain[i]!.side === side && role !== null && slot.roles.includes(role)) {
        index = i;
        break;
      }
    }
    if (index < 0 && next < chain.length) {
      const info = chain[next]!;
      const sideOk = info.side === side || (info.side === null && info.centerRole === null);
      const roleOk = info.sideRole === null || slot.positional.includes(info.sideRole);
      if (sideOk && roleOk && !info.finger && !info.palm) index = next;
    }
    if (index < 0) continue;
    while (index + 1 < chain.length && chain[index + 1]!.core === chain[index]!.core && chain[index + 1]!.side === chain[index]!.side && chain[index]!.core !== '') {
      index++;
    }
    assign(slot.bone, chain[index]!);
    next = index + 1;
  }
}

const sided = (side: 'left' | 'right', suffix: string): CanonicalBone => `${side === 'left' ? 'Left' : 'Right'}${suffix}` as CanonicalBone;

/**
 * Finds the canonical humanoid bones under (and including) `root`.
 * Never maps two canonical bones to one node, and prefers the first node in
 * depth-first order among nodes sharing a name, which is the node an
 * animation track with that name binds to. Does not modify the hierarchy.
 */
export function mapHumanoid(root: THREE.Object3D): HumanoidMapping {
  const infos = collect(root);
  const bones: Partial<Record<CanonicalBone, THREE.Object3D>> = {};
  const mapped = new Map<CanonicalBone, Info>();
  const taken = new Set<Info>();
  const assign = (bone: CanonicalBone, info: Info): void => {
    if (mapped.has(bone) || taken.has(info)) return;
    mapped.set(bone, info);
    taken.add(info);
  };

  const candidates = infos.filter((info) => usable(info) && !info.end).sort(byPreference);

  // A hand or foot is only believed when it hangs below two bones of its own side
  // (this rejects IK targets, props and meshes that merely carry the name).
  const limbEnd = (side: 'left' | 'right', role: SideRole): Info | null => {
    for (const info of candidates) {
      if (info.side !== side || info.sideRole !== role) continue;
      const above = chainAbove(info, null);
      if (above.length >= 2 && above[0]!.side === side && above[1]!.side === side && !above[0]!.finger) return info;
    }
    return null;
  };
  const sides = ['left', 'right'] as const;
  const hands = sides.map((side) => limbEnd(side, 'hand'));
  const feet = sides.map((side) => limbEnd(side, 'foot'));
  const bothHands = hands[0] && hands[1] ? [hands[0], hands[1]] : null;
  const bothFeet = feet[0] && feet[1] ? [feet[0], feet[1]] : null;

  let head = candidates.find((info) => info.side === null && info.centerRole === 'head') ?? null;
  if (!head && bothHands) {
    // No head by name (Rigify: "spine.006"): follow the single centre-line chain above the arms.
    let cursor = lowestCommonAncestor(bothHands);
    let last: Info | null = null;
    while (cursor) {
      const here: Info = cursor;
      const centre = infos.filter(
        (info) => info.parent === here && usable(info) && !info.end && info.side === null && !info.finger && !bothHands.some((hand) => hand === info || isAncestor(info, hand)),
      );
      if (centre.length !== 1) break;
      last = centre[0]!;
      cursor = last;
    }
    head = last;
  }

  // Hips: the deepest hips-named bone above every anchor, else the lowest common ancestor of feet and head.
  const anchors = [...feet, ...hands, head].filter((info): info is Info => info !== null);
  let hips: Info | null = null;
  if (anchors.length > 0) {
    for (const info of candidates) {
      if (info.side === null && info.centerRole === 'hips' && anchors.every((anchor) => isAncestor(info, anchor)) && (!hips || info.depth > hips.depth)) hips = info;
    }
  }
  if (!hips && bothFeet) {
    const common = lowestCommonAncestor(head ? [...bothFeet, head] : bothFeet);
    if (common && usable(common)) hips = common;
  }

  if (hips) {
    assign('Hips', hips);

    sides.forEach((side, i) => {
      const foot = feet[i];
      if (!foot || !isAncestor(hips, foot)) return;
      assign(sided(side, 'Foot'), foot);
      assignChain(
        chainAbove(foot, hips),
        side,
        [
          { bone: sided(side, 'Leg'), roles: ['leg'], positional: [] },
          { bone: sided(side, 'UpLeg'), roles: ['upLeg'], positional: ['leg'] },
        ],
        assign,
      );
      // Toes: the nearest toe-named bone below the foot, then its end marker.
      const below = infos.filter((info) => info.joint && isAncestor(foot, info) && info.side !== sides[1 - i]).sort((a, b) => a.depth - b.depth || a.order - b.order);
      const toe = below.find((info) => !info.helper && !info.end && info.sideRole === 'toe') ?? below.find((info) => !info.helper && !info.end && info.side === null && lookupSide(info.core) === 'toe');
      if (toe) {
        assign(sided(side, 'ToeBase'), toe);
        const kids = infos.filter((info) => info.parent === toe && info.joint && !info.helper);
        const tip = kids.find((info) => info.end) ?? (kids.length === 1 && kids[0]!.node.children.length === 0 ? kids[0] : undefined);
        if (tip) assign(sided(side, 'Toe_End'), tip);
      }
    });

    const chest = bothHands && head ? lowestCommonAncestor([...bothHands, head]) : null;
    if (chest && isAncestor(hips, chest)) {
      // Spine: every centre bone from below the hips up to the chest, by depth.
      const path = [chest, ...chainAbove(chest, hips)].reverse().filter((info) => usable(info) && info.centerRole !== 'hips');
      if (path.length === 1) assign('Spine', path[0]!);
      else if (path.length === 2) {
        assign('Spine', path[0]!);
        assign('Spine2', path[1]!);
      } else if (path.length >= 3) {
        assign('Spine', path[0]!);
        assign('Spine1', path[Math.floor((path.length - 1) / 2)]!);
        assign('Spine2', path[path.length - 1]!);
      }

      if (head) {
        assign('Head', head);
        const necks = chainAbove(head, chest).reverse();
        const neck = necks.find((info) => info.centerRole === 'neck') ?? necks[0];
        if (neck) assign('Neck', neck);
        const top = infos.find((info) => info.parent === head && info.joint && !info.helper && info.end && info.side === null);
        if (top) assign('HeadTop_End', top);
      }

      sides.forEach((side, i) => {
        const hand = hands[i];
        if (!hand) return;
        assign(sided(side, 'Hand'), hand);
        assignChain(
          chainAbove(hand, chest),
          side,
          [
            { bone: sided(side, 'ForeArm'), roles: ['foreArm'], positional: [] },
            { bone: sided(side, 'Arm'), roles: ['upperArm'], positional: ['shoulder'] },
            { bone: sided(side, 'Shoulder'), roles: ['clavicle', 'shoulder'], positional: [] },
          ],
          assign,
        );
        // Fingers: per kind, the first named bone below the hand starts a chain of up to three segments.
        const below = infos.filter((info) => usable(info) && !info.end && isAncestor(hand, info) && info.side !== sides[1 - i]);
        for (const kind of FINGER_KINDS) {
          let segment: Info | undefined = below.find((info) => info.finger === kind);
          const childOf = (parent: Info): Info | undefined => {
            const kids = below.filter((info) => info.parent === parent);
            // An unnamed continuation must be the only child and of the same node kind (not a mesh hanging off a bone).
            return kids.find((info) => info.finger === kind) ?? (kids.length === 1 && !kids[0]!.finger && kids[0]!.isBone === parent.isBone ? kids[0] : undefined);
          };
          // A palm / metacarpal bone is not segment 1, except for the thumb.
          if (segment && segment.palm && kind !== 'Thumb') segment = childOf(segment);
          for (let n = 1; n <= 3 && segment; n++) {
            assign(sided(side, `Hand${kind}${n}`), segment);
            segment = childOf(segment);
          }
        }
      });
    } else if (head && isAncestor(hips, head)) {
      assign('Head', head);
    }
  }

  // A bone is only kept when its canonical parent chain is consistent with the hierarchy.
  for (const bone of CANONICAL_BONES) {
    const info = mapped.get(bone);
    if (!info) continue;
    let ancestor = BONE_PARENT[bone];
    while (ancestor && !mapped.has(ancestor)) ancestor = BONE_PARENT[ancestor];
    if (ancestor && !isAncestor(mapped.get(ancestor)!, info)) {
      // Biped rigs hang the thighs below the first spine bone: accept any ancestor in the canonical chain.
      let ok = false;
      for (let up = BONE_PARENT[ancestor]; up && !ok; up = BONE_PARENT[up]) {
        const upInfo = mapped.get(up);
        if (upInfo && isAncestor(upInfo, info)) ok = true;
      }
      if (!ok) {
        mapped.delete(bone);
        continue;
      }
    }
    bones[bone] = info.node;
  }

  const missingRequired = REQUIRED_BONES.filter((bone) => !bones[bone]);
  return { bones, missingRequired, isHumanoid: missingRequired.length === 0, convention: conventionOf(mapped) };
}

function conventionOf(mapped: ReadonlyMap<CanonicalBone, Info>): string | null {
  if (mapped.size === 0) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const convention of CONVENTIONS) {
    const centre = new Set(Object.values(convention.center).flat());
    const side = new Set(Object.values(convention.side).flat());
    let score = 0;
    let prefixed = false;
    for (const info of mapped.values()) {
      if (info.finger || info.end) continue;
      if (info.side ? side.has(info.core) : centre.has(info.core)) score++;
      if (convention.prefixes?.some((prefix) => info.prefixes.includes(prefix))) prefixed = true;
    }
    if (prefixed) score += 3;
    if (score > bestScore) {
      bestScore = score;
      best = convention.id;
    }
  }
  return bestScore >= 6 ? best : 'generic';
}
