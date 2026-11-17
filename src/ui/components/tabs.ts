/**
 * Tabs with proper roles: tablist / tab / tabpanel, roving tabindex,
 * Left/Right/Home/End navigation with automatic activation.
 */
import { createScope, h } from '../dom';

export interface TabSpec<T extends string> {
  id: T;
  label: string;
  /** Count badge. */
  count?: number;
  /** Extra class on the tab button (e.g. 'tab--dance'). */
  className?: string;
}

export interface TabsOptions<T extends string> {
  label: string;
  tabs: readonly TabSpec<T>[];
  value: T;
  /** 'lg' = modal header tabs (.tabs--lg). */
  size?: 'md' | 'lg';
  className?: string;
  onChange?: (id: T) => void;
}

export interface TabsHandle<T extends string> {
  /** The tablist element. */
  el: HTMLElement;
  /** One .tabpanel element per tab, to fill with content and place anywhere. */
  panels: Record<T, HTMLElement>;
  value(): T;
  select(id: T, focus?: boolean): void;
  setCount(id: T, count: number | undefined): void;
  destroy(): void;
}

let tabsUid = 0;

export function createTabs<T extends string>(options: TabsOptions<T>): TabsHandle<T> {
  const scope = createScope();
  tabsUid += 1;
  const base = `tabs${tabsUid}`;
  const el = h('div', {
    class: ['tabs', options.size === 'lg' && 'tabs--lg', options.className],
    attrs: { role: 'tablist', 'aria-label': options.label },
  });
  const buttons = new Map<T, HTMLButtonElement>();
  const badges = new Map<T, HTMLElement>();
  const panels = {} as Record<T, HTMLElement>;
  let current = options.value;

  for (const tab of options.tabs) {
    const tabId = `${base}-tab-${tab.id}`;
    const panelId = `${base}-panel-${tab.id}`;
    const badge = h('b', { text: tab.count === undefined ? '' : String(tab.count) });
    badge.hidden = tab.count === undefined;
    badges.set(tab.id, badge);
    const button = h(
      'button',
      {
        class: ['tab', tab.className],
        attrs: { type: 'button', role: 'tab', id: tabId, 'aria-controls': panelId },
      },
      tab.label,
      badge,
    );
    scope.on(button, 'click', () => select(tab.id));
    buttons.set(tab.id, button);
    el.append(button);
    panels[tab.id] = h('div', { class: 'tabpanel', attrs: { role: 'tabpanel', id: panelId, 'aria-labelledby': tabId, tabindex: 0 } });
  }

  function select(id: T, focus = false): void {
    if (!buttons.has(id)) return;
    const changed = id !== current;
    current = id;
    for (const [tabId, button] of buttons) {
      const on = tabId === id;
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
      // Visibility comes from .tabpanel / .tabpanel.is-active, so layouts can override it.
      panels[tabId].classList.toggle('is-active', on);
    }
    if (focus) buttons.get(id)?.focus();
    if (changed) options.onChange?.(id);
  }

  scope.on(el, 'keydown', (event) => {
    const ids = options.tabs.map((t) => t.id).filter((id) => {
      const b = buttons.get(id);
      return b !== undefined && b.offsetParent !== null; // skip tabs hidden by CSS
    });
    if (ids.length === 0) return;
    const index = Math.max(0, ids.indexOf(current));
    let next: T | undefined;
    if (event.key === 'ArrowRight') next = ids[(index + 1) % ids.length];
    else if (event.key === 'ArrowLeft') next = ids[(index - 1 + ids.length) % ids.length];
    else if (event.key === 'Home') next = ids[0];
    else if (event.key === 'End') next = ids[ids.length - 1];
    if (next === undefined) return;
    event.preventDefault();
    select(next, true);
  });

  select(current);

  return {
    el,
    panels,
    value: () => current,
    select,
    setCount(id, count) {
      const badge = badges.get(id);
      if (!badge) return;
      badge.textContent = count === undefined ? '' : String(count);
      badge.hidden = count === undefined;
    },
    destroy: () => scope.dispose(),
  };
}
