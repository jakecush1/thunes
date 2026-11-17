// Scheme validation and the compiler's own guarantees on small schemes.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONTROL_NAMES, CONTROLS, DanceSchemeError, compileScheme, schemeProblems, validateScheme } from '../../../src/dances';
import type { DanceScheme } from '../../../src/dances';
import { BODY_BONES, isCanonicalBone } from '../../../src/rig/bones';
import { DEFAULT_PROPORTIONS, hipHeight } from '../../../src/rig/canonical';

const valid: DanceScheme = {
  format: 'thunes-dance@1',
  beats: 4,
  bpm: 120,
  base: { 'arms.raise': 10 },
  tracks: [{ control: 'leftArm.raise', keys: [[0, 0], [2, 80, 'snap']], mirror: 2 }],
  oscillators: [{ control: 'hips.crouch', wave: 'bounce', amp: 0.05, period: 1 }],
  lag: { 'head.nod': 0.1 },
  smooth: { 'feet.up': 0.2 },
};
const broken = (patch: Record<string, unknown>): unknown => ({ ...valid, ...patch });

describe('control vocabulary', () => {
  it('has a sane range for every control and pairs every side control', () => {
    expect(CONTROL_NAMES.length).toBe(14 + 2 * (7 + 5 + 5));
    for (const name of CONTROL_NAMES) {
      const spec = CONTROLS[name];
      expect(spec.min).toBeLessThan(spec.max);
      expect(spec.min).toBeLessThanOrEqual(0);
      expect(spec.max).toBeGreaterThanOrEqual(0);
      if (name.startsWith('left')) expect(CONTROL_NAMES).toContain(`right${name.slice(4)}`);
    }
  });
});

describe('validation', () => {
  it('accepts a valid scheme', () => {
    expect(schemeProblems(valid)).toEqual([]);
    expect(validateScheme(valid)).toBe(valid);
  });

  it.each([
    ['a non-object', null, /must be an object/],
    ['a wrong format', broken({ format: 'thunes-dance@2' }), /format must be "thunes-dance@1"/],
    ['missing beats', broken({ beats: undefined }), /beats must be a positive number/],
    ['zero bpm', broken({ bpm: 0 }), /bpm must be a positive number/],
    ['an unknown base control', broken({ base: { 'arms.wiggle': 1 } }), /base: unknown control "arms.wiggle"/],
    ['a NaN base value', broken({ base: { 'spine.lean': Number.NaN } }), /base\["spine.lean"\] must be a finite number/],
    ['an unknown track control', broken({ tracks: [{ control: 'tail.wag', keys: [[0, 1]] }] }), /unknown control "tail.wag"/],
    ['a track without keys', broken({ tracks: [{ control: 'spine.lean', keys: [] }] }), /keys must be a non-empty array/],
    ['a key outside the loop', broken({ tracks: [{ control: 'spine.lean', keys: [[4, 1]] }] }), /beat 4 is outside the loop \[0, 4\)/],
    ['a negative key beat', broken({ tracks: [{ control: 'spine.lean', keys: [[-1, 1]] }] }), /beat -1 is outside the loop/],
    ['a key outside the repeated phrase', broken({ tracks: [{ control: 'spine.lean', repeat: 2, keys: [[3, 1]] }] }), /beat 3 is outside the loop \[0, 2\)/],
    ['a NaN key value', broken({ tracks: [{ control: 'spine.lean', keys: [[0, Number.NaN]] }] }), /value must be a finite number/],
    ['an infinite key beat', broken({ tracks: [{ control: 'spine.lean', keys: [[Infinity, 0]] }] }), /beat must be a finite number/],
    ['two keys on one beat', broken({ tracks: [{ control: 'spine.lean', keys: [[1, 0], [1, 5]] }] }), /two keys on beat 1/],
    ['an unknown ease', broken({ tracks: [{ control: 'spine.lean', keys: [[0, 1, 'bouncy']] }] }), /unknown ease "bouncy"/],
    ['a malformed key', broken({ tracks: [{ control: 'spine.lean', keys: [[0]] }] }), /must be \[beat, value\]/],
    ['a repeat that does not divide the loop', broken({ tracks: [{ control: 'spine.lean', repeat: 3, keys: [[0, 1]] }] }), /repeat \(3\) must be .* divides the loop/],
    ['a bad mirror', broken({ tracks: [{ control: 'spine.lean', keys: [[0, 1]], mirror: 'yes' }] }), /mirror must be true, false or a beat offset/],
    ['an oscillator period that does not divide the loop', broken({ oscillators: [{ control: 'spine.lean', amp: 1, period: 3 }] }), /period \(3\) must be .* divides the loop/],
    ['an oscillator without amplitude', broken({ oscillators: [{ control: 'spine.lean', period: 2 }] }), /amp must be a finite number/],
    ['an unknown wave', broken({ oscillators: [{ control: 'spine.lean', amp: 1, period: 2, wave: 'saw' }] }), /unknown wave "saw"/],
    ['a bad pulse width', broken({ oscillators: [{ control: 'spine.lean', amp: 1, period: 2, wave: 'pulse', width: 1 }] }), /width must be between 0 and 1/],
    ['an unknown lag control', broken({ lag: { elbow: 1 } }), /lag: unknown control "elbow"/],
    ['a negative smooth', broken({ smooth: { 'spine.lean': -1 } }), /smooth\["spine.lean"\] must be between 0 and the loop length/],
    ['tracks that are not a list', broken({ tracks: {} }), /tracks must be an array/],
  ])('rejects %s', (_label, input, message) => {
    expect(schemeProblems(input).join('; ')).toMatch(message);
    expect(() => compileScheme(input as DanceScheme)).toThrow(DanceSchemeError);
    expect(() => compileScheme(input as DanceScheme)).toThrow(message);
  });

  it('reports every problem at once', () => {
    const problems = schemeProblems(broken({ bpm: -1, base: { nope: 1 }, tracks: [{ control: 'spine.lean', keys: [[9, 0]] }] }));
    expect(problems).toHaveLength(3);
    try {
      validateScheme(broken({ bpm: -1, base: { nope: 1 } }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DanceSchemeError);
      expect((error as DanceSchemeError).problems).toHaveLength(2);
      expect((error as Error).message).toMatch(/^Invalid dance scheme: /);
    }
  });
});

describe('compileScheme', () => {
  it('returns a clip and the rest-pose reference rig it animates', () => {
    const { clip, rig } = compileScheme(valid, { name: 'test' });
    expect(clip.name).toBe('test');
    expect(clip.duration).toBeCloseTo(2);
    expect(clip.tracks).toHaveLength(1 + BODY_BONES.length);
    expect(clip.tracks[0]).toBeInstanceOf(THREE.VectorKeyframeTrack);
    expect(clip.tracks[0].name).toBe('Hips.position');
    for (const track of clip.tracks.slice(1)) expect(track).toBeInstanceOf(THREE.QuaternionKeyframeTrack);
    expect(clip.validate()).toBe(true);

    for (const bone of BODY_BONES) {
      const node = rig.bones[bone];
      expect(node, bone).toBeDefined();
      expect(node!.name).toBe(bone);
      expect(node!.quaternion.equals(new THREE.Quaternion())).toBe(true);
    }
    for (const name of Object.keys(rig.bones)) expect(isCanonicalBone(name)).toBe(true);
    expect(rig.bones.Hips!.parent).toBe(rig.root);
    expect(rig.bones.Hips!.position.y).toBeCloseTo(hipHeight(DEFAULT_PROPORTIONS), 6);
    // Each call gets its own rig.
    expect(compileScheme(valid).rig.root).not.toBe(rig.root);
  });

  it('samples at the requested rate (30 fps by default) and closes the loop', () => {
    expect(compileScheme(valid).clip.tracks[0].times).toHaveLength(61);
    const { clip } = compileScheme(valid, { fps: 12 });
    const times = clip.tracks[0].times;
    expect(times).toHaveLength(25);
    expect(times[1]).toBeCloseTo(1 / 12, 6);
    expect(times[24]).toBeCloseTo(2, 6);
    expect(() => compileScheme(valid, { fps: 0 })).toThrow(/fps/);
  });

  it('drives a skeleton through an AnimationMixer by bone name', () => {
    const { clip, rig } = compileScheme(valid);
    const mixer = new THREE.AnimationMixer(rig.root);
    mixer.clipAction(clip).play();
    mixer.setTime(1); // beat 2: the left arm has snapped up to raise 90
    rig.root.updateMatrixWorld(true);
    const shoulder = rig.bones.LeftArm!.getWorldPosition(new THREE.Vector3());
    const wrist = rig.bones.LeftHand!.getWorldPosition(new THREE.Vector3());
    expect(wrist.y).toBeCloseTo(shoulder.y, 2);
    expect(wrist.x).toBeGreaterThan(shoulder.x + 0.5);
    const other = rig.bones.RightHand!.getWorldPosition(new THREE.Vector3());
    expect(other.y).toBeLessThan(shoulder.y - 0.4); // the right arm follows two beats later
  });

  it('a still scheme compiles to a still, grounded clip', () => {
    const { clip } = compileScheme({ format: 'thunes-dance@1', beats: 4, bpm: 120 });
    const position = clip.tracks[0].values;
    for (let i = 3; i < position.length; i += 3) {
      expect(position[i]).toBe(position[0]);
      expect(position[i + 1]).toBe(position[1]);
    }
    expect(position[1]).toBeCloseTo(hipHeight(DEFAULT_PROPORTIONS), 2);
  });
});
