/**
 * Picker modal: choose a character and/or a dance. Mock section: "Picker
 * modal" (#picker, modal--lg).
 *
 *   head    Characters | Dances tabs (with counts), search, close; category chips
 *   body    upload report, card grid (upload card first; thumbnails load as cards scroll into view)
 *   foot    what the choice will do, Cancel, the primary action
 *
 * Purposes (PickerRequest):
 *   add    pick a character (and optionally a dance) for a new dancer; the dance
 *          defaults to the last one used on stage, else FALLBACK_DANCE_ID;
 *   swap   pick a new character for `dancerId` (every setting is kept);
 *   dance  pick a new dance for `dancerId`.
 * A click selects a card; clicking the selected card again (or a double-click,
 * or the primary button) confirms.
 */
import './picker.css';
import { CHARACTER_EXTENSIONS, DANCE_EXTENSIONS } from '../../assets/formats';
import { FALLBACK_DANCE_ID, MAX_DANCERS } from '../../config';
import type { CharacterDef, DanceDef, DancerState, UploadReport } from '../../types';
import { createButton, createIconButton } from '../components/button';
import { createCard, createUploadCard } from '../components/cards';
import type { CardHandle } from '../components/cards';
import { createChips, createTextField } from '../components/choice';
import { createModal } from '../components/modal';
import { createTabs } from '../components/tabs';
import type { PickerHandle, PickerRequest, UiContext } from '../context';
import { append, createScope, h, icon } from '../dom';
import { ALL, categoryOptions, filterItems, isUpload, lastUsedDance, summarizeUpload } from './picker/model';

type PickerTab = 'characters' | 'dances';

interface GridEntry {
  id: string;
  card: CardHandle;
  /** Starts loading the thumbnail (called once, when the card scrolls into view). */
  load: () => void;
  extra: { destroy(): void }[];
}

const accept = (extensions: readonly string[]) => extensions.map((e) => `.${e}`).join(',');

export function mountPicker(ctx: UiContext, _host: HTMLElement): PickerHandle {
  const { store, registry, thumbnails } = ctx.services;
  const scope = createScope();

  let request: PickerRequest = { purpose: 'add' };
  /** The choice so far: character and dance ids (null = nothing chosen yet). */
  const pending: Record<PickerTab, string | null> = { characters: null, dances: null };
  const category: Record<PickerTab, string> = { characters: ALL, dances: ALL };
  let query = '';
  let rememberedDance: string | null = null;

  const modal = createModal({ label: 'Pick a character or a dance', size: 'lg', closeButton: true, className: 'picker', onClose: () => clearReport() });
  const closeButton = modal.headRow.querySelector<HTMLElement>('.modal__close');
  closeButton?.classList.add('picker__close');
  closeButton?.setAttribute('aria-label', 'Close picker');

  // ── Head ──
  const tabs = createTabs<PickerTab>({
    label: 'Library',
    size: 'lg',
    value: 'characters',
    tabs: [
      { id: 'characters', label: 'Characters' },
      { id: 'dances', label: 'Dances' },
    ],
    onChange: () => {
      renderChips();
      updateFoot();
    },
  });
  const search = createTextField({
    label: 'Search',
    type: 'search',
    icon: 'search',
    placeholder: 'Search by name or style',
    className: 'picker__search',
    onInput: (value) => {
      query = value;
      renderGrid('characters');
      renderGrid('dances');
    },
  });
  modal.headRow.prepend(tabs.el);
  modal.headRow.insertBefore(search.el, closeButton ?? null);
  const chips = createChips<string>({
    label: 'Category',
    options: [],
    value: ALL,
    scroll: true,
    className: 'picker__chips',
    onChange: (values) => {
      const tab = tabs.value();
      category[tab] = values[0] ?? ALL;
      renderGrid(tab);
    },
  });
  modal.head.append(h('div', { class: 'modal__row' }, chips.el));

  // ── Body ──
  const reportEl = h('div', { class: 'picker__report', attrs: { role: 'status', 'aria-live': 'polite' } });
  reportEl.hidden = true;
  const grids: Record<PickerTab, HTMLElement> = {
    characters: h('div', { class: 'card-grid', attrs: { role: 'group', 'aria-label': 'Characters' } }),
    dances: h('div', { class: 'card-grid', attrs: { role: 'group', 'aria-label': 'Dances' } }),
  };
  tabs.panels.characters.append(grids.characters);
  tabs.panels.dances.append(grids.dances);
  modal.body.append(reportEl, tabs.panels.characters, tabs.panels.dances);

  const fileInput = h('input', { class: 'sr-only', attrs: { type: 'file', multiple: true, tabindex: -1, 'aria-hidden': 'true' } });
  modal.dialog.append(fileInput);
  const uploadCards: Record<PickerTab, { el: HTMLButtonElement; destroy(): void }> = {
    characters: createUploadCard({ title: 'Upload your own', meta: '.glb, .gltf or .fbx · humanoid rig', onClick: () => chooseFiles('characters') }),
    dances: createUploadCard({ title: 'Upload a dance', meta: '.glb, .fbx, .bvh or .json animation', onClick: () => chooseFiles('dances') }),
  };

  // ── Foot ──
  const hintText = h('span');
  modal.hint.append(icon('info', 'sm'), hintText);
  const cancel = createButton({ label: 'Cancel', variant: 'ghost', onClick: () => modal.close() });
  const primary = createButton({ label: 'Add to the floor', variant: 'primary', onClick: () => confirmChoice() });
  primary.el.classList.add('picker__confirm');
  modal.actions.append(cancel.el, primary.el);

  // ── Lazy thumbnails ──
  const loaders = new WeakMap<Element, () => void>();
  const observer =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
          (records) => {
            for (const record of records) {
              if (!record.isIntersecting) continue;
              observer?.unobserve(record.target);
              loaders.get(record.target)?.();
              loaders.delete(record.target);
            }
          },
          { root: modal.body, rootMargin: '200px 0px' },
        )
      : null;
  scope.add(() => observer?.disconnect());

  // ── Grids ──
  const entries: Record<PickerTab, GridEntry[]> = { characters: [], dances: [] };
  const listFor = (tab: PickerTab): (CharacterDef | DanceDef)[] => (tab === 'characters' ? registry.listCharacters() : registry.listDances());
  const metaFor = (tab: PickerTab, def: CharacterDef | DanceDef): string => {
    const base = isUpload(def) ? 'Your upload' : (def.category ?? '');
    if (tab === 'dances') {
      const dance = def as DanceDef;
      const length = dance.beats ? `${dance.beats} beats` : '';
      return [base, length].filter(Boolean).join(' · ');
    }
    return base;
  };

  function clearGrid(tab: PickerTab): void {
    for (const entry of entries[tab]) {
      observer?.unobserve(entry.card.el);
      entry.card.destroy();
      for (const extra of entry.extra) extra.destroy();
    }
    entries[tab] = [];
  }

  function renderGrid(tab: PickerTab): void {
    // Keep keyboard focus when the cards are rebuilt under it.
    const active = document.activeElement instanceof HTMLElement && grids[tab].contains(document.activeElement) ? document.activeElement : null;
    const focusedId = active?.closest<HTMLElement>('[data-id]')?.dataset.id ?? null;
    clearGrid(tab);
    const all = listFor(tab);
    const items = filterItems(all, category[tab], query);
    const nodes: HTMLElement[] = [uploadCards[tab].el];
    items.forEach((def, index) => {
      const card = createCard({
        title: def.name,
        meta: metaFor(tab, def),
        fallbackIcon: 'figure',
        color: tab === 'characters' ? ctx.dancerColor(all.indexOf(def)) : ctx.dancerColor(index + 3),
        selected: def.id === pending[tab],
        onClick: () => choose(tab, def.id),
      });
      card.el.dataset.id = def.id;
      const load = () => card.setThumb(tab === 'characters' ? thumbnails.character(def.id) : thumbnails.dance(def.id));
      const entry: GridEntry = { id: def.id, card, load, extra: [] };
      if (observer) {
        loaders.set(card.el, load);
        observer.observe(card.el);
      } else {
        load();
      }
      if (isUpload(def)) {
        const remove = createIconButton({
          icon: 'trash',
          label: `Delete ${def.name}`,
          tip: false,
          size: 'sm',
          variant: 'ghost',
          round: true,
          className: 'picker__delete',
          onClick: () => void deleteUpload(def),
        });
        entry.extra.push(remove);
        nodes.push(h('div', { class: 'picker__item' }, card.el, remove.el));
      } else {
        nodes.push(card.el);
      }
      entries[tab].push(entry);
    });
    if (items.length === 0) {
      const what = tab === 'characters' ? 'characters' : 'dances';
      nodes.push(h('p', { class: 'card-grid__empty', text: query.trim() ? `No ${what} match “${query.trim()}”.` : `No ${what} in this category yet.` }));
    }
    grids[tab].replaceChildren(...nodes);
    if (active && !active.isConnected) {
      const again = entries[tab].find((e) => e.id === focusedId)?.card.el ?? uploadCards[tab].el;
      again.focus({ preventScroll: true });
    }
  }

  function renderChips(): void {
    const tab = tabs.value();
    const options = categoryOptions(listFor(tab));
    if (!options.some((o) => o.value === category[tab])) category[tab] = ALL;
    chips.setOptions(
      options.map((o) => ({ value: o.value, label: o.label, count: o.count })),
      category[tab],
    );
  }

  function renderAll(): void {
    tabs.setCount('characters', registry.listCharacters().length);
    tabs.setCount('dances', registry.listDances().length);
    for (const tab of ['characters', 'dances'] as const) {
      const ids = new Set(listFor(tab).map((d) => d.id));
      if (pending[tab] !== null && !ids.has(pending[tab])) pending[tab] = null;
      renderGrid(tab);
    }
    renderChips();
    updateFoot();
  }

  // ── Choosing ──
  const target = (): DancerState | undefined =>
    request.dancerId === undefined ? undefined : store.getState().dancers.find((d) => d.id === request.dancerId);

  function choose(tab: PickerTab, id: string): void {
    if (pending[tab] === id) {
      confirmChoice();
      return;
    }
    pending[tab] = id;
    for (const entry of entries[tab]) entry.card.setSelected(entry.id === id);
    updateFoot();
  }

  function updateFoot(): void {
    const character = pending.characters ? registry.getCharacter(pending.characters) : undefined;
    const dance = pending.dances ? registry.getDance(pending.dances) : undefined;
    const count = store.getState().dancers.length;
    if (request.purpose === 'add') {
      hintText.textContent = character
        ? `Adding dancer ${count + 1} of ${MAX_DANCERS}${dance ? `, dancing ${dance.name}` : ''}. Any dance fits any humanoid rig.`
        : `Adding dancer ${count + 1} of ${MAX_DANCERS}. Pick a character; any dance fits any humanoid rig.`;
      primary.setLabel(character ? `Add ${character.name} to the floor` : 'Pick a character');
      primary.setDisabled(!character);
      return;
    }
    const dancer = target();
    const index = dancer ? store.getState().dancers.indexOf(dancer) + 1 : 0;
    const swapCharacter = dancer !== undefined && character !== undefined && character.id !== dancer.characterId;
    const swapDance = dancer !== undefined && dance !== undefined && dance.id !== dancer.danceId;
    if (request.purpose === 'swap') {
      hintText.textContent = `Swapping the character of dancer ${index} keeps every setting.`;
    } else {
      hintText.textContent = `Choosing a dance for dancer ${index}. Double-click a card to use it straight away.`;
    }
    if (swapCharacter && swapDance) primary.setLabel('Apply both');
    else if (swapCharacter) primary.setLabel(`Swap to ${character.name}`);
    else if (swapDance) primary.setLabel(`Dance ${dance.name}`);
    else primary.setLabel(request.purpose === 'swap' ? 'Swap character' : 'Change dance');
    primary.setDisabled(!swapCharacter && !swapDance);
  }

  function stageFull(): void {
    ctx.toast(`The stage is full: ${MAX_DANCERS} dancers at most. Remove one to add another.`, { kind: 'warn', id: 'stage-full' });
  }

  function confirmChoice(): void {
    if (request.purpose === 'add') {
      const characterId = pending.characters;
      if (!characterId) {
        tabs.select('characters', true);
        return;
      }
      const danceId = pending.dances && registry.getDance(pending.dances) ? pending.dances : FALLBACK_DANCE_ID;
      const added = store.addDancer({ characterId, danceId });
      modal.close();
      if (!added) stageFull();
      return;
    }
    const dancer = target();
    if (!dancer) {
      modal.close();
      ctx.toast('That dancer has left the stage.', { kind: 'warn' });
      return;
    }
    const patch: { characterId?: string; danceId?: string } = {};
    if (pending.characters && pending.characters !== dancer.characterId) patch.characterId = pending.characters;
    if (pending.dances && pending.dances !== dancer.danceId) patch.danceId = pending.dances;
    if (patch.characterId !== undefined || patch.danceId !== undefined) store.updateDancer(dancer.id, patch);
    modal.close();
  }

  // ── Uploads ──
  let uploadTab: PickerTab = 'characters';
  function chooseFiles(tab: PickerTab): void {
    uploadTab = tab;
    fileInput.accept = accept(tab === 'characters' ? CHARACTER_EXTENSIONS : DANCE_EXTENSIONS);
    fileInput.click();
  }
  scope.on(fileInput, 'change', () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = '';
    if (files.length > 0) void upload(files, uploadTab);
  });

  function clearReport(): void {
    reportEl.hidden = true;
    reportEl.replaceChildren();
  }

  function showReport(summary: string, report: UploadReport | null): void {
    const dismiss = h('button', { class: 'btn btn--icon btn--sm btn--ghost btn--round', attrs: { type: 'button', 'aria-label': 'Dismiss upload report' } }, icon('close', 'sm'));
    dismiss.addEventListener('click', () => clearReport());
    const added = report ? [...report.characters.map((c) => `Character: ${c.name}`), ...report.dances.map((d) => `Dance: ${d.name}`), ...report.songs.map((s) => `Song: ${s.title}`)] : [];
    reportEl.replaceChildren();
    append(
      reportEl,
      h('div', { class: 'picker__report-head' }, icon(report && report.problems.length > 0 ? 'warn' : 'upload', 'sm'), h('strong', { text: summary }), dismiss),
      added.length > 0 ? h('ul', { class: 'picker__report-list' }, ...added.map((line) => h('li', { text: line }))) : null,
      report && report.problems.length > 0
        ? h(
            'ul',
            { class: 'picker__report-list picker__report-list--problems' },
            ...report.problems.map((p) => h('li', {}, h('b', { text: p.file }), ` ${p.reason}`)),
          )
        : null,
    );
    reportEl.hidden = false;
  }

  async function upload(files: File[], tab: PickerTab): Promise<void> {
    showReport(`Adding ${files.length === 1 ? files[0]!.name : `${files.length} files`}…`, null);
    let report: UploadReport;
    try {
      report = await registry.addUploads(files);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report = { characters: [], dances: [], songs: [], problems: files.map((f) => ({ file: f.name, reason: message })) };
    }
    const summary = summarizeUpload(report);
    showReport(summary, report);
    ctx.toast(summary, { kind: report.problems.length > 0 ? 'warn' : 'ok', id: 'picker-upload' });
    // Select what arrived, so the primary button uses it.
    const firstCharacter = report.characters[0];
    const firstDance = report.dances[0];
    if (firstCharacter && (request.purpose !== 'dance' || tab === 'characters')) pending.characters = firstCharacter.id;
    if (firstDance && (request.purpose !== 'swap' || tab === 'dances')) pending.dances = firstDance.id;
    if (modal.isOpen()) renderAll();
  }

  async function deleteUpload(def: CharacterDef | DanceDef): Promise<void> {
    const ok = await ctx.confirm({
      title: `Delete ${def.name}?`,
      message: 'It is removed from this device. Dancers that use it switch to a placeholder.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await registry.removeUpload(def.id);
      ctx.toast(`${def.name} deleted.`, { kind: 'ok', id: 'picker-delete' });
    } catch (error) {
      ctx.toast(error instanceof Error ? error.message : 'Could not delete that file.', { kind: 'error' });
    }
  }

  // ── Keyboard: arrow keys move between cards ──
  scope.on(modal.body, 'keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const current = (event.target as Element | null)?.closest<HTMLElement>('.card');
    const grid = current?.closest<HTMLElement>('.card-grid');
    if (!current || !grid) return;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('.card'));
    const index = cards.indexOf(current);
    const top = cards[0]?.offsetTop ?? 0;
    const columns = Math.max(1, cards.filter((c) => c.offsetTop === top).length);
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key] ?? 0;
    const next = cards[index + step];
    if (!next) return;
    event.preventDefault();
    next.focus();
  });
  // Enter in the search box selects the first match.
  scope.on(search.input, 'keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const first = entries[tabs.value()][0];
    if (first) {
      choose(tabs.value(), first.id);
      first.card.el.focus();
    }
  });

  // ── Catalogue and stage ──
  scope.add(
    registry.subscribe(() => {
      // Closed: open() re-renders anyway.
      if (modal.isOpen()) renderAll();
    }),
  );
  scope.add(
    ctx.watch(
      (s) => s.dancers,
      (dancers, previous) => {
        rememberedDance = lastUsedDance(previous, dancers, rememberedDance);
        if (modal.isOpen()) {
          if (request.purpose !== 'add' && !target()) modal.close();
          else updateFoot();
        }
      },
    ),
  );

  return {
    open(next) {
      const state = store.getState();
      if (next.purpose === 'add' && state.dancers.length >= MAX_DANCERS) {
        stageFull();
        return;
      }
      const dancer = next.dancerId === undefined ? undefined : state.dancers.find((d) => d.id === next.dancerId);
      if (next.purpose !== 'add' && !dancer) return;
      request = next;
      if (dancer && next.purpose !== 'add') {
        pending.characters = dancer.characterId;
        pending.dances = dancer.danceId;
      } else {
        pending.characters = null;
        pending.dances = rememberedDance && registry.getDance(rememberedDance) ? rememberedDance : FALLBACK_DANCE_ID;
      }
      query = '';
      search.set('');
      category.characters = ALL;
      category.dances = ALL;
      clearReport();
      const tab: PickerTab = next.purpose === 'dance' ? 'dances' : 'characters';
      tabs.select(tab);
      renderAll();
      // Focus the current choice, else the first card.
      for (const el of modal.dialog.querySelectorAll('[data-autofocus]')) el.removeAttribute('data-autofocus');
      const focusEntry = entries[tab].find((e) => e.id === pending[tab]) ?? entries[tab][0];
      focusEntry?.card.el.setAttribute('data-autofocus', '');
      modal.open();
      focusEntry?.card.el.scrollIntoView({ block: 'nearest' });
    },
    destroy() {
      scope.dispose();
      clearGrid('characters');
      clearGrid('dances');
      uploadCards.characters.destroy();
      uploadCards.dances.destroy();
      tabs.destroy();
      search.destroy();
      chips.destroy();
      cancel.destroy();
      primary.destroy();
      modal.destroy();
    },
  };
}
