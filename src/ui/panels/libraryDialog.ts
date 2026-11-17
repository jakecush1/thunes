/**
 * "My scenes": the scenes saved on this device as a card grid (cover, title,
 * relative date). Open one (asking first when the stage has dancers), delete
 * one, or start a fresh stage.
 */
import './libraryDialog.css';
import type { SavedScene } from '../../types';
import { createButton, createIconButton } from '../components/button';
import { createCard } from '../components/cards';
import type { CardHandle } from '../components/cards';
import type { IconButtonHandle } from '../components/button';
import { createModal } from '../components/modal';
import type { DialogHandle, UiContext } from '../context';
import { createScope, h, icon } from '../dom';
import { dancerCount, formatRelative } from './libraryDialog/relative';

export function mountLibraryDialog(ctx: UiContext, _host: HTMLElement): DialogHandle {
  const { store, library } = ctx.services;
  const scope = createScope();
  const modal = createModal({ title: 'My scenes', size: 'lg', className: 'library-dialog' });

  const fresh = createButton({ label: 'Start a fresh stage', icon: 'plus', size: 'sm', onClick: () => void startFresh() });
  const intro = h('p', { class: 'library-dialog__intro' });
  const tools = h('div', { class: 'modal__row library-dialog__tools' }, intro, fresh.el);
  modal.head.append(tools);

  const grid = h('ul', { class: 'library-dialog__grid', attrs: { 'aria-label': 'Saved scenes' } });
  const saveNow = createButton({ label: 'Save this scene', icon: 'save', variant: 'primary', onClick: () => { modal.close(); ctx.openSave(); } });
  const empty = h(
    'div',
    { class: 'library-dialog__empty' },
    h('span', { class: 'library-dialog__empty-icon', attrs: { 'aria-hidden': 'true' } }, icon('library', 'lg')),
    h('strong', { text: 'No saved scenes yet' }),
    h('p', { text: 'Save the stage with the Save button in the toolbar and it shows up here.' }),
    saveNow.el,
  );
  modal.body.append(grid, empty);

  let items: { card: CardHandle; remove: IconButtonHandle; li: HTMLLIElement }[] = [];

  const openScene = async (entry: SavedScene) => {
    if (store.getState().dancers.length > 0) {
      const ok = await ctx.confirm({
        title: `Open “${entry.title}”?`,
        message: 'It replaces the dancers and settings on the stage now. Save first if you want to keep them.',
        confirmLabel: 'Open scene',
      });
      if (!ok) return;
    }
    store.loadDocument(entry.document);
    if (store.getState().ui.viewOnly) store.updateUi({ viewOnly: false });
    modal.close();
    ctx.toast(`Opened “${entry.title}”`, { kind: 'ok', id: 'scene-opened' });
  };

  const deleteScene = async (entry: SavedScene) => {
    const ok = await ctx.confirm({
      title: `Delete “${entry.title}”?`,
      message: 'It is removed from this device. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      library.remove(entry.id);
      ctx.toast(`Deleted “${entry.title}”`, { kind: 'ok', id: 'scene-deleted' });
    } catch (err) {
      ctx.toast(`Could not delete it: ${err instanceof Error ? err.message : String(err)}`, { kind: 'error' });
    }
  };

  async function startFresh(): Promise<void> {
    if (store.getState().dancers.length > 0) {
      const ok = await ctx.confirm({
        title: 'Start a fresh stage?',
        message: 'Every dancer leaves the stage. Your saved scenes are kept.',
        confirmLabel: 'Clear the stage',
        danger: true,
      });
      if (!ok) return;
    }
    store.clearDancers();
    modal.close();
    ctx.toast('Fresh stage. Add a dancer to begin.', { kind: 'ok', id: 'fresh-stage', action: { label: 'Undo', run: () => store.undo() } });
  }

  const render = () => {
    for (const item of items) {
      item.card.destroy();
      item.remove.destroy();
    }
    const entries = library.list();
    const now = Date.now();
    items = entries.map((entry) => {
      const when = formatRelative(entry.savedAt, now);
      const card = createCard({
        title: entry.title,
        meta: `${when} · ${dancerCount(entry.document.dancers.length)}`,
        thumb: entry.thumbnail,
        fallbackIcon: 'scene',
        label: `Open ${entry.title}, saved ${when}`,
        onClick: () => void openScene(entry),
      });
      card.el.classList.add('library-dialog__card');
      const remove = createIconButton({
        icon: 'trash',
        label: `Delete ${entry.title}`,
        tip: false,
        size: 'sm',
        round: true,
        className: 'library-dialog__delete',
        onClick: () => void deleteScene(entry),
      });
      const date = new Date(entry.savedAt);
      card.el.title = `Saved ${date.toLocaleString()}`;
      return { card, remove, li: h('li', { class: 'library-dialog__item', attrs: { 'data-id': entry.id } }, card.el, remove.el) };
    });
    grid.replaceChildren(...items.map((i) => i.li));
    grid.hidden = entries.length === 0;
    empty.hidden = entries.length > 0;
    const n = entries.length;
    intro.textContent = n === 0 ? 'Scenes you save stay in this browser on this device.' : `${n} ${n === 1 ? 'scene' : 'scenes'} saved in this browser on this device.`;
  };

  scope.add(
    library.subscribe(() => {
      if (modal.isOpen()) render();
    }),
  );

  return {
    open() {
      render();
      modal.open();
    },
    destroy() {
      scope.dispose();
      for (const item of items) {
        item.card.destroy();
        item.remove.destroy();
      }
      fresh.destroy();
      saveNow.destroy();
      modal.destroy();
    },
  };
}
