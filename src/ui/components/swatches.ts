/**
 * Colour swatches (.swatch-grid / .swatch-row): a radio group of presets plus
 * an optional custom colour (native colour input behind the rainbow chip).
 */
import { createScope, h, icon, uniqueId } from '../dom';

export interface SwatchOption {
  /** Value reported to onChange (a preset id or a '#rrggbb' colour). */
  value: string;
  /** Accessible name and tooltip. */
  name: string;
  /** CSS background for the chip (colour or gradient). */
  swatch: string;
}

export interface SwatchesOptions {
  label?: string;
  labelledBy?: string;
  options: readonly SwatchOption[];
  /** Current value. A value that matches no option selects the custom chip (when enabled). */
  value: string | null;
  /** 'grid' (big squares, --swatch-cols per row) or 'row' (small dots). */
  layout?: 'grid' | 'row';
  columns?: number;
  /** Adds a custom colour chip. `customValue` is the colour it shows/starts from. */
  custom?: { label?: string; color: string };
  className?: string;
  /** A preset was picked: value is the option's value. */
  onChange: (value: string) => void;
  /** The custom colour changed: transient while the native picker is being dragged. */
  onCustom?: (color: string, transient: boolean) => void;
  /** End of a custom colour gesture (bind to store.commit()). */
  onCustomCommit?: () => void;
}

export interface SwatchesHandle {
  el: HTMLElement;
  /**
   * Select a preset value. A '#rrggbb' value that matches no preset selects the
   * custom chip with that colour; any other unmatched value (e.g. 'custom')
   * selects it with `customColor`. null clears the selection.
   */
  set(value: string | null, customColor?: string): void;
  destroy(): void;
}

export function createSwatches(options: SwatchesOptions): SwatchesHandle {
  const scope = createScope();
  const name = uniqueId('swatch');
  const dots = options.layout === 'row';
  const el = h('div', {
    class: [dots ? 'swatch-row' : 'swatch-grid', options.className],
    attrs: { role: 'radiogroup', 'aria-label': options.label, 'aria-labelledby': options.labelledBy },
    style: options.columns ? { '--swatch-cols': String(options.columns) } : {},
  });
  const radios = new Map<string, HTMLInputElement>();
  for (const option of options.options) {
    const input = h('input', { attrs: { type: 'radio', name, value: option.value, 'aria-label': option.name } });
    radios.set(option.value, input);
    scope.on(input, 'change', () => {
      if (input.checked) options.onChange(option.value);
    });
    el.append(
      h(
        'label',
        { class: ['swatch', dots && 'swatch--dot'], attrs: { title: option.name } },
        input,
        h('span', { class: 'swatch__chip', style: { '--sw': option.swatch } }),
      ),
    );
  }

  let customWrap: HTMLElement | null = null;
  let colorInput: HTMLInputElement | null = null;
  if (options.custom) {
    const label = options.custom.label ?? 'Custom colour';
    const input = h('input', { attrs: { type: 'color', 'aria-label': label } });
    input.value = options.custom.color;
    colorInput = input;
    customWrap = h(
      'label',
      { class: ['swatch', 'swatch--custom', dots && 'swatch--dot'], attrs: { title: label } },
      input,
      h('span', { class: 'swatch__chip' }, dots ? null : icon('plus')),
    );
    el.append(customWrap);
    let picking = false;
    scope.on(input, 'input', () => {
      picking = true;
      markCustom(input.value);
      options.onCustom?.(input.value, true);
    });
    scope.on(input, 'change', () => {
      markCustom(input.value);
      if (picking) {
        picking = false;
        options.onCustomCommit?.();
      } else {
        options.onCustom?.(input.value, false);
      }
    });
    // Clicking the chip of an already chosen custom colour re-applies it.
    scope.on(input, 'click', () => {
      if (!customWrap?.classList.contains('is-checked')) options.onCustom?.(input.value, false);
    });
  }

  function markCustom(color: string | null): void {
    if (!customWrap) return;
    const on = color !== null;
    customWrap.classList.toggle('is-checked', on);
    if (on) {
      customWrap.style.setProperty('--custom', color);
      for (const radio of radios.values()) radio.checked = false;
    }
  }

  const set = (value: string | null, customColor?: string) => {
    const radio = value === null ? undefined : radios.get(value);
    if (radio) {
      radio.checked = true;
      markCustom(null);
      return;
    }
    for (const r of radios.values()) r.checked = false;
    const hex = /^#[0-9a-f]{6}$/i;
    const color = value === null ? null : hex.test(value) ? value : (customColor ?? options.custom?.color ?? null);
    if (colorInput && color && hex.test(color)) {
      colorInput.value = color;
      markCustom(color);
    } else {
      markCustom(null);
    }
  };
  set(options.value);

  return { el, set, destroy: () => scope.dispose() };
}
