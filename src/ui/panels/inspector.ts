/**
 * Inspector (right column; bottom sheet on phones): the selected dancer.
 * Mock section: "right: the selected dancer" (.inspector).
 *
 *   header   character thumbnail + name, "Dancer n of m", Swap / Clone / Remove, close
 *   Dance    quick dance chooser (always visible on desktop, first tab on phones)
 *   tabs     Move · Motion · Look · Body · Warp, each with a reset action
 *
 * Every edit goes through the store: slider drags are transient updates
 * closed by one commit (one undo step per gesture); the controls follow the
 * store, so dragging a dancer on stage moves the sliders live.
 */
import './inspector.css';
import { DANCER_DEFAULTS, DANCER_LOOK_FIELDS, MAX_DANCERS } from '../../config';
import type { Axis, DancerSettings, DancerState, WarpMode } from '../../types';
import { createButton, createIconButton } from '../components/button';
import type { ButtonHandle } from '../components/button';
import { createThumb } from '../components/cards';
import type { ThumbHandle } from '../components/cards';
import { createChips, createSegmented, createToggle } from '../components/choice';
import type { ChipsHandle, SegmentedHandle, ToggleHandle } from '../components/choice';
import { createSlider } from '../components/slider';
import type { SliderHandle } from '../components/slider';
import { createSwatches } from '../components/swatches';
import { createTabs } from '../components/tabs';
import type { PanelHandle, UiContext } from '../context';
import { createScope, h, icon, PHONE_QUERY, uniqueId } from '../dom';
import { selectSelectedDancer, shallowEqual } from '../watch';
import {
  BODY_SHAKE_SLIDERS,
  BODY_SIZE_SLIDERS,
  danceNote,
  danceShortlist,
  isTabAtDefaults,
  MOTION_SLIDERS,
  MOVE_SLIDERS,
  resetPatch,
  TINT_PRESETS,
  WARP_SLIDERS,
} from './inspector/model';
import type { InspectorTab, NumericDancerKey, SliderSpec } from './inspector/model';

/** Dances in the quick chooser (phones show all of them, desktop the first DESKTOP_DANCES). */
const QUICK_DANCES = 7;
const DESKTOP_DANCES = 5;

type SettingsTab = Exclude<InspectorTab, 'dance'>;
type Patch = Partial<DancerSettings & Pick<DancerState, 'characterId' | 'danceId'>>;

const AXES: readonly { value: Axis; label: string }[] = [
  { value: 'x', label: 'X' },
  { value: 'y', label: 'Y' },
  { value: 'z', label: 'Z' },
];

export function mountInspector(ctx: UiContext, host: HTMLElement): PanelHandle {
  const { store, registry, thumbnails, stage } = ctx.services;
  const scope = createScope();
  const destroyers: (() => void)[] = [];
  const own = <T extends { destroy(): void }>(handle: T): T => {
    destroyers.push(() => handle.destroy());
    return handle;
  };

  const selectedId = () => store.getState().ui.selectedId;
  const update = (patch: Patch, transient = false) => {
    const id = selectedId();
    if (id) store.updateDancer(id, patch, { transient });
  };
  const commit = () => store.commit();

  // ── Header ──
  const avatarThumb = own(createThumb('avatar__thumb', 'figure'));
  const avatar = h('span', { class: 'avatar inspector__avatar', attrs: { 'aria-hidden': 'true' } }, avatarThumb.el);
  const title = h('h2', { class: 'panel__title' });
  const sub = h('p', { class: 'panel__sub' });
  const swap = own(
    createButton({
      label: 'Swap',
      icon: 'swap',
      onClick: () => {
        const id = selectedId();
        if (id) ctx.openPicker({ purpose: 'swap', dancerId: id });
      },
    }),
  );
  const clone = own(
    createButton({
      label: 'Clone',
      icon: 'clone',
      onClick: () => {
        const id = selectedId();
        if (id && !store.cloneDancer(id)) {
          ctx.toast(`The stage is full: ${MAX_DANCERS} dancers at most. Remove one to make room for a clone.`, { kind: 'warn', id: 'stage-full' });
        }
      },
    }),
  );
  const remove = own(
    createButton({
      label: 'Remove',
      icon: 'trash',
      variant: 'danger',
      onClick: () => {
        const id = selectedId();
        if (!id) return;
        store.removeDancer(id);
        ctx.toast('Dancer removed.', { id: 'dancer-removed', action: { label: 'Undo', run: () => store.undo() } });
      },
    }),
  );
  for (const [b, name] of [
    [swap, 'Swap character'],
    [clone, 'Clone dancer'],
    [remove, 'Remove dancer'],
  ] as const) {
    b.el.setAttribute('aria-label', name);
  }
  const close = own(
    createIconButton({ icon: 'close', label: 'Close inspector', tip: false, variant: 'ghost', className: 'inspector__close', onClick: () => store.select(null) }),
  );

  // ── Tabs ──
  const tabs = own(
    createTabs<InspectorTab>({
      label: 'Dancer settings',
      value: ctx.isPhone() ? 'dance' : 'move',
      tabs: [
        { id: 'dance', label: 'Dance', className: 'tab--dance' },
        { id: 'move', label: 'Move' },
        { id: 'motion', label: 'Motion' },
        { id: 'look', label: 'Look' },
        { id: 'body', label: 'Body' },
        { id: 'warp', label: 'Warp' },
      ],
    }),
  );
  const panels = tabs.panels;
  panels.dance.classList.add('tabpanel--dance');

  // ── Dance chooser ──
  const danceNoteEl = h('span', { class: 'section__note' });
  const danceGrid = h('div', { class: 'dance-grid', attrs: { role: 'group', 'aria-label': 'Dances' } });
  panels.dance.append(h('div', { class: 'section__head only-desktop' }, h('h3', { class: 'section__title', text: 'Dance' }), danceNoteEl), danceGrid);
  let danceThumbs: ThumbHandle[] = [];
  let danceGridKey = '';
  const renderDanceGrid = (currentId: string | null) => {
    const all = registry.listDances();
    const list = danceShortlist(all, currentId, QUICK_DANCES, DESKTOP_DANCES);
    const key = `${currentId}|${all.length}|${list.map((d) => `${d.id}:${d.name}`).join(',')}`;
    if (key === danceGridKey) return;
    danceGridKey = key;
    for (const t of danceThumbs) t.destroy();
    danceThumbs = [];
    const cards: HTMLElement[] = list.map((dance) => {
      const current = dance.id === currentId;
      const thumb = createThumb('dance-card__pose', 'figure');
      thumb.set(thumbnails.dance(dance.id));
      danceThumbs.push(thumb);
      return h(
        'button',
        {
          class: ['dance-card', current && 'is-current'],
          attrs: { type: 'button', 'aria-pressed': String(current), 'data-dance-id': dance.id, title: dance.name },
        },
        current ? h('span', { class: 'levels', attrs: { 'aria-hidden': 'true' } }, h('i'), h('i'), h('i')) : null,
        thumb.el,
        h('span', { class: 'dance-card__name', text: dance.name }),
      );
    });
    const more = h(
      'button',
      { class: 'dance-card dance-card--more', attrs: { type: 'button', 'data-more': '' } },
      icon('library'),
      h('span', { class: 'dance-card__name', text: `All ${all.length} dances` }),
    );
    danceGrid.replaceChildren(...cards, more);
  };
  scope.on(danceGrid, 'click', (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>('.dance-card');
    if (!target) return;
    const id = selectedId();
    if (!id) return;
    if (target.hasAttribute('data-more')) {
      ctx.openPicker({ purpose: 'dance', dancerId: id });
      return;
    }
    const danceId = target.dataset.danceId;
    if (danceId && store.getState().dancers.find((d) => d.id === id)?.danceId !== danceId) store.updateDancer(id, { danceId });
  });
  destroyers.push(() => {
    for (const t of danceThumbs) t.destroy();
  });

  // ── Building blocks for the settings tabs ──
  const sliders = new Map<NumericDancerKey, SliderHandle>();
  const addSliders = (parent: HTMLElement, specs: readonly SliderSpec[]) => {
    for (const spec of specs) {
      const slider = own(
        createSlider({
          label: spec.label,
          field: spec.field,
          value: DANCER_DEFAULTS[spec.key],
          onChange: (value, transient) => update({ [spec.key]: value }, transient),
          onCommit: commit,
        }),
      );
      slider.el.dataset.key = spec.key;
      sliders.set(spec.key, slider);
      parent.append(slider.el);
    }
  };
  const subhead = (text: string, id?: string) => h('p', { class: 'subhead', attrs: { id }, text });
  const fieldRow = (label: string, control: HTMLElement, labelId: string) =>
    h('div', { class: 'field-row' }, h('span', { class: 'field-row__label', attrs: { id: labelId }, text: label }), control);
  const resets = new Map<SettingsTab, ButtonHandle>();
  const addReset = (tab: SettingsTab, label: string) => {
    const button = own(
      createButton({
        label,
        icon: 'reset',
        size: 'sm',
        variant: 'ghost',
        onClick: () => {
          const dancer = selectSelectedDancer(store.getState());
          if (dancer && !isTabAtDefaults(tab, dancer)) update(resetPatch(tab));
        },
      }),
    );
    button.el.dataset.reset = tab;
    resets.set(tab, button);
    panels[tab].append(h('div', { class: 'tabpanel__foot' }, button.el));
  };

  // Move
  addSliders(panels.move, MOVE_SLIDERS);
  addReset('move', 'Reset move');

  // Motion
  addSliders(panels.motion, MOTION_SLIDERS);
  const mirror = own(createToggle({ label: 'Mirror left and right', layout: 'row', checked: false, onChange: (on) => update({ mirror: on }) }));
  const resync = own(
    createButton({
      label: 'Resync',
      icon: 'metronome',
      size: 'sm',
      onClick: () => {
        stage.resync();
        ctx.toast('Every dancer is back on the beat.', { kind: 'ok', id: 'resync' });
      },
    }),
  );
  resync.el.setAttribute('aria-label', 'Resync all dancers to the beat');
  const resyncLabel = uniqueId('resync');
  panels.motion.append(mirror.el, fieldRow('Back in step', resync.el, resyncLabel));
  addReset('motion', 'Reset motion');

  // Look
  const overrides = new Map<'shine' | 'metal', { toggle: ToggleHandle; slider: SliderHandle }>();
  panels.look.append(subhead('Material'));
  for (const [key, label] of [
    ['shine', 'Shine'],
    ['metal', 'Metal'],
  ] as const) {
    const field = DANCER_LOOK_FIELDS[key];
    const toggle = own(
      createToggle({
        label: `Custom ${label.toLowerCase()}`,
        checked: false,
        className: 'inspector__switch',
        onChange: (on) => update({ [key]: on ? field.default : null }),
      }),
    );
    const slider = own(
      createSlider({
        label,
        field,
        value: field.default,
        onChange: (value, transient) => update({ [key]: value }, transient),
        onCommit: commit,
      }),
    );
    slider.el.dataset.key = key;
    slider.setDisabled(true);
    overrides.set(key, { toggle, slider });
    panels.look.append(h('div', { class: 'inspector__override', attrs: { 'data-override': key } }, toggle.el, slider.el));
  }
  const tintLabel = uniqueId('tint');
  const tint = own(
    createSwatches({
      labelledBy: tintLabel,
      options: TINT_PRESETS,
      value: 'none',
      columns: TINT_PRESETS.length + 1,
      custom: { label: 'Custom tint', color: '#ffffff' },
      className: 'inspector__tints',
      onChange: (value) => update({ tint: value === 'none' ? null : value }),
      onCustom: (color, transient) => update({ tint: color }, transient),
      onCustomCommit: commit,
    }),
  );
  panels.look.append(subhead('Tint', tintLabel), tint.el);
  addReset('look', 'Reset look');

  // Body
  panels.body.append(subhead('Proportions'));
  addSliders(panels.body, BODY_SIZE_SLIDERS);
  panels.body.append(subhead('Shake'));
  addSliders(panels.body, BODY_SHAKE_SLIDERS);
  addReset('body', 'Reset body');

  // Warp
  addSliders(panels.warp, WARP_SLIDERS);
  const modeLabel = uniqueId('warp-mode');
  const warpMode: SegmentedHandle<WarpMode> = own(
    createSegmented<WarpMode>({
      labelledBy: modeLabel,
      size: 'sm',
      value: DANCER_DEFAULTS.warpMode,
      options: [
        { value: 'wave', label: 'Wave' },
        { value: 'pulse', label: 'Pulse' },
      ],
      onChange: (value) => update({ warpMode: value }),
    }),
  );
  const axisChips = (labelledBy: string, value: Axis, onPick: (axis: Axis) => void): ChipsHandle<Axis> =>
    own(
      createChips<Axis>({
        labelledBy,
        keycaps: true,
        value,
        options: AXES,
        onChange: (values) => {
          const axis = values[0];
          if (axis) onPick(axis);
        },
      }),
    );
  const alongLabel = uniqueId('warp-along');
  const effectLabel = uniqueId('warp-effect');
  const warpAlong = axisChips(alongLabel, DANCER_DEFAULTS.warpAlong, (axis) => update({ warpAlong: axis }));
  const warpEffect = axisChips(effectLabel, DANCER_DEFAULTS.warpEffect, (axis) => update({ warpEffect: axis }));
  panels.warp.append(
    h(
      'div',
      { class: 'inspector__fields' },
      fieldRow('Mode', warpMode.el, modeLabel),
      fieldRow('Travels along', warpAlong.el, alongLabel),
      fieldRow('Moves along', warpEffect.el, effectLabel),
    ),
  );
  addReset('warp', 'Reset warp');

  // ── Panel ──
  const main = h('div', { class: 'inspector__main' }, tabs.el, panels.dance, panels.move, panels.motion, panels.look, panels.body, panels.warp);
  const panel = h(
    'section',
    { class: 'panel sheet inspector', attrs: { 'aria-label': 'Selected dancer', 'data-group': 'right' } },
    h('span', { class: 'sheet__grabber', attrs: { 'aria-hidden': 'true' } }),
    h(
      'header',
      { class: 'panel__head inspector__head' },
      avatar,
      h('div', { class: 'panel__heading' }, title, sub),
      h('div', { class: 'inspector__actions' }, swap.el, clone.el, remove.el),
      close.el,
    ),
    main,
  );
  host.append(panel);

  // Desktop shows the dance chooser above the tabs, so the Dance tab only exists on phones.
  if (typeof matchMedia === 'function') {
    const query = matchMedia(PHONE_QUERY);
    const onLayout = () => {
      if (!query.matches && tabs.value() === 'dance') tabs.select('move');
    };
    query.addEventListener('change', onLayout);
    scope.add(() => query.removeEventListener('change', onLayout));
  }

  // ── Store → controls ──
  let open = false;
  let shownCharacter: string | null = null;
  scope.add(ctx.surfaces.register({ id: 'inspector', group: 'right', isOpen: () => open, close: () => store.select(null) }));

  const render = (dancer: DancerState | null, dancers: readonly DancerState[]) => {
    const wasOpen = open;
    open = dancer !== null;
    panel.classList.toggle('is-open', open);
    if (open && !wasOpen) ctx.surfaces.opened('inspector');
    if (!open && wasOpen) ctx.surfaces.closed('inspector');
    if (!dancer) return;

    // Header
    const index = dancers.indexOf(dancer);
    const character = registry.getCharacter(dancer.characterId);
    const dance = registry.getDance(dancer.danceId);
    avatar.style.setProperty('--c', ctx.dancerColor(index));
    if (shownCharacter !== dancer.characterId) {
      shownCharacter = dancer.characterId;
      avatarThumb.set(thumbnails.character(dancer.characterId));
    }
    title.textContent = character?.name ?? 'Missing character';
    sub.textContent = `Dancer ${index + 1} of ${dancers.length}`;
    clone.el.classList.toggle('is-muted', dancers.length >= MAX_DANCERS);
    clone.el.title = dancers.length >= MAX_DANCERS ? `The stage is full (${MAX_DANCERS} dancers)` : '';

    // Dance
    const note = danceNote(dance);
    danceNoteEl.textContent = dance ? (note ? `${dance.name} · ${note}` : dance.name) : 'Unknown dance';
    renderDanceGrid(dancer.danceId);

    // Settings
    for (const [key, slider] of sliders) slider.set(dancer[key]);
    mirror.set(dancer.mirror);
    for (const [key, { toggle, slider }] of overrides) {
      const value = dancer[key];
      toggle.set(value !== null);
      slider.setDisabled(value === null);
      slider.set(value ?? DANCER_LOOK_FIELDS[key].default);
    }
    tint.set(dancer.tint ?? 'none');
    warpMode.set(dancer.warpMode);
    warpAlong.set(dancer.warpAlong);
    warpEffect.set(dancer.warpEffect);
    // Reset buttons stay enabled (disabling a focused button would drop keyboard focus); a no-op reset records nothing.
    for (const [tab, button] of resets) button.el.classList.toggle('is-muted', isTabAtDefaults(tab, dancer));
  };

  scope.add(
    ctx.watch(
      (s) => [selectSelectedDancer(s), s.dancers] as const,
      ([dancer, dancers]) => render(dancer, dancers),
      { equals: shallowEqual },
    ),
  );
  // Catalogue changes (uploads, discovered library files) can rename things or add dances.
  scope.add(
    registry.subscribe(() => {
      const state = store.getState();
      shownCharacter = null;
      danceGridKey = '';
      render(selectSelectedDancer(state), state.dancers);
    }),
  );

  return {
    destroy() {
      scope.dispose();
      for (const destroy of destroyers.reverse()) destroy();
      panel.remove();
    },
  };
}
