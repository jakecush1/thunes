/**
 * Drawer: a glass pill when collapsed, a panel when expanded (.drawer /
 * .pill / .panel.sheet). At phone widths the panel becomes a bottom sheet
 * docked above the slot bar (CSS only).
 *
 * Register drawers with the shell's SurfaceManager so only one is open per
 * side on desktop (one sheet at a time on phones) and Escape closes the
 * top-most one.
 */
import type { SurfaceGroup, SurfaceManager } from '../context';
import { createScope, h, icon, uniqueId } from '../dom';

export interface DrawerOptions {
  /** Stable id used by the surface manager, e.g. 'scene' or 'music'. */
  id: string;
  /** Block class added next to .drawer (e.g. 'scene', 'music'); the layout CSS keys on it. */
  className: string;
  group: SurfaceGroup;
  /** Accessible name of the expanded panel, e.g. 'Scene settings'. */
  label: string;
  title: string;
  /** Second line of the pill (summary of the settings). */
  meta?: string;
  /** Subtitle under the panel title. */
  sub?: string;
  /** Leading visual in the pill (swatch, level bars…). */
  pillLead?: Node;
  /** Extra controls at the end of the pill (e.g. a mute button). */
  pillExtras?: Node[];
  /** Leading visual in the panel header. */
  headLead?: Node;
  /** Buttons in the panel header, before the collapse button. */
  headActions?: Node[];
  /** Which way the panel unfolds from the pill: 'down' (top of the column) or 'up' (bottom). */
  direction: 'down' | 'up';
  surfaces?: SurfaceManager;
  open?: boolean;
  onToggle?: (open: boolean) => void;
}

export interface DrawerHandle {
  el: HTMLElement;
  /** The expanded panel (section.panel.sheet). */
  panel: HTMLElement;
  /** The panel header, for extra controls. */
  head: HTMLElement;
  /** Scrollable content area of the panel. */
  body: HTMLElement;
  /** The pill's main (toggle) button. */
  pillButton: HTMLButtonElement;
  setTitle(title: string): void;
  setMeta(meta: string): void;
  setSub(sub: string): void;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  destroy(): void;
}

export function createDrawer(options: DrawerOptions): DrawerHandle {
  const scope = createScope();
  const panelId = uniqueId(`drawer-${options.id}`);
  const pillTitle = h('span', { class: 'pill__title', text: options.title });
  const pillMeta = h('span', { class: 'pill__meta', text: options.meta ?? '' });
  const pillButton = h(
    'button',
    { class: 'pill__main', attrs: { type: 'button', 'aria-controls': panelId, 'aria-expanded': 'false' } },
    options.pillLead ?? null,
    h('span', { class: 'pill__text' }, pillTitle, pillMeta),
    icon(options.direction === 'down' ? 'chev-down' : 'chev-up', 'sm', 'pill__chev'),
  );
  const pill = h('div', { class: 'pill' }, pillButton, ...(options.pillExtras ?? []));

  const title = h('h2', { class: 'panel__title', text: options.title });
  const sub = h('p', { class: 'panel__sub', text: options.sub ?? '' });
  sub.hidden = !options.sub;
  const collapse = h(
    'button',
    { class: 'btn btn--icon btn--ghost', attrs: { type: 'button', 'aria-label': `Collapse ${options.title.toLowerCase()}`, 'aria-controls': panelId } },
    icon(options.direction === 'down' ? 'chev-up' : 'chev-down'),
  );
  const head = h(
    'header',
    { class: 'panel__head' },
    options.headLead ?? null,
    h('div', { class: 'panel__heading' }, title, sub),
    ...(options.headActions ?? []),
    collapse,
  );
  const body = h('div', { class: 'panel__body' });
  const panel = h(
    'section',
    { class: 'panel sheet', attrs: { id: panelId, 'aria-label': options.label } },
    h('span', { class: 'sheet__grabber', attrs: { 'aria-hidden': 'true' } }),
    head,
    body,
  );
  const el = h('div', { class: ['drawer', options.className], attrs: { 'data-group': options.group } }, pill, panel);

  let isOpen = false;
  const setOpen = (open: boolean, moveFocus: boolean) => {
    if (open === isOpen) return;
    const focusInside = el.contains(document.activeElement);
    isOpen = open;
    el.classList.toggle('is-open', open);
    pillButton.setAttribute('aria-expanded', String(open));
    if (open) options.surfaces?.opened(options.id);
    else options.surfaces?.closed(options.id);
    if (moveFocus && focusInside) (open ? collapse : pillButton).focus();
    options.onToggle?.(open);
  };

  scope.on(pillButton, 'click', () => setOpen(true, true));
  scope.on(collapse, 'click', () => setOpen(false, true));
  if (options.surfaces) {
    scope.add(options.surfaces.register({ id: options.id, group: options.group, isOpen: () => isOpen, close: () => setOpen(false, true) }));
  }
  if (options.open) setOpen(true, false);

  return {
    el,
    panel,
    head,
    body,
    pillButton,
    setTitle(text) {
      pillTitle.textContent = text;
      title.textContent = text;
    },
    setMeta(text) {
      pillMeta.textContent = text;
    },
    setSub(text) {
      sub.textContent = text;
      sub.hidden = !text;
    },
    open: () => setOpen(true, false),
    close: () => setOpen(false, false),
    toggle: () => setOpen(!isOpen, false),
    isOpen: () => isOpen,
    destroy() {
      if (isOpen) options.surfaces?.closed(options.id);
      scope.dispose();
    },
  };
}
