/**
 * The contract between the shell (app.ts) and the panels in ui/panels/.
 *
 * Every panel module exports exactly one factory with a fixed name and
 * signature (see PANEL FACTORIES below). The shell creates the UiContext,
 * calls each factory once with the host element for that panel, and calls
 * `destroy()` on unmount.
 *
 * Conventions for panels
 *   - Build DOM with `h()` from ../dom and controls from ../components.
 *   - Bind to the store with `ctx.watch(select, callback)` (cleanup is automatic
 *     on unmount, but call the returned function if you stop earlier).
 *   - Keep every listener in a `createScope()` and dispose it in destroy().
 *   - Continuous gestures: `store.updateX(…, { transient: true })` while dragging,
 *     then `store.commit()` once. createSlider does this for you via onChange/onCommit.
 *   - Styles: put panel CSS in src/ui/panels/<panel>.css and import it from the
 *     panel module (`import './inspector.css'`). Reuse design-system classes
 *     first; new classes are prefixed with the panel block (`.inspector__…`,
 *     `.music__…`, `.scene__…`, `.picker__…`), state classes are `.is-*`.
 */
import type { NumberField } from '../config';
import type { AppServices, AppState, Store } from '../types';
import type { ConfirmOptions } from './components/modal';
import type { ToastOptions } from './components/toast';
import type { WatchOptions } from './watch';

/** What the picker is being opened for. */
export interface PickerRequest {
  /**
   *  add   — choose a character (and optionally a dance) for a new dancer;
   *  swap  — choose a new character for `dancerId`;
   *  dance — choose a new dance for `dancerId`.
   */
  purpose: 'add' | 'swap' | 'dance';
  dancerId?: string;
}

/** Side groups for drawers/sheets: one open per group on desktop, one at a time on phones. */
export type SurfaceGroup = 'left' | 'right' | 'tools';

/** Something that can be open and closed: a drawer, the inspector, the phone tools sheet. */
export interface Surface {
  id: string;
  group: SurfaceGroup;
  isOpen(): boolean;
  /** Close it (called by the manager to resolve conflicts or on Escape). */
  close(): void;
}

/**
 * Keeps drawers and sheets from piling up, and gives Escape a "top-most" to close.
 * Call `opened(id)` whenever your surface opens and `closed(id)` when it closes.
 */
export interface SurfaceManager {
  /** Returns the unregister function. */
  register(surface: Surface): () => void;
  /** Marks `id` as the top-most and closes conflicting surfaces. */
  opened(id: string): void;
  closed(id: string): void;
  /** Close the most recently opened surface that is still open. False when none is. */
  closeTop(): boolean;
  /** Ids of open surfaces, oldest first. */
  openIds(): string[];
}

/** Host elements for panels, created by the shell. */
export interface UiLayout {
  /** The UI root (.ui-root) inside the .ui-host layer. */
  root: HTMLElement;
  /** The HUD grid (.hud). */
  hud: HTMLElement;
  /** Empty area over the stage centre (.hud__stage) — the empty-stage hint lives here. */
  stage: HTMLElement;
  /** Layer for modals and full-window overlays (drag-and-drop). Children need pointer-events: auto. */
  overlay: HTMLElement;
}

export interface UiContext {
  services: AppServices;
  /** Same as services.store. */
  store: Store;
  layout: UiLayout;
  surfaces: SurfaceManager;

  /** Run `callback` when `select(state)` changes (and once now unless immediate: false). Auto-cleaned on unmount. */
  watch<T>(select: (state: AppState) => T, callback: (value: T, previous: T | undefined) => void, options?: WatchOptions<T>): () => void;

  /** Open the character/dance picker. */
  openPicker(request: PickerRequest): void;
  openSave(): void;
  openLibrary(): void;
  openShare(): void;
  openAbout(): void;

  /** Show a toast. Returns a dismiss function. */
  toast(message: string, options?: ToastOptions): () => void;
  /** Ask a yes/no question in a modal. */
  confirm(options: ConfirmOptions): Promise<boolean>;

  /** PNG of the stage at up to 2× the window size (no selection gizmos). */
  captureSnapshot(): string;
  /** A small JPEG of the stage for saved-scene thumbnails. */
  captureThumbnail(size?: number): string;
  /** A stable accent colour for a dancer (by index in state.dancers) — used by the dock, inspector avatar and cards. */
  dancerColor(index: number): string;
  /** Matches the CSS phone breakpoint (bottom sheets). */
  isPhone(): boolean;
}

/** Re-exported for panel authors. */
export type { ConfirmOptions, NumberField, ToastOptions };

// ─────────────────────────────────────────────────── PANEL FACTORIES ──
//
// Module               Export              Signature                                        Host / mock section
// panels/inspector.ts  mountInspector      (ctx, host) => PanelHandle                       .hud__right  → mock "right: the selected dancer" (.inspector)
// panels/scene.ts      mountScene          (ctx, host) => PanelHandle                       .hud__left (top) → mock "Scene drawer" (.drawer.scene)
// panels/music.ts      mountMusic          (ctx, host) => PanelHandle                       .hud__left (bottom) → mock "Music drawer" (.drawer.music)
// panels/picker.ts     mountPicker         (ctx, host) => PickerHandle                      overlay → mock "Picker modal" (#picker, modal--lg)
// panels/saveDialog.ts mountSaveDialog     (ctx, host) => DialogHandle                      overlay → a modal--md
// panels/libraryDialog.ts mountLibraryDialog (ctx, host) => DialogHandle                   overlay → a modal--lg with a card grid
// panels/shareDialog.ts mountShareDialog   (ctx, host) => DialogHandle                      overlay → a modal--md
// panels/uploads.ts    mountUploads        (ctx, host) => PanelHandle                       overlay → full-window drop target
//
// `host` is a layout-transparent wrapper (display: contents) that the panel
// appends its root element to. Modals created with createModal() attach to the
// overlay automatically, so dialog factories may ignore `host`.

export interface PanelHandle {
  destroy(): void;
}

export interface DialogHandle extends PanelHandle {
  open(): void;
}

export interface PickerHandle extends PanelHandle {
  open(request: PickerRequest): void;
}

export type PanelFactory = (ctx: UiContext, host: HTMLElement) => PanelHandle;
export type DialogFactory = (ctx: UiContext, host: HTMLElement) => DialogHandle;
export type PickerFactory = (ctx: UiContext, host: HTMLElement) => PickerHandle;
