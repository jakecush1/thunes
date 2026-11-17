/**
 * Scene drawer (top of the left column; a bottom sheet on phones): backdrop
 * presets and a custom colour, floor style and colour, light and air, strobe
 * (with photosensitivity consent) and the auto-orbiting camera loop.
 * Mock section: "Scene drawer" (.drawer.scene).
 *
 * Strobe consent: flashes only ever run while state.ui.strobeAllowed is true
 * (the stage enforces that). Raising the intensity without consent asks first;
 * a loaded or shared scene with a strobe shows a non-blocking prompt instead.
 */
import './scene.css';
import { DEFAULT_CAMERA, SCENE_DEFAULTS, SCENE_FIELDS } from '../../config';
import { BACKGROUNDS, CUSTOM_BACKGROUND_ID, getBackground } from '../../stage/backgrounds';
import type { FloorStyle, SceneSettings } from '../../types';
import { createButton } from '../components/button';
import { createSegmented, createToggle } from '../components/choice';
import { createDrawer } from '../components/drawer';
import { createSlider } from '../components/slider';
import { createSwatches } from '../components/swatches';
import type { SliderHandle } from '../components/slider';
import type { PanelHandle, UiContext } from '../context';
import { createScope, h, icon, uniqueId } from '../dom';
import {
  AUTO_FLOOR,
  BACKDROP_GROUPS,
  fitView,
  FLOOR_COLOR_LABELS,
  FLOOR_COLORS,
  FLOOR_LABELS,
  percent,
  presetsOfKind,
  sceneSummary,
  STROBE_NOTE,
  strobeConsentMessage,
  strobePromptMessage,
} from './scene/model';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
type NumericSceneKey = keyof typeof SCENE_FIELDS;

export function mountScene(ctx: UiContext, host: HTMLElement): PanelHandle {
  const { store } = ctx.services;
  const scope = createScope();
  const destroyers: { destroy(): void }[] = [];
  const keep = <T extends { destroy(): void }>(c: T): T => {
    destroyers.push(c);
    return c;
  };
  const scene = () => store.getState().scene;
  const reducedMotion = () => typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION).matches;

  // ── Drawer ──
  const pillSwatch = h('span', { class: 'pill__swatch', attrs: { 'aria-hidden': 'true' } });
  const reset = keep(
    createButton({
      label: 'Reset',
      icon: 'reset',
      size: 'sm',
      variant: 'ghost',
      className: 'scene__reset',
      onClick: () => {
        store.updateScene({ ...SCENE_DEFAULTS });
        ctx.toast('Scene settings reset', { kind: 'ok', id: 'scene-reset', action: { label: 'Undo', run: () => store.undo() } });
      },
    }),
  );
  reset.el.setAttribute('aria-label', 'Reset scene settings');
  const drawer = createDrawer({
    id: 'scene',
    className: 'scene',
    group: 'left',
    label: 'Scene settings',
    title: 'Scene',
    direction: 'down',
    pillLead: pillSwatch,
    headActions: [reset.el],
    surfaces: ctx.surfaces,
  });
  host.append(drawer.el);

  const section = (title: string, extra?: Node | null, note?: HTMLElement) =>
    h('section', { class: 'section' }, h('div', { class: 'section__head' }, h('h3', { class: 'section__title', text: title }), note ?? null, extra ?? null));

  const slider = (key: NumericSceneKey, label: string, format?: (v: number) => string): SliderHandle =>
    keep(
      createSlider({
        label,
        field: SCENE_FIELDS[key],
        value: scene()[key],
        format,
        onChange: (v, transient) => store.updateScene({ [key]: v } as Partial<SceneSettings>, { transient }),
        onCommit: () => store.commit(),
      }),
    );

  // ── Backdrop ──
  const backdropNote = h('span', { class: 'section__note' });
  const backdrop = section('Backdrop', null, backdropNote);
  const backdropGroups = BACKDROP_GROUPS.map((group) => {
    const id = uniqueId('backdrop');
    const swatches = keep(
      createSwatches({
        labelledBy: id,
        columns: 7,
        options: presetsOfKind(BACKGROUNDS, group.kind).map((p) => ({ value: p.id, name: p.name, swatch: p.swatch })),
        value: scene().background,
        custom: group.kind === 'solid' ? { label: 'Custom backdrop colour', color: scene().backgroundColor } : undefined,
        onChange: (value) => {
          // A place brings its own ground: grass in the forest, concrete in the city, sand in the desert.
          const leaving = getBackground(scene().background);
          const chosen = getBackground(value);
          const natural = chosen.naturalFloor;
          store.updateScene(natural ? { background: value, floorStyle: natural, floorColor: null } : { background: value });
          // Some places are best seen from a particular spot (the boat: side-on, whole boat in frame).
          // Leaving such a place returns the camera to the usual view of the stage.
          const aspect = window.innerWidth / Math.max(1, window.innerHeight);
          if (chosen.view) store.setCamera(fitView(chosen.view, aspect));
          else if (leaving.view) store.setCamera(fitView(DEFAULT_CAMERA, aspect));
        },
        onCustom: (color, transient) => store.updateScene({ background: CUSTOM_BACKGROUND_ID, backgroundColor: color }, { transient }),
        onCustomCommit: () => store.commit(),
      }),
    );
    backdrop.append(h('h4', { class: 'subhead scene__group', attrs: { id }, text: group.label }), swatches.el);
    return { swatches, ids: new Set(presetsOfKind(BACKGROUNDS, group.kind).map((p) => p.id)), custom: group.kind === 'solid' };
  });

  // ── Floor ──
  const floorStyle = keep(
    createSegmented<FloorStyle>({
      label: 'Floor style',
      size: 'block',
      value: scene().floorStyle,
      options: (Object.keys(FLOOR_LABELS) as FloorStyle[]).map((value) => ({ value, label: FLOOR_LABELS[value] })),
      onChange: (value) => store.updateScene({ floorStyle: value }),
    }),
  );
  const floorColorLabelId = uniqueId('floor-colour');
  const floorColorLabel = h('span', { class: 'field-row__label', attrs: { id: floorColorLabelId } });
  const floorColors = keep(
    createSwatches({
      labelledBy: floorColorLabelId,
      layout: 'row',
      options: [
        { value: AUTO_FLOOR, name: 'Auto (matches the backdrop)', swatch: '#f28a2e' },
        ...FLOOR_COLORS.map((c) => ({ value: c.value, name: c.name, swatch: c.value })),
      ],
      value: scene().floorColor ?? AUTO_FLOOR,
      custom: { label: 'Custom floor colour', color: scene().floorColor ?? '#f28a2e' },
      className: 'scene__floor-colours',
      onChange: (value) => store.updateScene({ floorColor: value === AUTO_FLOOR ? null : value }),
      onCustom: (color, transient) => store.updateScene({ floorColor: color }, { transient }),
      onCustomCommit: () => store.commit(),
    }),
  );
  const autoChip = floorColors.el.querySelector<HTMLElement>('.swatch:first-child');
  autoChip?.classList.add('scene__auto');
  const autoChipFace = autoChip?.querySelector<HTMLElement>('.swatch__chip') ?? null;
  autoChipFace?.append(h('span', { class: 'scene__auto-mark', attrs: { 'aria-hidden': 'true' }, text: 'A' }));
  const floorColorRow = h('div', { class: 'field-row scene__floor-row' }, floorColorLabel, floorColors.el);
  floorStyle.el.classList.add('scene__floor-style');
  const deckNote = h('p', { class: 'scene__deck-note', text: 'On the boat, the deck is the floor.' });
  deckNote.hidden = true;
  const floor = section('Floor');
  floor.append(deckNote, floorStyle.el, floorColorRow);

  // ── Light and air ──
  const brightness = slider('brightness', 'Brightness');
  const exposure = slider('exposure', 'Exposure');
  const fog = slider('fog', 'Fog', percent);
  const light = section('Light and air');
  light.append(brightness.el, exposure.el, fog.el);

  // ── Strobe ──
  let asking = false;
  let dismissPrompt: (() => void) | null = null;
  const askConsent = async (source: 'slider' | 'prompt'): Promise<void> => {
    if (asking) return;
    asking = true;
    dismissPrompt?.();
    dismissPrompt = null;
    const ok = await ctx.confirm({
      title: 'Allow flashing lights?',
      message: strobeConsentMessage(reducedMotion()),
      confirmLabel: 'Allow flashing',
      cancelLabel: 'Keep it off',
    });
    asking = false;
    if (ok) {
      store.updateUi({ strobeAllowed: true });
    } else if (source === 'slider') {
      store.updateScene({ strobeIntensity: 0 }, { transient: true });
      store.commit();
      intensity.set(0);
    }
  };

  const strobeSync = keep(
    createToggle({ label: 'Sync to the beat', checked: scene().strobeSync, className: 'scene__strobe-sync', onChange: (on) => store.updateScene({ strobeSync: on }) }),
  );
  const intensity = keep(
    createSlider({
      label: 'Intensity',
      field: SCENE_FIELDS.strobeIntensity,
      value: scene().strobeIntensity,
      format: percent,
      onChange: (v, transient) => {
        // Ask before the value lands in the store, so the "loaded scene" prompt does not fire too.
        if (v > 0 && !store.getState().ui.strobeAllowed) void askConsent('slider');
        store.updateScene({ strobeIntensity: v }, { transient });
      },
      onCommit: () => {
        store.commit();
        intensity.set(scene().strobeIntensity);
      },
    }),
  );
  const strobeSpeed = slider('strobeBpm', 'Speed');
  const divisionLabelId = uniqueId('strobe-division');
  const division = keep(
    createSegmented<'1' | '2' | '4'>({
      labelledBy: divisionLabelId,
      size: 'sm',
      value: String(scene().strobeDivision) as '1' | '2' | '4',
      options: [
        { value: '1', label: 'Beat' },
        { value: '2', label: '2 beats' },
        { value: '4', label: '4 beats' },
      ],
      onChange: (value) => store.updateScene({ strobeDivision: Number(value) as 1 | 2 | 4 }),
    }),
  );
  const divisionRow = h('div', { class: 'field-row scene__division' }, h('span', { class: 'field-row__label', attrs: { id: divisionLabelId }, text: 'Flash every' }), division.el);
  const strobeNote = h('span', { text: STROBE_NOTE });
  const callout = h('p', { class: 'callout scene__callout', attrs: { role: 'note' } }, icon('warn', 'sm'), strobeNote);
  const allowButton = keep(createButton({ label: 'Allow flashing', size: 'sm', onClick: () => void askConsent('prompt') }));
  const blockedRow = h(
    'div',
    { class: 'scene__blocked' },
    h('span', { class: 'scene__blocked-text', text: 'The strobe is paused until you allow flashing.' }),
    allowButton.el,
  );
  const strobe = section('Strobe', strobeSync.el);
  strobe.append(intensity.el, strobeSpeed.el, divisionRow, blockedRow, callout);

  // ── Camera loop ──
  const cameraLoop = keep(
    createToggle({ label: 'Auto-orbit', checked: scene().cameraLoop, className: 'scene__orbit', onChange: (on) => store.updateScene({ cameraLoop: on }) }),
  );
  const lap = slider('cameraLoopPeriod', 'Lap time');
  const height = slider('cameraLoopHeight', 'Height');
  const aim = slider('cameraLoopTargetHeight', 'Aim height');
  const distance = slider('cameraLoopDistance', 'Distance');
  const camera = section('Camera loop', cameraLoop.el);
  camera.append(lap.el, height.el, aim.el, distance.el);

  drawer.body.append(backdrop, floor, light, strobe, camera);

  // ── State → controls ──
  const sliders: [NumericSceneKey, SliderHandle][] = [
    ['brightness', brightness],
    ['exposure', exposure],
    ['fog', fog],
    ['strobeIntensity', intensity],
    ['strobeBpm', strobeSpeed],
    ['cameraLoopPeriod', lap],
    ['cameraLoopHeight', height],
    ['cameraLoopTargetHeight', aim],
    ['cameraLoopDistance', distance],
  ];
  scope.add(
    ctx.watch(
      (s) => s.scene,
      (s) => {
        const preset = getBackground(s.background);
        const custom = s.background === CUSTOM_BACKGROUND_ID;
        const name = custom ? 'Custom colour' : preset.name;
        pillSwatch.style.setProperty('--sw', custom ? s.backgroundColor : preset.swatch);
        drawer.setMeta(sceneSummary(s, name));
        backdropNote.textContent = name;
        for (const group of backdropGroups) {
          if (group.ids.has(s.background)) group.swatches.set(s.background);
          else if (custom && group.custom) group.swatches.set(CUSTOM_BACKGROUND_ID, s.backgroundColor);
          else group.swatches.set(null);
        }
        floorStyle.set(s.floorStyle);
        floorColors.set(s.floorColor ?? AUTO_FLOOR);
        floorColorLabel.textContent = FLOOR_COLOR_LABELS[s.floorStyle];
        // On the boat the deck replaces the floor, so the floor controls do nothing there.
        const onDeck = !custom && preset.place === 'ocean';
        deckNote.hidden = !onDeck;
        floorStyle.el.hidden = onDeck;
        floorColorRow.hidden = onDeck || s.floorStyle === 'none';
        autoChipFace?.style.setProperty('--sw', custom ? '#f28a2e' : preset.floor.line);
        for (const [key, handle] of sliders) handle.set(s[key]);
        strobeSync.set(s.strobeSync);
        division.set(String(s.strobeDivision) as '1' | '2' | '4');
        strobeSpeed.el.hidden = s.strobeSync;
        divisionRow.hidden = !s.strobeSync;
        cameraLoop.set(s.cameraLoop);
        for (const handle of [lap, height, aim, distance]) handle.el.classList.toggle('is-off', !s.cameraLoop);
      },
    ),
  );

  // Strobe consent state: inline "paused" row and the prompt for loaded/shared scenes.
  scope.add(
    ctx.watch(
      (s) => (s.scene.strobeIntensity > 0 && !s.ui.strobeAllowed ? (s.ui.entered ? 'blocked' : 'waiting') : 'ok'),
      (state) => {
        blockedRow.hidden = state === 'ok';
        if (state !== 'blocked') {
          dismissPrompt?.();
          dismissPrompt = null;
          return;
        }
        if (asking || dismissPrompt) return;
        const close = ctx.toast(strobePromptMessage(reducedMotion()), {
          kind: 'warn',
          id: 'strobe-prompt',
          duration: 15000,
          action: { label: 'Allow…', run: () => void askConsent('prompt') },
        });
        dismissPrompt = () => close();
      },
    ),
  );
  const syncNote = () => {
    strobeNote.textContent = reducedMotion() ? `${STROBE_NOTE} Your device asks for reduced motion.` : STROBE_NOTE;
  };
  syncNote();
  if (typeof matchMedia === 'function') {
    const query = matchMedia(REDUCED_MOTION);
    query.addEventListener('change', syncNote);
    scope.add(() => query.removeEventListener('change', syncNote));
  }

  return {
    destroy() {
      scope.dispose();
      dismissPrompt?.();
      for (const c of destroyers) c.destroy();
      drawer.destroy();
      drawer.el.remove();
    },
  };
}
