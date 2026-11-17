/**
 * Buttons: text buttons (optionally with an icon) and icon buttons with a
 * tooltip. Classes follow the design: .btn, .btn--primary|ghost|danger|line,
 * .btn--sm|lg, .btn--icon, .btn--round, .btn--block.
 */
import { createScope, h, icon, setIcon } from '../dom';
import type { IconName } from '../dom';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger' | 'line';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonOptions {
  label: string;
  icon?: IconName;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** Extra classes. */
  className?: string;
  /** Toggle buttons: sets aria-pressed. */
  pressed?: boolean;
  disabled?: boolean;
  onClick?: (event: MouseEvent) => void;
}

export interface ButtonHandle {
  el: HTMLButtonElement;
  setLabel(label: string): void;
  setIcon(name: IconName): void;
  setPressed(pressed: boolean): void;
  setDisabled(disabled: boolean): void;
  destroy(): void;
}

function buttonClasses(variant: ButtonVariant, size: ButtonSize, extra: (string | false | null | undefined)[]): string {
  return ['btn', variant !== 'default' && `btn--${variant}`, size !== 'md' && `btn--${size}`, ...extra].filter(Boolean).join(' ');
}

/** A text button. */
export function createButton(options: ButtonOptions): ButtonHandle {
  const scope = createScope();
  const label = h('span', { class: 'btn__label', text: options.label });
  const glyph = options.icon ? icon(options.icon, options.size === 'lg' ? 'md' : 'sm') : null;
  const el = h(
    'button',
    {
      class: buttonClasses(options.variant ?? 'default', options.size ?? 'md', [options.block && 'btn--block', options.className]),
      attrs: { type: 'button', 'aria-pressed': options.pressed === undefined ? undefined : String(options.pressed), disabled: options.disabled },
    },
    glyph,
    label,
  );
  if (options.onClick) scope.on(el, 'click', options.onClick);
  return {
    el,
    setLabel: (text) => {
      label.textContent = text;
    },
    setIcon: (name) => {
      if (glyph) setIcon(glyph, name);
    },
    setPressed: (pressed) => el.setAttribute('aria-pressed', String(pressed)),
    setDisabled: (disabled) => {
      el.disabled = disabled;
    },
    destroy: () => scope.dispose(),
  };
}

export interface IconButtonOptions {
  icon: IconName;
  /** Accessible name (also the tooltip text unless `tip` is given). */
  label: string;
  /** Tooltip text; false for none. Default: the label. */
  tip?: string | false;
  /** Key-cap hint shown in the tooltip, e.g. 'H'. */
  kbd?: string;
  /** Tooltip placement: centred below (default), aligned to the right edge, or above. */
  tipAlign?: 'center' | 'end' | 'up';
  variant?: Exclude<ButtonVariant, 'line'>;
  size?: 'sm' | 'md';
  round?: boolean;
  className?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: (event: MouseEvent) => void;
}

export interface IconButtonHandle extends ButtonHandle {
  /** Change the accessible name and tooltip together. */
  setLabel(label: string): void;
}

/** A square icon button with an accessible name and an optional tooltip (.has-tip > .tip). */
export function createIconButton(options: IconButtonOptions): IconButtonHandle {
  const scope = createScope();
  const glyph = icon(options.icon, options.size === 'sm' ? 'sm' : 'md');
  const tipText = options.tip === false ? null : (options.tip ?? options.label);
  const tipLabel = tipText === null ? null : h('span', { text: tipText });
  const tip =
    tipLabel === null
      ? null
      : h(
          'span',
          {
            class: ['tip', options.tipAlign === 'end' && 'tip--end', options.tipAlign === 'up' && 'tip--up'],
            attrs: { 'aria-hidden': 'true' },
          },
          tipLabel,
          options.kbd ? h('kbd', { class: 'kbd', text: options.kbd }) : null,
        );
  const el = h(
    'button',
    {
      class: [
        buttonClasses(options.variant ?? 'default', options.size ?? 'md', ['btn--icon', options.round && 'btn--round', tip !== null && 'has-tip', options.className]),
      ],
      attrs: {
        type: 'button',
        'aria-label': options.label,
        'aria-keyshortcuts': options.kbd,
        'aria-pressed': options.pressed === undefined ? undefined : String(options.pressed),
        disabled: options.disabled,
      },
    },
    glyph,
    tip,
  );
  if (options.onClick) scope.on(el, 'click', options.onClick);
  return {
    el,
    setLabel: (text) => {
      el.setAttribute('aria-label', text);
      if (tipLabel && options.tip === undefined) tipLabel.textContent = text;
    },
    setIcon: (name) => setIcon(glyph, name),
    setPressed: (pressed) => el.setAttribute('aria-pressed', String(pressed)),
    setDisabled: (disabled) => {
      el.disabled = disabled;
    },
    destroy: () => scope.dispose(),
  };
}
