/**
 * A tiny typed event emitter. Listeners run synchronously in subscription
 * order; a throwing listener is logged with console.error and does not stop
 * the others. Listeners added or removed during an emit take effect on the
 * next emit.
 */

export type Listener<T> = (value: T) => void;

export interface Emitter<T> {
  /** Adds a listener; returns a function that removes it (idempotent). */
  on(listener: Listener<T>): () => void;
  /** Calls every listener with `value`. */
  emit(value: T): void;
  /** Removes every listener. */
  clear(): void;
  /** Number of listeners. */
  readonly size: number;
}

/** Creates an emitter. */
export function createEmitter<T = void>(): Emitter<T> {
  let listeners: Listener<T>[] = [];
  return {
    on(listener) {
      // Copy-on-write so an emit in progress keeps its snapshot.
      listeners = [...listeners, listener];
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners = listeners.slice(0, i).concat(listeners.slice(i + 1));
      };
    },
    emit(value) {
      const snapshot = listeners;
      for (const l of snapshot) {
        try {
          l(value);
        } catch (err) {
          console.error('[thunes] listener failed', err);
        }
      }
    },
    clear() {
      listeners = [];
    },
    get size() {
      return listeners.length;
    },
  };
}
