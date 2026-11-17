/**
 * Share dialog: a link that opens this scene (in view-only mode until the
 * visitor remixes it), with a Copy button, the link's length, and a warning
 * when the scene uses uploads that exist only on this device.
 */
import './shareDialog.css';
import { buildShareUrl } from '../../core/serialize';
import { createButton } from '../components/button';
import { createTextField } from '../components/choice';
import { createModal } from '../components/modal';
import type { DialogHandle, UiContext } from '../context';
import { createScope, h, icon } from '../dom';
import { describeLinkLength, findUploadedAssets, hasUploads, uploadWarning } from './shareDialog/assets';

export function mountShareDialog(ctx: UiContext, _host: HTMLElement): DialogHandle {
  const { store, registry } = ctx.services;
  const scope = createScope();
  const modal = createModal({ title: 'Share this scene', size: 'md', className: 'share-dialog' });

  const linkField = createTextField({ label: 'Share link', readOnly: true, selectOnFocus: true, icon: 'link', className: 'share-dialog__field' });
  const copy = createButton({ label: 'Copy', icon: 'link', variant: 'primary', className: 'share-dialog__copy', onClick: () => void copyLink() });
  const length = h('p', { class: 'share-dialog__length' });
  const copied = h('p', { class: 'share-dialog__status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const warningText = h('span');
  const warning = h('p', { class: 'callout share-dialog__warning', attrs: { role: 'note' } }, icon('warn', 'sm'), warningText);
  warning.hidden = true;
  const errorText = h('p', { class: 'share-dialog__error', attrs: { role: 'alert' } });
  errorText.hidden = true;

  modal.body.append(
    h('p', { class: 'modal__text', text: 'Anyone with this link sees your stage exactly as it is now: dancers, moves, scene and song. They can watch it, or remix it into their own.' }),
    h('div', { class: 'share-dialog__row' }, linkField.el, copy.el),
    h('div', { class: 'share-dialog__meta' }, length, copied),
    warning,
    errorText,
  );
  modal.hint.textContent = 'The scene lives in the link itself; nothing is uploaded.';
  const done = createButton({ label: 'Done', variant: 'ghost', onClick: () => modal.close() });
  modal.actions.append(done.el);

  let url = '';
  let token = 0;

  async function copyLink(): Promise<void> {
    if (!url) return;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      // Fallback: select the field and use the legacy copy command.
      linkField.input.focus();
      linkField.input.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
    }
    if (ok) {
      copied.textContent = 'Copied to the clipboard.';
      copy.setLabel('Copied');
      copy.setIcon('check');
      ctx.toast('Link copied', { kind: 'ok', id: 'share-copied' });
    } else {
      linkField.input.focus();
      linkField.input.select();
      const key = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘C' : 'Ctrl+C';
      copied.textContent = `Copying is blocked here. The link is selected: press ${key} to copy it.`;
    }
  }

  const prepare = async () => {
    const mine = ++token;
    url = '';
    linkField.set('Building the link…');
    copy.setDisabled(true);
    copy.setLabel('Copy');
    copy.setIcon('link');
    copied.textContent = '';
    length.textContent = '';
    errorText.hidden = true;
    const doc = store.getDocument();
    const refs = findUploadedAssets(doc);
    warning.hidden = !hasUploads(refs);
    if (!warning.hidden) {
      warningText.textContent = uploadWarning({
        characters: refs.characters.map((id) => registry.getCharacter(id)?.name ?? 'a missing character'),
        dances: refs.dances.map((id) => registry.getDance(id)?.name ?? 'a missing dance'),
        songs: refs.songs.map((id) => registry.getSong(id)?.title ?? 'a missing song'),
      });
    }
    try {
      const built = await buildShareUrl(doc, location.href);
      if (mine !== token) return;
      url = built;
      linkField.set(built);
      const info = describeLinkLength(built.length);
      length.textContent = info.text;
      length.classList.toggle('is-long', info.long);
      copy.setDisabled(false);
      // The dialog opened with focus on the (then empty) field: move it to Copy.
      if (modal.isOpen() && (document.activeElement === linkField.input || !modal.dialog.contains(document.activeElement))) copy.el.focus();
    } catch (err) {
      if (mine !== token) return;
      linkField.set('');
      errorText.textContent = `The link could not be made: ${err instanceof Error ? err.message : String(err)}`;
      errorText.hidden = false;
    }
  };

  return {
    open() {
      modal.open();
      void prepare();
    },
    destroy() {
      token++;
      scope.dispose();
      linkField.destroy();
      copy.destroy();
      done.destroy();
      modal.destroy();
    },
  };
}
