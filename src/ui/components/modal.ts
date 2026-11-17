/**
 * Modal dialog (.modal > .modal__scrim + .modal__dialog) with a focus trap,
 * Escape to close, focus restore, scroll lock, backdrop click, and `inert`
 * on everything else in the UI layer. Modals stack (a confirm over a dialog).
 *
 * At phone widths dialogs become sheets anchored to the bottom (CSS).
 */
import { createScope, h, icon, uniqueId } from '../dom';

export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalOptions {
  /** Visible title in the header (also the accessible name). */
  title?: string;
  /** Accessible name when there is no visible title. */
  label?: string;
  /** sm ≈ 440px (confirm), md ≈ 640px (save/share/about), lg = 960 × 690 (picker). Default md. */
  size?: ModalSize;
  className?: string;
  /** Show the header close button (default true when `title` is set). */
  closeButton?: boolean;
  /** Clicking the scrim closes (default true). */
  closeOnBackdrop?: boolean;
  /** Escape closes (default true). */
  closeOnEscape?: boolean;
  /** Called after the modal closed (by any means). */
  onClose?: () => void;
  /** Where the modal element is attached (default: the host set by setModalHost, else document.body). */
  host?: HTMLElement;
}

export interface ModalHandle {
  /** The .modal root (role="dialog"). */
  el: HTMLElement;
  dialog: HTMLElement;
  /** Header (.modal__head); holds the title row. Add rows with `h('div', { class: 'modal__row' })`. */
  head: HTMLElement;
  /** The first header row (title + close button). */
  headRow: HTMLElement;
  /** Scrollable content (.modal__body). */
  body: HTMLElement;
  /** Footer (.modal__foot), hidden until something is appended to `actions` or `hint`. */
  foot: HTMLElement;
  /** Footer hint (.modal__hint). */
  hint: HTMLElement;
  /** Footer button group (.modal__actions). */
  actions: HTMLElement;
  setTitle(title: string): void;
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

let defaultHost: HTMLElement | null = null;
/** The shell sets this to the UI root so modals live inside the UI layer. */
export function setModalHost(host: HTMLElement | null): void {
  defaultHost = host;
}

const stack: { el: HTMLElement; close: () => void }[] = [];
/** True while any modal is open (keyboard shortcuts are ignored then). */
export function isModalOpen(): boolean {
  return stack.length > 0;
}
/** Close the top-most modal. Returns false when none is open. */
export function closeTopModal(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Focusable, visible elements inside `root`, in DOM order. */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest('[inert]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden',
  );
}

export function createModal(options: ModalOptions = {}): ModalHandle {
  const scope = createScope();
  const titleId = uniqueId('modal-title');
  const title = h('h2', { class: 'modal__title', attrs: { id: titleId }, text: options.title ?? '' });
  const hasTitle = options.title !== undefined;
  const closeButton = h(
    'button',
    { class: 'btn btn--icon btn--ghost modal__close', attrs: { type: 'button', 'aria-label': 'Close' } },
    icon('close'),
  );
  const showClose = options.closeButton ?? hasTitle;
  const headRow = h('div', { class: 'modal__row' }, hasTitle ? title : null, showClose ? closeButton : null);
  const head = h('header', { class: 'modal__head' }, headRow);
  if (!hasTitle && !showClose) head.hidden = true;
  const body = h('div', { class: 'modal__body' });
  const hint = h('p', { class: 'modal__hint' });
  const actions = h('div', { class: 'modal__actions' });
  const foot = h('footer', { class: 'modal__foot' }, hint, actions);
  const dialog = h('div', { class: 'modal__dialog', attrs: { tabindex: -1 } }, head, body, foot);
  const scrim = h('div', { class: 'modal__scrim', attrs: { 'aria-hidden': 'true' } });
  const el = h(
    'div',
    {
      class: ['modal', `modal--${options.size ?? 'md'}`, options.className],
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': hasTitle ? titleId : undefined,
        'aria-label': hasTitle ? undefined : options.label,
      },
    },
    scrim,
    dialog,
  );
  el.hidden = true;

  let open = false;
  let restoreFocus: HTMLElement | null = null;
  let inerted: HTMLElement[] = [];
  const entry = { el, close: () => close() };

  const updateFoot = () => {
    foot.hidden = actions.childElementCount === 0 && hint.childNodes.length === 0;
  };
  const footObserver = new MutationObserver(updateFoot);
  footObserver.observe(foot, { childList: true, subtree: true });
  scope.add(() => footObserver.disconnect());

  function openModal(): void {
    if (open) return;
    open = true;
    updateFoot();
    const host = options.host ?? defaultHost ?? document.body;
    if (el.parentElement !== host) host.appendChild(el);
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Everything else in the layer becomes inert (no focus, no clicks, hidden from AT).
    inerted = [];
    for (const sibling of Array.from(host.children)) {
      if (sibling === el || !(sibling instanceof HTMLElement) || sibling.inert) continue;
      sibling.inert = true;
      inerted.push(sibling);
    }
    stack.push(entry);
    document.documentElement.classList.add('has-modal');
    el.hidden = false;
    const preferred = dialog.querySelector<HTMLElement>('[data-autofocus]');
    const first = preferred ?? focusableWithin(body)[0] ?? focusableWithin(dialog)[0] ?? dialog;
    first.focus({ preventScroll: true });
  }

  function close(): void {
    if (!open) return;
    open = false;
    el.hidden = true;
    const index = stack.indexOf(entry);
    if (index >= 0) stack.splice(index, 1);
    if (stack.length === 0) document.documentElement.classList.remove('has-modal');
    for (const sibling of inerted) sibling.inert = false;
    inerted = [];
    if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
    restoreFocus = null;
    options.onClose?.();
  }

  scope.on(closeButton, 'click', () => close());
  scope.on(scrim, 'click', () => {
    if (options.closeOnBackdrop !== false) close();
  });
  scope.on(el, 'keydown', (event) => {
    if (stack[stack.length - 1] !== entry) return;
    if (event.key === 'Escape') {
      // preventDefault tells the shell's shortcut handler this key was used.
      event.preventDefault();
      event.stopPropagation();
      if (options.closeOnEscape !== false) close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusableWithin(dialog);
    if (items.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  });
  // Focus that escapes (e.g. a click on the page chrome) is pulled back in.
  scope.on(document, 'focusin', (event) => {
    if (!open || stack[stack.length - 1] !== entry) return;
    const target = event.target as Node | null;
    if (target && !el.contains(target)) (focusableWithin(dialog)[0] ?? dialog).focus({ preventScroll: true });
  });

  return {
    el,
    dialog,
    head,
    headRow,
    body,
    foot,
    hint,
    actions,
    setTitle(text) {
      title.textContent = text;
    },
    open: openModal,
    close,
    isOpen: () => open,
    destroy() {
      close();
      scope.dispose();
      el.remove();
    },
  };
}

// ────────────────────────────────────────────────────────────── Confirm ──

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
}

/** Ask a yes/no question. Resolves true on confirm, false on cancel/Escape/backdrop. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const modal = createModal({
      title: options.title,
      size: 'sm',
      className: 'modal--confirm',
      onClose: () => {
        resolve(result);
        // Let the close (and focus restore) finish before removing the element.
        queueMicrotask(() => modal.destroy());
      },
    });
    if (options.message) modal.body.append(h('p', { class: 'modal__text', text: options.message }));
    else modal.body.hidden = true;
    const cancel = h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: options.cancelLabel ?? 'Cancel' });
    const ok = h('button', {
      class: ['btn', options.danger ? 'btn--danger btn--danger-solid' : 'btn--primary'],
      attrs: { type: 'button', 'data-autofocus': '' },
      text: options.confirmLabel ?? 'OK',
    });
    cancel.addEventListener('click', () => modal.close());
    ok.addEventListener('click', () => {
      result = true;
      modal.close();
    });
    modal.actions.append(cancel, ok);
    modal.open();
  });
}
