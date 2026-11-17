/**
 * The dance scheme format ('thunes-dance@1').
 *
 * A DanceScheme is JSON-compatible data that describes a seamlessly looping
 * dance of N beats on the canonical skeleton. It is written in anatomical
 * CONTROLS (degrees, or fractions of the leg length) measured from a relaxed
 * standing pose with the arms hanging at the sides, never in bone quaternions.
 * `compileScheme` (compile.ts) turns it into an AnimationClip.
 *
 * How a control gets its value at a given beat:
 *
 *     value = base[control] + Σ tracks(beat − lag) + Σ oscillators(beat − lag)
 *
 * then optionally smoothed (`smooth`) and finally clamped to the control's
 * range. Everything is periodic over the loop: keys wrap around, oscillator
 * periods must divide the loop, so the last frame always equals the first.
 *
 * ── Control vocabulary ────────────────────────────────────────────────────
 * Lateral centre controls are positive toward the dancer's own LEFT.
 * Side controls ('leftArm.raise' / 'rightArm.raise' …) are anatomical, so the
 * same number means the mirror-image pose on the other side. The shorthand
 * targets 'arms.*', 'legs.*' and 'feet.*' drive both sides at once.
 *
 *  spine.lean   forward (+) / back bend of the whole spine, degrees
 *  spine.side   side bend, + toward the dancer's left
 *  spine.twist  turn of the chest, + toward the dancer's left
 *  hips.yaw     turn of the pelvis (and everything above it), + to the left
 *  hips.tilt    pelvis pitch, + tips the top forward
 *  hips.roll    pelvis side tilt, + tips the top to the left (right hip rises)
 *  hips.shift   side shift of the pelvis, + left, fraction of leg length
 *  hips.forward forward shift of the pelvis, fraction of leg length
 *  hips.crouch  how far the pelvis drops, fraction of leg length (bends the knees of planted legs)
 *  air          jump height, fraction of leg length (the whole body is lifted, feet leave the floor)
 *  head.nod     chin down (+) / up, degrees
 *  head.tilt    ear toward the left shoulder (+)
 *  head.turn    look left (+)
 *  head.level   0..1 stabilisation: how much the head cancels the lean, bend and turn of hips and spine
 *
 *  <side>Arm.raise         0 = hanging, 90 = horizontal out to the side, 180 = overhead
 *  <side>Arm.swing         swings the raised arm about the shoulder-to-shoulder axis: + forward, − back.
 *                          raise 0 + swing 90 points straight ahead; swing 180 is overhead by way of the front,
 *                          and `raise` then opens the arm outward. (At raise 90 swing only rolls the arm.)
 *  <side>Arm.twist         upper-arm roll, + outward (external rotation): with raise 90 and elbow 90 it lifts the forearm up
 *  <side>Arm.shrug         lifts the shoulder
 *  <side>Arm.elbow         0 = straight … 150 = folded. With the arm hanging the forearm folds forward.
 *  <side>Arm.forearmTwist  + turns the palm outward/up (supination). At 0 a hanging hand's palm faces the thigh.
 *  <side>Arm.wrist         + flexes the hand toward the palm
 *
 * Legs are driven by FOOT TARGETS: each foot is placed on the floor and the
 * knee is solved by inverse kinematics, so planted feet never slide when the
 * hips move. All zero = standing with the feet under the hip joints.
 *
 *  <side>Foot.side     step outward (+) / across (−), fraction of leg length
 *  <side>Foot.forward  step forward (+) / back (−)
 *  <side>Foot.up       lift of the foot above the floor, fraction of leg length
 *  <side>Foot.turn     toes outward (+) / inward, degrees, measured on the floor
 *  <side>Foot.pitch    ankle flex against the floor: + toes up (heel stays down), − heel up (ball stays down)
 *  <side>Leg.kneeOut   swings the bent knee outward (+) / inward
 *
 * Leg angle controls are ADDED on top of the solved leg, for gestures of a
 * free leg (they move a foot off its target):
 *
 *  <side>Leg.lift      thigh forward (+) / back
 *  <side>Leg.spread    thigh outward (+)
 *  <side>Leg.turnOut   thigh roll, toes outward (+)
 *  <side>Leg.knee      extra knee bend (moves the foot back)
 *
 * After solving, the dancer is GROUNDED: the hips height is set on every frame
 * so that the lowest sole is exactly on the floor (then `air` is added).
 */

/** Easing of the move INTO a key, from the key before it. */
export type Ease =
  /** Constant speed. */
  | 'linear'
  /** Starts slow, arrives at full speed. */
  | 'in'
  /** Starts fast, settles gently. */
  | 'out'
  /** Slow start and gentle arrival (the default). */
  | 'inOut'
  /** Stays on the previous value, then jumps exactly on the key's beat. */
  | 'hold'
  /** Stays on the previous value, then whips into the key during the last quarter beat: an on-beat accent. */
  | 'snap'
  /** Shoots about 10 % past the key and settles back onto it. */
  | 'overshoot';

export const EASES: readonly Ease[] = ['linear', 'in', 'out', 'inOut', 'hold', 'snap', 'overshoot'];

/**
 * Oscillator shapes, as functions of the phase u (in periods):
 *   sine      sin(2πu): −1..1, zero and rising at u = 0
 *   bounce    |sin(πu)|: 0..1, touches zero sharply at whole periods, rounded peak half-way
 *   triangle  −1..1 straight ramps, zero and rising at u = 0
 *   pulse     0..1: on for the first `width` of each period, with short eased edges
 */
export type Wave = 'sine' | 'bounce' | 'triangle' | 'pulse';

export const WAVES: readonly Wave[] = ['sine', 'bounce', 'triangle', 'pulse'];

export type ControlUnit = 'deg' | 'leg' | 'ratio';

/**
 * How a control maps to the other side of the body:
 *   side    a left/right pair (the value is anatomical and carries over unchanged)
 *   negate  a centre control whose sign flips (side bend, twist, shift …)
 *   same    a centre control that is its own mirror image (lean, crouch …)
 */
export type MirrorKind = 'side' | 'negate' | 'same';

export interface ControlSpec {
  /** Values are clamped to [min, max] after everything has been added up. */
  min: number;
  max: number;
  unit: ControlUnit;
  mirror: MirrorKind;
}

const deg = (min: number, max: number, mirror: MirrorKind = 'side'): ControlSpec => ({ min, max, unit: 'deg', mirror });
const leg = (min: number, max: number, mirror: MirrorKind = 'side'): ControlSpec => ({ min, max, unit: 'leg', mirror });

const CENTRE_CONTROLS = {
  'spine.lean': deg(-40, 80, 'same'),
  'spine.side': deg(-40, 40, 'negate'),
  'spine.twist': deg(-60, 60, 'negate'),
  'hips.yaw': deg(-180, 180, 'negate'),
  'hips.tilt': deg(-30, 40, 'same'),
  'hips.roll': deg(-30, 30, 'negate'),
  'hips.shift': leg(-1, 1, 'negate'),
  'hips.forward': leg(-1, 1, 'same'),
  'hips.crouch': leg(0, 0.6, 'same'),
  air: leg(0, 1, 'same'),
  'head.nod': deg(-50, 60, 'same'),
  'head.tilt': deg(-40, 40, 'negate'),
  'head.turn': deg(-80, 80, 'negate'),
  'head.level': { min: 0, max: 1, unit: 'ratio', mirror: 'same' },
} as const satisfies Record<string, ControlSpec>;

const ARM_CONTROLS = {
  raise: deg(-40, 200),
  swing: deg(-90, 200),
  twist: deg(-90, 90),
  shrug: deg(-15, 30),
  elbow: deg(0, 150),
  forearmTwist: deg(-90, 90),
  wrist: deg(-70, 70),
} as const satisfies Record<string, ControlSpec>;

const LEG_CONTROLS = {
  lift: deg(-40, 120),
  spread: deg(-30, 70),
  turnOut: deg(-45, 70),
  knee: deg(0, 150),
  kneeOut: deg(-45, 60),
} as const satisfies Record<string, ControlSpec>;

const FOOT_CONTROLS = {
  side: leg(-1, 1.2),
  forward: leg(-1, 1),
  up: leg(0, 1),
  turn: deg(-60, 90),
  pitch: deg(-70, 45),
} as const satisfies Record<string, ControlSpec>;

export type Side = 'left' | 'right';
export type CentreControl = keyof typeof CENTRE_CONTROLS;
export type ArmChannel = keyof typeof ARM_CONTROLS;
export type LegChannel = keyof typeof LEG_CONTROLS;
export type FootChannel = keyof typeof FOOT_CONTROLS;

/** One animatable channel of the dancer. */
export type ControlName =
  | CentreControl
  | `${Side}Arm.${ArmChannel}`
  | `${Side}Leg.${LegChannel}`
  | `${Side}Foot.${FootChannel}`;

/** Shorthand that drives the left and the right control together. */
export type GroupControl = `arms.${ArmChannel}` | `legs.${LegChannel}` | `feet.${FootChannel}`;

/** What a track, oscillator, base entry, lag or smooth entry may name. */
export type ControlTarget = ControlName | GroupControl;

/** Every control with its range, unit and mirror behaviour. */
export const CONTROLS: Readonly<Record<ControlName, ControlSpec>> = (() => {
  const all: Record<string, ControlSpec> = { ...CENTRE_CONTROLS };
  for (const side of ['left', 'right'] as const) {
    for (const [name, spec] of Object.entries(ARM_CONTROLS)) all[`${side}Arm.${name}`] = spec;
    for (const [name, spec] of Object.entries(LEG_CONTROLS)) all[`${side}Leg.${name}`] = spec;
    for (const [name, spec] of Object.entries(FOOT_CONTROLS)) all[`${side}Foot.${name}`] = spec;
  }
  return Object.freeze(all) as Readonly<Record<ControlName, ControlSpec>>;
})();

/** All control names, in a stable order. */
export const CONTROL_NAMES: readonly ControlName[] = Object.keys(CONTROLS) as ControlName[];

const GROUP_PREFIX: Record<string, string> = { arms: 'Arm', legs: 'Leg', feet: 'Foot' };

/** True when `name` is a single control (not a group shorthand). */
export function isControlName(name: string): name is ControlName {
  return Object.prototype.hasOwnProperty.call(CONTROLS, name);
}

/**
 * The controls a target stands for: one for a control name, the left and right
 * control for a group shorthand ('arms.raise'), none when the name is unknown.
 */
export function resolveTarget(target: string): ControlName[] {
  if (isControlName(target)) return [target];
  const dot = target.indexOf('.');
  if (dot > 0) {
    const part = GROUP_PREFIX[target.slice(0, dot)];
    const channel = target.slice(dot);
    if (part) {
      const left = `left${part}${channel}`;
      const right = `right${part}${channel}`;
      if (isControlName(left) && isControlName(right)) return [left, right];
    }
  }
  return [];
}

/** The control that plays the same role on the other side, and the sign its values take there. */
export function mirrorControl(name: ControlName): { control: ControlName; sign: 1 | -1 } {
  const spec = CONTROLS[name];
  if (spec.mirror === 'negate') return { control: name, sign: -1 };
  if (spec.mirror === 'same') return { control: name, sign: 1 };
  const other = name.startsWith('left') ? `right${name.slice(4)}` : `left${name.slice(5)}`;
  return { control: other as ControlName, sign: 1 };
}

/**
 * One keyframe: [beat, value] or [beat, value, ease].
 * `beat` is measured from the start of the loop (or of the repeated phrase).
 * `ease` shapes the move into this key from the previous one (default 'inOut').
 */
export type DanceKey = readonly [beat: number, value: number, ease?: Ease];

/** Options shared by tracks and oscillators. */
interface LayerOptions {
  /** The control to drive, or a both-sides shorthand such as 'arms.raise'. */
  control: ControlTarget;
  /** Multiplies the layer's output (default 1). */
  scale?: number;
  /** Delays the layer by this many beats (may be negative to lead). */
  lag?: number;
  /**
   * Also drive the mirror-image control, delayed by this many beats (`true` = no delay).
   * A side control drives its twin on the other side; a lateral centre control
   * (side bend, twist, shift …) gets a sign-flipped copy; a symmetric centre
   * control gets a plain delayed copy. Typical use: author one half of an
   * alternating move and mirror it by half the phrase.
   */
  mirror?: number | boolean;
}

/** Keyframes on the beat grid. Its values are added to the base pose. */
export interface DanceTrack extends LayerOptions {
  /** At least one key. Beats must lie in [0, phrase length). Order does not matter. */
  keys: readonly DanceKey[];
  /**
   * Phrase length in beats: the keys repeat every `repeat` beats. It must
   * divide the loop length. Default: the whole loop.
   */
  repeat?: number;
}

/** A periodic wave added to the base pose: value = bias + amp × wave((beat − phase) / period). */
export interface DanceOscillator extends LayerOptions {
  /** Default 'sine'. */
  wave?: Wave;
  /** Peak size in the control's unit. */
  amp: number;
  /** Beats per cycle. The loop length must be a whole number of periods. */
  period: number;
  /** Shifts the wave later by this many beats (default 0). */
  phase?: number;
  /** Constant added to the wave (default 0). */
  bias?: number;
  /** For 'pulse': fraction of the period spent on, 0..1 (default 0.5). */
  width?: number;
}

export interface DanceScheme {
  format: 'thunes-dance@1';
  /** Loop length in beats. */
  beats: number;
  /** Native tempo in beats per minute. */
  bpm: number;
  /** Optional human-readable notes about the move. */
  description?: string;
  /** The pose everything else is added to. Controls not listed are 0 (relaxed standing, arms hanging). */
  base?: Partial<Record<ControlTarget, number>>;
  /** Keyframed layers. */
  tracks?: readonly DanceTrack[];
  /** Periodic layers. */
  oscillators?: readonly DanceOscillator[];
  /** Follow-through: delays everything that drives a control by this many beats. */
  lag?: Partial<Record<ControlTarget, number>>;
  /** Softening: blurs a control over a window of this many beats (rounds off corners, adds overlap). */
  smooth?: Partial<Record<ControlTarget, number>>;
}

/** Thrown by `validateScheme` and `compileScheme`. `problems` lists every issue found. */
export class DanceSchemeError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`Invalid dance scheme: ${problems.join('; ')}`);
    this.name = 'DanceSchemeError';
    this.problems = problems;
  }
}

const EPSILON = 1e-6;

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function dividesLoop(period: number, beats: number): boolean {
  const cycles = beats / period;
  return Math.abs(cycles - Math.round(cycles)) < EPSILON && Math.round(cycles) >= 1;
}

/**
 * Lists everything that is wrong with a scheme, in readable sentences
 * (empty when it is valid). Accepts any value, so it can check parsed JSON.
 */
export function schemeProblems(input: unknown): string[] {
  const problems: string[] = [];
  if (typeof input !== 'object' || input === null) return ['the scheme must be an object'];
  const scheme = input as Record<string, unknown>;
  if (scheme.format !== 'thunes-dance@1') problems.push(`format must be "thunes-dance@1" (got ${JSON.stringify(scheme.format)})`);
  const beats = scheme.beats;
  const beatsOk = isNumber(beats) && beats > 0;
  if (!beatsOk) problems.push(`beats must be a positive number (got ${String(beats)})`);
  if (!isNumber(scheme.bpm) || scheme.bpm <= 0) problems.push(`bpm must be a positive number (got ${String(scheme.bpm)})`);
  const loop = beatsOk ? (beats as number) : 1;

  const checkTarget = (where: string, target: unknown): boolean => {
    if (typeof target !== 'string' || resolveTarget(target).length === 0) {
      problems.push(`${where}: unknown control ${JSON.stringify(target)}`);
      return false;
    }
    return true;
  };

  const checkMap = (field: 'base' | 'lag' | 'smooth'): void => {
    const map = scheme[field];
    if (map === undefined) return;
    if (typeof map !== 'object' || map === null) {
      problems.push(`${field} must be an object of control: number`);
      return;
    }
    for (const [target, value] of Object.entries(map as Record<string, unknown>)) {
      if (!checkTarget(field, target)) continue;
      if (!isNumber(value)) problems.push(`${field}["${target}"] must be a finite number (got ${String(value)})`);
      else if (field === 'smooth' && (value < 0 || value > loop)) problems.push(`smooth["${target}"] must be between 0 and the loop length`);
    }
  };
  checkMap('base');
  checkMap('lag');
  checkMap('smooth');

  const checkLayer = (where: string, layer: Record<string, unknown>): void => {
    checkTarget(where, layer.control);
    if (layer.scale !== undefined && !isNumber(layer.scale)) problems.push(`${where}: scale must be a finite number`);
    if (layer.lag !== undefined && !isNumber(layer.lag)) problems.push(`${where}: lag must be a finite number`);
    if (layer.mirror !== undefined && typeof layer.mirror !== 'boolean' && !isNumber(layer.mirror)) {
      problems.push(`${where}: mirror must be true, false or a beat offset`);
    }
  };

  if (scheme.tracks !== undefined && !Array.isArray(scheme.tracks)) problems.push('tracks must be an array');
  (Array.isArray(scheme.tracks) ? scheme.tracks : []).forEach((raw: unknown, index: number) => {
    const where = `tracks[${index}]`;
    if (typeof raw !== 'object' || raw === null) {
      problems.push(`${where} must be an object`);
      return;
    }
    const track = raw as Record<string, unknown>;
    if (typeof track.control === 'string') checkLayer(`${where} (${track.control})`, track);
    else checkLayer(where, track);
    let phrase = loop;
    if (track.repeat !== undefined) {
      if (!isNumber(track.repeat) || track.repeat <= 0 || !dividesLoop(track.repeat, loop)) {
        problems.push(`${where}: repeat (${String(track.repeat)}) must be a positive number of beats that divides the loop (${loop})`);
      } else phrase = track.repeat;
    }
    if (!Array.isArray(track.keys) || track.keys.length === 0) {
      problems.push(`${where}: keys must be a non-empty array of [beat, value, ease?]`);
      return;
    }
    const seen: number[] = [];
    track.keys.forEach((key: unknown, k: number) => {
      const at = `${where}.keys[${k}]`;
      if (!Array.isArray(key) || key.length < 2 || key.length > 3) {
        problems.push(`${at} must be [beat, value] or [beat, value, ease]`);
        return;
      }
      const [beat, value, ease] = key as unknown[];
      if (!isNumber(beat)) problems.push(`${at}: beat must be a finite number (got ${String(beat)})`);
      else if (beat < 0 || beat >= phrase - EPSILON) problems.push(`${at}: beat ${beat} is outside the loop [0, ${phrase})`);
      else if (seen.some((other) => Math.abs(other - beat) < EPSILON)) problems.push(`${at}: two keys on beat ${beat}`);
      else seen.push(beat);
      if (!isNumber(value)) problems.push(`${at}: value must be a finite number (got ${String(value)})`);
      if (ease !== undefined && !EASES.includes(ease as Ease)) problems.push(`${at}: unknown ease ${JSON.stringify(ease)}`);
    });
  });

  if (scheme.oscillators !== undefined && !Array.isArray(scheme.oscillators)) problems.push('oscillators must be an array');
  (Array.isArray(scheme.oscillators) ? scheme.oscillators : []).forEach((raw: unknown, index: number) => {
    const where = `oscillators[${index}]`;
    if (typeof raw !== 'object' || raw === null) {
      problems.push(`${where} must be an object`);
      return;
    }
    const osc = raw as Record<string, unknown>;
    if (typeof osc.control === 'string') checkLayer(`${where} (${osc.control})`, osc);
    else checkLayer(where, osc);
    if (!isNumber(osc.amp)) problems.push(`${where}: amp must be a finite number (got ${String(osc.amp)})`);
    if (!isNumber(osc.period) || osc.period <= 0 || !dividesLoop(osc.period, loop)) {
      problems.push(`${where}: period (${String(osc.period)}) must be a positive number of beats that divides the loop (${loop})`);
    }
    if (osc.wave !== undefined && !WAVES.includes(osc.wave as Wave)) problems.push(`${where}: unknown wave ${JSON.stringify(osc.wave)}`);
    if (osc.phase !== undefined && !isNumber(osc.phase)) problems.push(`${where}: phase must be a finite number`);
    if (osc.bias !== undefined && !isNumber(osc.bias)) problems.push(`${where}: bias must be a finite number`);
    if (osc.width !== undefined && (!isNumber(osc.width) || osc.width <= 0 || osc.width >= 1)) {
      problems.push(`${where}: width must be between 0 and 1 (exclusive)`);
    }
  });

  return problems;
}

/** Throws a DanceSchemeError that lists every problem, or returns the value typed as a scheme. */
export function validateScheme(input: unknown): DanceScheme {
  const problems = schemeProblems(input);
  if (problems.length > 0) throw new DanceSchemeError(problems);
  return input as DanceScheme;
}
