/**
 * Global keyboard shortcuts. Matching is pure (../shortcuts.ts); this module
 * decides when shortcuts apply and what each action does to the store.
 */
import { MAX_DANCERS } from '../../config';
import { isModalOpen } from '../components/modal';
import type { UiContext } from '../context';
import { wrapDegrees } from '../format';
import { isKeyOwnedByControl, isTypingTarget, matchShortcut } from '../shortcuts';
import type { ShortcutAction } from '../shortcuts';

/** Actions allowed in view-only mode (nothing that edits the scene). */
const VIEW_ONLY_ACTIONS = new Set<ShortcutAction['type']>(['toggle-ui', 'mute', 'resync', 'escape']);

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Install the window keydown handler. Returns the uninstall function. */
export function installShortcuts(ctx: UiContext): () => void {
  const { store, stage } = ctx.services;

  const run = (action: ShortcutAction): boolean => {
    const state = store.getState();
    const selected = state.ui.selectedId ? state.dancers.find((d) => d.id === state.ui.selectedId) : undefined;
    switch (action.type) {
      case 'undo':
        if (!store.canUndo()) return true;
        store.undo();
        return true;
      case 'redo':
        if (!store.canRedo()) return true;
        store.redo();
        return true;
      case 'escape':
        if (ctx.surfaces.closeTop()) return true;
        if (state.ui.selectedId !== null) {
          store.select(null);
          return true;
        }
        return false;
      case 'toggle-ui':
        store.updateUi({ uiHidden: !state.ui.uiHidden });
        return true;
      case 'mute': {
        const muted = !state.audio.muted;
        store.updateAudio({ muted });
        ctx.toast(muted ? 'Sound off' : 'Sound on', { kind: 'info', id: 'mute', duration: 1500 });
        return true;
      }
      case 'resync':
        stage.resync();
        ctx.toast('Everyone is back in step', { kind: 'info', id: 'resync', duration: 1500 });
        return true;
      case 'select-slot': {
        const dancer = state.dancers[action.index];
        if (!dancer) return false;
        store.select(dancer.id);
        return true;
      }
      case 'remove': {
        if (!selected) return false;
        store.removeDancer(selected.id);
        ctx.toast('Dancer removed', { id: 'removed', action: { label: 'Undo', run: () => store.undo() } });
        return true;
      }
      case 'clone': {
        // Always swallow Cmd/Ctrl+D so the browser does not open "bookmark this page".
        if (!selected) return true;
        if (!store.cloneDancer(selected.id)) ctx.toast(`The stage is full: ${MAX_DANCERS} dancers at most.`, { kind: 'warn', id: 'full' });
        return true;
      }
      case 'nudge':
        if (!selected) return false;
        store.updateDancer(selected.id, { x: round2(selected.x + action.dx), z: round2(selected.z + action.dz) });
        return true;
      case 'rotate':
        if (!selected) return false;
        store.updateDancer(selected.id, { rotation: wrapDegrees(selected.rotation + action.degrees) });
        return true;
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const state = store.getState();
    if (!state.ui.entered || isModalOpen()) return;
    if (isTypingTarget(event.target)) return;
    const action = matchShortcut(event);
    if (!action) return;
    if (isKeyOwnedByControl(event.target, event.key)) return;
    if (state.ui.viewOnly && !VIEW_ONLY_ACTIONS.has(action.type)) return;
    if (event.repeat && action.type !== 'nudge' && action.type !== 'rotate' && action.type !== 'undo' && action.type !== 'redo') return;
    if (run(action)) event.preventDefault();
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
