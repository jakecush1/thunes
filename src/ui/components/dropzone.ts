/**
 * Dropzone (.dropzone): a button that opens a file chooser and accepts files
 * dragged onto it. Window-wide drag-and-drop belongs to panels/uploads.ts.
 */
import { createScope, h, icon } from '../dom';
import type { IconName } from '../dom';

export interface DropzoneOptions {
  title: string;
  text?: string;
  /** File input accept list, e.g. '.mp3,.wav,.ogg,audio/*'. */
  accept?: string;
  multiple?: boolean;
  icon?: IconName;
  className?: string;
  onFiles: (files: File[]) => void;
}

export interface DropzoneHandle {
  el: HTMLElement;
  /** Open the file chooser programmatically. */
  browse(): void;
  destroy(): void;
}

/** True when a drag carries files (not text or links). */
export function dragHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export function createDropzone(options: DropzoneOptions): DropzoneHandle {
  const scope = createScope();
  const input = h('input', {
    class: 'sr-only',
    attrs: { type: 'file', accept: options.accept, multiple: options.multiple ?? true, tabindex: -1, 'aria-hidden': 'true' },
  });
  const button = h(
    'button',
    { class: ['dropzone', options.className], attrs: { type: 'button' } },
    h('span', { class: 'dropzone__icon', attrs: { 'aria-hidden': 'true' } }, icon(options.icon ?? 'upload')),
    h('span', {}, h('strong', { text: options.title }), options.text ? h('small', { text: options.text }) : null),
  );
  const el = h('div', { class: 'dropzone-wrap' }, button, input);
  const browse = () => input.click();
  scope.on(button, 'click', browse);
  scope.on(input, 'change', () => {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) options.onFiles(files);
  });
  let depth = 0;
  scope.on(button, 'dragenter', (event) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    depth++;
    button.classList.add('is-over');
  });
  scope.on(button, 'dragover', (event) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  scope.on(button, 'dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) button.classList.remove('is-over');
  });
  scope.on(button, 'drop', (event) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    // Handled here: the window-wide drop target must not process it again.
    event.stopPropagation();
    depth = 0;
    button.classList.remove('is-over');
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) options.onFiles(files);
  });
  return { el, browse, destroy: () => scope.dispose() };
}
