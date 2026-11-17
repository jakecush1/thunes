/**
 * Toast stack (.toast-stack > .toast): short status messages under the top
 * bar, announced politely to screen readers.
 */
import { createScope, h, icon } from '../dom';
import type { IconName } from '../dom';

export type ToastKind = 'ok' | 'info' | 'warn' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  /** Optional action button, e.g. { label: 'Undo', run: () => store.undo() }. */
  action?: { label: string; run: () => void };
  /** Milliseconds before it hides; 0 keeps it until dismissed. Default 3500 (6000 with an action, 8000 for errors). */
  duration?: number;
  /** A toast with the same id replaces the previous one instead of stacking. */
  id?: string;
}

export interface ToastStack {
  el: HTMLElement;
  /** Show a toast. Returns a function that dismisses it. */
  show(message: string, options?: ToastOptions): () => void;
  clear(): void;
  destroy(): void;
}

const KIND_ICON: Record<ToastKind, IconName> = { ok: 'check', info: 'info', warn: 'warn', error: 'warn' };
const MAX_TOASTS = 3;

export function createToastStack(): ToastStack {
  const scope = createScope();
  const el = h('div', { class: 'toast-stack', attrs: { 'aria-live': 'polite', 'aria-atomic': 'false' } });
  const live = new Map<HTMLElement, { id?: string; dismiss: () => void }>();

  function show(message: string, options: ToastOptions = {}): () => void {
    const kind = options.kind ?? 'ok';
    if (options.id) for (const entry of live.values()) if (entry.id === options.id) entry.dismiss();
    const toastScope = createScope();
    const text = h('span', { class: 'toast__text', text: message, attrs: { title: message } });
    const toast = h(
      'div',
      { class: ['toast', `toast--${kind}`], attrs: { role: kind === 'error' ? 'alert' : 'status' } },
      h('span', { class: 'toast__icon', attrs: { 'aria-hidden': 'true' } }, icon(KIND_ICON[kind])),
      text,
    );
    let timer = 0;
    let gone = false;
    const dismiss = () => {
      if (gone) return;
      gone = true;
      window.clearTimeout(timer);
      live.delete(toast);
      toastScope.dispose();
      toast.remove();
    };
    if (options.action) {
      const { label, run } = options.action;
      const button = h('button', { class: 'btn btn--sm', attrs: { type: 'button' }, text: label });
      toastScope.on(button, 'click', () => {
        run();
        dismiss();
      });
      toast.append(button);
    }
    const close = h(
      'button',
      { class: 'btn btn--icon btn--sm btn--ghost btn--round', attrs: { type: 'button', 'aria-label': 'Dismiss' } },
      icon('close', 'sm'),
    );
    toastScope.on(close, 'click', dismiss);
    toast.append(close);

    const duration = options.duration ?? (kind === 'error' ? 8000 : options.action ? 6000 : 3500);
    const arm = () => {
      window.clearTimeout(timer);
      if (duration > 0) timer = window.setTimeout(dismiss, duration);
    };
    // Pause while hovered or focused so people can read and act.
    toastScope.on(toast, 'pointerenter', () => window.clearTimeout(timer));
    toastScope.on(toast, 'pointerleave', arm);
    toastScope.on(toast, 'focusin', () => window.clearTimeout(timer));
    toastScope.on(toast, 'focusout', arm);
    arm();

    live.set(toast, { id: options.id, dismiss });
    el.append(toast);
    while (live.size > MAX_TOASTS) live.values().next().value?.dismiss();
    return dismiss;
  }

  const clear = () => {
    for (const entry of Array.from(live.values())) entry.dismiss();
  };
  scope.add(clear);
  return { el, show, clear, destroy: () => scope.dispose() };
}
