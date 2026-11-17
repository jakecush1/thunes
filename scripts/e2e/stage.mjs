// Stage environment checks: every background and floor style renders, capture,
// resize, quality switching, strobe safety, context loss, dispose.
// Also writes contact sheets to .e2e/stage/ for visual review.
// Usage: node scripts/e2e/stage.mjs [--sheets] (only build the contact sheets)
import fs from 'node:fs/promises';
import path from 'node:path';
import { OUT_DIR, createChecks, frames, imageStats, openPage, startServer, waitForApp } from './harness.mjs';

const sheetsOnly = process.argv.includes('--sheets');
const server = await startServer();
const checks = createChecks();
const outDir = path.join(OUT_DIR, 'stage');
await fs.mkdir(outDir, { recursive: true });

async function saveDataUrl(name, dataUrl) {
  const file = path.join(outDir, `${name}.png`);
  await fs.writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`  sheet ${file}`);
  return file;
}

/** Size and pixel statistics of an image data URL, decoded in the page. */
function dataUrlStats(page, dataUrl) {
  return page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < data.length; i += 4) {
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sum += l;
      sumSq += l * l;
    }
    const n = data.length / 4;
    const mean = sum / n;
    return { width: canvas.width, height: canvas.height, mean, stddev: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), mime: url.slice(5, url.indexOf(';')) };
  }, dataUrl);
}

async function buildSheets(page) {
  const presets = await page.evaluate(() => globalThis.__thunes.presets);
  const backgroundTiles = [
    ...presets.map((p) => ({ label: `${p.id} · ${p.name}`, scene: { background: p.id } })),
    { label: 'custom #2f6b3a', scene: { background: 'custom', backgroundColor: '#2f6b3a' } },
    { label: 'unknown id → club', scene: { background: 'no-such-preset' } },
  ];
  await saveDataUrl(
    'sheet-backgrounds',
    await page.evaluate((tiles) => globalThis.__thunes.sheet(tiles, { columns: 4, width: 480, height: 300, base: { floorStyle: 'grid' } }), backgroundTiles),
  );

  const floorTiles = [];
  for (const background of ['club', 'bubblegum', 'white', 'black']) {
    for (const floorStyle of ['grid', 'checker', 'tiles', 'none']) {
      floorTiles.push({ label: `${background} / ${floorStyle}`, scene: { background, floorStyle } });
    }
  }
  await saveDataUrl(
    'sheet-floors',
    await page.evaluate((tiles) => globalThis.__thunes.sheet(tiles, { columns: 4, width: 480, height: 300 }), floorTiles),
  );

  const low = { position: [0, 0.6, 10], target: [0, 0.9, 0] };
  const high = { position: [7, 9, 9], target: [0, 0.5, 0] };
  const wide = { position: [0, 5, 30], target: [0, 1, 0] };
  const close = { position: [1.2, 1.5, 3.2], target: [0.6, 0.9, 0] };
  const extraTiles = [
    { label: 'club low horizon', scene: { background: 'club' }, camera: low },
    { label: 'daydream low horizon', scene: { background: 'daydream' }, camera: low },
    { label: 'lastlight low horizon', scene: { background: 'lastlight' }, camera: low },
    { label: 'white far (30 m)', scene: { background: 'white' }, camera: wide },
    { label: 'club fog 0', scene: { background: 'club', fog: 0 } },
    { label: 'club fog 0.6', scene: { background: 'club', fog: 0.6 } },
    { label: 'club fog 1', scene: { background: 'club', fog: 1 } },
    { label: 'peach fog 1', scene: { background: 'peach', fog: 1 } },
    { label: 'studio high angle', scene: { background: 'studio' }, camera: high },
    { label: 'black high angle tiles', scene: { background: 'black', floorStyle: 'tiles' }, camera: high },
    { label: 'studio close-up', scene: { background: 'studio' }, camera: close },
    { label: 'white close-up none', scene: { background: 'white', floorStyle: 'none' }, camera: close },
    { label: 'club brightness 0.3', scene: { background: 'club', brightness: 0.3 } },
    { label: 'club brightness 2', scene: { background: 'club', brightness: 2 } },
    { label: 'club exposure 0.4', scene: { background: 'club', exposure: 0.4 } },
    { label: 'lagoon floorColor #ff5fa8 checker', scene: { background: 'lagoon', floorColor: '#ff5fa8', floorStyle: 'checker' } },
  ];
  await saveDataUrl(
    'sheet-extra',
    await page.evaluate((tiles) => globalThis.__thunes.sheet(tiles, { columns: 4, width: 480, height: 300 }), extraTiles),
  );
}

const session = await openPage({ viewport: { width: 1280, height: 800 } });
const { page } = session;
let retina = null;

try {
  await page.goto(`${server.url}/lab/stage.html?hud=0`);
  await waitForApp(page);
  await frames(page, 3);
  console.log(`GPU: ${await page.evaluate(() => globalThis.__thunes.gpu)}`);

  if (sheetsOnly) {
    await buildSheets(page);
    checks.ok(session.problems.length === 0, 'no console errors', session.problems.join(' | '));
  } else {
    // ── Presets and floor styles ──
    const presets = await page.evaluate(() => globalThis.__thunes.presets);
    console.log(`presets: ${presets.map((p) => `${p.id} (${p.name})`).join(', ')}`);
    checks.ok(presets.length >= 12 && presets.some((p) => p.id === 'club'), `has ${presets.length} presets including club`);
    for (const id of [...presets.map((p) => p.id), 'custom', 'no-such-preset']) {
      await page.evaluate((background) => globalThis.__thunes.setScene({ background, backgroundColor: '#2f6b3a', floorStyle: 'grid' }), id);
      await frames(page, 2);
      const stats = await imageStats(page, await page.screenshot());
      checks.ok(stats.stddev > 2 && stats.distinctColors > 16, `background ${id} renders`, JSON.stringify(stats));
    }
    for (const background of ['club', 'white', 'black']) {
      for (const floorStyle of ['grid', 'checker', 'tiles', 'none']) {
        await page.evaluate((patch) => globalThis.__thunes.setScene(patch), { background, floorStyle });
        await frames(page, 2);
        const stats = await imageStats(page, await page.screenshot());
        checks.ok(stats.stddev > 2 && stats.distinctColors > 16, `floor ${floorStyle} on ${background} renders`, JSON.stringify(stats));
      }
    }
    await page.evaluate(() => globalThis.__thunes.setScene({ background: 'club', floorStyle: 'grid' }));
    await frames(page, 2);

    // ── audio.tick() once per frame ──
    const tickRatio = await page.evaluate(async () => {
      const t = globalThis.__thunes;
      const before = t.audio.ticks;
      let n = 0;
      await new Promise((resolve) => {
        const step = () => (++n >= 30 ? resolve() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      });
      return (t.audio.ticks - before) / n;
    });
    checks.ok(Math.abs(tickRatio - 1) < 0.1, 'audio.tick() runs once per frame', `ticks per frame ${tickRatio}`);

    // ── Capture ──
    const cap = await page.evaluate(() => {
      const t = globalThis.__thunes;
      const poseBefore = JSON.stringify(t.stage.getCameraPose());
      const sizeBefore = [t.stage.canvas.width, t.stage.canvas.height];
      const plain = t.capture({ width: 320, height: 200 });
      const top = t.capture({ width: 320, height: 200, camera: { position: [0, 12, 0.01], target: [0, 0, 0] } });
      const jpeg = t.capture({ width: 200, type: 'image/jpeg', quality: 0.8 });
      const full = t.capture();
      return {
        plain, top, jpeg, full,
        poseSame: poseBefore === JSON.stringify(t.stage.getCameraPose()),
        sizeBefore,
        sizeAfter: [t.stage.canvas.width, t.stage.canvas.height],
      };
    });
    const plainStats = await dataUrlStats(page, cap.plain);
    const topStats = await dataUrlStats(page, cap.top);
    const jpegStats = await dataUrlStats(page, cap.jpeg);
    const fullStats = await dataUrlStats(page, cap.full);
    checks.ok(plainStats.width === 320 && plainStats.height === 200 && plainStats.mime === 'image/png', 'capture 320x200 is a PNG of that size', JSON.stringify(plainStats));
    checks.ok(plainStats.stddev > 2, 'capture is not blank', JSON.stringify(plainStats));
    checks.ok(topStats.width === 320 && topStats.height === 200 && topStats.stddev > 2 && cap.top !== cap.plain, 'capture with camera override differs', JSON.stringify(topStats));
    checks.ok(cap.poseSame, 'capture leaves the live camera alone');
    checks.ok(jpegStats.mime === 'image/jpeg' && jpegStats.width === 200 && jpegStats.height === 125, 'capture derives height from the aspect ratio (JPEG)', JSON.stringify(jpegStats));
    checks.ok(fullStats.width === cap.sizeBefore[0] && fullStats.height === cap.sizeBefore[1], 'default capture size is the canvas size', JSON.stringify(fullStats));
    checks.ok(cap.sizeBefore[0] === 1280 && cap.sizeBefore[1] === 800 && String(cap.sizeBefore) === String(cap.sizeAfter), 'canvas size restored after capture', `${cap.sizeBefore} → ${cap.sizeAfter}`);
    await frames(page, 2);
    const afterCapture = await imageStats(page, await page.screenshot());
    checks.ok(afterCapture.width === 1280 && afterCapture.stddev > 2, 'live view intact after capture', JSON.stringify(afterCapture));

    // ── Resize ──
    await page.setViewportSize({ width: 900, height: 620 });
    await frames(page, 3);
    const resized = await page.evaluate(() => {
      const t = globalThis.__thunes;
      return { w: t.stage.canvas.width, h: t.stage.canvas.height, aspect: t.stage.context.camera.aspect };
    });
    checks.ok(resized.w === 900 && resized.h === 620 && Math.abs(resized.aspect - 900 / 620) < 1e-6, 'canvas follows a window resize', JSON.stringify(resized));
    const resizedStats = await imageStats(page, await page.screenshot());
    checks.ok(resizedStats.stddev > 2, 'renders after resize', JSON.stringify(resizedStats));
    await page.setViewportSize({ width: 1280, height: 800 });
    await frames(page, 3);

    // ── Quality (shadows) ──
    const shadowInfo = async (quality) => {
      await page.evaluate((q) => globalThis.__thunes.setUi({ quality: q }), quality);
      await frames(page, 3);
      return page.evaluate(() => {
        const key = globalThis.__thunes.stage.context.scene.getObjectByName('key');
        return { cast: key.castShadow, map: key.shadow.map ? key.shadow.map.width : 0, debug: globalThis.__thunes.stage.debug() };
      });
    };
    const lowQ = await shadowInfo('low');
    const highQ = await shadowInfo('high');
    const mediumQ = await shadowInfo('medium');
    checks.ok(lowQ.cast === false && lowQ.map === 0, 'low quality: no shadows', JSON.stringify(lowQ));
    checks.ok(mediumQ.cast === true && mediumQ.map === 2048, 'medium quality: 2048 shadow map', JSON.stringify(mediumQ));
    checks.ok(highQ.cast === true && highQ.map === 4096, 'high quality: 4096 shadow map', JSON.stringify(highQ));
    checks.ok(mediumQ.debug.drawCalls > lowQ.debug.drawCalls && mediumQ.debug.triangles > 0 && Array.isArray(mediumQ.debug.dancers), 'debug() reports draw calls and triangles', JSON.stringify(mediumQ.debug));
    checks.ok(mediumQ.debug.fps > 5, 'fps is measured', `fps ${mediumQ.debug.fps}`);

    // Shadows actually darken the floor: compare a patch right of the centre stand-in with shadows on and off.
    const shadowProbe = async (quality) => {
      await page.evaluate((q) => {
        globalThis.__thunes.setUi({ quality: q });
        globalThis.__thunes.setScene({ background: 'white', floorStyle: 'none' });
      }, quality);
      const url = await page.evaluate(() => globalThis.__thunes.capture({ width: 320, height: 200, camera: { position: [0, 9, 0.01], target: [0, 0, 0] } }));
      return dataUrlStats(page, url);
    };
    const withShadow = await shadowProbe('medium');
    const withoutShadow = await shadowProbe('low');
    checks.ok(withoutShadow.mean - withShadow.mean > 0.3, 'shadows darken the floor on white with floor style none', `mean ${withShadow.mean.toFixed(2)} vs ${withoutShadow.mean.toFixed(2)}`);
    await page.evaluate(() => {
      globalThis.__thunes.setUi({ quality: 'medium' });
      globalThis.__thunes.setScene({ background: 'club', floorStyle: 'grid' });
    });

    // ── Strobe ──
    const sampleStrobe = (ms) =>
      page.evaluate(
        (duration) =>
          new Promise((resolve) => {
            const overlay = document.querySelector('[data-role="strobe"]');
            const samples = [];
            const started = performance.now();
            const step = () => {
              const style = getComputedStyle(overlay);
              samples.push(style.display === 'none' || style.visibility === 'hidden' ? 0 : Number(style.opacity));
              if (performance.now() - started < duration) requestAnimationFrame(step);
              else {
                let onsets = 0;
                for (let i = 1; i < samples.length; i++) if (samples[i] > samples[i - 1] + 0.05) onsets++;
                resolve({ max: Math.max(...samples), zeros: samples.filter((s) => s === 0).length, count: samples.length, onsets, pointerEvents: getComputedStyle(overlay).pointerEvents });
              }
            };
            requestAnimationFrame(step);
          }),
        ms,
      );
    await page.evaluate(() => globalThis.__thunes.setScene({ strobeIntensity: 1, strobeSync: true, strobeDivision: 1 }));
    const blocked = await sampleStrobe(1500);
    checks.ok(blocked.max === 0, 'strobe stays dark while strobeAllowed is false', JSON.stringify(blocked));
    await page.evaluate(() => globalThis.__thunes.setUi({ strobeAllowed: true }));
    const synced = await sampleStrobe(3000);
    checks.ok(synced.max > 0.2 && synced.zeros > synced.count * 0.5 && synced.pointerEvents === 'none', 'strobe flashes when allowed and decays to nothing between flashes', JSON.stringify(synced));
    checks.ok(synced.onsets >= 4 && synced.onsets <= 7, 'synced strobe: one flash per beat (120 BPM → about 6 in 3 s)', JSON.stringify(synced));
    await page.evaluate(() => globalThis.__thunes.setScene({ strobeSync: false, strobeBpm: 120 }));
    const free = await sampleStrobe(3000);
    checks.ok(free.onsets >= 4 && free.onsets <= 7, 'free strobe: 120 per minute → about 6 in 3 s', JSON.stringify(free));
    await page.evaluate(() => globalThis.__thunes.setScene({ strobeSync: false, strobeBpm: 1200 }));
    const capped = await sampleStrobe(3000);
    checks.ok(capped.onsets <= 10, 'strobe never exceeds three flashes per second', JSON.stringify(capped));
    await page.evaluate(() => globalThis.__thunes.setScene({ strobeIntensity: 0 }));
    const zero = await sampleStrobe(800);
    checks.ok(zero.max === 0, 'strobe stays dark at intensity 0', JSON.stringify(zero));

    // ── Frame time ──
    for (const quality of ['low', 'medium', 'high']) {
      await page.evaluate((q) => globalThis.__thunes.setUi({ quality: q }), quality);
      await frames(page, 20);
      const ms = await page.evaluate(() => globalThis.__thunes.benchmark(60));
      await frames(page, 60);
      const fps = await page.evaluate(() => globalThis.__thunes.stage.fps);
      console.log(`  frame time (${quality}, 1280x800 @1x, GPU-synced): ${ms.toFixed(2)} ms; live ${fps.toFixed(1)} fps`);
    }
    await page.evaluate(() => globalThis.__thunes.setUi({ quality: 'medium' }));

    // ── Context loss ──
    await page.evaluate(() => globalThis.__thunes.stage.context.renderer.forceContextLoss());
    await page.waitForTimeout(300);
    await page.evaluate(() => globalThis.__thunes.stage.context.renderer.forceContextRestore());
    await page.waitForTimeout(300);
    await frames(page, 3);
    const restored = await imageStats(page, await page.screenshot());
    checks.ok(restored.stddev > 2 && restored.distinctColors > 16, 'renders again after context loss and restore', JSON.stringify(restored));
    const metalAfter = await page.evaluate(() => Boolean(globalThis.__thunes.stage.context.scene.environment));
    checks.ok(metalAfter, 'environment map rebuilt after restore');

    await buildSheets(page);

    // ── Dispose ──
    const disposed = await page.evaluate(() => {
      const t = globalThis.__thunes;
      t.stage.dispose();
      t.stage.dispose();
      return { canvases: document.querySelectorAll('#stage canvas').length, overlays: document.querySelectorAll('[data-role="strobe"]').length };
    });
    await page.waitForTimeout(200);
    checks.ok(disposed.canvases === 0 && disposed.overlays === 0, 'dispose removes the canvas and the overlay', JSON.stringify(disposed));
    checks.ok(session.problems.length === 0, 'no console errors or failed requests', session.problems.join(' | '));

    // ── Pixel ratio per quality on a 2x display ──
    retina = await openPage({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 2 });
    await retina.page.goto(`${server.url}/lab/stage.html?hud=0&quality=low&bg=daydream&floor=tiles`);
    await waitForApp(retina.page);
    const widths = {};
    for (const quality of ['low', 'medium', 'high']) {
      await retina.page.evaluate((q) => globalThis.__thunes.setUi({ quality: q }), quality);
      await frames(retina.page, 2);
      widths[quality] = await retina.page.evaluate(() => globalThis.__thunes.stage.canvas.width);
    }
    checks.ok(widths.low === 800 && widths.medium === 1200 && widths.high === 1600, 'pixel ratio 1 / 1.5 / 2 per quality on a 2x display', JSON.stringify(widths));
    const retinaStats = await imageStats(retina.page, await retina.page.screenshot());
    checks.ok(retinaStats.stddev > 2, 'URL parameters apply (daydream tiles renders)', JSON.stringify(retinaStats));
    await retina.page.evaluate(() => globalThis.__thunes.setUi({ quality: 'high' }));
    await frames(retina.page, 20);
    const retinaMs = await retina.page.evaluate(() => globalThis.__thunes.benchmark(60));
    console.log(`  frame time (high, 1600x1000 buffer, daydream sky + tiles, GPU-synced): ${retinaMs.toFixed(2)} ms`);
    checks.ok(retina.problems.length === 0, 'no console errors on the 2x page', retina.problems.join(' | '));
  }
} catch (error) {
  checks.ok(false, 'script completed', String(error && error.stack ? error.stack : error));
  if (session.problems.length) console.log(session.problems.join('\n'));
} finally {
  if (retina) await retina.close();
  await session.close();
  await server.close();
}

process.exit(checks.summary() ? 0 : 1);
