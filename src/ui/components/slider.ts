/**
 * Slider row: label, range input, live readout (.slider-row).
 *
 * Gestures map onto the store's undo model:
 *   - pointer drags send `onChange(v, true)` (transient) and one `onCommit()` on release;
 *   - keyboard steps send `onChange(v, false)` (each one is its own undo step);
 *   - double-clicking the label or the readout resets to the field default;
 *   - clicking the readout (or pressing Enter on the slider) lets you type a number.
 *
 * Typical store binding:
 *   createSlider({ label: 'Speed', field: DANCER_FIELDS.speed, value,
 *     onChange: (v, transient) => store.updateDancer(id, { speed: v }, { transient }),
 *     onCommit: () => store.commit() });
 */
import type { NumberField } from '../../config';
import { createScope, h, uniqueId } from '../dom';
import { clampToField, fillPercent, formatValue, formatValueText, parseValue } from '../format';

export interface SliderOptions {
  label: string;
  field: NumberField;
  value: number;
  /** Custom readout text (default: formatValue with the field's unit and digits). */
  format?: (value: number) => string;
  /** Called on every change. `transient` is true while a pointer drag is in progress. */
  onChange: (value: number, transient: boolean) => void;
  /** Called once when a drag ends (default: nothing). Bind to store.commit(). */
  onCommit?: () => void;
  /** Value used by double-click reset (default field.default). */
  resetValue?: number;
  className?: string;
}

export interface SliderHandle {
  el: HTMLElement;
  input: HTMLInputElement;
  /** Reflect an outside change (ignored while the user is dragging this slider). */
  set(value: number): void;
  setDisabled(disabled: boolean): void;
  destroy(): void;
}

export function createSlider(options: SliderOptions): SliderHandle {
  const scope = createScope();
  const { field } = options;
  const format = options.format ?? ((v: number) => formatValue(v, field));
  const id = uniqueId('slider');
  const input = h('input', {
    class: 'slider',
    attrs: { id, type: 'range', min: field.min, max: field.max, step: field.step },
  });
  const label = h('label', { class: 'slider-row__label', attrs: { for: id }, text: options.label });
  const readout = h('output', {
    class: 'slider-row__value',
    attrs: { for: id, title: 'Click to type a value · double-click to reset' },
  });
  const el = h('div', { class: ['slider-row', options.className] }, label, input, readout);

  let value = clampToField(options.value, field);
  let dragging = false;
  let editor: HTMLInputElement | null = null;

  const render = () => {
    input.value = String(value);
    input.style.setProperty('--val', fillPercent(value, field));
    const text = format(value);
    if (!editor) readout.textContent = text;
    input.setAttribute('aria-valuetext', format === options.format ? text : formatValueText(value, field));
  };
  render();

  const emit = (next: number, transient: boolean) => {
    next = clampToField(next, field);
    if (next === value && transient) return;
    value = next;
    render();
    options.onChange(value, transient);
  };

  // Pointer drags are transient; the release commits once.
  scope.on(input, 'pointerdown', () => {
    dragging = true;
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    options.onCommit?.();
  };
  scope.on(window, 'pointerup', endDrag);
  scope.on(window, 'pointercancel', endDrag);
  scope.on(input, 'input', () => emit(Number(input.value), dragging));
  scope.on(input, 'change', () => {
    // A drag can end without a pointerup reaching the window (e.g. focus loss).
    if (dragging) endDrag();
  });
  scope.on(input, 'keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      openEditor();
    }
  });

  const reset = () => emit(options.resetValue ?? field.default, false);
  scope.on(label, 'dblclick', (event) => {
    event.preventDefault();
    reset();
  });
  scope.on(readout, 'dblclick', (event) => {
    event.preventDefault();
    closeEditor(false);
    reset();
  });

  // Type-in editor that temporarily replaces the readout text.
  const openEditor = () => {
    if (editor || input.disabled) return;
    const box = h('input', {
      class: 'slider-row__edit',
      attrs: { type: 'text', inputmode: 'decimal', 'aria-label': `${options.label} value`, autocomplete: 'off', spellcheck: 'false' },
    });
    box.value = (field.digits ?? 0) > 0 ? value.toFixed(field.digits) : String(Math.round(value));
    editor = box;
    readout.replaceChildren(box);
    readout.classList.add('is-editing');
    box.focus();
    box.select();
    box.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        closeEditor(true);
        input.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeEditor(false);
        input.focus();
      }
    });
    box.addEventListener('blur', () => closeEditor(true));
  };
  const closeEditor = (apply: boolean) => {
    const box = editor;
    if (!box) return;
    editor = null;
    readout.classList.remove('is-editing');
    const parsed = apply ? parseValue(box.value, field) : null;
    box.remove();
    if (parsed !== null && parsed !== value) emit(parsed, false);
    else render();
  };
  scope.on(readout, 'click', () => openEditor());
  scope.add(() => closeEditor(false));

  return {
    el,
    input,
    set(next) {
      if (dragging || editor) return;
      const clamped = clampToField(next, field);
      if (clamped === value) return;
      value = clamped;
      render();
    },
    setDisabled(disabled) {
      input.disabled = disabled;
      el.classList.toggle('is-disabled', disabled);
    },
    destroy: () => scope.dispose(),
  };
}
