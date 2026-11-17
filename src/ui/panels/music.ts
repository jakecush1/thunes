/**
 * Music drawer (bottom of the left column; a bottom sheet on phones).
 *
 * Collapsed: a pill with live level bars, the song title, its status and a
 * mute button. Expanded: the song list (built-ins, library files, uploads,
 * and "No music"), volume, mute, beat sync, and a dropzone for your own music.
 * Mock section: "Music drawer" (.drawer.music).
 */
import './music.css';
import { AUDIO_FIELDS } from '../../config';
import { MUSIC_EXTENSIONS } from '../../assets/formats';
import type { AudioStatus, SongDef } from '../../types';
import { createIconButton } from '../components/button';
import { createToggle } from '../components/choice';
import { createDrawer } from '../components/drawer';
import { createDropzone } from '../components/dropzone';
import { createSlider } from '../components/slider';
import type { IconButtonHandle } from '../components/button';
import type { PanelHandle, UiContext } from '../context';
import { createScope, h, icon } from '../dom';
import { formatBpm, formatDuration, LEVEL_STEPS, levelBarHeights, levelStep, musicSummary, songVibe } from './music/model';
import { addFilesWithToasts } from './uploads/add';

/** Precomputed scaleY strings, so the animation loop never builds strings. */
const LEVEL_VALUES: readonly string[] = Array.from({ length: LEVEL_STEPS + 1 }, (_, i) => (i / LEVEL_STEPS).toFixed(3));

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

interface TrackRow {
  id: string | null;
  li: HTMLLIElement;
  button: HTMLButtonElement;
  state: HTMLElement;
  remove: IconButtonHandle | null;
}

export function mountMusic(ctx: UiContext, host: HTMLElement): PanelHandle {
  const { store, registry, audio } = ctx.services;
  const scope = createScope();

  // ── Pill ──
  const pillLevels = h('span', { class: 'levels music__levels', attrs: { 'aria-hidden': 'true' } }, h('i'), h('i'), h('i'), h('i'));
  const toggleMute = () => store.updateAudio({ muted: !store.getState().audio.muted });
  const pillMute = createIconButton({ icon: 'volume', label: 'Mute', tip: false, variant: 'ghost', pressed: false, className: 'music__mute', onClick: toggleMute });

  const disc = h('span', { class: 'disc music__disc', attrs: { 'aria-hidden': 'true' } });
  const drawer = createDrawer({
    id: 'music',
    className: 'music',
    group: 'left',
    label: 'Music',
    title: 'Music',
    direction: 'up',
    pillLead: pillLevels,
    pillExtras: [pillMute.el],
    headLead: disc,
    surfaces: ctx.surfaces,
  });
  host.append(drawer.el);

  // ── Volume row ──
  const volumeMute = createIconButton({ icon: 'volume', label: 'Mute', tip: false, variant: 'ghost', size: 'sm', pressed: false, onClick: toggleMute });
  const volume = createSlider({
    label: 'Volume',
    field: AUDIO_FIELDS.volume,
    value: store.getState().audio.volume,
    className: 'music__volume',
    format: (v) => `${Math.round(v * 100)}%`,
    onChange: (v) => {
      const muted = store.getState().audio.muted;
      store.updateAudio(muted && v > 0 ? { volume: v, muted: false } : { volume: v });
    },
  });
  volume.el.querySelector('.slider-row__label')?.classList.add('sr-only');
  volume.el.prepend(volumeMute.el);

  // ── Beat sync ──
  const beatSync = createToggle({
    label: 'Sync dancers to the beat',
    layout: 'row',
    checked: store.getState().audio.beatSync,
    className: 'music__sync',
    onChange: (checked) => store.updateAudio({ beatSync: checked }),
  });

  // ── Track list ──
  const tracksNote = h('span', { class: 'section__note' });
  const list = h('ul', { class: 'track-list', attrs: { 'aria-label': 'Tracks' } });
  const status = h('p', { class: 'music__status', attrs: { role: 'status', 'aria-live': 'polite' } });
  status.hidden = true;
  const dropzone = createDropzone({
    title: 'Add your own music',
    text: 'Drop an MP3, WAV or OGG here, or browse. It stays on this device.',
    accept: [...MUSIC_EXTENSIONS.map((e) => `.${e}`), 'audio/*'].join(','),
    icon: 'upload',
    className: 'music__drop',
    onFiles: (files) => void addFilesWithToasts(ctx, files, { playFirstSong: true }),
  });

  drawer.body.append(
    h('div', { class: 'music__controls' }, volume.el, beatSync.el),
    h('section', { class: 'section music__tracks' }, h('div', { class: 'section__head' }, h('h3', { class: 'section__title', text: 'Tracks' }), tracksNote), list, status),
    dropzone.el,
  );

  let rows: TrackRow[] = [];
  let rowScope = createScope();
  const trackLevels = h('span', { class: 'levels music__levels music__levels--track', attrs: { 'aria-hidden': 'true' } }, h('i'), h('i'), h('i'));

  const chooseSong = (id: string | null) => {
    store.updateAudio({ songId: id });
  };

  const removeSong = async (song: SongDef) => {
    const ok = await ctx.confirm({
      title: `Remove “${song.title}”?`,
      message: 'It is deleted from this device. Scenes that use it will play no music instead.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    // Stop using it first, so nothing tries to play a song that is being deleted.
    if (store.getState().audio.songId === song.id) store.updateAudio({ songId: null });
    try {
      await registry.removeUpload(song.id);
      ctx.toast(`Removed “${song.title}”`, { kind: 'ok' });
    } catch (error) {
      ctx.toast(`Could not remove it: ${error instanceof Error ? error.message : String(error)}`, { kind: 'error' });
    }
  };

  const buildRow = (song: SongDef | null): TrackRow => {
    const id = song?.id ?? null;
    const state = h('span', { class: 'track__state', attrs: { 'aria-hidden': 'true' } });
    const title = song?.title ?? 'No music';
    const vibe = song ? songVibe(song) : 'Silence · the beat keeps going';
    const bpm = song ? formatBpm(song.bpm) : '';
    const time = song ? formatDuration(song.duration) : '';
    const button = h(
      'button',
      { class: ['track', !song && 'track--none'], attrs: { type: 'button', 'data-song': id ?? 'none' } },
      state,
      h('span', { class: 'track__text' }, h('span', { class: 'track__title', text: title }), vibe ? h('span', { class: 'track__vibe', text: vibe }) : null),
      h('span', { class: 'track__bpm', text: bpm, attrs: { 'aria-label': bpm ? `${bpm} bpm` : undefined } }),
      h('span', { class: 'track__time', text: time }),
    );
    if (!bpm) button.querySelector('.track__bpm')?.classList.add('is-empty');
    rowScope.on(button, 'click', () => chooseSong(id));
    let remove: IconButtonHandle | null = null;
    if (song && song.source === 'upload') {
      remove = createIconButton({
        icon: 'trash',
        label: `Remove ${song.title}`,
        tip: false,
        variant: 'ghost',
        size: 'sm',
        className: 'music__remove',
        onClick: () => void removeSong(song),
      });
    }
    const li = h('li', { class: ['music__item', remove && 'has-remove'] }, button, remove?.el ?? null);
    return { id, li, button, state, remove };
  };

  const renderList = () => {
    for (const row of rows) row.remove?.destroy();
    rowScope.dispose();
    rowScope = createScope();
    const songs = registry.listSongs();
    rows = [...songs.map((s) => buildRow(s)), buildRow(null)];
    list.replaceChildren(...rows.map((r) => r.li));
    const builtin = songs.filter((s) => s.source === 'builtin').length;
    const library = songs.filter((s) => s.source === 'library').length;
    const yours = songs.filter((s) => s.source === 'upload').length;
    tracksNote.textContent = [`${builtin} built in`, library ? `${library} in the library` : '', yours ? `${yours} yours` : ''].filter(Boolean).join(' · ');
    renderState();
  };

  // ── State → DOM ──
  let live = false;
  const renderState = () => {
    const state = store.getState();
    const { songId, muted, beatSync: sync } = state.audio;
    const song = songId ? registry.getSong(songId) : undefined;
    const st: AudioStatus = audio.status;
    const summary = musicSummary({ song, songId, status: st, muted, entered: state.ui.entered });
    drawer.setTitle(summary.title);
    drawer.setMeta(summary.meta);
    drawer.setSub(songId === null ? 'Silence' : [song ? songVibe(song) : '', `${Math.round(summary.bpm)} bpm`].filter(Boolean).join(' · '));
    drawer.el.style.setProperty('--beat', `${(60 / summary.bpm).toFixed(3)}s`);
    disc.classList.toggle('is-paused', !summary.live);
    for (const b of [pillMute, volumeMute]) {
      b.setPressed(muted);
      b.setIcon(muted ? 'mute' : 'volume');
      b.setLabel(muted ? 'Unmute' : 'Mute');
    }
    volume.set(state.audio.volume);
    beatSync.set(sync);
    beatSync.setHint(sync ? `Every move locks to ${Math.round(summary.bpm)} bpm` : 'Dancers keep their own tempo');

    const forCurrent = st.state !== 'idle' && st.songId === songId;
    for (const row of rows) {
      const current = row.id === songId;
      row.button.setAttribute('aria-current', String(current));
      const loading = current && forCurrent && st.state === 'loading';
      const failed = current && forCurrent && st.state === 'error';
      row.button.classList.toggle('is-loading', loading);
      row.button.classList.toggle('is-error', failed);
      row.button.setAttribute('aria-busy', String(loading));
      if (current && row.id !== null && !loading && !failed) {
        if (trackLevels.parentElement !== row.state) row.state.replaceChildren(trackLevels);
      } else {
        const glyph = failed ? 'warn' : row.id === null ? 'mute' : 'play';
        const existing = row.state.firstElementChild;
        if (!existing || existing.getAttribute('data-glyph') !== glyph) {
          const svg = icon(glyph);
          svg.setAttribute('data-glyph', glyph);
          row.state.replaceChildren(svg);
        }
      }
    }
    if (songId !== null && forCurrent && st.state === 'error') {
      status.textContent = `“${summary.title}” could not play: ${st.message}`;
      status.hidden = false;
      status.classList.add('is-error');
    } else if (songId !== null && forCurrent && st.state === 'loading') {
      status.textContent = `Loading “${summary.title}”…`;
      status.hidden = false;
      status.classList.remove('is-error');
    } else {
      status.textContent = '';
      status.hidden = true;
      status.classList.remove('is-error');
    }
    // Animate only while the bars can be seen: past the splash, controls shown, not in view-only mode.
    live = summary.live && state.ui.entered && !state.ui.uiHidden && !state.ui.viewOnly;
    updateLoop();
  };

  // ── Level bars ──
  const bars: HTMLElement[] = [...Array.from(pillLevels.children), ...Array.from(trackLevels.children)] as HTMLElement[];
  const heights = new Float32Array(bars.length);
  const steps = new Int16Array(bars.length).fill(-1);
  const reduced = typeof matchMedia === 'function' ? matchMedia(REDUCED_MOTION) : null;
  let frame = 0;
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    levelBarHeights(audio.levels(), now / 1000, heights);
    for (let i = 0; i < bars.length; i++) {
      const step = levelStep(heights[i]!);
      if (step === steps[i]) continue;
      steps[i] = step;
      bars[i]!.style.setProperty('--lv', LEVEL_VALUES[step]!);
    }
  };
  function updateLoop(): void {
    const run = live && !reduced?.matches && document.visibilityState === 'visible';
    for (const el of [pillLevels, trackLevels]) {
      el.classList.toggle('is-live', run);
      el.classList.toggle('is-paused', !live);
    }
    if (run && frame === 0) {
      frame = requestAnimationFrame(tick);
    } else if (!run && frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
      steps.fill(-1);
    }
  }
  scope.add(() => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  });
  scope.on(document, 'visibilitychange', updateLoop);
  if (reduced) {
    const onChange = () => updateLoop();
    reduced.addEventListener('change', onChange);
    scope.add(() => reduced.removeEventListener('change', onChange));
  }

  // ── Subscriptions ──
  scope.add(registry.subscribe(renderList));
  scope.add(audio.subscribe(renderState));
  scope.add(
    ctx.watch(
      (s) => s.audio,
      () => renderState(),
      { immediate: false },
    ),
  );
  scope.add(
    ctx.watch(
      (s) => s.ui.entered && !s.ui.uiHidden && !s.ui.viewOnly,
      () => renderState(),
      { immediate: false },
    ),
  );
  renderList();

  return {
    destroy() {
      scope.dispose();
      for (const row of rows) row.remove?.destroy();
      rowScope.dispose();
      for (const c of [pillMute, volumeMute, volume, beatSync, dropzone]) c.destroy();
      drawer.destroy();
      drawer.el.remove();
    },
  };
}
