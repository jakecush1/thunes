/**
 * Keyboard shortcuts as pure data: `matchShortcut` maps a key event to an
 * action, and the shell decides what each action does. Listed in About.
 */

export type ShortcutAction =
  | { type: 'remove' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clone' }
  | { type: 'escape' }
  | { type: 'toggle-ui' }
  | { type: 'mute' }
  | { type: 'resync' }
  | { type: 'select-slot'; index: number }
  | { type: 'nudge'; dx: number; dz: number }
  | { type: 'rotate'; degrees: number };

/** The parts of a KeyboardEvent the matcher reads. */
export interface KeyLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export const NUDGE_STEP = 0.1;
export const NUDGE_STEP_LARGE = 0.5;
export const ROTATE_STEP = 15;

/** Map a key press to an action, or null when it is not a shortcut. */
export function matchShortcut(e: KeyLike): ShortcutAction | null {
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (mod && !e.altKey) {
    if (key === 'z') return e.shiftKey ? { type: 'redo' } : { type: 'undo' };
    if (key === 'y' && e.ctrlKey && !e.metaKey && !e.shiftKey) return { type: 'redo' };
    if (key === 'd' && !e.shiftKey) return { type: 'clone' };
    return null;
  }
  if (mod || e.altKey) return null;

  switch (key) {
    case 'Delete':
    case 'Backspace':
      return { type: 'remove' };
    case 'Escape':
      return { type: 'escape' };
    case 'h':
      return { type: 'toggle-ui' };
    case 'm':
      return { type: 'mute' };
    case 's':
      return e.shiftKey ? null : { type: 'resync' };
    case '[':
    case '{':
      return { type: 'rotate', degrees: -ROTATE_STEP };
    case ']':
    case '}':
      return { type: 'rotate', degrees: ROTATE_STEP };
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown': {
      const step = e.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
      if (key === 'ArrowLeft') return { type: 'nudge', dx: -step, dz: 0 };
      if (key === 'ArrowRight') return { type: 'nudge', dx: step, dz: 0 };
      // Up moves away from the default camera (-Z), down toward it.
      if (key === 'ArrowUp') return { type: 'nudge', dx: 0, dz: -step };
      return { type: 'nudge', dx: 0, dz: step };
    }
  }
  // Digits 1-8 (top row or numpad, with or without Shift on layouts that need it).
  const digit = /^Digit([1-8])$|^Numpad([1-8])$/.exec(e.code ?? '');
  if (digit) return { type: 'select-slot', index: Number(digit[1] ?? digit[2]) - 1 };
  if (!e.shiftKey && /^[1-8]$/.test(key)) return { type: 'select-slot', index: Number(key) - 1 };
  return null;
}

/** Elements where typing must not trigger shortcuts. Also true inside contenteditable. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  // Range, checkbox, radio, button and colour inputs do not take text.
  return !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file'].includes(type);
}

/**
 * Keys that a focused control uses itself and that must not trigger a shortcut
 * (arrows on a slider, segmented control or tab list; Space/Enter on buttons).
 */
export function isKeyOwnedByControl(target: EventTarget | null, key: string): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const el = target as HTMLElement;
  const arrows = key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown' || key === 'Home' || key === 'End';
  if (!arrows) return false;
  if (el.tagName === 'INPUT') return true; // range/radio/checkbox move with arrows
  return el.closest('[role="tablist"], [role="radiogroup"], [role="listbox"], [role="menu"], [data-own-arrows]') !== null;
}

/** Human-readable list for the About dialog. `mod` is ⌘ on Apple platforms, Ctrl elsewhere. */
export function shortcutList(mod: string): { keys: string[]; action: string }[] {
  return [
    { keys: ['1', '–', '8'], action: 'Select a dancer by pad' },
    { keys: ['←', '→', '↑', '↓'], action: 'Move the selected dancer (hold Shift for bigger steps)' },
    { keys: ['[', ']'], action: 'Turn the selected dancer' },
    { keys: [mod, 'D'], action: 'Clone the selected dancer' },
    { keys: ['Delete'], action: 'Remove the selected dancer' },
    { keys: [mod, 'Z'], action: 'Undo' },
    { keys: ['Shift', mod, 'Z'], action: 'Redo' },
    { keys: ['S'], action: 'Put every dancer back in step' },
    { keys: ['M'], action: 'Mute or unmute' },
    { keys: ['H'], action: 'Hide or show the controls' },
    { keys: ['Esc'], action: 'Close the open panel, then deselect' },
  ];
}

/** True on Apple platforms (⌘ instead of Ctrl in labels). */
export function isApplePlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}
