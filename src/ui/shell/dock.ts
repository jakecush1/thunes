/**
 * The dock: eight dancer pads (.slotbar > .slot) following state.dancers.
 * A filled pad selects its dancer; an empty pad opens the picker to add one.
 */
import { MAX_DANCERS } from '../../config';
import type { DancerState } from '../../types';
import { createThumb } from '../components/cards';
import type { ThumbHandle } from '../components/cards';
import type { UiContext } from '../context';
import { createScope, h, icon } from '../dom';

export interface DockHandle {
  el: HTMLElement;
  destroy(): void;
}

interface Pad {
  button: HTMLButtonElement;
  /** What the pad currently shows, to skip needless DOM work. */
  key: string;
  thumb: ThumbHandle | null;
}

/** Short label for a pad: the dance name. */
function padKey(dancer: DancerState | undefined, index: number, selected: boolean, next: boolean): string {
  return dancer ? `${index}|${dancer.id}|${dancer.characterId}|${dancer.danceId}|${selected}` : `empty|${index}|${next}`;
}

export function createDock(ctx: UiContext): DockHandle {
  const scope = createScope();
  const { store, registry, thumbnails } = ctx.services;
  const nav = h('nav', { class: 'bar slotbar', attrs: { 'aria-label': 'Dancers' } });
  const pads: Pad[] = [];

  for (let i = 0; i < MAX_DANCERS; i++) {
    const button = h('button', { class: 'slot', attrs: { type: 'button', 'data-slot': i } });
    const index = i;
    scope.on(button, 'click', () => {
      const dancer = store.getState().dancers[index];
      if (dancer) store.select(dancer.id);
      else ctx.openPicker({ purpose: 'add' });
    });
    nav.append(button);
    pads.push({ button, key: '', thumb: null });
  }

  const render = () => {
    const state = store.getState();
    const count = state.dancers.length;
    pads.forEach((pad, i) => {
      const dancer = state.dancers[i];
      const selected = dancer !== undefined && dancer.id === state.ui.selectedId;
      const key = padKey(dancer, i, selected, count === 0 && i === 0);
      if (key === pad.key) return;
      pad.key = key;
      pad.thumb?.destroy();
      pad.thumb = null;
      const { button } = pad;
      if (!dancer) {
        button.className = ['slot', 'slot--empty', count === 0 && i === 0 && 'slot--next'].filter(Boolean).join(' ');
        button.style.removeProperty('--c');
        button.removeAttribute('aria-pressed');
        button.setAttribute('aria-label', `Add a dancer to pad ${i + 1}`);
        button.replaceChildren(icon('plus'));
        return;
      }
      const character = registry.getCharacter(dancer.characterId);
      const dance = registry.getDance(dancer.danceId);
      const characterName = character?.name ?? 'Missing character';
      const danceName = dance?.name ?? 'Missing dance';
      button.className = selected ? 'slot is-selected' : 'slot';
      button.style.setProperty('--c', ctx.dancerColor(i));
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-label', `Dancer ${i + 1}: ${characterName}, ${danceName}`);
      const thumb = createThumb('slot__thumb', 'figure');
      thumb.set(thumbnails.character(dancer.characterId));
      pad.thumb = thumb;
      button.replaceChildren(
        h('span', { class: 'slot__num', attrs: { 'aria-hidden': 'true' }, text: String(i + 1) }),
        h('span', { class: 'slot__led', attrs: { 'aria-hidden': 'true' } }),
        thumb.el,
        h('span', { class: 'slot__label', attrs: { 'aria-hidden': 'true' }, text: danceName }),
      );
    });
  };

  scope.add(ctx.watch((s) => [s.dancers, s.ui.selectedId] as const, render, { equals: (a, b) => a[0] === b[0] && a[1] === b[1] }));
  // Names can change when the catalogue does (uploads, library discovery).
  scope.add(
    registry.subscribe(() => {
      for (const pad of pads) pad.key = '';
      render();
    }),
  );

  const el = h('div', { class: 'hud__dock' }, nav);
  return {
    el,
    destroy() {
      for (const pad of pads) pad.thumb?.destroy();
      scope.dispose();
    },
  };
}
