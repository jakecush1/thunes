/**
 * Full-screen states of the shell: the splash (enter) screen, the view-only
 * bar for shared scenes, the "show controls" button when the UI is hidden, and
 * the empty-stage hint.
 */
import { APP_TAGLINE, BAND } from '../../config';
import { createIconButton } from '../components/button';
import type { UiContext } from '../context';
import { createScope, externalLink, h, icon, logo } from '../dom';
import { isFullscreen, toggleFullscreen } from './fullscreen';

export interface ScreenHandle {
  el: HTMLElement;
  destroy(): void;
}

/** The enter screen. Enter unlocks audio (needs a user gesture) and reveals the UI. */
export function createSplash(ctx: UiContext): ScreenHandle {
  const scope = createScope();
  const { audio, store, startup } = ctx.services;
  const enter = h('button', { class: 'btn btn--primary btn--lg splash__enter', attrs: { type: 'button' } }, icon('play', 'sm'), 'Enter');
  const title = logo(`${BAND.name} dance party`, 'h1');
  title.classList.add('splash__logo');
  title.id = 'thunes-splash-title';
  const links = h(
    'p',
    { class: 'splash__links' },
    externalLink(BAND.website, `${BAND.name} website`, icon('external', 'sm'), BAND.websiteLabel),
    externalLink(BAND.instagram, `${BAND.name} on Instagram`, icon('instagram', 'sm'), BAND.instagramHandle),
  );
  const el = h(
    'div',
    { class: 'splash', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'thunes-splash-title', 'aria-describedby': 'thunes-splash-tagline' } },
    h(
      'div',
      { class: 'splash__inner' },
      startup.sharedScene ? h('p', { class: 'splash__note' }, icon('link', 'sm'), 'Someone shared a scene with you') : null,
      title,
      h('p', { class: 'splash__tagline', attrs: { id: 'thunes-splash-tagline' }, text: APP_TAGLINE }),
      enter,
      h('p', { class: 'splash__fine' }, icon('volume', 'sm'), 'Sound on. Flashing lights stay off unless you switch them on.'),
      links,
    ),
  );
  let entering = false;
  scope.on(enter, 'click', () => {
    if (entering) return;
    entering = true;
    enter.disabled = true;
    // Unlock first (from this gesture), but never let a failure keep people out.
    audio
      .unlock()
      .catch((error: unknown) => console.warn('Audio could not start', error))
      .finally(() => {
        store.updateUi({ entered: true });
        entering = false;
        enter.disabled = false;
      });
  });
  return { el, destroy: () => scope.dispose() };
}

/** Compact bar for shared scenes: title, Remix, mute, fullscreen. */
export function createViewBar(ctx: UiContext): ScreenHandle {
  const scope = createScope();
  const { store } = ctx.services;
  const title = h('span', { class: 'viewbar__title' });
  const viewLogo = externalLink(BAND.website, `${BAND.name} website`, logo(BAND.name));
  viewLogo.classList.add('logo-link');
  const remix = h('button', { class: 'btn btn--primary viewbar__remix', attrs: { type: 'button' } }, icon('remix', 'sm'), 'Remix');
  scope.on(remix, 'click', () => {
    store.updateUi({ viewOnly: false });
    ctx.toast('Remixing: change anything, then save or share your version.', { kind: 'info' });
  });
  const mute = createIconButton({
    icon: 'volume',
    label: 'Mute',
    tip: false,
    variant: 'ghost',
    pressed: store.getState().audio.muted,
    onClick: () => store.updateAudio({ muted: !store.getState().audio.muted }),
  });
  const fullscreen = createIconButton({ icon: 'fullscreen', label: 'Fullscreen', tip: false, variant: 'ghost', onClick: () => toggleFullscreen(ctx) });
  scope.add(mute.destroy);
  scope.add(fullscreen.destroy);
  const el = h(
    'div',
    { class: 'viewonly' },
    h(
      'div',
      { class: 'bar viewbar', attrs: { role: 'region', 'aria-label': 'Shared scene' } },
      h('span', { class: 'viewbar__brand' }, viewLogo),
      h('span', { class: 'bar__sep', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'viewbar__text' }, h('span', { class: 'viewbar__kicker', text: 'Shared scene' }), title),
      remix,
      mute.el,
      fullscreen.el,
    ),
  );
  scope.add(
    ctx.watch(
      (s) => s.title,
      (text) => {
        title.textContent = text.trim() || 'Untitled scene';
      },
    ),
  );
  scope.add(
    ctx.watch(
      (s) => s.audio.muted,
      (muted) => {
        mute.setPressed(muted);
        mute.setIcon(muted ? 'mute' : 'volume');
      },
    ),
  );
  const syncFullscreen = () => {
    fullscreen.setPressed(isFullscreen());
    fullscreen.setIcon(isFullscreen() ? 'fullscreen-exit' : 'fullscreen');
  };
  syncFullscreen();
  scope.on(document, 'fullscreenchange', syncFullscreen);
  return { el, destroy: () => scope.dispose() };
}

/** "Show controls" button, visible while the UI is hidden. */
export function createRestoreButton(ctx: UiContext): ScreenHandle {
  const scope = createScope();
  const el = h(
    'button',
    { class: 'btn glass ui-restore', attrs: { type: 'button', 'aria-keyshortcuts': 'H' } },
    icon('eye', 'sm'),
    'Show controls',
    h('kbd', { class: 'kbd', attrs: { 'aria-hidden': 'true' }, text: 'H' }),
  );
  scope.on(el, 'click', () => ctx.services.store.updateUi({ uiHidden: false }));
  return { el, destroy: () => scope.dispose() };
}

/** The empty-stage hint card (pointer-transparent so the stage stays reachable). */
export function createEmptyHint(ctx: UiContext): ScreenHandle {
  const scope = createScope();
  const el = h(
    'div',
    { class: 'hint-card', attrs: { role: 'note' } },
    h('span', { class: 'hint-card__icon', attrs: { 'aria-hidden': 'true' } }, icon('plus', 'lg')),
    h('h2', { class: 'hint-card__title', text: 'Add your first dancer' }),
    h('p', { class: 'hint-card__text', text: 'Tap a pad below, pick a character, and they start moving right away.' }),
    icon('chev-down', 'md', 'hint-card__arrow'),
  );
  scope.add(
    ctx.watch(
      (s) => s.dancers.length === 0,
      (empty) => {
        el.hidden = !empty;
      },
    ),
  );
  return { el, destroy: () => scope.dispose() };
}
