/**
 * Tiny DOM toolkit for the UI: a typed element factory, the inline SVG icon
 * sprite, and a cleanup scope for listeners.
 *
 * Never build DOM from strings that contain dynamic data: use `h()` with text
 * children (they become text nodes) or set `textContent`.
 */

/** Attribute values: `false`/`null`/`undefined` omit the attribute, `true` sets it empty. */
export type AttrValue = string | number | boolean | null | undefined;

export interface ElementProps {
  /** Space-separated class names. Falsy entries in an array are skipped. */
  class?: string | readonly (string | false | null | undefined)[];
  /** Plain attributes (aria-*, role, type, data-*…). */
  attrs?: Record<string, AttrValue>;
  /** CSS custom properties and inline styles, e.g. { '--c': '#ff0' }. */
  style?: Record<string, string>;
  /** Text content (set before children are appended). */
  text?: string;
  /** Event listeners. Only use for elements whose lifetime equals their owner's; otherwise use a Scope. */
  on?: { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };
}

export type Child = Node | string | number | false | null | undefined;

/**
 * Create an element: `h('button', { class: 'btn', attrs: { type: 'button' } }, 'Save')`.
 * Strings become text nodes, so dynamic text is always safe.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, ...children);
  return el;
}

/** Apply ElementProps to an existing element. */
export function applyProps(el: HTMLElement, props: ElementProps): void {
  if (props.class) el.className = classNames(props.class);
  if (props.attrs) for (const [name, value] of Object.entries(props.attrs)) setAttr(el, name, value);
  if (props.style) for (const [name, value] of Object.entries(props.style)) el.style.setProperty(name, value);
  if (props.text !== undefined) el.textContent = props.text;
  if (props.on) {
    for (const [type, handler] of Object.entries(props.on)) {
      if (handler) el.addEventListener(type, handler as EventListener);
    }
  }
}

/** Append children, skipping falsy ones; strings and numbers become text nodes. */
export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
}

/** Join class names, skipping falsy entries. */
export function classNames(value: string | readonly (string | false | null | undefined)[]): string {
  return typeof value === 'string' ? value : value.filter(Boolean).join(' ');
}

/** Set or remove one attribute. */
export function setAttr(el: Element, name: string, value: AttrValue): void {
  if (value === false || value === null || value === undefined) el.removeAttribute(name);
  else el.setAttribute(name, value === true ? '' : String(value));
}

let uid = 0;
/** A document-unique id with the given prefix (for aria-labelledby, radio names…). */
export function uniqueId(prefix = 'ui'): string {
  uid += 1;
  return `${prefix}-${uid}`;
}

// ───────────────────────────────────────────────────────────── Cleanup ──

/**
 * Collects cleanups. Every component and panel owns one and calls `dispose()`
 * in its destroy function, so no listener outlives its owner.
 */
export interface Scope {
  /** addEventListener now, removeEventListener on dispose. */
  on<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void;
  on<K extends keyof WindowEventMap>(target: Window, type: K, handler: (event: WindowEventMap[K]) => void, options?: AddEventListenerOptions): void;
  on<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    handler: (event: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void;
  /** Run `cleanup` on dispose (unsubscribe functions, timers…). Returns it for convenience. */
  add<T extends () => void>(cleanup: T): T;
  /** Run every cleanup (last added first). Safe to call twice. */
  dispose(): void;
}

export function createScope(): Scope {
  let cleanups: (() => void)[] = [];
  return {
    on(target: EventTarget, type: string, handler: (event: never) => void, options?: AddEventListenerOptions) {
      const listener = handler as unknown as EventListener;
      target.addEventListener(type, listener, options);
      cleanups.push(() => target.removeEventListener(type, listener, options));
    },
    add(cleanup) {
      cleanups.push(cleanup);
      return cleanup;
    },
    dispose() {
      const list = cleanups;
      cleanups = [];
      for (let i = list.length - 1; i >= 0; i--) {
        try {
          list[i]!();
        } catch (error) {
          console.error(error);
        }
      }
    },
  } as Scope;
}

// ──────────────────────────────────────────────────────────────── Icons ──

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Icon artwork (24 grid, 1.8 stroke; shapes marked solid are filled). Static, trusted markup. */
const ICON_PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  'chev-down': '<path d="M6.5 9.5l5.5 5.5 5.5-5.5"/>',
  'chev-up': '<path d="M6.5 14.5L12 9l5.5 5.5"/>',
  save: '<path d="M7.5 4h9A1.5 1.5 0 0 1 18 5.5V20l-6-4.2L6 20V5.5A1.5 1.5 0 0 1 7.5 4z"/>',
  library:
    '<rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.8"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  instagram: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.9" cy="7.1" r="0.6" fill="currentColor" stroke="none"/>',
  link: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1-1"/>',
  camera: '<path d="M4 9a2 2 0 0 1 2-2h1.6l1.3-2h6.2l1.3 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.4"/>',
  fullscreen: '<path d="M4.5 9V4.5H9M19.5 9V4.5H15M4.5 15v4.5H9M19.5 15v4.5H15"/>',
  'fullscreen-exit': '<path d="M9 4.5V9H4.5M15 4.5V9h4.5M9 19.5V15H4.5M15 19.5V15h4.5"/>',
  'eye-off': '<path d="M3 12s3.4-6 9-6 9 6 9 6-3.4 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.6"/><path d="M4.5 4.5l15 15"/>',
  eye: '<path d="M3 12s3.4-6 9-6 9 6 9 6-3.4 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.6"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.5-1.2 1-1.2 1.9"/><path d="M12 16.8h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6h.01"/>',
  swap: '<path d="M4 8.5h14l-3-3M20 15.5H6l3 3"/>',
  clone: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.2"/><path d="M5 15V6.7A1.7 1.7 0 0 1 6.7 5H15"/>',
  trash: '<path d="M5 7.5h14M10 7.5V5h4v2.5M7 7.5l.9 11.5h8.2L17 7.5M10.2 11v5M13.8 11v5"/>',
  note: '<path d="M9.5 17.5V6.2l9-1.7v11"/><circle cx="7" cy="17.5" r="2.5"/><circle cx="16" cy="15.5" r="2.5"/>',
  volume: '<path d="M4 10v4h3l5 4V6l-5 4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 6.6a7.6 7.6 0 0 1 0 10.8"/>',
  mute: '<path d="M4 10v4h3l5 4V6l-5 4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  play: '<path d="M8 5.2v13.6a.6.6 0 0 0 .9.5l11-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z" fill="currentColor" stroke="none"/>',
  pause:
    '<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  scene: '<rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="15.5" cy="10" r="1.7"/><path d="M3.8 16l4.7-4 3.8 3 2.6-1.8 5.3 3.6"/>',
  upload: '<path d="M12 15.5V5M8 9l4-4 4 4M5 15.5v2.8A1.7 1.7 0 0 0 6.7 20h10.6a1.7 1.7 0 0 0 1.7-1.7v-2.8"/>',
  download: '<path d="M12 4.5V15M8 11l4 4 4-4M5 15.5v2.8A1.7 1.7 0 0 0 6.7 20h10.6a1.7 1.7 0 0 0 1.7-1.7v-2.8"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5L20 20"/>',
  warn: '<path d="M12 4.2L21 19.5H3z"/><path d="M12 10v4.2M12 16.9h.01"/>',
  more: '<circle cx="5.5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  reset: '<path d="M5.2 12a6.8 6.8 0 1 0 2.1-4.9"/><path d="M5 4.5v4h4"/>',
  undo: '<path d="M9 14.5L4.5 10 9 5.5"/><path d="M4.8 10H14a5.5 5.5 0 0 1 0 11h-3"/>',
  redo: '<path d="M15 14.5l4.5-4.5L15 5.5"/><path d="M19.2 10H10a5.5 5.5 0 0 0 0 11h3"/>',
  metronome: '<path d="M9.5 4h5l3.5 16H6z"/><path d="M12 15l5-8.5M8.2 15h7.6"/>',
  figure: '<circle cx="12" cy="5.5" r="2.3"/><path d="M12 9.5v5M12 14.5l-3.5 5.5M12 14.5l3.5 5.5M5.5 8l6.5 3 6.5-4"/>',
  remix: '<path d="M4 7h4.5c4 0 4 10 8 10H20M4 17h4.5c1.6 0 2.5-1.6 3.2-3.4M14.3 10.4C15 8.6 16 7 17.5 7H20M17.5 4.5L20 7l-2.5 2.5M17.5 14.5L20 17l-2.5 2.5"/>',
  keyboard: '<rect x="3" y="6.5" width="18" height="11" rx="2.2"/><path d="M7 10.5h.01M10.3 10.5h.01M13.7 10.5h.01M17 10.5h.01M8 14h8"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;
export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];

const SPRITE_ID = 'thunes-icon-sprite';

/**
 * Insert the icon sprite into the document once (idempotent). `mountUi` calls
 * this; lab pages that use components without the shell must call it too.
 */
export function ensureIconSprite(doc: Document = document): void {
  if (doc.getElementById(SPRITE_ID)) return;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.id = SPRITE_ID;
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.position = 'absolute';
  const defs = doc.createElementNS(SVG_NS, 'defs');
  // The artwork is a static constant in this module, never user data.
  defs.innerHTML = (Object.entries(ICON_PATHS) as [IconName, string][])
    .map(([name, body]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`)
    .join('');
  svg.appendChild(defs);
  doc.body.prepend(svg);
}

/** An inline icon: `<svg class="icon"><use href="#i-name"/></svg>`, hidden from assistive tech. */
export function icon(name: IconName, size: 'sm' | 'md' | 'lg' = 'md', extraClass = ''): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', ['icon', size === 'md' ? '' : `icon--${size}`, extraClass].filter(Boolean).join(' '));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

/** Swap the symbol an icon created by `icon()` shows. */
export function setIcon(svg: SVGSVGElement, name: IconName): void {
  svg.firstElementChild?.setAttribute('href', `#i-${name}`);
}

/** The app name in the display face (a text fallback where the logo does not fit). */
export function wordmark(name: string, tag: 'span' | 'h1' = 'span'): HTMLElement {
  return h(tag, { class: 'wordmark' }, h('span', { class: 'wordmark__text', text: name }));
}

/**
 * The Thunes' hand-painted logo (a CSS mask, so it takes the colour of
 * `--logo-color`). `label` names it for assistive technology.
 */
export function logo(label: string, tag: 'span' | 'h1' = 'span'): HTMLElement {
  return h(tag, { class: 'logo', attrs: { role: 'img', 'aria-label': label } });
}

/** A link that opens in a new tab and says so to screen readers. */
export function externalLink(href: string, label: string, ...children: Child[]): HTMLAnchorElement {
  return h('a', { attrs: { href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${label} (opens in a new tab)` } }, ...children);
}

/** True when the touch layout (bottom sheets) is active. Matches the CSS breakpoint. */
export const PHONE_QUERY = '(max-width: 820px)';
export function isPhoneLayout(): boolean {
  return typeof matchMedia === 'function' && matchMedia(PHONE_QUERY).matches;
}
