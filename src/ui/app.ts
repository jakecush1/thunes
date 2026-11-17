/**
 * The UI shell: splash, HUD (top bars, left drawers, inspector, dock, hints),
 * toasts, dialogs, view-only bar and keyboard shortcuts. Panels in ./panels/
 * plug into it through the UiContext contract in ./context.ts.
 *
 * Root structure (inside the .ui-host layer, which has pointer-events: none):
 *   .ui-root                       state classes: is-splash, is-view-only, is-ui-hidden
 *     .hud                         the desktop grid / phone column (pointer-events: none)
 *       header.hud__top            brand bar + toolbar
 *       aside.hud__left            [slot scene] [slot music]
 *       .hud__stage                empty-stage hint
 *       aside.hud__right           [slot inspector]
 *       .hud__dock                 slot bar
 *     .toast-stack
 *     .viewonly                    compact bar for shared scenes
 *     button.ui-restore            "Show controls" while hidden
 *     .ui-overlay                  uploads drop target; modals attach to .ui-root
 *     .splash                      enter screen
 */
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/content.css';
import './styles/layout.css';
import './styles/shell.css';
import './styles/prefs.css';

import type { AppServices } from '../types';
import { confirmDialog, setModalHost } from './components/modal';
import { createToastStack } from './components/toast';
import type { DialogHandle, PickerHandle, PanelHandle, UiContext, UiLayout } from './context';
import { createScope, ensureIconSprite, h, isPhoneLayout } from './dom';
import { mountInspector } from './panels/inspector';
import { mountLibraryDialog } from './panels/libraryDialog';
import { mountMusic } from './panels/music';
import { mountPicker } from './panels/picker';
import { mountSaveDialog } from './panels/saveDialog';
import { mountScene } from './panels/scene';
import { mountShareDialog } from './panels/shareDialog';
import { mountUploads } from './panels/uploads';
import { createAboutDialog } from './shell/about';
import { createDock } from './shell/dock';
import { installShortcuts } from './shell/keyboard';
import { createEmptyHint, createRestoreButton, createSplash, createViewBar } from './shell/screens';
import { createSurfaceManager } from './shell/surfaces';
import { createTopbar } from './shell/topbar';
import { watch } from './watch';

/** Accent colours for dancer pads, avatars and cards, by position in the crew. */
export const DANCER_COLORS = ['#ff7a5c', '#19cdb8', '#ffc13d', '#b08cff', '#4aa8ff', '#ff7ac8', '#b6f24a', '#ffd84d'] as const;

/** Longest side of a snapshot, in pixels. */
const SNAPSHOT_MAX = 4096;

/** Mount the UI into `root` (the .ui-host layer). Returns a function that unmounts it. */
export function mountUi(root: HTMLElement, services: AppServices): () => void {
  ensureIconSprite();
  const scope = createScope();
  const { store, stage } = services;

  // ── Layout skeleton ──
  const uiRoot = h('div', { class: 'ui-root' });
  const hud = h('div', { class: 'hud' });
  const left = h('aside', { class: 'hud__left', attrs: { 'aria-label': 'Room' } });
  const stageArea = h('div', { class: 'hud__stage' });
  const right = h('aside', { class: 'hud__right', attrs: { 'aria-label': 'Selected dancer' } });
  const overlay = h('div', { class: 'ui-overlay' });
  const slot = (name: string) => h('div', { class: 'ui-slot', attrs: { 'data-slot': name } });
  const sceneSlot = slot('scene');
  const musicSlot = slot('music');
  const inspectorSlot = slot('inspector');
  left.append(sceneSlot, musicSlot);
  right.append(inspectorSlot);
  root.append(uiRoot);
  setModalHost(uiRoot);
  scope.add(() => setModalHost(null));

  const toasts = createToastStack();
  scope.add(toasts.destroy);
  const surfaces = createSurfaceManager(isPhoneLayout);
  const layout: UiLayout = { root: uiRoot, hud, stage: stageArea, overlay };

  // Late-bound panel handles (the context is created before the panels).
  let picker: PickerHandle | null = null;
  let saveDialog: DialogHandle | null = null;
  let libraryDialog: DialogHandle | null = null;
  let shareDialog: DialogHandle | null = null;
  let aboutDialog: DialogHandle | null = null;

  const ctx: UiContext = {
    services,
    store,
    layout,
    surfaces,
    watch(select, callback, options) {
      return scope.add(watch(store, select, callback, options));
    },
    openPicker: (request) => picker?.open(request),
    openSave: () => saveDialog?.open(),
    openLibrary: () => libraryDialog?.open(),
    openShare: () => shareDialog?.open(),
    openAbout: () => aboutDialog?.open(),
    toast: (message, options) => toasts.show(message, options),
    confirm: (options) => confirmDialog(options),
    captureSnapshot() {
      const width = stage.canvas.clientWidth || window.innerWidth;
      const height = stage.canvas.clientHeight || window.innerHeight;
      const scale = Math.min(2, SNAPSHOT_MAX / Math.max(width, height));
      return stage.capture({ width: Math.round(width * scale), height: Math.round(height * scale), type: 'image/png' });
    },
    captureThumbnail(size = 320) {
      return stage.capture({ width: size, height: Math.round(size * 0.75), type: 'image/jpeg', quality: 0.82 });
    },
    dancerColor: (index) => DANCER_COLORS[((index % DANCER_COLORS.length) + DANCER_COLORS.length) % DANCER_COLORS.length]!,
    isPhone: isPhoneLayout,
  };

  // ── Shell parts ──
  const topbar = createTopbar(ctx);
  const dock = createDock(ctx);
  const hint = createEmptyHint(ctx);
  stageArea.append(hint.el);
  hud.append(topbar.el, left, stageArea, right, dock.el);
  const viewBar = createViewBar(ctx);
  const restore = createRestoreButton(ctx);
  const splash = createSplash(ctx);
  uiRoot.append(hud, toasts.el, viewBar.el, restore.el, overlay, splash.el);
  for (const part of [topbar, dock, hint, viewBar, restore, splash]) scope.add(() => part.destroy());

  // ── Panels ──
  const panels: PanelHandle[] = [];
  const mount = <T extends PanelHandle>(name: string, create: () => T): T | null => {
    try {
      const handle = create();
      panels.push(handle);
      return handle;
    } catch (error) {
      console.error(`The ${name} panel failed to start`, error);
      return null;
    }
  };
  mount('scene', () => mountScene(ctx, sceneSlot));
  mount('music', () => mountMusic(ctx, musicSlot));
  mount('inspector', () => mountInspector(ctx, inspectorSlot));
  picker = mount('picker', () => mountPicker(ctx, overlay));
  saveDialog = mount('save', () => mountSaveDialog(ctx, overlay));
  libraryDialog = mount('library', () => mountLibraryDialog(ctx, overlay));
  shareDialog = mount('share', () => mountShareDialog(ctx, overlay));
  aboutDialog = mount('about', () => createAboutDialog(ctx));
  mount('uploads', () => mountUploads(ctx, overlay));
  scope.add(() => {
    for (const panel of panels.reverse()) {
      try {
        panel.destroy();
      } catch (error) {
        console.error(error);
      }
    }
  });

  // ── Global state → root classes ──
  scope.add(
    watch(
      store,
      (s) => s.ui,
      (ui) => {
        uiRoot.classList.toggle('is-splash', !ui.entered);
        uiRoot.classList.toggle('is-view-only', ui.entered && ui.viewOnly);
        uiRoot.classList.toggle('is-ui-hidden', ui.entered && ui.uiHidden);
        splash.el.hidden = ui.entered;
        // Hidden parts must not keep keyboard focus.
        hud.inert = !ui.entered || ui.viewOnly || ui.uiHidden;
        viewBar.el.inert = !ui.entered || !ui.viewOnly || ui.uiHidden;
      },
    ),
  );
  // Quality: Low turns off backdrop blur everywhere (the design's low-cost mode).
  const html = document.documentElement;
  scope.add(
    watch(
      store,
      (s) => s.ui.quality,
      (quality) => {
        if (quality === 'low') html.dataset.glass = 'off';
        else delete html.dataset.glass;
      },
    ),
  );
  scope.add(() => delete html.dataset.glass);
  if (!store.getState().ui.entered) {
    queueMicrotask(() => splash.el.querySelector<HTMLElement>('.splash__enter')?.focus({ preventScroll: true }));
  }

  if (services.startup.shareError) {
    toasts.show(services.startup.shareError, { kind: 'warn', duration: 9000, id: 'share-error' });
  }

  scope.add(installShortcuts(ctx));

  return () => {
    scope.dispose();
    uiRoot.remove();
  };
}
