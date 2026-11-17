/**
 * Save dialog: pick one of three covers (the current view and two other
 * angles), name the scene, and save it to "My scenes" on this device.
 */
import './saveDialog.css';
import type { CameraPose } from '../../types';
import { createButton } from '../components/button';
import { createTextField } from '../components/choice';
import { createModal } from '../components/modal';
import type { DialogHandle, UiContext } from '../context';
import { createScope, h, uniqueId } from '../dom';
import { alternativeAngles, COVER, TITLE_MAX, validateTitle } from './saveDialog/angles';

/** Data URLs longer than this are re-encoded at a lower quality (the library rejects > 200 000). */
const COVER_BUDGET = 150_000;
const COVER_LABELS = ['Current view', 'From the side', 'Up close'] as const;

export function mountSaveDialog(ctx: UiContext, _host: HTMLElement): DialogHandle {
  const { store, stage, library } = ctx.services;
  const scope = createScope();
  const modal = createModal({ title: 'Save scene', size: 'md', className: 'save-dialog' });

  const titleField = createTextField({ label: 'Name', visibleLabel: true, maxLength: TITLE_MAX, placeholder: 'My dance party' });
  titleField.input.setAttribute('data-autofocus', '');
  const counter = h('span', { class: 'save-dialog__count', attrs: { 'aria-hidden': 'true' } });
  const error = h('p', { class: 'save-dialog__error', attrs: { role: 'alert' } });
  error.hidden = true;
  const errorId = uniqueId('save-error');
  error.id = errorId;

  const coverLabelId = uniqueId('save-cover');
  const coverName = uniqueId('cover');
  const covers = COVER_LABELS.map((label, index) => {
    const input = h('input', { class: 'sr-only', attrs: { type: 'radio', name: coverName, value: String(index), 'aria-label': label } });
    const img = h('img', { class: 'save-dialog__img', attrs: { alt: '', width: COVER.width, height: COVER.height, draggable: 'false' } });
    const el = h('label', { class: 'save-dialog__cover' }, input, h('span', { class: 'save-dialog__frame' }, img), h('span', { class: 'save-dialog__caption', text: label }));
    return { input, img, el, src: '' };
  });
  const coverGrid = h('div', { class: 'save-dialog__covers', attrs: { role: 'radiogroup', 'aria-labelledby': coverLabelId } }, ...covers.map((c) => c.el));

  modal.body.append(
    h('div', { class: 'save-dialog__name' }, titleField.el, counter),
    h('div', { class: 'save-dialog__section' }, h('span', { class: 'field-label', attrs: { id: coverLabelId }, text: 'Cover' }), coverGrid),
    error,
  );
  modal.hint.textContent = 'Saved in this browser, on this device.';
  const cancel = createButton({ label: 'Cancel', variant: 'ghost', onClick: () => modal.close() });
  const save = createButton({ label: 'Save', icon: 'save', variant: 'primary', onClick: () => submit() });
  save.el.classList.add('save-dialog__save');
  modal.actions.append(cancel.el, save.el);

  const showError = (message: string | null) => {
    error.textContent = message ?? '';
    error.hidden = message === null;
    if (message === null) titleField.input.removeAttribute('aria-describedby');
    else titleField.input.setAttribute('aria-describedby', errorId);
  };
  const updateCount = () => {
    counter.textContent = `${titleField.input.value.length}/${TITLE_MAX}`;
    const valid = validateTitle(titleField.input.value).ok;
    save.setDisabled(!valid);
  };
  scope.on(titleField.input, 'input', () => {
    updateCount();
    if (!error.hidden) showError(null);
  });
  scope.on(titleField.input, 'keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });

  const capture = (camera?: CameraPose): string => {
    try {
      let url = stage.capture({ ...COVER, ...(camera ? { camera } : {}) });
      if (url.length > COVER_BUDGET) url = stage.capture({ ...COVER, quality: 0.6, ...(camera ? { camera } : {}) });
      if (url.length > COVER_BUDGET) url = stage.capture({ ...COVER, quality: 0.4, ...(camera ? { camera } : {}) });
      return url.startsWith('data:image/') ? url : '';
    } catch (err) {
      console.warn('[save] capture failed', err);
      return '';
    }
  };

  function selectedCover(): string {
    const chosen = covers.find((c) => c.input.checked && c.src) ?? covers.find((c) => c.src);
    return chosen?.src ?? '';
  }

  function submit(): void {
    const check = validateTitle(titleField.input.value);
    if (!check.ok) {
      showError(check.error);
      titleField.focus();
      return;
    }
    const thumbnail = selectedCover();
    if (!thumbnail) {
      showError('The cover image could not be made. Try again in a moment.');
      return;
    }
    try {
      store.setTitle(check.title);
      const saved = library.save({ title: check.title, thumbnail, document: store.getDocument() });
      modal.close();
      ctx.toast(`Saved “${saved.title}” on this device`, {
        kind: 'ok',
        id: 'scene-saved',
        action: { label: 'Open My scenes', run: () => ctx.openLibrary() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showError(message);
      ctx.toast(`Not saved: ${message}`, { kind: 'error', id: 'scene-save-error' });
    }
  }

  return {
    open() {
      if (modal.isOpen()) return;
      showError(null);
      const title = store.getState().title.trim();
      titleField.set(title.slice(0, TITLE_MAX));
      updateCount();
      const live = stage.getCameraPose();
      const [side, close] = alternativeAngles(live);
      const sources = [capture(), capture(side), capture(close)];
      covers.forEach((cover, i) => {
        cover.src = sources[i] ?? '';
        cover.img.src = cover.src || '';
        cover.el.classList.toggle('is-empty', !cover.src);
        cover.input.disabled = !cover.src;
        cover.input.checked = i === 0;
      });
      modal.open();
      titleField.input.select();
    },
    destroy() {
      scope.dispose();
      titleField.destroy();
      cancel.destroy();
      save.destroy();
      modal.destroy();
    },
  };
}
