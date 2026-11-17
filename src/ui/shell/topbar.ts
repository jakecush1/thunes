/**
 * Top of the HUD: the brand bar (wordmark + Look/Grab/Both) and the toolbar
 * (undo/redo, save, my scenes, share, snapshot, quality, fullscreen, hide UI,
 * about). On phones the toolbar becomes the "Tools" bottom sheet.
 */
import { BAND } from '../../config';
import type { InteractionMode, Quality } from '../../types';
import { createIconButton } from '../components/button';
import type { IconButtonHandle } from '../components/button';
import { createSegmented } from '../components/choice';
import type { UiContext } from '../context';
import { createScope, externalLink, h, icon, logo } from '../dom';
import type { IconName } from '../dom';
import { snapshotFileName } from '../format';
import { isApplePlatform } from '../shortcuts';
import { isFullscreen, toggleFullscreen } from './fullscreen';

export interface TopbarHandle {
  el: HTMLElement;
  destroy(): void;
}

interface ToolOptions {
  icon: IconName;
  label: string;
  /** Visible label on desktop ('wide': Save/Share) or only in the phone sheet ('compact'). */
  text: string;
  textMode: 'wide' | 'compact';
  tip: string;
  kbd?: string;
  tipEnd?: boolean;
  variant?: 'line' | 'primary' | 'icon';
  onClick: () => void;
}

/** A toolbar button as in the design: icon, label (wide or phone-only) and tooltip. */
function createTool(options: ToolOptions, scope: ReturnType<typeof createScope>): HTMLButtonElement {
  const variant = options.variant ?? 'icon';
  const el = h(
    'button',
    {
      class: ['btn', 'tool', 'has-tip', variant === 'icon' ? 'btn--icon' : `btn--${variant}`],
      attrs: { type: 'button', 'aria-label': options.label, 'aria-keyshortcuts': options.kbd },
    },
    icon(options.icon),
    h('span', { class: ['tool__label', options.textMode === 'compact' && 'tool__label--compact'], text: options.text }),
    h(
      'span',
      { class: ['tip', options.tipEnd && 'tip--end'], attrs: { 'aria-hidden': 'true' } },
      options.tip,
      options.kbd ? h('kbd', { class: 'kbd', text: options.kbd }) : null,
    ),
  );
  scope.on(el, 'click', options.onClick);
  return el;
}

export function createTopbar(ctx: UiContext): TopbarHandle {
  const scope = createScope();
  const { store } = ctx.services;
  const mod = isApplePlatform(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';

  // ── Brand bar ──
  const mode = createSegmented<InteractionMode>({
    label: 'What dragging does',
    value: store.getState().ui.mode,
    options: [
      { value: 'look', label: 'Look' },
      { value: 'grab', label: 'Grab' },
      { value: 'both', label: 'Both' },
    ],
    onChange: (value) => store.updateUi({ mode: value }),
  });
  scope.add(mode.destroy);
  mode.el.title = 'Look: drag orbits the camera · Grab: drag moves dancers · Both: drag a dancer to move it, the floor to orbit';
  const toolsToggle: IconButtonHandle = createIconButton({
    icon: 'more',
    label: 'Tools',
    tip: false,
    variant: 'ghost',
    className: 'only-mobile',
    onClick: () => setToolsOpen(!toolsOpen),
  });
  scope.add(toolsToggle.destroy);
  toolsToggle.el.setAttribute('aria-controls', 'thunes-toolbar');
  toolsToggle.el.setAttribute('aria-expanded', 'false');
  const brandLink = externalLink(BAND.website, `${BAND.name} website`, logo(BAND.name));
  brandLink.classList.add('logo-link', 'brandbar__logo');
  const brandbar = h(
    'div',
    { class: 'bar brandbar' },
    brandLink,
    h('span', { class: 'bar__sep', attrs: { 'aria-hidden': 'true' } }),
    mode.el,
    toolsToggle.el,
  );

  // ── Toolbar ──
  const closeOnPhone = (run: () => void) => () => {
    if (ctx.isPhone()) setToolsOpen(false, false);
    run();
  };
  const undo = createTool(
    { icon: 'undo', label: 'Undo', text: 'Undo', textMode: 'compact', tip: 'Undo', kbd: `${mod}Z`, onClick: () => store.undo() },
    scope,
  );
  const redo = createTool(
    { icon: 'redo', label: 'Redo', text: 'Redo', textMode: 'compact', tip: 'Redo', kbd: `⇧${mod}Z`, onClick: () => store.redo() },
    scope,
  );
  const save = createTool(
    { icon: 'save', label: 'Save scene', text: 'Save', textMode: 'wide', tip: 'Save this scene', variant: 'line', onClick: closeOnPhone(() => ctx.openSave()) },
    scope,
  );
  const library = createTool(
    { icon: 'library', label: 'My scenes', text: 'My scenes', textMode: 'compact', tip: 'My scenes', onClick: closeOnPhone(() => ctx.openLibrary()) },
    scope,
  );
  const share = createTool(
    { icon: 'link', label: 'Share scene', text: 'Share', textMode: 'wide', tip: 'Share a link to this scene', variant: 'primary', onClick: closeOnPhone(() => ctx.openShare()) },
    scope,
  );
  const snapshot = createTool(
    {
      icon: 'camera',
      label: 'Snapshot',
      text: 'Snapshot',
      textMode: 'compact',
      tip: 'Save a picture of the stage',
      onClick: closeOnPhone(() => void downloadSnapshot(ctx)),
    },
    scope,
  );
  const quality = createSegmented<Quality>({
    labelledBy: 'thunes-quality-label',
    size: 'sm',
    value: store.getState().ui.quality,
    options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Med' },
      { value: 'high', label: 'High' },
    ],
    onChange: (value) => store.updateUi({ quality: value }),
  });
  scope.add(quality.destroy);
  const fullscreenIcon = icon('fullscreen');
  const fullscreen = createTool(
    {
      icon: 'fullscreen',
      label: 'Fullscreen',
      text: 'Fullscreen',
      textMode: 'compact',
      tip: 'Fullscreen',
      tipEnd: true,
      onClick: closeOnPhone(() => toggleFullscreen(ctx)),
    },
    scope,
  );
  fullscreen.firstElementChild?.replaceWith(fullscreenIcon);
  const hide = createTool(
    {
      icon: 'eye-off',
      label: 'Hide controls',
      text: 'Hide UI',
      textMode: 'compact',
      tip: 'Hide controls',
      kbd: 'H',
      tipEnd: true,
      onClick: closeOnPhone(() => store.updateUi({ uiHidden: true })),
    },
    scope,
  );
  const about = createTool(
    { icon: 'help', label: 'About and help', text: 'About', textMode: 'compact', tip: 'About and help', tipEnd: true, onClick: closeOnPhone(() => ctx.openAbout()) },
    scope,
  );
  const sheetClose = createIconButton({ icon: 'close', label: 'Close tools', tip: false, variant: 'ghost', onClick: () => setToolsOpen(false) });
  scope.add(sheetClose.destroy);
  const sep = () => h('span', { class: 'bar__sep', attrs: { 'aria-hidden': 'true' } });
  const toolbar = h(
    'div',
    { class: 'bar toolbar sheet', attrs: { id: 'thunes-toolbar', role: 'toolbar', 'aria-label': 'Scene tools', 'data-group': 'tools' } },
    h(
      'div',
      { class: 'sheet__head only-mobile' },
      h('span', { class: 'sheet__grabber', attrs: { 'aria-hidden': 'true' } }),
      h('h2', { class: 'panel__title', text: 'Tools' }),
      sheetClose.el,
    ),
    undo,
    redo,
    sep(),
    save,
    library,
    share,
    snapshot,
    sep(),
    h('div', { class: 'toolbar__group' }, h('span', { class: 'toolbar__label', attrs: { id: 'thunes-quality-label' }, text: 'Quality' }), quality.el),
    sep(),
    fullscreen,
    hide,
    about,
  );

  // Phone: the toolbar is a sheet registered with the surface manager.
  let toolsOpen = false;
  function setToolsOpen(open: boolean, moveFocus = true): void {
    if (open === toolsOpen) return;
    toolsOpen = open;
    toolbar.classList.toggle('is-open', open);
    toolsToggle.el.setAttribute('aria-expanded', String(open));
    if (open) {
      ctx.surfaces.opened('tools');
      if (moveFocus) sheetClose.el.focus();
    } else {
      ctx.surfaces.closed('tools');
      if (moveFocus && toolbar.contains(document.activeElement)) toolsToggle.el.focus();
    }
  }
  scope.add(ctx.surfaces.register({ id: 'tools', group: 'tools', isOpen: () => toolsOpen, close: () => setToolsOpen(false) }));

  // ── Store bindings ──
  scope.add(ctx.watch((s) => s.ui.mode, (value) => mode.set(value)));
  scope.add(ctx.watch((s) => s.ui.quality, (value) => quality.set(value)));
  const syncHistory = () => {
    undo.disabled = !store.canUndo();
    redo.disabled = !store.canRedo();
  };
  syncHistory();
  scope.add(store.subscribe(syncHistory));
  const syncFullscreen = () => {
    const on = isFullscreen();
    fullscreen.setAttribute('aria-pressed', String(on));
    fullscreenIcon.firstElementChild?.setAttribute('href', on ? '#i-fullscreen-exit' : '#i-fullscreen');
  };
  syncFullscreen();
  scope.on(document, 'fullscreenchange', syncFullscreen);

  const el = h('header', { class: 'hud__top' }, brandbar, toolbar);
  return {
    el,
    destroy() {
      if (toolsOpen) ctx.surfaces.closed('tools');
      scope.dispose();
    },
  };
}

/** Capture the stage as a PNG and download it. */
export async function downloadSnapshot(ctx: UiContext): Promise<void> {
  try {
    const dataUrl = ctx.captureSnapshot();
    const blob = await (await fetch(dataUrl)).blob();
    const url = URL.createObjectURL(blob);
    const link = h('a', { attrs: { href: url, download: snapshotFileName(ctx.store.getState().title, new Date()) } });
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    ctx.toast('Snapshot saved to your downloads');
  } catch (error) {
    console.error(error);
    ctx.toast('Could not take a snapshot.', { kind: 'error' });
  }
}
