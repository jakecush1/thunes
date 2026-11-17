/**
 * Store bindings for the UI: run a callback when a selected slice of the
 * state changes.
 *
 *   const stop = watch(store, (s) => s.ui.mode, (mode) => seg.set(mode));
 *
 * Selectors should return existing state branches or primitives. When a
 * selector builds a new array/object each time, pass `equals: shallowEqual`.
 */
import type { AppState, Store } from '../types';

export interface WatchOptions<T> {
  /** Call the callback right away with the current value (default true). */
  immediate?: boolean;
  /** Decides whether the selected value changed (default Object.is). */
  equals?: (a: T, b: T) => boolean;
}

/** Subscribe to a slice of the state. Returns the unsubscribe function. */
export function watch<T>(
  store: Pick<Store, 'getState' | 'subscribe'>,
  select: (state: AppState) => T,
  callback: (value: T, previous: T | undefined) => void,
  options: WatchOptions<T> = {},
): () => void {
  const equals = options.equals ?? Object.is;
  let current = select(store.getState());
  if (options.immediate !== false) callback(current, undefined);
  return store.subscribe((state) => {
    const next = select(state);
    if (equals(next, current)) return;
    const previous = current;
    current = next;
    callback(next, previous);
  });
}

/** Equal when both are the same, or arrays/plain objects with identical (Object.is) entries. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const key of ka) if (!Object.prototype.hasOwnProperty.call(rb, key) || !Object.is(ra[key], rb[key])) return false;
  return true;
}

/** The selected dancer, or null. Handy selector for panels. */
export function selectSelectedDancer(state: AppState): AppState['dancers'][number] | null {
  const id = state.ui.selectedId;
  if (id === null) return null;
  return state.dancers.find((d) => d.id === id) ?? null;
}
