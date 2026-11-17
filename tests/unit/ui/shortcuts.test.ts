import { describe, expect, it } from 'vitest';
import { isApplePlatform, isKeyOwnedByControl, isTypingTarget, matchShortcut, shortcutList } from '../../../src/ui/shortcuts';
import type { KeyLike } from '../../../src/ui/shortcuts';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

describe('matchShortcut', () => {
  it('maps history and clone with Cmd or Ctrl', () => {
    expect(matchShortcut(key('z', { metaKey: true }))).toEqual({ type: 'undo' });
    expect(matchShortcut(key('z', { ctrlKey: true }))).toEqual({ type: 'undo' });
    expect(matchShortcut(key('Z', { metaKey: true, shiftKey: true }))).toEqual({ type: 'redo' });
    expect(matchShortcut(key('y', { ctrlKey: true }))).toEqual({ type: 'redo' });
    expect(matchShortcut(key('y', { metaKey: true }))).toBeNull();
    expect(matchShortcut(key('d', { metaKey: true }))).toEqual({ type: 'clone' });
    expect(matchShortcut(key('s', { metaKey: true }))).toBeNull();
    expect(matchShortcut(key('z', { metaKey: true, altKey: true }))).toBeNull();
  });
  it('maps single keys', () => {
    expect(matchShortcut(key('Delete'))).toEqual({ type: 'remove' });
    expect(matchShortcut(key('Backspace'))).toEqual({ type: 'remove' });
    expect(matchShortcut(key('Escape'))).toEqual({ type: 'escape' });
    expect(matchShortcut(key('h'))).toEqual({ type: 'toggle-ui' });
    expect(matchShortcut(key('H', { shiftKey: true }))).toEqual({ type: 'toggle-ui' });
    expect(matchShortcut(key('m'))).toEqual({ type: 'mute' });
    expect(matchShortcut(key('s'))).toEqual({ type: 'resync' });
    expect(matchShortcut(key('x'))).toBeNull();
    expect(matchShortcut(key('h', { altKey: true }))).toBeNull();
  });
  it('maps pads 1-8 by key or code', () => {
    expect(matchShortcut(key('1'))).toEqual({ type: 'select-slot', index: 0 });
    expect(matchShortcut(key('8'))).toEqual({ type: 'select-slot', index: 7 });
    expect(matchShortcut(key('9'))).toBeNull();
    expect(matchShortcut(key('&', { code: 'Digit1', shiftKey: true }))).toEqual({ type: 'select-slot', index: 0 });
    expect(matchShortcut(key('3', { code: 'Numpad3' }))).toEqual({ type: 'select-slot', index: 2 });
  });
  it('nudges 0.1 m (0.5 with Shift) and rotates 15°', () => {
    expect(matchShortcut(key('ArrowLeft'))).toEqual({ type: 'nudge', dx: -0.1, dz: 0 });
    expect(matchShortcut(key('ArrowRight', { shiftKey: true }))).toEqual({ type: 'nudge', dx: 0.5, dz: 0 });
    expect(matchShortcut(key('ArrowUp'))).toEqual({ type: 'nudge', dx: 0, dz: -0.1 });
    expect(matchShortcut(key('ArrowDown'))).toEqual({ type: 'nudge', dx: 0, dz: 0.1 });
    expect(matchShortcut(key('['))).toEqual({ type: 'rotate', degrees: -15 });
    expect(matchShortcut(key(']'))).toEqual({ type: 'rotate', degrees: 15 });
  });
});

/** Minimal element stand-ins: the guards only read a few properties. */
const fake = (tagName: string, extra: Record<string, unknown> = {}) =>
  ({ tagName, isContentEditable: false, closest: () => null, ...extra }) as unknown as EventTarget;

describe('typing and control guards', () => {
  it('detects text entry targets', () => {
    expect(isTypingTarget(fake('INPUT', { type: 'text' }))).toBe(true);
    expect(isTypingTarget(fake('INPUT', { type: 'search' }))).toBe(true);
    expect(isTypingTarget(fake('INPUT', { type: 'range' }))).toBe(false);
    expect(isTypingTarget(fake('INPUT', { type: 'radio' }))).toBe(false);
    expect(isTypingTarget(fake('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(fake('SELECT'))).toBe(true);
    expect(isTypingTarget(fake('DIV', { isContentEditable: true }))).toBe(true);
    expect(isTypingTarget(fake('BUTTON'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
  it('leaves arrow keys to inputs and composite widgets', () => {
    expect(isKeyOwnedByControl(fake('INPUT', { type: 'range' }), 'ArrowLeft')).toBe(true);
    expect(isKeyOwnedByControl(fake('INPUT', { type: 'range' }), 'h')).toBe(false);
    expect(isKeyOwnedByControl(fake('BUTTON', { closest: () => ({}) }), 'ArrowRight')).toBe(true);
    expect(isKeyOwnedByControl(fake('BUTTON'), 'ArrowRight')).toBe(false);
  });
});

describe('labels', () => {
  it('detects Apple platforms and lists every shortcut', () => {
    expect(isApplePlatform('MacIntel')).toBe(true);
    expect(isApplePlatform('iPhone')).toBe(true);
    expect(isApplePlatform('Win32')).toBe(false);
    const list = shortcutList('⌘');
    expect(list.length).toBeGreaterThanOrEqual(10);
    expect(list.some((s) => s.keys.includes('⌘') && s.keys.includes('D'))).toBe(true);
  });
});
