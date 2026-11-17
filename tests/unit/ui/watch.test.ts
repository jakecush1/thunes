import { describe, expect, it, vi } from 'vitest';
import { createStore } from '../../../src/core/store';
import { createSurfaceManager } from '../../../src/ui/shell/surfaces';
import { selectSelectedDancer, shallowEqual, watch } from '../../../src/ui/watch';

describe('watch', () => {
  it('calls immediately, then only when the slice changes, and stops on cleanup', () => {
    const store = createStore();
    const seen: string[] = [];
    const stop = watch(store, (s) => s.ui.mode, (mode) => seen.push(mode));
    expect(seen).toEqual(['both']);
    store.updateUi({ quality: 'high' });
    store.updateUi({ mode: 'grab' });
    store.updateUi({ mode: 'grab' });
    expect(seen).toEqual(['both', 'grab']);
    stop();
    store.updateUi({ mode: 'look' });
    expect(seen).toEqual(['both', 'grab']);
  });
  it('passes the previous value and supports immediate: false and custom equality', () => {
    const store = createStore();
    const callback = vi.fn();
    watch(store, (s) => [s.ui.mode, s.ui.quality], callback, { immediate: false, equals: shallowEqual });
    store.updateUi({ uiHidden: true });
    expect(callback).not.toHaveBeenCalled();
    store.updateUi({ quality: 'low' });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]).toEqual([['both', 'low'], ['both', 'medium']]);
  });
  it('selects the selected dancer', () => {
    const store = createStore();
    expect(selectSelectedDancer(store.getState())).toBeNull();
    const dancer = store.addDancer({ characterId: 'builtin:mannequin', danceId: 'builtin:groove' });
    expect(selectSelectedDancer(store.getState())?.id).toBe(dancer?.id);
  });
});

describe('shallowEqual', () => {
  it('compares arrays and plain objects one level deep', () => {
    const inner = { a: 1 };
    expect(shallowEqual([1, inner], [1, inner])).toBe(true);
    expect(shallowEqual([1, { a: 1 }], [1, { a: 1 }])).toBe(false);
    expect(shallowEqual({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqual([1], { 0: 1 })).toBe(false);
    expect(shallowEqual(null, null)).toBe(true);
  });
});

describe('surface manager', () => {
  const surface = (id: string, group: 'left' | 'right' | 'tools') => {
    let open = false;
    return { id, group, isOpen: () => open, close: vi.fn(() => (open = false)), setOpen: (v: boolean) => (open = v) };
  };
  it('keeps one surface per group on desktop and closes the top-most on Escape', () => {
    const manager = createSurfaceManager(() => false);
    const scene = surface('scene', 'left');
    const music = surface('music', 'left');
    const inspector = surface('inspector', 'right');
    for (const s of [scene, music, inspector]) manager.register(s);
    scene.setOpen(true);
    manager.opened('scene');
    inspector.setOpen(true);
    manager.opened('inspector');
    music.setOpen(true);
    manager.opened('music');
    expect(scene.close).toHaveBeenCalledTimes(1);
    expect(inspector.close).not.toHaveBeenCalled();
    expect(manager.openIds()).toEqual(['inspector', 'music']);
    expect(manager.closeTop()).toBe(true);
    expect(music.close).toHaveBeenCalledTimes(1);
    expect(manager.closeTop()).toBe(true);
    expect(inspector.close).toHaveBeenCalledTimes(1);
    expect(manager.closeTop()).toBe(false);
  });
  it('allows one sheet at a time on phones', () => {
    const manager = createSurfaceManager(() => true);
    const tools = surface('tools', 'tools');
    const music = surface('music', 'left');
    manager.register(tools);
    const unregister = manager.register(music);
    tools.setOpen(true);
    manager.opened('tools');
    music.setOpen(true);
    manager.opened('music');
    expect(tools.close).toHaveBeenCalledTimes(1);
    unregister();
    expect(manager.openIds()).toEqual([]);
  });
});
