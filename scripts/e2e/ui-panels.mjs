// Panels check: music drawer, scene drawer, save / My scenes / share dialogs and
// window drag-and-drop, against the real app at desktop (1440×900) and phone
// (390×844, reduced motion) sizes.
// Usage: node scripts/e2e/ui-panels.mjs [--preview]
import { createChecks, frames, openPage, shot, startServer, waitForApp } from './harness.mjs';

const mode = process.argv.includes('--preview') ? 'preview' : 'dev';
const server = await startServer({ mode });
const checks = createChecks();

const state = (page) => page.evaluate(() => __thunes.store.getState());
const settle = (page, ms = 450) => page.waitForTimeout(ms);
const visible = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]');
  }, selector);
const inViewport = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.width > 0;
  }, selector);
const toastTexts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast .toast__text')].map((t) => t.textContent));

async function enter(page) {
  await page.click('.splash__enter');
  await page.waitForFunction(() => __thunes.store.getState().ui.entered === true);
  await frames(page, 3);
}

async function waitPlaying(page, songId, timeout = 15000) {
  return page
    .waitForFunction(
      (id) => {
        const s = __thunes.audio.status;
        return s.state === 'playing' && s.songId === id;
      },
      songId,
      { timeout },
    )
    .then(() => true)
    .catch(() => false);
}

/** A short 16-bit mono WAV (a beeping square wave) as a byte array, built in the page. */
const DROP_WAV = async (page, name = 'tiny-beat.wav', selector = null) =>
  page.evaluate(
    async ({ name, selector }) => {
      const rate = 22050;
      const seconds = 2;
      const n = rate * seconds;
      const buffer = new ArrayBuffer(44 + n * 2);
      const v = new DataView(buffer);
      const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      str(0, 'RIFF');
      v.setUint32(4, 36 + n * 2, true);
      str(8, 'WAVE');
      str(12, 'fmt ');
      v.setUint32(16, 16, true);
      v.setUint16(20, 1, true);
      v.setUint16(22, 1, true);
      v.setUint32(24, rate, true);
      v.setUint32(28, rate * 2, true);
      v.setUint16(32, 2, true);
      v.setUint16(34, 16, true);
      str(36, 'data');
      v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const beat = (t * 2) % 1 < 0.12 ? 1 : 0; // 120 bpm clicks
        const s = beat * Math.sign(Math.sin(2 * Math.PI * 220 * t)) * 0.5;
        v.setInt16(44 + i * 2, s * 32767, true);
      }
      const file = new File([buffer], name, { type: 'audio/wav' });
      const junk = new File(['hello'], 'notes.txt', { type: 'text/plain' });
      const dt = new DataTransfer();
      dt.items.add(file);
      dt.items.add(junk);
      const target = selector ? document.querySelector(selector) : document.querySelector('.stage-host canvas') ?? document.body;
      const fire = (type) => target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      fire('dragenter');
      fire('dragover');
      const overlayShown = !document.querySelector('.uploads')?.hidden;
      fire('drop');
      const overlayHidden = Boolean(document.querySelector('.uploads')?.hidden);
      return { overlayShown, overlayHidden };
    },
    { name, selector },
  );

/** Press Tab until `selector` has focus (max `limit` presses). */
async function tabTo(page, selector, limit = 60, shift = false) {
  const seen = [];
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
    const info = await page.evaluate((sel) => {
      const el = document.activeElement;
      return { hit: el?.matches(sel) ?? false, name: el ? `${el.tagName}.${el.className?.baseVal ?? el.className}[${el.getAttribute('aria-label') ?? ''}]` : 'none' };
    }, selector);
    if (info.hit) return true;
    seen.push(info.name);
  }
  console.log('    tab walk:', [...new Set(seen)].slice(0, 25).join(' | '));
  return false;
}

// ─────────────────────────────────────────────────────────────── Desktop ──
async function desktop() {
  console.log('\n— desktop 1440×900');
  const session = await openPage({ viewport: { width: 1440, height: 900 } });
  const { page, context } = session;
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url });
  try {
    await page.goto(server.url);
    await waitForApp(page);
    await enter(page);

    // ── Music drawer ──
    const songs = await page.evaluate(() => __thunes.registry.listSongs().map((s) => s.id));
    const initialSong = (await state(page)).audio.songId;
    checks.ok(await waitPlaying(page, initialSong), 'starter song plays after Enter', initialSong);
    checks.ok(
      /Now playing/.test(await page.textContent('.drawer.music .pill__meta')),
      'music pill says "Now playing"',
      await page.textContent('.drawer.music .pill__meta'),
    );
    await page.waitForTimeout(400);
    checks.ok(await page.evaluate(() => document.querySelector('.drawer.music .pill .levels')?.classList.contains('is-live')), 'pill level bars run live while playing');
    const levelVar = await page.evaluate(() => [...document.querySelectorAll('.drawer.music .pill .levels i')].map((i) => i.style.getPropertyValue('--lv')));
    checks.ok(levelVar.some((v) => v !== ''), 'level bars are driven by audio levels', levelVar.join(','));
    await page.click('.drawer.music .pill__main');
    await settle(page);
    checks.ok(await visible(page, '.drawer.music .panel'), 'music drawer expands');
    const rows = await page.$$eval('.drawer.music .track', (els) => els.map((e) => e.dataset.song));
    checks.ok(rows.length === songs.length + 1 && rows.at(-1) === 'none', 'track list: every song plus "No music"', rows.join(','));
    checks.ok(
      await page.evaluate((id) => document.querySelector(`.track[data-song="${id}"]`)?.getAttribute('aria-current') === 'true', initialSong),
      'current song is marked',
    );
    const other = songs.find((id) => id !== initialSong);
    await page.click(`.track[data-song="${other}"]`);
    checks.ok((await state(page)).audio.songId === other, 'choosing a song sets audio.songId');
    checks.ok(await waitPlaying(page, other), 'audio status reaches playing for the new song');
    checks.ok(
      (await page.textContent('.drawer.music .panel__title')) === (await page.evaluate((id) => __thunes.registry.getSong(id).title, other)),
      'drawer title follows the song',
    );
    await settle(page, 300);
    await shot(page, 'ui-panels/desktop-music');

    await page.click('.drawer.music .music__volume .btn--icon');
    checks.ok((await state(page)).audio.muted === true, 'volume-row mute button mutes');
    checks.ok(/Muted/.test(await page.textContent('.drawer.music .pill__meta')), 'pill says muted');
    await page.click('.drawer.music .music__volume .btn--icon');
    checks.ok((await state(page)).audio.muted === false, 'volume-row mute button unmutes');
    const vol0 = (await state(page)).audio.volume;
    await page.focus('.drawer.music .music__volume input[type="range"]');
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft');
    const vol1 = (await state(page)).audio.volume;
    checks.ok(Math.abs(vol0 - 0.1 - vol1) < 0.005, 'volume slider lowers volume by keyboard', `${vol0} → ${vol1}`);
    checks.ok((await page.textContent('.drawer.music .music__volume .slider-row__value')) === `${Math.round(vol1 * 100)}%`, 'volume readout in percent');
    await page.click('.drawer.music .music__sync');
    checks.ok((await state(page)).audio.beatSync === false, 'beat-sync toggle turns sync off');
    await page.click('.drawer.music .music__sync');
    checks.ok((await state(page)).audio.beatSync === true, 'beat-sync toggle turns sync on');
    await page.click('.track[data-song="none"]');
    checks.ok((await state(page)).audio.songId === null, '"No music" sets songId null');
    await page.waitForFunction(() => __thunes.audio.status.state === 'idle', null, { timeout: 5000 }).catch(() => {});
    checks.ok((await page.evaluate(() => __thunes.audio.status.state)) === 'idle', 'audio goes idle with no music');
    checks.ok((await page.textContent('.drawer.music .pill__title')) === 'No music', 'pill shows "No music"');
    await page.click(`.track[data-song="${initialSong}"]`);
    checks.ok(await waitPlaying(page, initialSong), 'switching back plays again');

    // ── Drop a WAV onto the window ──
    const songCount = songs.length;
    const drop = await DROP_WAV(page);
    checks.ok(drop.overlayShown, 'dragging files shows the drop overlay');
    checks.ok(drop.overlayHidden, 'dropping hides the overlay');
    const added = await page
      .waitForFunction((n) => __thunes.registry.listSongs().length === n + 1, songCount, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    checks.ok(added, 'dropped WAV becomes a song');
    await page.waitForTimeout(200);
    const toasts = await toastTexts(page);
    checks.ok(toasts.some((t) => /Added 1 song/.test(t)), 'toast reports the added song', toasts.join(' | '));
    checks.ok(toasts.some((t) => /notes\.txt/.test(t)), 'toast gives the reason for the rejected file', toasts.join(' | '));
    const uploadId = await page.evaluate(() => __thunes.registry.listSongs().find((s) => s.source === 'upload')?.id);
    checks.ok(await visible(page, `.track[data-song="${uploadId}"]`), 'uploaded song appears in the list');
    await page.click(`.track[data-song="${uploadId}"]`);
    checks.ok(await waitPlaying(page, uploadId), 'uploaded song plays');
    await shot(page, 'ui-panels/desktop-music-upload');

    // ── Share (with the uploaded song: warning) ──
    await page.click('button[aria-label="Share scene"]');
    await page.waitForFunction(() => document.querySelector('.share-dialog input')?.value.startsWith('http'));
    const shareUrl = await page.inputValue('.share-dialog input');
    checks.ok(shareUrl.includes('#s='), 'share link carries the scene', shareUrl.slice(0, 80));
    checks.ok(await visible(page, '.share-dialog__warning'), 'share dialog warns about uploaded assets');
    checks.ok(
      (await page.textContent('.share-dialog__length')).startsWith(`${shareUrl.length.toLocaleString('en-US')} characters`),
      'share dialog shows the link length',
    );
    await page.click('.share-dialog__copy');
    await page.waitForTimeout(200);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    checks.ok(clip === shareUrl, 'Copy puts the link on the clipboard');
    await shot(page, 'ui-panels/desktop-share');
    await page.keyboard.press('Escape');
    checks.ok(!(await visible(page, '.share-dialog')), 'Escape closes the share dialog');

    // Remove the uploaded song again (confirm).
    await page.click(`.music__item:has(.track[data-song="${uploadId}"]) .music__remove`);
    await page.click('.modal--confirm .btn--danger');
    const removed = await page
      .waitForFunction((id) => !__thunes.registry.getSong(id), uploadId, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    checks.ok(
      removed && (await state(page)).audio.songId === null,
      'removing the playing upload deletes it and falls back to no music',
      `${removed} ${(await state(page)).audio.songId} ${await toastTexts(page)}`,
    );
    // The drawer's own dropzone adds the song and plays it.
    await DROP_WAV(page, 'zone-beat.wav', '.music__drop');
    const zoneId = await page
      .waitForFunction(() => __thunes.registry.listSongs().find((s) => s.source === 'upload')?.id, null, { timeout: 15000 })
      .then((h) => h.jsonValue())
      .catch(() => null);
    checks.ok(zoneId && (await state(page)).audio.songId === zoneId, 'music dropzone adds the song and plays it', String(zoneId));
    if (zoneId) {
      await page.click(`.music__item:has(.track[data-song="${zoneId}"]) .music__remove`);
      await page.click('.modal--confirm .btn--danger');
      await page.waitForFunction((id) => !__thunes.registry.getSong(id), zoneId, { timeout: 5000 }).catch(() => {});
    }
    await page.click(`.track[data-song="${initialSong}"]`);

    // ── Scene drawer ──
    await page.click('.drawer.scene .pill__main');
    await settle(page);
    checks.ok(await visible(page, '.drawer.scene .panel') && !(await visible(page, '.drawer.music .panel')), 'scene drawer opens and closes the music drawer');
    await page.click('.drawer.scene label.swatch:has(input[value="lagoon"])');
    checks.ok((await state(page)).scene.background === 'lagoon', 'backdrop swatch sets the background');
    checks.ok(/Lagoon/.test(await page.textContent('.drawer.scene .pill__meta')), 'pill summary names the backdrop');
    await page.evaluate(() => {
      const input = document.querySelector('.drawer.scene .swatch--custom input[type="color"][aria-label="Custom backdrop colour"]');
      input.value = '#336699';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    let scene = (await state(page)).scene;
    checks.ok(scene.background === 'custom' && scene.backgroundColor === '#336699', 'custom backdrop colour', `${scene.background} ${scene.backgroundColor}`);
    await page.click('.drawer.scene label.swatch:has(input[value="deepfield"])');
    await page.click('.drawer.scene .seg__item:has(input[value="checker"])');
    checks.ok((await state(page)).scene.floorStyle === 'checker', 'floor style switch');
    checks.ok((await page.textContent('.scene__floor-row .field-row__label')) === 'Square colour', 'floor colour label follows the style');
    await page.click('.drawer.scene label.swatch:has(input[value="#6aa6d8"])');
    checks.ok((await state(page)).scene.floorColor === '#6aa6d8', 'floor colour swatch');
    await page.click('.drawer.scene label.swatch:has(input[value="auto"])');
    checks.ok((await state(page)).scene.floorColor === null, '"auto" floor colour is null');
    for (const [label, key] of [
      ['Brightness', 'brightness'],
      ['Exposure', 'exposure'],
      ['Fog', 'fog'],
    ]) {
      const before = (await state(page)).scene[key];
      await page.focus(`.drawer.scene .slider-row:has(label:text-is("${label}")) input`);
      for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
      const after = (await state(page)).scene[key];
      checks.ok(Math.abs(after - before - 0.05) < 0.005, `${label} slider changes scene.${key}`, `${before} → ${after}`);
    }

    // Strobe consent: decline, then accept.
    await page.focus('.drawer.scene .slider-row:has(label:text-is("Intensity")) input');
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('.modal--confirm:not([hidden])', { timeout: 3000 }).catch(() => {});
    checks.ok(await visible(page, '.modal--confirm'), 'raising strobe intensity asks for consent');
    checks.ok(/seizures/.test(await page.textContent('.modal--confirm')), 'consent dialog carries the photosensitivity warning');
    checks.ok((await state(page)).ui.strobeAllowed === false, 'no consent yet while asking');
    await shot(page, 'ui-panels/desktop-strobe-consent');
    await page.click('.modal--confirm .btn--ghost');
    await settle(page, 200);
    scene = (await state(page)).scene;
    checks.ok(scene.strobeIntensity === 0 && (await state(page)).ui.strobeAllowed === false, 'declining puts intensity back to 0', String(scene.strobeIntensity));
    checks.ok((await page.inputValue('.drawer.scene .slider-row:has(label:text-is("Intensity")) input')) === '0', 'intensity slider shows 0 after declining');
    await page.focus('.drawer.scene .slider-row:has(label:text-is("Intensity")) input');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.waitForSelector('.modal--confirm:not([hidden])', { timeout: 3000 }).catch(() => {});
    checks.ok((await page.$$('.modal--confirm')).length === 1, 'only one consent dialog at a time');
    await page.click('.modal--confirm .btn--primary');
    await settle(page, 200);
    checks.ok((await state(page)).ui.strobeAllowed === true, 'accepting allows the strobe');
    checks.ok((await state(page)).scene.strobeIntensity > 0, 'intensity stays raised after accepting');
    checks.ok(!(await visible(page, '.scene__blocked')), 'no "paused" note once allowed');
    await page.focus('.drawer.scene .slider-row:has(label:text-is("Intensity")) input');
    await page.keyboard.press('Home');
    checks.ok((await state(page)).scene.strobeIntensity === 0, 'Home key turns the strobe off');
    await page.click('.drawer.scene .scene__strobe-sync');
    checks.ok((await state(page)).scene.strobeSync === false, 'strobe sync toggle');
    checks.ok(await page.locator('.drawer.scene .slider-row:has(label:text-is("Speed"))').isVisible() && !(await visible(page, '.scene__division')), 'unsynced strobe shows speed (bpm)');
    await page.click('.drawer.scene .scene__strobe-sync');
    await page.click('.scene__division .seg__item:has(input[value="2"])');
    checks.ok((await state(page)).scene.strobeDivision === 2, 'flashes per beat');

    // Camera loop
    await page.click('.drawer.scene .scene__orbit');
    checks.ok((await state(page)).scene.cameraLoop === true, 'camera loop toggle on');
    const cam0 = await page.evaluate(() => __thunes.stage.getCameraPose().position);
    await page.waitForTimeout(600);
    const cam1 = await page.evaluate(() => __thunes.stage.getCameraPose().position);
    checks.ok(cam0.some((v, i) => Math.abs(v - cam1[i]) > 1e-3), 'camera orbits while the loop is on', `${cam0} → ${cam1}`);
    await page.focus('.drawer.scene .slider-row:has(label:text-is("Distance")) input');
    await page.keyboard.press('ArrowRight');
    checks.ok(Math.abs((await state(page)).scene.cameraLoopDistance - 8.1) < 1e-6, 'camera loop distance slider');
    await settle(page, 200);
    await shot(page, 'ui-panels/desktop-scene');
    await page.click('.drawer.scene .scene__orbit');
    checks.ok((await state(page)).scene.cameraLoop === false, 'camera loop toggle off');
    await page.click('.drawer.scene .scene__reset');
    scene = (await state(page)).scene;
    checks.ok(scene.background === 'club' && scene.floorStyle === 'grid' && scene.strobeDivision === 1, 'Reset restores scene defaults');
    await page.click('.toast .btn:text-is("Undo")');
    checks.ok((await state(page)).scene.background === 'deepfield', 'Undo after reset brings the settings back');

    // ── Save / My scenes ──
    await page.keyboard.press('Escape');
    await page.click('button[aria-label="Save scene"]');
    await page.waitForSelector('.save-dialog:not([hidden])');
    const covers = await page.$$eval('.save-dialog__img', (imgs) => imgs.map((i) => ({ src: i.src, w: i.naturalWidth, h: i.naturalHeight })));
    checks.ok(covers.length === 3 && covers.every((c) => c.src.startsWith('data:image/jpeg')), 'save dialog offers three JPEG covers');
    checks.ok(covers.every((c) => c.src.length < 200_000 && c.w === 400 && c.h === 225), 'covers are 400×225 and under 200 kB', covers.map((c) => `${c.w}x${c.h}:${c.src.length}`).join(' '));
    checks.ok(new Set(covers.map((c) => c.src)).size === 3, 'the three covers differ');
    checks.ok(await page.evaluate(() => document.activeElement?.closest('.save-dialog') !== null), 'focus is in the save dialog');
    await page.fill('.save-dialog input[type="text"]', '');
    checks.ok(await page.evaluate(() => document.querySelector('.save-dialog__save').disabled), 'Save is disabled with an empty name');
    await page.fill('.save-dialog input[type="text"]', 'E2E party');
    await page.click('.save-dialog__cover:nth-child(2)');
    await shot(page, 'ui-panels/desktop-save');
    await page.click('.save-dialog__save');
    const saved = await page.evaluate(() => __thunes.library.list());
    checks.ok(saved.length >= 1 && saved[0].title === 'E2E party', 'scene saved to the library');
    checks.ok(saved[0]?.thumbnail === covers[1].src, 'the chosen cover is saved');
    checks.ok((await state(page)).title === 'E2E party', 'store title updated');
    checks.ok(!(await visible(page, '.save-dialog')), 'save dialog closes');

    // Quota error is reported readably.
    await page.evaluate(() => {
      window.__realSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function () {
        const e = new Error('quota');
        e.name = 'QuotaExceededError';
        throw e;
      };
    });
    await page.click('button[aria-label="Save scene"]');
    await page.click('.save-dialog__save');
    const err = await page.textContent('.save-dialog__error');
    checks.ok(/Not enough browser storage/.test(err) && (await visible(page, '.save-dialog__error')), 'storage errors are shown readably', err);
    await page.evaluate(() => {
      Storage.prototype.setItem = window.__realSetItem;
    });
    await page.keyboard.press('Escape');

    await page.click('button[aria-label="My scenes"]');
    await page.waitForSelector('.library-dialog:not([hidden])');
    checks.ok((await page.textContent('.library-dialog__grid')).includes('E2E party'), 'My scenes lists the saved scene');
    checks.ok(/just now/.test(await page.textContent('.library-dialog__grid .card__meta')), 'relative date shown');
    await settle(page);
    await shot(page, 'ui-panels/desktop-library');
    await page.keyboard.press('Escape');

    // Reload: still there; open it.
    await page.reload();
    await waitForApp(page);
    await enter(page);
    await page.evaluate(() => __thunes.store.updateScene({ background: 'white' }));
    await page.click('button[aria-label="My scenes"]');
    await page.waitForSelector('.library-dialog:not([hidden])');
    checks.ok((await page.textContent('.library-dialog__grid')).includes('E2E party'), 'saved scene survives a reload');
    await page.click('.library-dialog__card');
    await page.waitForSelector('.modal--confirm:not([hidden])');
    checks.ok(/Open/.test(await page.textContent('.modal--confirm .modal__title')), 'opening asks first when the stage has dancers');
    await page.click('.modal--confirm .btn--primary');
    const loaded = await state(page);
    checks.ok(loaded.title === 'E2E party' && loaded.scene.background === 'deepfield', 'opening loads the saved scene');
    // Delete
    await page.click('button[aria-label="My scenes"]');
    await page.waitForSelector('.library-dialog:not([hidden])');
    await page.hover('.library-dialog__item');
    await page.click('.library-dialog__delete');
    await page.click('.modal--confirm .btn--danger');
    await page.waitForTimeout(100);
    checks.ok((await page.evaluate(() => __thunes.library.list().length)) === 0, 'delete removes the saved scene');
    checks.ok(await visible(page, '.library-dialog__empty'), 'empty state shown');
    await shot(page, 'ui-panels/desktop-library-empty');
    await page.click('.library-dialog .btn:has-text("Start a fresh stage")');
    await page.click('.modal--confirm .btn--danger');
    checks.ok((await state(page)).dancers.length === 0, '"Start a fresh stage" clears the dancers');
    await page.evaluate(() => __thunes.store.undo());

    // ── Share round trip, with a strobe in the scene ──
    await page.evaluate(() => __thunes.store.updateScene({ strobeIntensity: 0.5, background: 'ember', floorStyle: 'tiles' }));
    await page.click('button[aria-label="Share scene"]');
    await page.waitForFunction(() => document.querySelector('.share-dialog input')?.value.startsWith('http'));
    const url2 = await page.inputValue('.share-dialog input');
    checks.ok(!(await visible(page, '.share-dialog__warning')), 'no upload warning without uploads');
    const original = await page.evaluate(() => __thunes.store.getDocument());
    await page.keyboard.press('Escape');
    const other2 = await context.newPage();
    const problems2 = [];
    other2.on('console', (m) => m.type() === 'error' && problems2.push(m.text()));
    other2.on('pageerror', (e) => problems2.push(e.message));
    await other2.goto(url2);
    await waitForApp(other2);
    const opened = await other2.evaluate(() => __thunes.store.getDocument());
    const norm = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'number' ? Math.round(x * 1e4) / 1e4 : x));
    const diff = Object.keys(original).filter((k) => norm(original[k]) !== norm(opened[k]));
    checks.ok(diff.length === 0, 'share link opens the same document', diff.map((k) => `${k}: ${JSON.stringify(original[k])} vs ${JSON.stringify(opened[k])}`).join(' ; '));
    await other2.click('.splash__enter');
    await other2.waitForFunction(() => __thunes.store.getState().ui.entered);
    await other2.waitForTimeout(300);
    const t2 = await toastTexts(other2);
    checks.ok(t2.some((t) => /strobe/.test(t)), 'shared scene with a strobe shows a consent prompt', t2.join(' | '));
    checks.ok((await state(other2)).ui.strobeAllowed === false, 'shared strobe does not flash without consent');
    await shot(other2, 'ui-panels/desktop-shared-strobe-prompt');
    await other2.click('.toast .btn:text-is("Allow…")');
    await other2.waitForSelector('.modal--confirm:not([hidden])');
    await other2.click('.modal--confirm .btn--primary');
    checks.ok((await state(other2)).ui.strobeAllowed === true, 'prompt → confirm allows the strobe');
    checks.ok(problems2.length === 0, 'no console errors on the shared page', problems2.join(' | '));
    await other2.close();
    await page.evaluate(() => __thunes.store.updateScene({ strobeIntensity: 0 }));

    // ── Keyboard only ──
    await page.evaluate(() => document.activeElement?.blur());
    checks.ok(await tabTo(page, '.drawer.music .pill__main'), 'Tab reaches the music pill');
    await page.keyboard.press('Enter');
    checks.ok(await visible(page, '.drawer.music .panel'), 'Enter opens the music drawer');
    const target = songs.find((id) => id !== (initialSong ?? '') && id !== other) ?? other;
    checks.ok(await tabTo(page, `.track[data-song="${target}"]`), 'Tab reaches a track');
    await page.keyboard.press('Enter');
    checks.ok((await state(page)).audio.songId === target, 'Enter on a track picks it');
    await page.keyboard.press('Escape');
    checks.ok(!(await visible(page, '.drawer.music .panel')), 'Escape closes the music drawer');
    checks.ok(await page.evaluate(() => document.activeElement?.matches('.drawer.music .pill__main')), 'focus returns to the pill');
    await page.click('.drawer.music .music__mute');
    checks.ok((await state(page)).audio.muted === true, 'pill mute button mutes');
    await page.click('.drawer.music .music__mute');
    checks.ok((await state(page)).audio.muted === false, 'pill mute button unmutes');
    await page.focus('.drawer.music .pill__main');
    checks.ok(await tabTo(page, '.drawer.scene .pill__main', 60, true), 'Shift+Tab reaches the scene pill');
    await page.keyboard.press('Enter');
    checks.ok(await tabTo(page, '.drawer.scene .swatch-grid input[type="radio"]'), 'Tab reaches the backdrop swatches');
    const bg0 = (await state(page)).scene.background;
    await page.keyboard.press('ArrowRight');
    checks.ok((await state(page)).scene.background !== bg0, 'arrow keys change the backdrop', `${bg0} → ${(await state(page)).scene.background}`);
    await page.keyboard.press('Escape');
    // Save dialog by keyboard.
    checks.ok(await tabTo(page, 'button[aria-label="Save scene"]', 80), 'Tab reaches Save');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.save-dialog:not([hidden])');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Keyboard scene');
    await page.keyboard.press('Enter');
    checks.ok((await page.evaluate(() => __thunes.library.list()[0]?.title)) === 'Keyboard scene', 'save by keyboard (type a name, Enter)');
    await page.evaluate(() => __thunes.library.remove(__thunes.library.list()[0].id));

    // Error state: a song that cannot be decoded.
    await page.evaluate(() => __thunes.registry.register({ songs: [{ id: 'library:broken', source: 'library', title: 'Broken Tape', url: 'data:audio/mpeg;base64,AAAAAAAA' }] }));
    await page.click('.drawer.music .pill__main');
    await page.click('.track[data-song="library:broken"]');
    const failed = await page
      .waitForFunction(() => __thunes.audio.status.state === 'error', null, { timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    checks.ok(failed && (await visible(page, '.track.is-error')) && /could not play/.test(await page.textContent('.music__status')), 'unplayable song shows an error state', await page.textContent('.music__status'));
    await shot(page, 'ui-panels/desktop-music-error');
    await page.click(`.track[data-song="${initialSong}"]`);
    checks.ok(await waitPlaying(page, initialSong) && !(await visible(page, '.music__status')), 'picking another song clears the error');

    checks.ok(session.problems.length === 0, 'no console errors (desktop)', session.problems.join(' | '));
  } finally {
    await session.close();
  }
}

// ───────────────────────────────────────────────────────────────── Phone ──
async function phone() {
  console.log('\n— phone 390×844 (reduced motion)');
  const session = await openPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const { page } = session;
  try {
    await page.goto(server.url);
    await waitForApp(page);
    await enter(page);
    const songId = (await state(page)).audio.songId;
    checks.ok(await waitPlaying(page, songId), 'phone: song plays');
    checks.ok(
      await page.evaluate(() => !document.querySelector('.drawer.music .pill .levels')?.classList.contains('is-live')),
      'phone: level bars stay still with reduced motion',
    );
    checks.ok(await visible(page, '.drawer.music .pill__main') && (await visible(page, '.drawer.scene .pill__main')), 'phone: both pills visible');
    await page.click('.drawer.music .pill__main');
    await settle(page);
    checks.ok(await inViewport(page, '.drawer.music .panel'), 'phone: music sheet fits the screen');
    const other = await page.evaluate((id) => __thunes.registry.listSongs().find((s) => s.id !== id).id, songId);
    await page.click(`.track[data-song="${other}"]`);
    checks.ok(await waitPlaying(page, other), 'phone: picking a track plays it');
    await shot(page, 'ui-panels/phone-music');
    await page.click('.drawer.scene .pill__main').catch(async () => {
      await page.keyboard.press('Escape');
      await page.click('.drawer.scene .pill__main');
    });
    await settle(page);
    checks.ok(await inViewport(page, '.drawer.scene .panel') && !(await visible(page, '.drawer.music .panel')), 'phone: scene sheet replaces the music sheet');
    checks.ok(/reduced motion/.test(await page.textContent('.scene__callout')), 'phone: strobe warning mentions reduced motion');
    await page.click('.drawer.scene label.swatch:has(input[value="bubblegum"])');
    checks.ok((await state(page)).scene.background === 'bubblegum', 'phone: backdrop swatch');
    await page.$eval('.drawer.scene .panel__body', (b) => (b.scrollTop = b.scrollHeight));
    await page.focus('.drawer.scene .slider-row:has(label:text-is("Intensity")) input');
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('.modal--confirm:not([hidden])');
    checks.ok(/reduce motion/.test(await page.textContent('.modal--confirm')), 'phone: consent dialog mentions reduced motion');
    await page.click('.modal--confirm .btn--ghost');
    await shot(page, 'ui-panels/phone-scene');
    await page.keyboard.press('Escape');
    await page.evaluate(() => __thunes.store.updateUi({}));
    // Save and share dialogs fit.
    await page.evaluate(() => document.querySelector('.toolbar') && null);
    await page.evaluate(() => {
      // Open through the UI context the shell exposes via the toolbar buttons.
      document.querySelector('button[aria-label="Save scene"]').click();
    });
    await page.waitForSelector('.save-dialog:not([hidden])');
    await settle(page);
    checks.ok(await inViewport(page, '.save-dialog .modal__dialog'), 'phone: save dialog fits');
    await shot(page, 'ui-panels/phone-save');
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelector('button[aria-label="Share scene"]').click());
    await page.waitForFunction(() => document.querySelector('.share-dialog input')?.value.startsWith('http'));
    checks.ok(await inViewport(page, '.share-dialog .modal__dialog'), 'phone: share dialog fits');
    await shot(page, 'ui-panels/phone-share');
    checks.ok(session.problems.length === 0, 'no console errors (phone)', session.problems.join(' | '));
  } finally {
    await session.close();
  }
}

try {
  await desktop();
  await phone();
} catch (error) {
  checks.ok(false, 'script crashed', error.stack || String(error));
} finally {
  await server.close();
}
process.exit(checks.summary() ? 0 : 1);
