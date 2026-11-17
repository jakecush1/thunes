// Inspector and picker check against the real app, at desktop (1440×900) and phone (390×844) sizes:
// add through the picker, change dance, slider drags (one undo step each), mirror, look overrides,
// tab reset, swap keeping settings, clone until full, remove, picker search / categories / uploads,
// keyboard-only operation, no console errors.
// Usage: node scripts/e2e/ui-inspector.mjs [--preview]
import { createChecks, frames, openPage, shot, startServer, waitForApp } from './harness.mjs';

const mode = process.argv.includes('--preview') ? 'preview' : 'dev';
const server = await startServer({ mode });
const checks = createChecks();

const PICKER = '.modal.picker';
const INSPECTOR = '.inspector.is-open';

const state = (page) => page.evaluate(() => __thunes.store.getState());
const selected = (page) =>
  page.evaluate(() => {
    const s = __thunes.store.getState();
    return s.dancers.find((d) => d.id === s.ui.selectedId) ?? null;
  });
const visible = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]');
  }, selector);
const pickerOpen = (page) => page.evaluate((sel) => !document.querySelector(sel)?.hidden, PICKER);
const activeCards = (page) =>
  page.evaluate((sel) => [...document.querySelectorAll(`${sel} .tabpanel.is-active .card[data-id]`)].map((c) => c.dataset.id), PICKER);
const settle = (page) => page.waitForTimeout(450);

async function enter(page) {
  await page.click('.splash__enter');
  await page.waitForFunction(() => __thunes.store.getState().ui.entered === true);
  await frames(page, 3);
}

/** Drag a range input from its centre to `fraction` of its width with the mouse. */
async function dragSlider(page, selector, fraction) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width * (0.5 + ((fraction - 0.5) * i) / 8), y);
  await page.mouse.up();
}

/** One drag = one undo step: undo restores the value from before the drag, redo the value after it. */
async function checkOneUndoStep(page, key, before, label) {
  const after = (await selected(page))[key];
  await page.evaluate(() => __thunes.store.undo());
  const undone = (await selected(page))[key];
  await page.evaluate(() => __thunes.store.redo());
  const redone = (await selected(page))[key];
  checks.ok(after !== before && undone === before && redone === after, label, `before ${before}, after ${after}, undo ${undone}, redo ${redone}`);
}

async function openPickerFromDock(page) {
  await page.click('.slot--empty');
  await page.waitForFunction((sel) => !document.querySelector(sel)?.hidden, PICKER);
  await page.waitForTimeout(150);
}

// ─────────────────────────────────────────────────────────────── Desktop ──
async function desktop() {
  console.log('\n— desktop 1440×900');
  const session = await openPage({ viewport: { width: 1440, height: 900 } });
  const { page } = session;
  try {
    await page.goto(server.url);
    await waitForApp(page);
    await enter(page);
    const starterDance = await page.evaluate(() => {
      const d = __thunes.store.getState().dancers;
      return d.length ? d[d.length - 1].danceId : null;
    });
    await page.evaluate(() => __thunes.store.clearDancers());

    // ── Add through the picker ──
    await openPickerFromDock(page);
    checks.ok(await pickerOpen(page), 'an empty pad opens the picker');
    const counts = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} .tab b`)].map((b) => Number(b.textContent)), PICKER);
    const catalogue = await page.evaluate(() => [__thunes.registry.listCharacters().length, __thunes.registry.listDances().length]);
    checks.ok(counts[0] === catalogue[0] && counts[1] === catalogue[1], 'picker tabs show catalogue counts', JSON.stringify({ counts, catalogue }));
    checks.ok((await activeCards(page)).length === catalogue[0], 'characters tab lists every character');
    checks.ok(await page.evaluate((sel) => document.querySelector(`${sel} .picker__confirm`).disabled, PICKER), 'confirm is disabled until a character is picked');
    await page.waitForFunction((sel) => document.querySelectorAll(`${sel} .tabpanel.is-active .card .thumb__img:not([hidden])`).length >= 3, PICKER, { timeout: 15000 }).catch(() => {});
    const thumbs = await page.evaluate((sel) => document.querySelectorAll(`${sel} .tabpanel.is-active .card .thumb__img:not([hidden])`).length, PICKER);
    checks.ok(thumbs >= 3, 'character thumbnails load in the visible cards', `${thumbs}`);
    await settle(page);
    await shot(page, 'ui-inspector/desktop-picker');
    await page.click(`${PICKER} .tabpanel.is-active .card[data-id="builtin:robot"]`);
    const confirmText = await page.textContent(`${PICKER} .picker__confirm`);
    checks.ok(/Add Bolt to the floor/.test(confirmText), 'confirm names the chosen character', confirmText);
    await page.click(`${PICKER} .picker__confirm`);
    let s = await state(page);
    checks.ok(!(await pickerOpen(page)) && s.dancers.length === 1 && s.dancers[0].characterId === 'builtin:robot', 'confirm adds the dancer');
    checks.ok(s.dancers[0].danceId === (starterDance ?? 'builtin:groove'), 'new dancer gets the last used dance', `${s.dancers[0].danceId} vs ${starterDance}`);
    checks.ok(s.ui.selectedId === s.dancers[0].id && (await visible(page, INSPECTOR)), 'the new dancer is selected and the inspector opens');
    checks.ok((await page.textContent(`${INSPECTOR} .panel__title`)) === 'Bolt', 'inspector title is the character name');
    checks.ok(/Dancer 1 of 1/.test(await page.textContent(`${INSPECTOR} .panel__sub`)), 'inspector says "Dancer 1 of 1"');

    // ── Dance chooser ──
    const visibleDances = await page.evaluate(() =>
      [...document.querySelectorAll('.inspector .dance-card[data-dance-id]')].filter((c) => c.getClientRects().length > 0).map((c) => c.dataset.danceId),
    );
    checks.ok(visibleDances.length === 5 && (await visible(page, '.inspector .dance-card--more')), 'desktop shows 5 dances and the "All dances" card', JSON.stringify(visibleDances));
    const nextDance = visibleDances.find((id) => id !== s.dancers[0].danceId);
    await page.click(`.inspector .dance-card[data-dance-id="${nextDance}"]`);
    s = await state(page);
    checks.ok(s.dancers[0].danceId === nextDance, 'a dance card changes the dance');
    checks.ok(await page.evaluate((id) => document.querySelector(`.inspector .dance-card[data-dance-id="${id}"]`)?.classList.contains('is-current'), nextDance), 'the current dance is highlighted');
    await page.click('.inspector .dance-card--more');
    await page.waitForFunction((sel) => !document.querySelector(sel)?.hidden, PICKER);
    checks.ok(
      await page.evaluate((sel) => document.querySelector(`${sel} .tab[aria-selected="true"]`)?.textContent.startsWith('Dances'), PICKER),
      '"All dances" opens the picker on Dances',
    );
    checks.ok(
      await page.evaluate(([sel, id]) => document.querySelector(`${sel} .tabpanel.is-active .card[data-id="${id}"]`)?.classList.contains('is-selected'), [PICKER, nextDance]),
      'the picker highlights the current dance',
    );
    await page.dblclick(`${PICKER} .tabpanel.is-active .card[data-id="builtin:robot"]`);
    s = await state(page);
    checks.ok(!(await pickerOpen(page)) && s.dancers[0].danceId === 'builtin:robot', 'double-clicking a dance card uses it');

    // ── Move: slider drags, one undo step each, live updates ──
    const rotSel = '.inspector .slider-row[data-key="rotation"] input';
    await dragSlider(page, rotSel, 0.8);
    checks.ok(Math.abs((await selected(page)).rotation - 108) < 15, 'dragging Rotation changes the store', String((await selected(page)).rotation));
    await checkOneUndoStep(page, 'rotation', 0, 'one undo step per rotation drag');
    await page.evaluate(() => {
      const st = __thunes.store;
      const id = st.getState().ui.selectedId;
      st.updateDancer(id, { x: 1.25 }, { transient: true });
      st.updateDancer(id, { x: 2.5 }, { transient: true });
    });
    checks.ok(
      (await page.inputValue('.inspector .slider-row[data-key="x"] input')) === '2.5' &&
        (await page.textContent('.inspector .slider-row[data-key="x"] output')).includes('2.50'),
      'sliders follow transient (stage drag) updates live',
    );
    await page.evaluate(() => __thunes.store.commit());

    // Tabs by keyboard
    await page.focus('.inspector .tab[aria-selected="true"]');
    await page.keyboard.press('ArrowRight');
    checks.ok(await page.evaluate(() => document.activeElement?.textContent === 'Motion' && document.activeElement.getAttribute('aria-selected') === 'true'), 'ArrowRight moves to the Motion tab');

    // ── Motion ──
    await dragSlider(page, '.inspector .slider-row[data-key="speed"] input', 0.25);
    await checkOneUndoStep(page, 'speed', 1, 'one undo step per speed drag');
    await page.click('.inspector .tabpanel.is-active .toggle--row input');
    checks.ok((await selected(page)).mirror === true, 'mirror toggle sets mirror');
    await page.keyboard.press('Space');
    checks.ok((await selected(page)).mirror === false, 'Space toggles mirror back');
    await page.click('.inspector .tabpanel.is-active button[aria-label^="Resync"]');
    checks.ok(true, 'Resync runs');

    // ── Look ──
    await page.click('.inspector .tab:has-text("Look")');
    checks.ok((await selected(page)).shine === null && (await page.isDisabled('.inspector [data-override="shine"] input.slider')), 'shine override starts off');
    await page.click('.inspector [data-override="shine"] .toggle');
    checks.ok((await selected(page)).shine === 0.5 && !(await page.isDisabled('.inspector [data-override="shine"] input.slider')), 'switching on shine sets the default and enables the slider');
    await dragSlider(page, '.inspector [data-override="shine"] input.slider', 0.9);
    await checkOneUndoStep(page, 'shine', 0.5, 'one undo step per shine drag');
    await page.click('.inspector [data-override="metal"] .toggle');
    checks.ok((await selected(page)).metal === 0, 'switching on metal sets its default');
    await page.click('.inspector .inspector__tints .swatch[title="Teal"]');
    checks.ok((await selected(page)).tint === '#19cdb8', 'tint swatch sets the tint');
    await settle(page);
    await shot(page, 'ui-inspector/desktop-look');
    await page.click('.inspector [data-override="shine"] .toggle');
    checks.ok((await selected(page)).shine === null, 'switching off shine clears the override');
    await page.click('.inspector .inspector__tints .swatch[title="Original colours"]');
    checks.ok((await selected(page)).tint === null, '"Original colours" clears the tint');
    await page.click('.inspector button[data-reset="look"]');
    s = await selected(page);
    checks.ok(s.shine === null && s.metal === null && s.tint === null, 'Reset look clears every override');

    // ── Warp: change things, reset in one undo step ──
    await page.click('.inspector .tab:has-text("Warp")');
    await dragSlider(page, '.inspector .slider-row[data-key="warpAmount"] input', 0.7);
    await page.click('.inspector .tabpanel.is-active .seg__item:has(input[value="pulse"])');
    await page.click('.inspector .tabpanel.is-active .chip:has(input[value="z"]) >> nth=0');
    s = await selected(page);
    checks.ok(s.warpAmount > 0.3 && s.warpMode === 'pulse' && s.warpAlong === 'z', 'warp controls set amount, mode and axis', JSON.stringify([s.warpAmount, s.warpMode, s.warpAlong]));
    const warped = s;
    await page.click('.inspector button[data-reset="warp"]');
    s = await selected(page);
    checks.ok(s.warpAmount === 0 && s.warpMode === 'wave' && s.warpAlong === 'y', 'Reset warp restores the defaults');
    await page.evaluate(() => __thunes.store.undo());
    s = await selected(page);
    checks.ok(s.warpAmount === warped.warpAmount && s.warpMode === 'pulse' && s.warpAlong === 'z', 'one undo brings the whole warp tab back');

    // ── Body ──
    await page.click('.inspector .tab:has-text("Body")');
    await dragSlider(page, '.inspector .slider-row[data-key="headSize"] input', 0.75);
    checks.ok((await selected(page)).headSize > 1.5, 'Head size slider works');

    // ── Swap keeps settings ──
    await page.evaluate(() => {
      const st = __thunes.store;
      st.updateDancer(st.getState().ui.selectedId, { rotation: 45, mirror: true, tint: '#ff7a5c' });
    });
    const beforeSwap = await selected(page);
    await page.click('.inspector button[aria-label="Swap character"]');
    await page.waitForFunction((sel) => !document.querySelector(sel)?.hidden, PICKER);
    checks.ok(
      await page.evaluate((sel) => document.querySelector(`${sel} .tabpanel.is-active .card[data-id="builtin:robot"]`)?.classList.contains('is-selected'), PICKER),
      'swap opens with the current character selected',
    );
    await page.click(`${PICKER} .tabpanel.is-active .card[data-id="builtin:toy"]`);
    await page.click(`${PICKER} .picker__confirm`);
    const afterSwap = await selected(page);
    const { characterId: c1, ...restBefore } = beforeSwap;
    const { characterId: c2, ...restAfter } = afterSwap;
    checks.ok(c1 === 'builtin:robot' && c2 === 'builtin:toy' && JSON.stringify(restBefore) === JSON.stringify(restAfter), 'swap replaces the character and keeps every setting');
    checks.ok((await page.textContent(`${INSPECTOR} .panel__title`)) === 'Mochi', 'inspector title follows the swap');

    // ── Clone until the stage is full ──
    for (let i = 0; i < 8; i++) await page.click('.inspector button[aria-label="Clone dancer"]');
    s = await state(page);
    checks.ok(s.dancers.length === 8, 'Clone fills the stage to 8', String(s.dancers.length));
    checks.ok(
      await page.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => /stage is full/i.test(t.textContent))),
      'a toast explains the stage is full',
    );
    checks.ok(s.dancers.every((d) => d.characterId === 'builtin:toy' && d.tint === '#ff7a5c'), 'clones keep the settings');
    checks.ok(/Dancer 8 of 8/.test(await page.textContent(`${INSPECTOR} .panel__sub`)), 'inspector counts the clones');
    await settle(page);
    await shot(page, 'ui-inspector/desktop-inspector');

    // ── Remove ──
    await page.click('.inspector button[aria-label="Remove dancer"]');
    s = await state(page);
    checks.ok(s.dancers.length === 7 && s.ui.selectedId === null && !(await visible(page, INSPECTOR)), 'Remove deletes the dancer and closes the inspector');

    // ── Picker: search, categories ──
    await openPickerFromDock(page);
    await page.fill(`${PICKER} .picker__search input`, 'bolt');
    checks.ok(JSON.stringify(await activeCards(page)) === '["builtin:robot"]', 'search filters characters by name', JSON.stringify(await activeCards(page)));
    await page.click(`${PICKER} .tab:has-text("Dances")`);
    checks.ok((await activeCards(page)).length === 0 && (await visible(page, `${PICKER} .tabpanel.is-active .card-grid__empty`)), 'search applies to dances too (no match message)');
    await page.fill(`${PICKER} .picker__search input`, '');
    await page.click(`${PICKER} .chip:has-text("Silly")`);
    const silly = await activeCards(page);
    const sillyExpected = await page.evaluate(() => __thunes.registry.listDances().filter((d) => d.category === 'Silly').map((d) => d.id));
    checks.ok(JSON.stringify(silly) === JSON.stringify(sillyExpected), 'category chip filters dances', JSON.stringify(silly));
    await page.fill(`${PICKER} .picker__search input`, 'robot');
    checks.ok(JSON.stringify(await activeCards(page)) === '["builtin:robot"]', 'search and category combine');
    await page.keyboard.press('Escape');
    checks.ok(!(await pickerOpen(page)), 'Escape closes the picker');

    // ── Uploads: a rejected file and an accepted dance scheme, then delete ──
    await openPickerFromDock(page);
    await page.click(`${PICKER} .tab:has-text("Dances")`);
    const scheme = await page.evaluate(() => JSON.stringify(__thunes.registry.getDance('builtin:robot').scheme));
    await page.setInputFiles(`${PICKER} input[type="file"]`, [
      { name: 'junk.txt', mimeType: 'text/plain', buffer: Buffer.from('not a model') },
      { name: 'my-robot.json', mimeType: 'application/json', buffer: Buffer.from(scheme) },
    ]);
    await page.waitForFunction((sel) => document.querySelector(`${sel} .picker__report-list--problems`) !== null, PICKER, { timeout: 15000 }).catch(() => {});
    const report = await page.evaluate((sel) => document.querySelector(`${sel} .picker__report`)?.innerText ?? '', PICKER);
    checks.ok(/junk\.txt/.test(report), 'the upload report names the rejected file and why', report.replace(/\n/g, ' | '));
    const uploaded = await page.evaluate(() => __thunes.registry.listDances().filter((d) => d.id.startsWith('upload:')).map((d) => d.id));
    checks.ok(uploaded.length === 1 && /Added 1 dance/.test(report), 'an accepted file is added and reported', JSON.stringify(uploaded));
    if (uploaded.length === 1) {
      checks.ok((await activeCards(page)).includes(uploaded[0]), 'the upload appears in the grid immediately');
      checks.ok(
        await page.evaluate((sel) => [...document.querySelectorAll(`${sel} .chip`)].some((c) => /My uploads/.test(c.textContent)), PICKER),
        'a "My uploads" chip appears',
      );
      await settle(page);
      await shot(page, 'ui-inspector/desktop-picker-upload');
      await page.click(`${PICKER} .picker__item .picker__delete`);
      await page.waitForSelector('.modal--confirm:not([hidden])');
      await page.click('.modal--confirm .btn--danger');
      await page.waitForFunction(() => !__thunes.registry.listDances().some((d) => d.id.startsWith('upload:')), null, { timeout: 10000 }).catch(() => {});
      checks.ok(!(await activeCards(page)).some((id) => id.startsWith('upload:')), 'deleting an upload removes its card');
    }
    await page.keyboard.press('Escape');
    checks.ok(!(await pickerOpen(page)), 'Escape closes the picker after deleting an upload', await page.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`));

    // ── Keyboard-only picker ──
    const countBefore = (await state(page)).dancers.length;
    await page.focus('.slot--empty');
    await page.keyboard.press('Enter');
    await page.waitForFunction((sel) => !document.querySelector(sel)?.hidden, PICKER);
    const focused = await page.evaluate(() => document.activeElement?.dataset?.id ?? document.activeElement?.className);
    checks.ok(typeof focused === 'string' && focused.startsWith('builtin:'), 'picker opens with focus on a card', focused);
    await page.keyboard.press('ArrowRight');
    const focused2 = await page.evaluate(() => document.activeElement?.dataset?.id);
    checks.ok(focused2 && focused2 !== focused, 'ArrowRight moves between cards', `${focused} → ${focused2}`);
    await page.keyboard.press('Enter');
    checks.ok(await page.evaluate(() => document.activeElement?.getAttribute('aria-pressed') === 'true'), 'Enter selects the focused card');
    await page.keyboard.press('Enter');
    s = await state(page);
    checks.ok(s.dancers.length === countBefore + 1 && s.dancers[s.dancers.length - 1].characterId === focused2, 'Enter on the selected card adds the dancer');
    // Tabs in the picker by keyboard
    await page.evaluate(() => __thunes.store.removeDancer(__thunes.store.getState().dancers[0].id));
    await openPickerFromDock(page);
    await page.focus(`${PICKER} .tab[aria-selected="true"]`);
    await page.keyboard.press('ArrowRight');
    checks.ok(await page.evaluate((sel) => document.querySelector(`${sel} .tab[aria-selected="true"]`)?.textContent.startsWith('Dances'), PICKER), 'ArrowRight switches picker tabs');
    await page.keyboard.press('Tab');
    checks.ok(await page.evaluate(() => document.activeElement?.closest('.picker__search') !== null), 'Tab reaches the search box');
    await page.keyboard.type('twist');
    await page.keyboard.press('Enter');
    checks.ok(await page.evaluate(() => document.activeElement?.dataset?.id === 'builtin:twist'), 'Enter in search selects the first match');
    await page.keyboard.press('Escape');
    checks.ok(!(await pickerOpen(page)), 'Escape closes (keyboard)');

    checks.ok(session.problems.length === 0, 'no console errors (desktop)', session.problems.slice(0, 5).join(' || '));
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
    await page.goto(server.url);
    await waitForApp(page);
    await enter(page);
    await page.evaluate(() => __thunes.store.clearDancers());
    await openPickerFromDock(page);
    await page.waitForTimeout(800);
    await shot(page, 'ui-inspector/phone-picker');
    await page.tap(`${PICKER} .tabpanel.is-active .card[data-id="builtin:mannequin"]`);
    await page.tap(`${PICKER} .picker__confirm`);
    const s = await state(page);
    checks.ok(s.dancers.length === 1 && (await visible(page, INSPECTOR)), 'phone: adding opens the inspector sheet');
    checks.ok(
      await page.evaluate(() => document.querySelector('.inspector .tab[aria-selected="true"]')?.textContent === 'Dance'),
      'phone: Dance is the first, selected tab',
    );
    await page.waitForTimeout(700); // let the sheet finish sliding in before measuring it
    const box = await page.locator(INSPECTOR).boundingBox();
    checks.ok(box && box.x >= 0 && box.x + box.width <= 391 && box.y + box.height <= 845, 'phone: the sheet fits the screen', JSON.stringify(box));
    const cards = await page.evaluate(() => [...document.querySelectorAll('.inspector .dance-card[data-dance-id]')].filter((c) => c.getClientRects().length).map((c) => c.dataset.danceId));
    await page.tap(`.inspector .dance-card[data-dance-id="${cards[2]}"]`);
    checks.ok((await selected(page)).danceId === cards[2], 'phone: tapping a dance card changes the dance');
    await page.waitForTimeout(800);
    await shot(page, 'ui-inspector/phone-inspector');
    await page.tap('.inspector .tab:has-text("Move")');
    await dragSlider(page, '.inspector .slider-row[data-key="scale"] input', 0.8);
    checks.ok((await selected(page)).scale > 1.5, 'phone: Scale slider drag works', String((await selected(page)).scale));
    await checkOneUndoStep(page, 'scale', 1, 'phone: one undo step per drag');
    await page.tap('.inspector .tab:has-text("Look")');
    await settle(page);
    await shot(page, 'ui-inspector/phone-look');
    checks.ok(session.problems.length === 0, 'no console errors (phone)', session.problems.slice(0, 5).join(' || '));
  } finally {
    await session.close();
  }
}

try {
  await desktop();
  await phone();
} catch (error) {
  checks.ok(false, 'script ran to the end', error.stack || String(error));
} finally {
  await server.close();
}
process.exit(checks.summary() ? 0 : 1);
