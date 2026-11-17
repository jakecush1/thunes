/**
 * Window-wide drag-and-drop of files (characters, dances, music). While files
 * are dragged over the window a full-window overlay says what can be dropped;
 * dropping passes them to registry.addUploads and reports with toasts.
 *
 * The overlay is visual only (pointer-events: none), so dropzones underneath
 * (the music drawer's) still receive their own drops and stop propagation.
 */
import './uploads.css';
import { dragHasFiles } from '../components/dropzone';
import type { PanelHandle, UiContext } from '../context';
import { createScope, h, icon } from '../dom';
import { addFilesWithToasts } from './uploads/add';

export function mountUploads(ctx: UiContext, host: HTMLElement): PanelHandle {
  const scope = createScope();
  const { store } = ctx.services;
  const overlay = h(
    'div',
    { class: 'uploads', attrs: { 'aria-hidden': 'true' } },
    h(
      'div',
      { class: 'uploads__card' },
      h('span', { class: 'uploads__icon' }, icon('upload', 'lg')),
      h('strong', { class: 'uploads__title', text: 'Drop to add' }),
      h('span', { class: 'uploads__text', text: 'Characters (GLB, GLTF, FBX), dances (GLB, FBX, BVH) and music (MP3, WAV, OGG). They stay on this device.' }),
    ),
  );
  overlay.hidden = true;
  host.append(overlay);

  /** Uploads only make sense once the stage is open for editing. */
  const accepting = () => {
    const ui = store.getState().ui;
    return ui.entered && !ui.viewOnly;
  };

  let depth = 0;
  const show = (on: boolean) => {
    overlay.hidden = !on;
    overlay.classList.toggle('is-active', on);
  };
  const reset = () => {
    depth = 0;
    show(false);
  };

  scope.on(window, 'dragenter', (event) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    depth++;
    if (accepting()) show(true);
  });
  scope.on(window, 'dragover', (event) => {
    if (!dragHasFiles(event)) return;
    // Always cancel, so a stray drop never navigates away from the app.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = accepting() ? 'copy' : 'none';
  });
  scope.on(window, 'dragleave', (event) => {
    if (!dragHasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    // Leaving the window entirely reports a null relatedTarget.
    if (depth === 0 || event.relatedTarget === null) reset();
  });
  // Capture phase: hide the overlay even when a dropzone handles the drop itself.
  scope.on(window, 'drop', () => reset(), { capture: true });
  scope.on(window, 'dragend', () => reset());
  scope.on(window, 'drop', (event) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    if (!accepting()) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) void addFilesWithToasts(ctx, files);
  });

  return {
    destroy() {
      scope.dispose();
      overlay.remove();
    },
  };
}
