/** Fullscreen helpers shared by the toolbar and the view-only bar. */
import type { UiContext } from '../context';

export function isFullscreen(): boolean {
  return document.fullscreenElement !== null && document.fullscreenElement !== undefined;
}

/** Enter or leave fullscreen on the whole page; reports failures with a toast. */
export function toggleFullscreen(ctx: Pick<UiContext, 'toast'>): void {
  const request = isFullscreen() ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  if (!request) {
    ctx.toast('Fullscreen is not available in this browser.', { kind: 'info' });
    return;
  }
  request.catch(() => ctx.toast('Fullscreen is not available here.', { kind: 'info' }));
}
