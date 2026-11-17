/**
 * Cards (.card-grid > .card) for pickers and libraries, an upload card, and
 * thumbnails that fall back to a glyph while an image loads or when it is blank.
 */
import { createScope, h, icon } from '../dom';
import type { IconName } from '../dom';

// ───────────────────────────────────────────────────────────── Thumbnail ──

export interface ThumbHandle {
  el: HTMLElement;
  /** Show this image (data URL / URL / promise of one). Blank (≤ 1 px) images keep the fallback. */
  set(src: string | Promise<string> | null): void;
  destroy(): void;
}

/**
 * A thumbnail slot: shows `fallback` (an icon) until the image has loaded with
 * real content. `className` is the wrapper class ('card__thumb', 'slot__thumb'…).
 */
export function createThumb(className: string, fallback: IconName = 'figure'): ThumbHandle {
  const glyph = icon(fallback, 'lg', 'thumb__fallback');
  const img = h('img', { class: 'thumb__img', attrs: { alt: '', draggable: 'false', decoding: 'async' } });
  img.hidden = true;
  const el = h('span', { class: ['thumb', className], attrs: { 'aria-hidden': 'true' } }, glyph, img);
  let token = 0;
  const showImage = (on: boolean) => {
    img.hidden = !on;
    glyph.style.display = on ? 'none' : '';
  };
  const set = (src: string | Promise<string> | null) => {
    const mine = ++token;
    showImage(false);
    if (src === null) return;
    void Promise.resolve(src)
      .then((url) => {
        if (mine !== token || !url) return;
        img.onload = () => {
          if (mine === token) showImage(img.naturalWidth > 1 && img.naturalHeight > 1);
        };
        img.onerror = () => {
          if (mine === token) showImage(false);
        };
        img.src = url;
      })
      .catch(() => {
        /* keep the fallback */
      });
  };
  return {
    el,
    set,
    destroy() {
      token++;
      img.onload = null;
      img.onerror = null;
    },
  };
}

// ────────────────────────────────────────────────────────────────── Card ──

export interface CardOptions {
  title: string;
  meta?: string;
  /** Image source (or promise); shows the fallback glyph while loading or when blank. */
  thumb?: string | Promise<string> | null;
  fallbackIcon?: IconName;
  /** Accent colour for the glow behind the thumbnail (--c). */
  color?: string;
  selected?: boolean;
  /** Accessible name if it should differ from title + meta. */
  label?: string;
  onClick?: (event: MouseEvent) => void;
}

export interface CardHandle {
  el: HTMLButtonElement;
  setSelected(selected: boolean): void;
  setThumb(src: string | Promise<string> | null): void;
  destroy(): void;
}

export function createCard(options: CardOptions): CardHandle {
  const scope = createScope();
  const thumb = createThumb('card__thumb', options.fallbackIcon);
  const el = h(
    'button',
    {
      class: 'card',
      attrs: { type: 'button', 'aria-pressed': String(Boolean(options.selected)), 'aria-label': options.label },
      style: options.color ? { '--c': options.color } : {},
    },
    h('span', { class: 'card__check', attrs: { 'aria-hidden': 'true' } }, icon('check')),
    thumb.el,
    h('span', { class: 'card__title', text: options.title }),
    options.meta ? h('span', { class: 'card__meta', text: options.meta }) : null,
  );
  thumb.set(options.thumb ?? null);
  const setSelected = (on: boolean) => {
    el.classList.toggle('is-selected', on);
    el.setAttribute('aria-pressed', String(on));
  };
  setSelected(Boolean(options.selected));
  if (options.onClick) scope.on(el, 'click', options.onClick);
  return {
    el,
    setSelected,
    setThumb: thumb.set,
    destroy() {
      thumb.destroy();
      scope.dispose();
    },
  };
}

/** The dashed "add your own" card that opens a file chooser or an upload flow. */
export function createUploadCard(options: { title: string; meta?: string; icon?: IconName; onClick: () => void }): {
  el: HTMLButtonElement;
  destroy(): void;
} {
  const scope = createScope();
  const el = h(
    'button',
    { class: 'card card--upload', attrs: { type: 'button' } },
    h('span', { class: 'card__badge', attrs: { 'aria-hidden': 'true' } }, icon(options.icon ?? 'upload')),
    h('span', { class: 'card__title', text: options.title }),
    options.meta ? h('span', { class: 'card__meta', text: options.meta }) : null,
  );
  scope.on(el, 'click', options.onClick);
  return { el, destroy: () => scope.dispose() };
}

// ──────────────────────────────────────────────────────────── Card grid ──

export interface CardGridOptions<T> {
  /** Accessible name of the list. */
  label: string;
  items: readonly T[];
  key: (item: T) => string;
  render: (item: T) => Omit<CardOptions, 'selected' | 'onClick'>;
  selected?: string | null;
  onSelect: (item: T) => void;
  /** Optional leading upload card. */
  upload?: { title: string; meta?: string; onClick: () => void };
  /** Text shown when there are no items. */
  empty?: string;
  /** Minimum card width (CSS length) for the auto-fill grid. */
  minWidth?: string;
}

export interface CardGridHandle<T> {
  el: HTMLElement;
  /** Replace the items (cards are rebuilt) and/or the selection. */
  update(items: readonly T[], selected?: string | null): void;
  /** Change only the selection. */
  select(key: string | null): void;
  destroy(): void;
}

export function createCardGrid<T>(options: CardGridOptions<T>): CardGridHandle<T> {
  const el = h('div', {
    class: 'card-grid',
    attrs: { role: 'group', 'aria-label': options.label },
    style: options.minWidth ? { '--card-min': options.minWidth } : {},
  });
  const upload = options.upload ? createUploadCard(options.upload) : null;
  let cards: { key: string; card: CardHandle }[] = [];
  let selected = options.selected ?? null;
  const emptyNote = h('p', { class: 'card-grid__empty', text: options.empty ?? 'Nothing here yet.' });

  const update = (items: readonly T[], nextSelected: string | null = selected) => {
    for (const { card } of cards) card.destroy();
    selected = nextSelected;
    cards = items.map((item) => {
      const key = options.key(item);
      const card = createCard({ ...options.render(item), selected: key === selected, onClick: () => options.onSelect(item) });
      return { key, card };
    });
    el.replaceChildren(...(upload ? [upload.el] : []), ...cards.map((c) => c.card.el), ...(items.length === 0 && !upload ? [emptyNote] : []));
  };
  update(options.items);
  return {
    el,
    update,
    select(key) {
      selected = key;
      for (const c of cards) c.card.setSelected(c.key === key);
    },
    destroy() {
      for (const { card } of cards) card.destroy();
      upload?.destroy();
    },
  };
}
