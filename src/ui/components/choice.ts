/**
 * Choice controls built on native inputs (so keyboard and screen-reader
 * behaviour come for free): segmented control, toggle switch, select, chips.
 */
import { createScope, h, icon, uniqueId } from '../dom';
import type { IconName } from '../dom';

export interface Option<T extends string> {
  value: T;
  label: string;
  /** Small count badge (chips, tabs). */
  count?: number;
}

// ─────────────────────────────────────────────────────────── Segmented ──

export interface SegmentedOptions<T extends string> {
  /** Accessible name of the group. Either this or `labelledBy`. */
  label?: string;
  labelledBy?: string;
  options: readonly Option<T>[];
  value: T;
  /** 'sm' (toolbar), 'md' (default), 'block' (full width). */
  size?: 'sm' | 'md' | 'block';
  className?: string;
  onChange: (value: T) => void;
}

export interface SegmentedHandle<T extends string> {
  el: HTMLElement;
  set(value: T): void;
  destroy(): void;
}

/** A radio group drawn as a segmented control (.seg). Arrow keys move the choice natively. */
export function createSegmented<T extends string>(options: SegmentedOptions<T>): SegmentedHandle<T> {
  const scope = createScope();
  const name = uniqueId('seg');
  const inputs = new Map<T, HTMLInputElement>();
  const el = h('div', {
    class: ['seg', options.size === 'sm' && 'seg--sm', options.size === 'block' && 'seg--block', options.className],
    attrs: { role: 'radiogroup', 'aria-label': options.label, 'aria-labelledby': options.labelledBy },
  });
  for (const option of options.options) {
    const input = h('input', { attrs: { type: 'radio', name, value: option.value } });
    input.checked = option.value === options.value;
    inputs.set(option.value, input);
    scope.on(input, 'change', () => {
      if (input.checked) options.onChange(option.value);
    });
    el.append(h('label', { class: 'seg__item' }, input, h('span', { text: option.label })));
  }
  return {
    el,
    set(value) {
      const input = inputs.get(value);
      if (input && !input.checked) input.checked = true;
    },
    destroy: () => scope.dispose(),
  };
}

// ─────────────────────────────────────────────────────────────── Toggle ──

export interface ToggleOptions {
  label: string;
  /** Second line under the label (row layout). */
  hint?: string;
  checked: boolean;
  /** 'row': label left, switch right, full width (.toggle--row). Default 'inline'. */
  layout?: 'inline' | 'row';
  className?: string;
  onChange: (checked: boolean) => void;
}

export interface ToggleHandle {
  el: HTMLElement;
  input: HTMLInputElement;
  set(checked: boolean): void;
  setHint(text: string): void;
  setDisabled(disabled: boolean): void;
  destroy(): void;
}

/** A switch (checkbox with role="switch"). */
export function createToggle(options: ToggleOptions): ToggleHandle {
  const scope = createScope();
  const input = h('input', { attrs: { type: 'checkbox', role: 'switch' } });
  input.checked = options.checked;
  const hint = h('span', { class: 'toggle__hint', text: options.hint ?? '' });
  hint.hidden = !options.hint;
  const labelText = h('span', { class: 'toggle__text', text: options.label });
  const el = h(
    'label',
    { class: ['toggle', options.layout === 'row' && 'toggle--row', options.className] },
    h('span', { class: 'toggle__label' }, labelText, hint),
    input,
    h('span', { class: 'toggle__track', attrs: { 'aria-hidden': 'true' } }),
  );
  scope.on(input, 'change', () => options.onChange(input.checked));
  return {
    el,
    input,
    set(checked) {
      input.checked = checked;
    },
    setHint(text) {
      hint.textContent = text;
      hint.hidden = !text;
    },
    setDisabled(disabled) {
      input.disabled = disabled;
      el.classList.toggle('is-disabled', disabled);
    },
    destroy: () => scope.dispose(),
  };
}

// ─────────────────────────────────────────────────────────────── Select ──

export interface SelectOptions<T extends string> {
  label?: string;
  labelledBy?: string;
  options: readonly Option<T>[];
  value: T;
  size?: 'sm' | 'md';
  className?: string;
  onChange: (value: T) => void;
}

export interface SelectHandle<T extends string> {
  el: HTMLElement;
  select: HTMLSelectElement;
  set(value: T): void;
  /** Replace the option list (keeps the value if still present). */
  setOptions(options: readonly Option<T>[], value: T): void;
  destroy(): void;
}

/** A native select styled as .select. */
export function createSelect<T extends string>(options: SelectOptions<T>): SelectHandle<T> {
  const scope = createScope();
  const select = h('select', { attrs: { 'aria-label': options.label, 'aria-labelledby': options.labelledBy } });
  const fill = (list: readonly Option<T>[], value: T) => {
    select.replaceChildren(...list.map((o) => h('option', { attrs: { value: o.value }, text: o.label })));
    select.value = value;
  };
  fill(options.options, options.value);
  scope.on(select, 'change', () => options.onChange(select.value as T));
  const el = h('label', { class: ['select', options.size === 'sm' && 'select--sm', options.className] }, select, icon('chev-down', 'sm'));
  return {
    el,
    select,
    set(value) {
      select.value = value;
    },
    setOptions: fill,
    destroy: () => scope.dispose(),
  };
}

// ─────────────────────────────────────────────────────────── Text field ──

export interface TextFieldOptions {
  /** Accessible name (visually hidden unless `visibleLabel`). */
  label: string;
  visibleLabel?: boolean;
  value?: string;
  placeholder?: string;
  type?: 'text' | 'search' | 'url' | 'number';
  icon?: IconName;
  maxLength?: number;
  /** Selects the whole value on focus (share links). */
  selectOnFocus?: boolean;
  readOnly?: boolean;
  className?: string;
  /** Every keystroke. */
  onInput?: (value: string) => void;
  /** On blur or Enter. */
  onChange?: (value: string) => void;
}

export interface TextFieldHandle {
  el: HTMLElement;
  input: HTMLInputElement;
  set(value: string): void;
  focus(): void;
  destroy(): void;
}

/** A text input (.field), optionally with a leading icon and a visible label (.field-label). */
export function createTextField(options: TextFieldOptions): TextFieldHandle {
  const scope = createScope();
  const id = uniqueId('field');
  const input = h('input', {
    attrs: {
      id,
      type: options.type ?? 'text',
      placeholder: options.placeholder,
      maxlength: options.maxLength,
      readonly: options.readOnly,
      'aria-label': options.visibleLabel ? undefined : options.label,
      autocomplete: 'off',
      spellcheck: 'false',
    },
  });
  input.value = options.value ?? '';
  const field = h('div', { class: ['field', !options.icon && 'field--plain', options.className] }, options.icon ? icon(options.icon) : null, input);
  const el = options.visibleLabel
    ? h('div', { class: 'field-stack' }, h('label', { class: 'field-label', attrs: { for: id }, text: options.label }), field)
    : field;
  if (options.onInput) {
    const onInput = options.onInput;
    scope.on(input, 'input', () => onInput(input.value));
  }
  if (options.onChange) {
    const onChange = options.onChange;
    scope.on(input, 'change', () => onChange(input.value));
  }
  if (options.selectOnFocus) scope.on(input, 'focus', () => input.select());
  return {
    el,
    input,
    set(value) {
      if (input.value !== value) input.value = value;
    },
    focus: () => input.focus(),
    destroy: () => scope.dispose(),
  };
}

// ──────────────────────────────────────────────────────────────── Chips ──

export interface ChipsOptions<T extends string> {
  label?: string;
  labelledBy?: string;
  options: readonly Option<T>[];
  /** Single choice (radio) by default; `multiple` uses checkboxes. */
  multiple?: boolean;
  value: T | readonly T[];
  /** Key-cap look (monospace, square-ish) for axis pickers. */
  keycaps?: boolean;
  /** Scroll sideways instead of wrapping. */
  scroll?: boolean;
  className?: string;
  onChange: (value: T[]) => void;
}

export interface ChipsHandle<T extends string> {
  el: HTMLElement;
  set(value: T | readonly T[]): void;
  /** Replace the chips (e.g. when counts change). */
  setOptions(options: readonly Option<T>[], value: T | readonly T[]): void;
  destroy(): void;
}

/** A row of chips (radio or checkbox). onChange always receives an array. */
export function createChips<T extends string>(options: ChipsOptions<T>): ChipsHandle<T> {
  let scope = createScope();
  const name = uniqueId('chips');
  const el = h('div', {
    class: ['chips', options.scroll && 'scroll-x', options.className],
    attrs: { role: options.multiple ? 'group' : 'radiogroup', 'aria-label': options.label, 'aria-labelledby': options.labelledBy },
  });
  let inputs: { value: T; input: HTMLInputElement }[] = [];
  const asArray = (v: T | readonly T[]): readonly T[] => (typeof v === 'string' ? [v] : v);
  const set = (value: T | readonly T[]) => {
    const values = asArray(value);
    for (const item of inputs) item.input.checked = values.includes(item.value);
  };
  const build = (list: readonly Option<T>[], value: T | readonly T[]) => {
    scope.dispose();
    scope = createScope();
    inputs = [];
    el.replaceChildren();
    for (const option of list) {
      const input = h('input', { attrs: { type: options.multiple ? 'checkbox' : 'radio', name, value: option.value } });
      inputs.push({ value: option.value, input });
      scope.on(input, 'change', () => options.onChange(inputs.filter((i) => i.input.checked).map((i) => i.value)));
      const text = h('span', {}, option.label, option.count === undefined ? null : h('b', { text: String(option.count) }));
      el.append(h('label', { class: ['chip', options.keycaps && 'chip--key'] }, input, text));
    }
    set(value);
  };
  build(options.options, options.value);
  return { el, set, setOptions: build, destroy: () => scope.dispose() };
}
