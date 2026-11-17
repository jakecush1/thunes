// End-to-end harness: serves the app with Vite and drives it in the system's
// Google Chrome (via playwright-core, no browser download needed).
//
//   import { startServer, openPage, waitForApp, shot, imageStats } from './harness.mjs';
//   const server = await startServer();              // dev server on a free port
//   const session = await openPage();
//   await session.page.goto(server.url);
//   await waitForApp(session.page);
//   await shot(session.page, 'home');                // -> .e2e/home.png
//   await session.close(); await server.close();
//
// Every server gets its own port and Vite cache dir, so several harness
// processes can run side by side.

import { build, createServer, preview } from 'vite';
import { chromium } from 'playwright-core';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Where screenshots and other artifacts go. Override with E2E_OUT. */
export const OUT_DIR = process.env.E2E_OUT ? path.resolve(process.env.E2E_OUT) : path.join(ROOT, '.e2e');

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Start the app server.
 * @param {{ mode?: 'dev' | 'preview' }} [options] 'dev' serves sources (and the lab/ pages);
 *   'preview' builds a production bundle into a private folder and serves that.
 * @returns {Promise<{ url: string, mode: string, close: () => Promise<void> }>}
 */
export async function startServer({ mode = 'dev' } = {}) {
  const port = await freePort();
  const tag = `${process.pid}-${port}`;
  const host = '127.0.0.1';

  if (mode === 'preview') {
    const outDir = path.join(ROOT, '.e2e', `dist-${tag}`);
    await build({ root: ROOT, logLevel: 'error', build: { outDir, emptyOutDir: true, sourcemap: false } });
    const server = await preview({
      root: ROOT,
      logLevel: 'error',
      build: { outDir },
      preview: { port, host, strictPort: true },
    });
    return {
      url: `http://${host}:${port}`,
      mode,
      close: async () => {
        await new Promise((resolve) => server.httpServer.close(() => resolve()));
        await fs.rm(outDir, { recursive: true, force: true });
      },
    };
  }

  const cacheDir = path.join(ROOT, 'node_modules', '.vite-e2e', tag);
  const server = await createServer({
    root: ROOT,
    cacheDir,
    logLevel: 'error',
    clearScreen: false,
    server: { port, host, strictPort: true, hmr: false, watch: null },
  });
  await server.listen();
  return {
    url: `http://${host}:${port}`,
    mode,
    close: async () => {
      await server.close();
      await fs.rm(cacheDir, { recursive: true, force: true });
    },
  };
}

/**
 * Launch Chrome and open a blank page that records everything that goes wrong.
 * `problems` collects console errors, uncaught exceptions, failed requests and HTTP >= 400.
 * @param {{ viewport?: { width: number, height: number }, deviceScaleFactor?: number, headless?: boolean,
 *           hasTouch?: boolean, isMobile?: boolean, reducedMotion?: 'reduce' | 'no-preference' }} [options]
 */
export async function openPage({
  viewport = { width: 1280, height: 800 },
  deviceScaleFactor = 1,
  headless = true,
  hasTouch = false,
  isMobile = false,
  reducedMotion = 'no-preference',
} = {}) {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ viewport, deviceScaleFactor, hasTouch, isMobile, reducedMotion });
  const page = await context.newPage();
  const logs = [];
  const problems = [];
  page.on('console', (message) => {
    const line = `[${message.type()}] ${message.text()}`;
    logs.push(line);
    if (message.type() === 'error') problems.push(line);
  });
  page.on('pageerror', (error) => problems.push(`[pageerror] ${error.stack || error.message}`));
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    // Aborted media/range requests are normal when audio elements are torn down.
    if (failure && /ERR_ABORTED/.test(failure.errorText)) return;
    problems.push(`[requestfailed] ${request.url()} ${failure ? failure.errorText : ''}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`[http ${response.status()}] ${response.url()}`);
  });
  return { browser, context, page, logs, problems, close: () => browser.close() };
}

/** Wait until the app (or a lab page) reports `window.__thunes.ready === true`. */
export async function waitForApp(page, { timeout = 30000 } = {}) {
  await page.waitForFunction(() => globalThis.__thunes && globalThis.__thunes.ready === true, null, { timeout });
}

/** Wait for `count` animation frames to be presented. */
export async function frames(page, count = 2) {
  await page.evaluate(
    (n) =>
      new Promise((resolve) => {
        const step = () => (n-- <= 0 ? resolve(undefined) : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    count,
  );
}

/**
 * Save a screenshot under OUT_DIR and return its absolute path.
 * @param {import('playwright-core').Page | import('playwright-core').Locator} target
 * @param {string} name file name without extension (sub-folders allowed)
 */
export async function shot(target, name, options = {}) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await target.screenshot({ path: file, ...options });
  return file;
}

/**
 * Pixel statistics of a PNG (decoded inside the page, so no image library is needed).
 * A rendered 3D scene has stddev well above 0 and many distinct colours; a blank canvas has neither.
 * @returns {Promise<{ width: number, height: number, mean: number, stddev: number, distinctColors: number }>}
 */
export async function imageStats(page, pngBuffer) {
  const base64 = Buffer.from(pngBuffer).toString('base64');
  return page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const { data: px } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const colors = new Set();
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    const stride = Math.max(1, Math.floor(px.length / 4 / 40000)) * 4;
    for (let i = 0; i < px.length; i += stride) {
      const luma = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      sum += luma;
      sumSq += luma * luma;
      n++;
      colors.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
    }
    const mean = sum / n;
    return {
      width: bitmap.width,
      height: bitmap.height,
      mean,
      stddev: Math.sqrt(Math.max(0, sumSq / n - mean * mean)),
      distinctColors: colors.size,
    };
  }, base64);
}

/** Tiny assertion helper that collects failures instead of throwing on the first one. */
export function createChecks() {
  const failures = [];
  const passes = [];
  return {
    ok(condition, label, detail = '') {
      if (condition) passes.push(label);
      else failures.push(detail ? `${label}: ${detail}` : label);
      console.log(`${condition ? '  ok  ' : '  FAIL'} ${label}${!condition && detail ? ` (${detail})` : ''}`);
      return Boolean(condition);
    },
    failures,
    passes,
    summary() {
      console.log(`\n${passes.length} passed, ${failures.length} failed`);
      return failures.length === 0;
    },
  };
}
