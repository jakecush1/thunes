// UI shell check: splash, HUD controls, dialogs, dock, shortcuts, view-only mode,
// toasts and basic accessibility, at desktop (1440×900) and phone (390×844) sizes.
// Usage: node scripts/e2e/ui-shell.mjs [--preview]
import fs from 'node:fs/promises';
import { createChecks, frames, openPage, shot, startServer, waitForApp } from './harness.mjs';

const mode = process.argv.includes('--preview') ? 'preview' : 'dev';
const server = await startServer({ mode });
const checks = createChecks();
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Read a little of the app state. */
const ui = (page) => page.evaluate(() => __thunes.store.getState().ui);
const dancers = (page) => page.evaluate(() => __thunes.store.getState().dancers.map((d) => ({ id: d.id, x: d.x, z: d.z, rotation: d.rotation })));
const visible = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }, selector);

/** Every visible interactive element in the UI layer, with its accessible name (simple heuristic). */
const auditNames = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('.ui-root');
    const items = [...root.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])')];
    const out = [];
    for (const el of items) {
      if (el.closest('[inert]') || el.getClientRects().length === 0) continue;
      if (el.matches('input[type="file"], .sr-only')) continue;
      const style = getComputedStyle(el);
      // Native radios/checkboxes in the design are opacity 0 overlays: still interactive.
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const labelledBy = (el.getAttribute('aria-labelledby') || '')
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ');
      const name = (
        el.getAttribute('aria-label') ||
        labelledBy ||
        (el.labels && [...el.labels].map((l) => l.textContent).join(' ')) ||
        el.textContent ||
        el.getAttribute('title') ||
        ''
      ).trim();
      const group = el.type === 'radio' ? el.name : null;
      out.push({ tag: el.tagName.toLowerCase(), type: el.type || '', name, group, cls: el.className?.baseVal ?? el.className });
    }
    return out;
  });

/** Press Tab repeatedly and record which elements received focus. */
const tabWalk = (page, presses) =>
  page.evaluate(async () => {
    document.activeElement?.blur?.();
    return true;
  }).then(async () => {
    const seen = new Set();
    const groups = new Set();
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        return { key: el.getAttribute('aria-label') || el.textContent?.trim() || el.name || el.tagName, group: el.type === 'radio' ? el.name : null };
      });
      if (!info) continue;
      seen.add(info.key);
      if (info.group) groups.add(info.group);
    }
    return { seen, groups };
  });

/** Let entry animations finish before a screenshot. */
const settle = (page) => page.waitForTimeout(450);

async function enter(page) {
  await page.click('.splash__enter');
  await page.waitForFunction(() => __thunes.store.getState().ui.entered === true);
  await frames(page, 3);
}

// ─────────────────────────────────────────────────────────────── Desktop ──
async function desktop() {
  console.log('\n— desktop 1440×900');
  const session = await openPage({ viewport: { width: 1440, height: 900 } });
  const { page } = session;
  try {
    await page.goto(server.url);
    await waitForApp(page);
    await frames(page, 5);

    // Splash
    checks.ok(await visible(page, '.splash'), 'splash is shown before entering');
    checks.ok(!(await visible(page, '.hud')), 'HUD is hidden behind the splash');
    checks.ok(
      await page.evaluate(() => document.querySelector('.splash h1')?.textContent?.includes('Thunes')),
      'splash shows the app name',
    );
    checks.ok(await page.evaluate(() => document.activeElement?.classList.contains('splash__enter')), 'Enter button has focus');
    await settle(page);
    await shot(page, 'ui-shell/desktop-splash');
    await enter(page);
    checks.ok(!(await visible(page, '.splash')), 'Enter hides the splash');
    checks.ok(await visible(page, '.hud__top .brandbar') && (await visible(page, '.slotbar')), 'Enter reveals the HUD');
    checks.ok(await page.evaluate(() => __thunes.audio.unlocked), 'Enter unlocked audio');
    await settle(page);
    await shot(page, 'ui-shell/desktop-hud');

    // Mode switch both ways
    await page.click('.brandbar .seg__item:has(input[value="grab"])');
    checks.ok((await ui(page)).mode === 'grab', 'mode switch sets ui.mode');
    await page.evaluate(() => __thunes.store.updateUi({ mode: 'look' }));
    checks.ok(
      await page.evaluate(() => document.querySelector('.brandbar input[value="look"]').checked),
      'mode switch follows the store',
    );

    // Quality and the low-cost glass mode
    await page.click('.toolbar .seg__item:has(input[value="low"])');
    checks.ok((await ui(page)).quality === 'low', 'quality switch sets ui.quality');
    checks.ok(
      await page.evaluate(() => document.documentElement.dataset.glass === 'off' && getComputedStyle(document.querySelector('.brandbar')).backdropFilter === 'none'),
      'Quality: Low turns off backdrop blur',
    );
    await page.click('.toolbar .seg__item:has(input[value="high"])');
    checks.ok(
      (await ui(page)).quality === 'high' && (await page.evaluate(() => document.documentElement.dataset.glass === undefined)),
      'Quality: High restores glass',
    );

    // Hide / show UI
    await page.click('button[aria-label="Hide controls"]');
    checks.ok((await ui(page)).uiHidden === true && !(await visible(page, '.hud')), 'Hide UI hides the HUD');
    checks.ok(await visible(page, '.ui-restore'), 'a "Show controls" button remains');
    await settle(page);
    await shot(page, 'ui-shell/desktop-hidden');
    await page.keyboard.press('h');
    checks.ok((await ui(page)).uiHidden === false && (await visible(page, '.hud')), 'H shows the UI again');

    // About dialog: focus trap, Escape, focus restore
    await page.click('button[aria-label="About and help"]');
    checks.ok(await visible(page, '.modal.about .modal__dialog'), 'About opens a dialog');
    let inside = true;
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab');
      inside &&= await page.evaluate(() => document.querySelector('.modal.about').contains(document.activeElement));
    }
    checks.ok(inside, 'focus stays inside the About dialog');
    checks.ok(
      await page.evaluate(() => document.querySelector('.hud').inert === true),
      'the HUD is inert while a dialog is open',
    );
    await settle(page);
    await shot(page, 'ui-shell/desktop-about');
    const hiddenBefore = (await ui(page)).uiHidden;
    await page.keyboard.press('h');
    checks.ok((await ui(page)).uiHidden === hiddenBefore, 'shortcuts are ignored while a dialog is open');
    await page.keyboard.press('Escape');
    checks.ok(!(await visible(page, '.modal.about .modal__dialog')), 'Escape closes the dialog');
    checks.ok(
      await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'About and help'),
      'focus returns to the About button',
    );
    // Backdrop click
    await page.click('button[aria-label="About and help"]');
    await page.mouse.click(30, 450);
    checks.ok(!(await visible(page, '.modal.about .modal__dialog')), 'clicking the backdrop closes the dialog');

    // Snapshot download
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('button[aria-label="Snapshot"]')]);
    const file = await download.path();
    const size = file ? (await fs.stat(file)).size : 0;
    checks.ok(/^thunes-.*\.png$/.test(download.suggestedFilename()) && size > 20000, 'Snapshot downloads a PNG', `${download.suggestedFilename()} ${size} bytes`);

    // Dock reflects the store
    await page.evaluate(() => __thunes.store.clearDancers());
    await frames(page, 2);
    checks.ok(
      await page.evaluate(() => document.querySelectorAll('.slot--empty').length === 8 && document.querySelector('.slot--next') !== null),
      'empty stage: eight empty pads, the first one highlighted',
    );
    checks.ok(await visible(page, '.hint-card'), 'empty-stage hint is shown');
    await settle(page);
    await shot(page, 'ui-shell/desktop-empty');
    await page.evaluate(() => {
      const s = __thunes.store;
      s.addDancer({ characterId: 'builtin:mannequin', danceId: 'builtin:groove' });
      s.addDancer({ characterId: 'builtin:robot', danceId: 'builtin:robot' });
      s.addDancer({ characterId: 'builtin:toy', danceId: 'builtin:groove' });
    });
    await frames(page, 2);
    const dock1 = await page.evaluate(() => ({
      filled: document.querySelectorAll('.slot:not(.slot--empty)').length,
      selected: [...document.querySelectorAll('.slot')].findIndex((s) => s.classList.contains('is-selected')),
      label: document.querySelector('.slot')?.getAttribute('aria-label'),
    }));
    checks.ok(dock1.filled === 3 && dock1.selected === 2, 'dock follows added dancers and the selection', JSON.stringify(dock1));
    checks.ok(!(await visible(page, '.hint-card')), 'hint hides once there are dancers');
    await page.click('.slot[data-slot="0"]');
    const firstId = (await dancers(page))[0].id;
    checks.ok((await ui(page)).selectedId === firstId, 'clicking a pad selects its dancer');
    await page.evaluate((id) => __thunes.store.removeDancer(id), firstId);
    checks.ok(
      await page.evaluate(() => document.querySelectorAll('.slot:not(.slot--empty)').length === 2),
      'dock follows removed dancers',
    );
    await page.click('.slot--empty');
    checks.ok(await visible(page, '.modal.picker .modal__dialog'), 'an empty pad opens the picker');
    await settle(page);
    await shot(page, 'ui-shell/desktop-picker');
    await page.keyboard.press('Escape');
    checks.ok(!(await visible(page, '.modal.picker .modal__dialog')), 'Escape closes the picker');

    // Keyboard shortcuts act on the store
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('1');
    let list = await dancers(page);
    checks.ok((await ui(page)).selectedId === list[0].id, '1 selects the first pad');
    const before = list[0];
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press(']');
    list = await dancers(page);
    checks.ok(
      Math.abs(list[0].x - (before.x + 0.1)) < 1e-6 && Math.abs(list[0].z - (before.z - 0.5)) < 1e-6 && list[0].rotation === before.rotation + 15,
      'arrows nudge and ] rotates the selected dancer',
      JSON.stringify({ before, after: list[0] }),
    );
    await page.keyboard.press(`${MOD}+d`);
    checks.ok((await dancers(page)).length === 3, `${MOD}+D clones the selected dancer`);
    await page.keyboard.press('Delete');
    checks.ok((await dancers(page)).length === 2, 'Delete removes the selected dancer');
    checks.ok(await page.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('removed'))), 'removing shows a toast');
    await page.keyboard.press(`${MOD}+z`);
    checks.ok((await dancers(page)).length === 3, `${MOD}+Z undoes`);
    await page.keyboard.press(`Shift+${MOD}+z`);
    checks.ok((await dancers(page)).length === 2, `Shift+${MOD}+Z redoes`);
    await page.keyboard.press('1');
    await page.keyboard.press('Escape');
    checks.ok((await ui(page)).selectedId === null, 'Escape deselects');
    const muted = await page.evaluate(() => __thunes.store.getState().audio.muted);
    await page.keyboard.press('m');
    checks.ok((await page.evaluate(() => __thunes.store.getState().audio.muted)) === !muted, 'M toggles mute');
    checks.ok(await page.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => /Sound/.test(t.textContent))), 'mute shows a toast');
    await page.keyboard.press('m');
    await page.evaluate(() => {
      window.__resyncs = 0;
      const original = __thunes.stage.resync.bind(__thunes.stage);
      __thunes.stage.resync = () => {
        window.__resyncs++;
        original();
      };
    });
    await page.keyboard.press('s');
    checks.ok((await page.evaluate(() => window.__resyncs)) === 1, 'S resyncs the stage');
    // Typing in a field does not trigger shortcuts
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'probe';
      input.style.cssText = 'position:fixed;left:0;top:0;pointer-events:auto';
      document.querySelector('.ui-overlay').append(input);
      input.focus();
    });
    await page.keyboard.type('hms');
    checks.ok((await ui(page)).uiHidden === false, 'shortcuts are ignored while typing');
    await page.evaluate(() => document.getElementById('probe').remove());

    // Keyboard reachability and accessible names
    const names = await auditNames(page);
    const unnamed = names.filter((n) => !n.name);
    checks.ok(unnamed.length === 0, 'every interactive element has an accessible name', JSON.stringify(unnamed));
    const walk = await tabWalk(page, 60);
    const unreachable = names.filter((n) => (n.group ? !walk.groups.has(n.group) : !walk.seen.has(n.name)));
    checks.ok(unreachable.length === 0, 'every interactive element is reachable with Tab', JSON.stringify(unreachable.map((n) => n.name || n.group)));

    // View-only mode
    await page.evaluate(() => {
      __thunes.store.setTitle('Late night crew');
      __thunes.store.updateUi({ viewOnly: true });
    });
    await frames(page, 2);
    checks.ok(!(await visible(page, '.hud')) && (await visible(page, '.viewbar')), 'view-only shows only the compact bar');
    checks.ok(await page.evaluate(() => document.querySelector('.viewbar__title').textContent === 'Late night crew'), 'view-only bar shows the title');
    const countBefore = (await dancers(page)).length;
    await page.keyboard.press('1');
    await page.keyboard.press('Delete');
    checks.ok((await dancers(page)).length === countBefore, 'editing shortcuts are off in view-only mode');
    await settle(page);
    await shot(page, 'ui-shell/desktop-viewonly');
    await page.click('.viewbar__remix');
    checks.ok((await ui(page)).viewOnly === false && (await visible(page, '.hud')), 'Remix leaves view-only mode');

    // White stage legibility shot
    await page.evaluate(() => {
      __thunes.store.updateScene({ background: 'white' });
      __thunes.store.select(__thunes.store.getState().dancers[0].id);
    });
    await frames(page, 4);
    await settle(page);
    await shot(page, 'ui-shell/desktop-white');
    // A toast from the shell's context
    await page.keyboard.press('s');
    checks.ok(await visible(page, '.toast'), 'toasts appear');

    checks.ok(session.problems.length === 0, 'desktop: no console errors', session.problems.join(' | '));
  } finally {
    await session.close();
  }
}

// ───────────────────────────────────────────────────────────────── Phone ──
async function phone() {
  console.log('\n— phone 390×844');
  const session = await openPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const { page } = session;
  try {
    await page.goto(`${server.url}`);
    await waitForApp(page);
    await frames(page, 5);
    checks.ok(await visible(page, '.splash__enter'), 'phone: splash with Enter');
    await enter(page);
    checks.ok(!(await visible(page, '.toolbar')), 'phone: toolbar folds into a Tools button');
    const pads = await page.evaluate(() =>
      [...document.querySelectorAll('.slot')].every((s) => {
        const r = s.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
      }),
    );
    checks.ok(pads, 'phone: all eight pads fit on screen');
    await settle(page);
    await shot(page, 'ui-shell/phone-hud');
    await page.click('button[aria-label="Tools"]');
    checks.ok(await visible(page, '.toolbar.is-open'), 'phone: Tools opens a bottom sheet');
    await settle(page);
    await shot(page, 'ui-shell/phone-tools');
    await page.click('.toolbar button[aria-label="About and help"]');
    checks.ok(await visible(page, '.modal.about .modal__dialog') && !(await visible(page, '.toolbar.is-open')), 'phone: About opens and the sheet closes');
    await settle(page);
    await shot(page, 'ui-shell/phone-about');
    await page.keyboard.press('Escape');
    await page.click('button[aria-label="Tools"]');
    await page.keyboard.press('Escape');
    checks.ok(!(await visible(page, '.toolbar.is-open')), 'phone: Escape closes the Tools sheet');
    await page.evaluate(() => {
      __thunes.store.updateScene({ background: 'white' });
      __thunes.store.select(__thunes.store.getState().dancers[0].id);
    });
    await frames(page, 4);
    await settle(page);
    await shot(page, 'ui-shell/phone-white');
    await page.evaluate(() => __thunes.store.updateUi({ viewOnly: true }));
    await frames(page, 2);
    const bar = await page.evaluate(() => {
      const r = document.querySelector('.viewbar').getBoundingClientRect();
      return { left: r.left, right: r.right, width: innerWidth };
    });
    checks.ok(bar.left >= 0 && bar.right <= bar.width, 'phone: view-only bar fits', JSON.stringify(bar));
    await settle(page);
    await shot(page, 'ui-shell/phone-viewonly');
    checks.ok(session.problems.length === 0, 'phone: no console errors', session.problems.join(' | '));
  } finally {
    await session.close();
  }
}

// ─────────────────────────────────────────── Components (dev server only) ──
async function components() {
  console.log('\n— components');
  const session = await openPage({ viewport: { width: 1280, height: 800 } });
  const { page } = session;
  try {
    await page.goto(server.url);
    await waitForApp(page);
    await enter(page);
    await page.evaluate(async () => {
      const kit = await import('/src/ui/components/index.ts');
      const { DANCER_FIELDS } = await import('/src/config.ts');
      const host = document.createElement('div');
      host.id = 'kit';
      host.className = 'panel';
      host.style.cssText = 'position:fixed;left:400px;top:200px;width:360px;padding:16px;pointer-events:auto;z-index:45';
      document.querySelector('.ui-overlay').append(host);
      const log = (window.__kitLog = []);
      const slider = kit.createSlider({
        label: 'Speed',
        field: DANCER_FIELDS.speed,
        value: 1,
        onChange: (v, transient) => log.push(['change', v, transient]),
        onCommit: () => log.push(['commit']),
      });
      const tabs = kit.createTabs({ label: 'Demo', value: 'a', tabs: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], onChange: (id) => log.push(['tab', id]) });
      const swatches = kit.createSwatches({
        label: 'Tint',
        value: 'red',
        options: [{ value: 'red', name: 'Red', swatch: '#f00' }, { value: 'blue', name: 'Blue', swatch: '#00f' }],
        custom: { color: '#123456' },
        onChange: (v) => log.push(['swatch', v]),
      });
      host.append(slider.el, tabs.el, tabs.panels.a, tabs.panels.b, tabs.panels.c, swatches.el);
      window.__kit = { slider, tabs, swatches, kit };
    });
    const box = await page.locator('#kit .slider').boundingBox();
    await page.mouse.move(box.x + box.width * 0.33, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) await page.mouse.move(box.x + box.width * (0.33 + i * 0.08), box.y + box.height / 2);
    await page.mouse.up();
    let log = await page.evaluate(() => window.__kitLog.splice(0));
    const transient = log.filter((e) => e[0] === 'change' && e[2] === true).length;
    const commits = log.filter((e) => e[0] === 'commit').length;
    checks.ok(transient >= 3 && commits === 1 && log.every((e) => e[0] !== 'change' || e[2] === true), 'slider drag: transient changes, one commit', JSON.stringify(log));
    await page.keyboard.press('ArrowRight');
    log = await page.evaluate(() => window.__kitLog.splice(0));
    checks.ok(log.length === 1 && log[0][2] === false, 'slider keyboard step commits immediately', JSON.stringify(log));
    await page.dblclick('#kit .slider-row__label');
    log = await page.evaluate(() => window.__kitLog.splice(0));
    checks.ok(log.some((e) => e[0] === 'change' && e[1] === 1 && e[2] === false), 'double-click on the label resets to the default', JSON.stringify(log));
    await page.click('#kit .slider-row__value');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('2.5');
    await page.keyboard.press('Enter');
    log = await page.evaluate(() => window.__kitLog.splice(0));
    const readout = await page.textContent('#kit .slider-row__value');
    checks.ok(log.length === 1 && log[0][1] === 2.5 && readout === '2.50×', 'typing into the readout sets the value', JSON.stringify({ log, readout }));
    await page.click('#kit [role="tab"]:nth-child(1)');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('End');
    const tabState = await page.evaluate(() => ({
      focused: document.activeElement?.textContent,
      selected: [...document.querySelectorAll('#kit [role="tab"]')].map((t) => t.getAttribute('aria-selected')),
      visible: [...document.querySelectorAll('#kit [role="tabpanel"]')].map((p) => getComputedStyle(p).display !== 'none'),
    }));
    checks.ok(tabState.focused === 'C' && tabState.selected.join() === 'false,false,true' && tabState.visible.join() === 'false,false,true', 'tabs: arrow keys and End move selection and focus', JSON.stringify(tabState));
    await page.click('#kit .swatch[title="Blue"]');
    await page.evaluate(() => window.__kit.swatches.set('#abcdef'));
    log = await page.evaluate(() => window.__kitLog.splice(0));
    const custom = await page.evaluate(() => document.querySelector('#kit .swatch--custom').classList.contains('is-checked'));
    checks.ok(log.some((e) => e[0] === 'swatch' && e[1] === 'blue') && custom, 'swatches: presets report values, unknown colours select the custom chip', JSON.stringify(log));
    const answer = page.evaluate(() => window.__kit.kit.confirmDialog({ title: 'Remove everyone?', message: 'This clears the stage.', confirmLabel: 'Remove', danger: true }));
    await page.waitForSelector('.modal--confirm:not([hidden])');
    checks.ok(await page.evaluate(() => document.activeElement?.textContent === 'Remove'), 'confirm focuses its action');
    await page.keyboard.press('Escape');
    checks.ok((await answer) === false, 'confirm resolves false on Escape');
    const answer2 = page.evaluate(() => window.__kit.kit.confirmDialog({ title: 'Sure?' }));
    await page.waitForSelector('.modal--confirm:not([hidden])');
    await page.keyboard.press('Enter');
    checks.ok((await answer2) === true && (await page.evaluate(() => document.querySelectorAll('.modal--confirm').length === 0)), 'confirm resolves true and cleans up');
    await page.evaluate(() => {
      const { slider, tabs, swatches } = window.__kit;
      slider.destroy();
      tabs.destroy();
      swatches.destroy();
      document.getElementById('kit').remove();
    });
    checks.ok(session.problems.length === 0, 'components: no console errors', session.problems.join(' | '));
  } finally {
    await session.close();
  }
}

try {
  await desktop();
  await phone();
  if (mode === 'dev') await components();
} catch (error) {
  checks.ok(false, 'script ran to the end', error.stack || String(error));
} finally {
  await server.close();
}
process.exit(checks.summary() ? 0 : 1);
