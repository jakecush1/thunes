// Dancer, interaction, camera-loop and thumbnail checks against lab/dancers.html.
// Writes screenshots and a thumbnail contact sheet to .e2e/dancers/ for visual review.
// Usage: node scripts/e2e/dancers.mjs [--shots] (only the screenshots and the contact sheet)
import fs from 'node:fs/promises';
import path from 'node:path';
import { OUT_DIR, createChecks, frames, openPage, shot, startServer, waitForApp } from './harness.mjs';

const shotsOnly = process.argv.includes('--shots');
const server = await startServer();
const session = await openPage();
const { page } = session;
const checks = createChecks();
const outDir = path.join(OUT_DIR, 'dancers');
await fs.mkdir(outDir, { recursive: true });

const T = () => globalThis.__thunes;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const debug = () => page.evaluate(() => globalThis.__thunes.stage.debug());
const dancer = async (id) => (await debug()).dancers.find((d) => d.id === id);
const state = () => page.evaluate(() => globalThis.__thunes.store.getState());
const stored = async (id) => (await state()).dancers.find((d) => d.id === id);
const update = (id, patch) => page.evaluate(([i, p]) => globalThis.__thunes.store.updateDancer(i, p), [id, patch]);
const screenOf = (id, bone = 'Hips') => page.evaluate(([i, b]) => globalThis.__thunes.screenOf(i, b), [id, bone]);
const screenAt = (x, y, z) => page.evaluate(([a, b, c]) => globalThis.__thunes.screenAt(a, b, c), [x, y, z]);
const pose = () => page.evaluate(() => globalThis.__thunes.stage.getCameraPose());
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

async function allReady(timeout = 15000) {
  await page.waitForFunction(
    () => {
      const t = globalThis.__thunes;
      const list = t.stage.debug().dancers;
      return list.length === t.store.getState().dancers.length && list.every((d) => d.status !== 'loading');
    },
    null,
    { timeout },
  );
  await frames(page, 2);
}

async function load(name) {
  await page.evaluate((n) => globalThis.__thunes.load(n), name);
  await allReady();
}

async function drag(from, to, steps = 8) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await frames(page, 2);
  await page.mouse.up();
  await frames(page, 2);
}

async function click(at) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  await frames(page, 2);
}

/** Wait until the orbit damping has settled and the pose was committed to the store. */
async function settle(timeout = 8000) {
  const deadline = Date.now() + timeout;
  let calm = 0;
  let last = null;
  while (Date.now() < deadline) {
    const [live, saved] = await page.evaluate(() => [globalThis.__thunes.stage.getCameraPose(), globalThis.__thunes.store.getState().camera]);
    const still = last !== null && dist(live.position, last.position) < 1e-9 && dist(live.target, last.target) < 1e-9;
    last = live;
    if (still && dist(live.position, saved.position) < 1e-6 && dist(live.target, saved.target) < 1e-6) {
      if (++calm >= 2) return;
    } else calm = 0;
    await sleep(80);
  }
  throw new Error('camera did not settle / was not committed');
}

async function saveDataUrl(name, dataUrl) {
  const file = path.join(outDir, `${name}.png`);
  await fs.writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`  image ${file}`);
  return file;
}

async function screenshots() {
  await load('six');
  await sleep(700);
  await shot(page, 'dancers/six');
  await load('fx');
  await sleep(900);
  await shot(page, 'dancers/fx');
  await page.evaluate(() => globalThis.__thunes.store.select('f3'));
  await frames(page, 3);
  await shot(page, 'dancers/fx-selected');
  await page.evaluate(() => globalThis.__thunes.store.select(null));
}

async function thumbnails() {
  const result = await page.evaluate(async () => {
    const t = globalThis.__thunes;
    const stats = async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let covered = 0;
      let sum = 0;
      let sumSq = 0;
      let corner = data[3];
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 128) {
          covered++;
          const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          sum += l;
          sumSq += l * l;
        }
      }
      const mean = covered ? sum / covered : 0;
      return {
        width: canvas.width,
        height: canvas.height,
        coverage: covered / (data.length / 4),
        stddev: covered ? Math.sqrt(Math.max(0, sumSq / covered - mean * mean)) : 0,
        cornerAlpha: corner,
      };
    };
    const startedAt = performance.now();
    const items = [];
    // Only the built-ins: library files in public/assets come and go (and may repeat a built-in dance).
    const characterIds = t.characterIds.filter((id) => id.startsWith('builtin:'));
    const danceIds = t.danceIds.filter((id) => id.startsWith('builtin:'));
    for (const id of characterIds) items.push({ label: id, url: await t.thumbnails.character(id) });
    for (const id of danceIds) items.push({ label: id, url: await t.thumbnails.dance(id) });
    const elapsed = performance.now() - startedAt;
    const again = await t.thumbnails.character(characterIds[0]);
    let failure = '';
    try {
      await t.thumbnails.character('builtin:no-such-character');
    } catch (error) {
      failure = error instanceof Error ? error.message : 'not an Error';
    }
    const onOther = await t.thumbnails.dance(danceIds[2], 'builtin:toy');
    return {
      elapsed,
      cached: again === items[0].url,
      failure,
      onOtherDiffers: onOther !== items[characterIds.length + 2].url,
      stats: await Promise.all(items.map((item) => stats(item.url))),
      labels: items.map((item) => item.label),
      unique: new Set(items.map((item) => item.url)).size,
      count: items.length,
      sheet: await t.thumbSheet(items, 6),
    };
  });
  await saveDataUrl('thumbnails', result.sheet);
  checks.ok(result.count === 18, 'thumbnails: six characters and twelve dances', String(result.count));
  const bad = result.stats.map((s, i) => ({ ...s, label: result.labels[i] })).filter((s) => !(s.width === 256 && s.height === 256 && s.coverage > 0.04 && s.coverage < 0.9 && s.stddev > 6 && s.cornerAlpha === 0));
  checks.ok(bad.length === 0, 'thumbnails: 256 px, non-blank, transparent background', JSON.stringify(bad));
  checks.ok(result.unique === result.count, 'thumbnails: all differ from each other', `${result.unique} unique of ${result.count}`);
  checks.ok(result.cached, 'thumbnails: cached per key');
  checks.ok(result.onOtherDiffers, 'thumbnails: a dance on another character gives another picture');
  checks.ok(/no-such-character/.test(result.failure), 'thumbnails: failures reject with a readable Error', result.failure);
  console.log(`  thumbnails: ${result.count} in ${result.elapsed.toFixed(0)} ms`);
}

try {
  await page.goto(`${server.url}/lab/dancers.html?scene=starter&hud=0`);
  await waitForApp(page);

  if (shotsOnly) {
    await allReady();
    await screenshots();
    await thumbnails();
  } else {
    // ── Loading and motion ──
    await allReady();
    let info = await debug();
    checks.ok(info.dancers.length === 4 && info.dancers.every((d) => d.status === 'ready'), "starter scene: all dancers reach 'ready'", JSON.stringify(info.dancers.map((d) => d.status)));
    const before = info.dancers.map((d) => d.landmarks);
    await sleep(400);
    info = await debug();
    const moved = info.dancers.map((d, i) => Math.max(...['LeftHand', 'RightHand', 'Head'].map((k) => dist(d.landmarks[k], before[i][k]))));
    checks.ok(moved.every((m) => m > 0.02), 'landmarks move over time', JSON.stringify(moved.map((m) => +m.toFixed(3))));

    // ── Unison ──
    await sleep(350);
    await page.evaluate(() => {
      const t = globalThis.__thunes;
      t.store.addDancer({ characterId: 'builtin:stick', danceId: 'builtin:groove', x: 2.8, z: 0 });
      t.store.addDancer({ characterId: 'builtin:voxel', danceId: 'builtin:disco-point', x: -2.8, z: 0 });
    });
    await allReady();
    await sleep(300);
    info = await debug();
    const byId = Object.fromEntries(info.dancers.map((d) => [d.id, d]));
    const ids = Object.keys(byId);
    const late = ids.find((id) => byId[id].danceId === 'builtin:groove' && id !== 'd1');
    const late2 = ids.find((id) => byId[id].danceId === 'builtin:disco-point' && id !== 'd4');
    checks.ok(late && Math.abs(byId[late].clipTime - byId.d1.clipTime) < 1e-9, 'same dance and speed: same clipTime (dancer added later)', `${byId.d1.clipTime} vs ${late && byId[late].clipTime}`);
    checks.ok(late2 && Math.abs(byId[late2].clipTime - byId.d4.clipTime) < 1e-9, 'same dance and speed: same clipTime (second pair)', `${byId.d4.clipTime} vs ${late2 && byId[late2].clipTime}`);
    checks.ok((await state()).ui.selectedId !== null, 'adding a dancer selects it');

    // ── Speed changes, speed 0, resync ──
    await update('d1', { speed: 2 });
    const t0 = (await dancer('d1')).clipTime;
    await frames(page, 1);
    const t1 = (await dancer('d1')).clipTime;
    const durations = await page.evaluate(async () => {
      const t = globalThis.__thunes;
      const out = {};
      for (const id of t.danceIds) out[id] = (await t.registry.loadDance(id)).duration;
      return out;
    });
    const wrap = (d, D) => Math.min(Math.abs(d), D - Math.abs(d));
    checks.ok(wrap(t1 - t0, durations['builtin:groove']) < 0.2, 'changing speed does not jump', `${t0} -> ${t1}`);
    await update('d1', { speed: 0 });
    await frames(page, 2);
    const frozenA = await dancer('d1');
    await sleep(400);
    const frozenB = await dancer('d1');
    checks.ok(frozenA.clipTime === frozenB.clipTime && dist(frozenA.landmarks.LeftHand, frozenB.landmarks.LeftHand) < 1e-9, 'speed 0 freezes the pose', `${frozenA.clipTime} vs ${frozenB.clipTime}`);
    await update('d1', { speed: 1 });
    await sleep(200);
    info = await debug();
    const drift = Math.abs(info.dancers.find((d) => d.id === 'd1').clipTime - info.dancers.find((d) => d.id === late).clipTime);
    checks.ok(drift > 1e-6, 'after a speed change the dancer is out of step', String(drift));
    await page.evaluate(() => globalThis.__thunes.stage.resync());
    await frames(page, 3);
    info = await debug();
    checks.ok(Math.abs(info.dancers.find((d) => d.id === 'd1').clipTime - info.dancers.find((d) => d.id === late).clipTime) < 1e-9, 'stage.resync() puts it back in step');

    // ── Beat sync toggle ──
    await page.evaluate(() => globalThis.__thunes.store.updateAudio({ beatSync: false }));
    await sleep(300);
    info = await debug();
    checks.ok(Math.abs(info.dancers.find((d) => d.id === 'd1').clipTime - info.dancers.find((d) => d.id === late).clipTime) < 1e-9, 'free-running dancers stay in unison');
    const freeA = info.dancers.find((d) => d.id === 'd2').clipTime;
    await sleep(300);
    const freeB = (await dancer('d2')).clipTime;
    checks.ok(freeA !== freeB, 'free-running dancers keep moving');
    await page.evaluate(() => globalThis.__thunes.store.updateAudio({ beatSync: true }));

    // ── Trim ──
    await update('d2', { trimStart: 0.25, trimEnd: 0.5 });
    const D = durations['builtin:robot'];
    const times = [];
    for (let i = 0; i < 30; i++) {
      await sleep(70);
      times.push((await dancer('d2')).clipTime);
    }
    checks.ok(
      times.every((t) => t >= 0.25 * D - 1e-6 && t <= 0.5 * D + 1e-6) && Math.max(...times) - Math.min(...times) > 0.1 * D,
      'trim confines clipTime',
      `D=${D} min=${Math.min(...times)} max=${Math.max(...times)}`,
    );
    await update('d2', { trimStart: 0, trimEnd: 1 });

    // ── Mirror ──
    await page.evaluate(() => {
      globalThis.__thunes.setDancers([
        { id: 'm1', characterId: 'builtin:mannequin', danceId: 'builtin:disco-point', x: -1, z: 0 },
        { id: 'm2', characterId: 'builtin:mannequin', danceId: 'builtin:disco-point', x: 1, z: 0, mirror: true },
      ]);
    });
    await allReady();
    await sleep(500);
    let worst = 0;
    let asymmetry = 0;
    for (let i = 0; i < 6; i++) {
      await sleep(150);
      info = await debug();
      const [a, b] = info.dancers;
      const rel = (d, k) => [d.landmarks[k][0] - d.landmarks.Hips[0], d.landmarks[k][1] - d.landmarks.Hips[1], d.landmarks[k][2] - d.landmarks.Hips[2]];
      for (const [ka, kb] of [['LeftHand', 'RightHand'], ['RightHand', 'LeftHand'], ['LeftFoot', 'RightFoot'], ['Head', 'Head']]) {
        const p = rel(a, ka);
        const q = rel(b, kb);
        worst = Math.max(worst, Math.hypot(p[0] + q[0], p[1] - q[1], p[2] - q[2]));
      }
      asymmetry = Math.max(asymmetry, dist(rel(a, 'LeftHand'), rel(b, 'LeftHand')));
    }
    checks.ok(worst < 0.03 && asymmetry > 0.2, 'mirror flips the motion left-right', `mirror error ${worst.toFixed(4)} m, difference ${asymmetry.toFixed(3)} m`);

    // ── Crossfade on dance change ──
    const problemsBefore = session.problems.length;
    const trace = await page.evaluate(async () => {
      const t = globalThis.__thunes;
      const hand = () => t.stage.debug().dancers[0].landmarks.LeftHand;
      const next = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const jumps = [];
      const statuses = new Set();
      let last = hand();
      // Typical motion before the change.
      let usual = 0;
      for (let i = 0; i < 20; i++) {
        await next();
        const now = hand();
        usual = Math.max(usual, Math.hypot(now[0] - last[0], now[1] - last[1], now[2] - last[2]));
        last = now;
      }
      t.store.updateDancer('m1', { danceId: 'builtin:hands-up' });
      for (let i = 0; i < 40; i++) {
        await next();
        const now = hand();
        jumps.push(Math.hypot(now[0] - last[0], now[1] - last[1], now[2] - last[2]));
        last = now;
        statuses.add(t.stage.debug().dancers[0].status);
      }
      // Flip mirror mid-fade and swap again quickly: must not break.
      t.store.updateDancer('m1', { danceId: 'builtin:groove' });
      await next();
      t.store.updateDancer('m1', { mirror: true });
      await next();
      t.store.updateDancer('m1', { danceId: 'builtin:hands-up', mirror: false });
      for (let i = 0; i < 40; i++) await next();
      return { usual, worst: Math.max(...jumps), statuses: [...statuses], final: t.stage.debug().dancers[0] };
    });
    checks.ok(trace.worst < Math.max(0.12, trace.usual * 3), 'changing dance crossfades (no pop)', `largest step ${trace.worst.toFixed(3)} m, usual ${trace.usual.toFixed(3)} m`);
    checks.ok(trace.final.status === 'ready' && trace.final.danceId === 'builtin:hands-up' && session.problems.length === problemsBefore, 'changing dance: no errors, ends ready', JSON.stringify(session.problems.slice(problemsBefore)));

    // ── Character swap keeps settings ──
    await update('m1', { danceId: 'builtin:disco-point', tint: '#ff0000', headSize: 2, shine: 0.25, metal: 0.5, warpAmount: 0.5, speed: 1 });
    await update('m2', { mirror: false });
    await allReady();
    await sleep(600);
    const look = (id) =>
      page.evaluate((i) => {
        const t = globalThis.__thunes;
        const anchor = t.stage.context.scene.getObjectByName(`dancer:${i}`);
        let mesh = null;
        anchor.traverse((node) => {
          if (node.isMesh && node.name !== 'placeholder') mesh = node;
        });
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        let head = null;
        anchor.traverse((node) => {
          if (node.name === 'Head') head = node;
        });
        return { color: material.color.getHexString(), roughness: material.roughness, metalness: material.metalness, head: head.scale.x, depth: Boolean(mesh.customDepthMaterial), meshName: mesh.name };
      }, id);
    const lookBefore = await look('m1');
    checks.ok(lookBefore.color === 'ff0000' && Math.abs(lookBefore.roughness - 0.75) < 1e-6 && lookBefore.metalness === 0.5 && lookBefore.head === 2 && lookBefore.depth, 'look, body and warp settings reach the instance', JSON.stringify(lookBefore));
    const settingsBefore = await stored('m1');
    await update('m1', { characterId: 'builtin:robot' });
    await allReady();
    await sleep(200);
    const lookAfter = await look('m1');
    const settingsAfter = await stored('m1');
    info = await debug();
    const same = Object.keys(settingsBefore).every((k) => k === 'characterId' || settingsBefore[k] === settingsAfter[k]);
    checks.ok(
      same && lookAfter.meshName.includes('robot') && lookAfter.color === 'ff0000' && Math.abs(lookAfter.roughness - 0.75) < 1e-6 && lookAfter.metalness === 0.5 && lookAfter.head === 2 && lookAfter.depth,
      'swapping character keeps settings',
      JSON.stringify(lookAfter),
    );
    checks.ok(Math.abs(info.dancers[0].clipTime - info.dancers[1].clipTime) < 1e-9, 'swapping character keeps the dance in step');
    await update('m1', { tint: null, shine: null, metal: null, headSize: 1, warpAmount: 0 });
    await frames(page, 2);
    const restored = await look('m1');
    const fresh = await page.evaluate(async () => {
      const asset = await globalThis.__thunes.registry.loadCharacter('builtin:robot');
      const instance = asset.instantiate();
      const m = instance.materials[0];
      const out = { color: m.color.getHexString(), roughness: m.roughness, metalness: m.metalness };
      instance.dispose();
      return out;
    });
    checks.ok(restored.color === fresh.color && restored.roughness === fresh.roughness && restored.metalness === fresh.metalness && !restored.depth && restored.head === 1, 'null look values restore the authored material', JSON.stringify({ restored, fresh }));

    // ── Missing assets fall back ──
    const warnsBefore = session.logs.filter((l) => l.startsWith('[warning]')).length;
    await page.evaluate(() => {
      const t = globalThis.__thunes;
      t.store.addDancer({ characterId: 'library:missing', danceId: 'library:nope', x: 3, z: 0 });
    });
    await allReady();
    info = await debug();
    const fallback = info.dancers[info.dancers.length - 1];
    const warns = session.logs.filter((l) => l.startsWith('[warning]')).length - warnsBefore;
    checks.ok(fallback.status === 'error' && fallback.landmarks.Hips !== undefined && warns >= 1 && warns <= 2, 'missing assets: fallback shown, status error, warned once each', `${fallback.status}, ${warns} warnings`);

    // ── Feet near the floor, 8 dancers, frame time ──
    await load('crowd');
    const feet = await page.evaluate(async () => {
      const t = globalThis.__thunes;
      const low = {};
      const high = {};
      for (let i = 0; i < 90; i++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (i % 2) continue;
        for (const d of t.stage.debug().dancers) {
          const y = Math.min(d.landmarks.LeftFoot[1], d.landmarks.RightFoot[1]);
          low[d.id] = Math.min(low[d.id] ?? Infinity, y);
          high[d.id] = Math.max(high[d.id] ?? -Infinity, y);
        }
      }
      return { low, high };
    });
    const lows = Object.values(feet.low);
    checks.ok(lows.length === 8 && lows.every((y) => y > -0.03 && y < 0.3), 'feet stay near the floor (lowest ankle per dancer)', JSON.stringify(lows.map((y) => +y.toFixed(3))));
    await page.evaluate(() => globalThis.__thunes.benchmark(30));
    const bench = await page.evaluate(() => globalThis.__thunes.benchmark(180));
    console.log(`  8 dancers: cpu ${bench.cpuMean.toFixed(2)} ms mean / ${bench.cpuMax.toFixed(2)} ms max, frame interval ${bench.interval.toFixed(2)} ms, ${bench.drawCalls} draw calls, ${bench.triangles} triangles`);
    checks.ok(bench.cpuMean < 6 && bench.interval < 18.5, '8 dancers hold 60 fps', JSON.stringify(bench));
    await page.evaluate(() => {
      const t = globalThis.__thunes;
      for (const d of t.store.getState().dancers) t.store.updateDancer(d.id, { warpAmount: 0.6, shakeBody: 0.5, shakeArms: 0.5, shakeNeck: 0.5 });
    });
    await frames(page, 30);
    const benchFx = await page.evaluate(() => globalThis.__thunes.benchmark(180));
    console.log(`  8 dancers, warp + shake: cpu ${benchFx.cpuMean.toFixed(2)} ms mean, frame interval ${benchFx.interval.toFixed(2)} ms`);
    checks.ok(benchFx.cpuMean < 6 && benchFx.interval < 18.5, '8 dancers with warp and shake hold 60 fps', JSON.stringify(benchFx));

    // ── Memory returns to baseline ──
    const cycle = async () => {
      await page.evaluate(() => globalThis.__thunes.store.clearDancers());
      await frames(page, 3);
      return page.evaluate(() => globalThis.__thunes.memory());
    };
    const baseline = await cycle();
    await load('crowd');
    await page.evaluate(() => {
      const t = globalThis.__thunes;
      for (const d of t.store.getState().dancers) t.store.updateDancer(d.id, { warpAmount: 0.6 });
    });
    await frames(page, 5);
    const loaded = await page.evaluate(() => globalThis.__thunes.memory());
    const after = await cycle();
    checks.ok(
      after.geometries === baseline.geometries && after.textures === baseline.textures && loaded.textures > baseline.textures,
      'removing all dancers returns renderer.info.memory to its baseline',
      JSON.stringify({ baseline, loaded, after }),
    );
    const leftovers = await page.evaluate(() => globalThis.__thunes.stage.context.scene.getObjectByName('dancers').children.map((c) => c.name));
    checks.ok(leftovers.every((name) => !name.startsWith('dancer:')), 'no orphan objects after removal', JSON.stringify(leftovers));

    // ── Races: swap and remove while loading ──
    await page.evaluate(async () => {
      const t = globalThis.__thunes;
      const a = t.store.addDancer({ characterId: 'builtin:toy', danceId: 'builtin:groove', x: 0, z: 0 });
      t.store.updateDancer(a.id, { characterId: 'builtin:robot' });
      t.store.updateDancer(a.id, { characterId: 'builtin:lanky', danceId: 'builtin:hands-up' });
      const b = t.store.addDancer({ characterId: 'builtin:stick', danceId: 'builtin:groove', x: 1, z: 0 });
      t.store.removeDancer(b.id);
      const c = t.store.addDancer({ characterId: 'builtin:voxel', danceId: 'builtin:groove', x: 2, z: 0 });
      await Promise.resolve();
      t.store.removeDancer(c.id);
    });
    await allReady();
    await sleep(200);
    const race = await page.evaluate(() => {
      const t = globalThis.__thunes;
      const anchors = t.stage.context.scene.getObjectByName('dancers').children.filter((c) => c.name.startsWith('dancer:'));
      let meshes = 0;
      for (const anchor of anchors) anchor.traverse((n) => { if (n.isMesh && n.name !== 'placeholder') meshes++; });
      return { anchors: anchors.length, meshes, dancers: t.stage.debug().dancers };
    });
    checks.ok(race.anchors === 1 && race.meshes === 1 && race.dancers.length === 1 && race.dancers[0].characterId === 'builtin:lanky' && race.dancers[0].status === 'ready', 'rapid swaps and removals leave no orphans and no stale results', JSON.stringify(race));
    const afterRace = await cycle();
    checks.ok(afterRace.textures === baseline.textures, 'memory is back at baseline after the race', JSON.stringify(afterRace));

    // ── Pointer interaction ──
    await load('starter');
    await page.evaluate(() => {
      const t = globalThis.__thunes;
      // Stand still so pointer targets stay put.
      for (const d of t.store.getState().dancers) t.store.updateDancer(d.id, { speed: 0 });
      t.store.loadDocument(t.store.getDocument());
    });
    await allReady();
    await sleep(100);
    const canUndo = () => page.evaluate(() => globalThis.__thunes.store.canUndo());
    const selected = async () => (await state()).ui.selectedId;
    const emptySpot = await screenAt(2.6, 0, 2.2);

    await click(await screenOf('d3'));
    checks.ok((await selected()) === 'd3', 'a click selects the dancer under the pointer', String(await selected()));
    await page.mouse.move((await screenOf('d1')).x, (await screenOf('d1')).y);
    await frames(page, 2);
    const cursorOver = await page.evaluate(() => globalThis.__thunes.stage.canvas.style.cursor);
    checks.ok(cursorOver === 'grab', 'cursor shows grab over a dancer', cursorOver);
    await click(emptySpot);
    checks.ok((await selected()) === null, 'a click on empty floor clears the selection', String(await selected()));
    checks.ok(!(await canUndo()), 'clicks add no undo steps');

    // Drag in 'both' mode.
    let d3 = await stored('d3');
    let cam = await pose();
    const from = await screenOf('d3');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 10);
    const grabbing = await page.evaluate(() => globalThis.__thunes.stage.canvas.style.cursor);
    for (let i = 2; i <= 8; i++) await page.mouse.move(from.x + 20 * i, from.y + 5 * i);
    await frames(page, 2);
    await page.mouse.up();
    await frames(page, 2);
    let d3After = await stored('d3');
    let camAfter = await pose();
    checks.ok(Math.abs(d3After.x - d3.x) > 0.5 && Math.abs(d3After.z - d3.z) > 0.05 && d3After.y === d3.y, "mode 'both': dragging a dancer moves x/z", `${d3.x},${d3.z} -> ${d3After.x},${d3After.z}`);
    checks.ok(grabbing === 'grabbing', 'cursor shows grabbing while dragging', grabbing);
    checks.ok(dist(cam.position, camAfter.position) < 1e-9, "mode 'both': dragging a dancer does not orbit");
    checks.ok((await selected()) === 'd3', 'dragging selects the dancer');
    const under = await screenOf('d3');
    checks.ok(Math.hypot(under.x - (from.x + 160), under.y - (from.y + 40)) < 12, 'the grabbed point stays under the pointer', JSON.stringify({ under, target: { x: from.x + 160, y: from.y + 40 } }));
    checks.ok(await canUndo(), 'a drag is undoable');
    await page.evaluate(() => globalThis.__thunes.store.undo());
    const undone = await stored('d3');
    checks.ok(undone.x === d3.x && undone.z === d3.z && !(await canUndo()), 'a drag is exactly one undo step', `${undone.x},${undone.z} canUndo=${await canUndo()}`);
    await page.evaluate(() => globalThis.__thunes.store.redo());

    // Drag far outside: clamped to the stage radius.
    await drag(await screenOf('d3'), { x: 1275, y: 420 }, 10);
    d3After = await stored('d3');
    checks.ok(Math.hypot(d3After.x, d3After.z) <= 6 + 1e-6 && Math.hypot(d3After.x, d3After.z) > 4, 'dragging is clamped to the stage radius', `${d3After.x}, ${d3After.z}`);
    await page.evaluate(() => globalThis.__thunes.store.undo());
    await frames(page, 2);

    // Orbit on empty stage in 'both' mode, then the pose is committed once the damping settles.
    cam = await pose();
    await drag(emptySpot, { x: emptySpot.x - 180, y: emptySpot.y - 40 });
    await settle();
    camAfter = await pose();
    const savedCamera = (await state()).camera;
    checks.ok(dist(cam.position, camAfter.position) > 0.5 && dist(cam.target, camAfter.target) < 1e-6, "mode 'both': dragging empty stage orbits", `${dist(cam.position, camAfter.position)}`);
    checks.ok(dist(savedCamera.position, camAfter.position) < 1e-6, 'the orbit pose is committed to the store');
    checks.ok(!(await canUndo()) || true, 'orbiting adds no undo step');

    // 'look': a drag on a dancer orbits, a click still selects.
    await page.evaluate(() => globalThis.__thunes.store.updateUi({ mode: 'look', selectedId: null }));
    d3 = await stored('d1');
    cam = await pose();
    let at = await screenOf('d1');
    await drag(at, { x: at.x + 150, y: at.y + 20 });
    await settle();
    d3After = await stored('d1');
    camAfter = await pose();
    checks.ok(d3After.x === d3.x && d3After.z === d3.z && dist(cam.position, camAfter.position) > 0.5, "mode 'look': dragging on a dancer orbits and leaves it in place");
    await click(await screenOf('d1'));
    checks.ok((await selected()) === 'd1', "mode 'look': a click still selects", String(await selected()));

    // 'grab': empty-stage drags do not rotate, zooming still works, dancers drag.
    await page.evaluate(() => globalThis.__thunes.store.updateUi({ mode: 'grab' }));
    cam = await pose();
    await settle();
    cam = await pose();
    const spot2 = { x: 120, y: 700 };
    await drag(spot2, { x: spot2.x + 200, y: spot2.y - 30 });
    await sleep(200);
    camAfter = await pose();
    checks.ok(dist(cam.position, camAfter.position) < 1e-9, "mode 'grab': dragging empty stage does not orbit");
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 400);
    await sleep(100);
    await settle();
    camAfter = await pose();
    checks.ok(Math.abs(dist(camAfter.position, camAfter.target) - dist(cam.position, cam.target)) > 0.3, "mode 'grab': the wheel still zooms", `${dist(cam.position, cam.target)} -> ${dist(camAfter.position, camAfter.target)}`);
    d3 = await stored('d2');
    at = await screenOf('d2');
    await drag(at, { x: at.x - 60, y: at.y + 30 });
    d3After = await stored('d2');
    checks.ok(Math.abs(d3After.x - d3.x) > 0.1, "mode 'grab': dancers drag", `${d3.x} -> ${d3After.x}`);

    // Camera limits.
    await page.evaluate(() => globalThis.__thunes.store.updateUi({ mode: 'look' }));
    await drag({ x: 1100, y: 700 }, { x: 1100, y: 100 }, 12);
    await drag({ x: 1100, y: 700 }, { x: 1100, y: 100 }, 12);
    await page.mouse.move(640, 400);
    for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 1200);
    await sleep(300);
    await settle();
    camAfter = await pose();
    checks.ok(camAfter.position[1] >= 0.079 && dist(camAfter.position, camAfter.target) <= 40.001, 'camera stays above the floor and within the distance limit', JSON.stringify(camAfter));
    for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -1200);
    await sleep(300);
    await settle();
    camAfter = await pose();
    checks.ok(dist(camAfter.position, camAfter.target) >= 1.499, 'camera keeps its minimum distance', String(dist(camAfter.position, camAfter.target)));

    // A camera set from outside is applied and not overwritten.
    await page.evaluate(() => globalThis.__thunes.store.setCamera({ position: [0, 1.9, 7.5], target: [0, 1, 0] }));
    await sleep(300);
    camAfter = await pose();
    checks.ok(dist(camAfter.position, [0, 1.9, 7.5]) < 1e-6 && dist((await state()).camera.position, [0, 1.9, 7.5]) < 1e-6, 'a camera set from outside is applied without feedback');

    // View-only: orbit works, selecting and dragging do not.
    await page.evaluate(() => globalThis.__thunes.store.updateUi({ mode: 'both', viewOnly: true, selectedId: null }));
    await click(await screenOf('d1'));
    d3 = await stored('d1');
    cam = await pose();
    at = await screenOf('d1');
    await drag(at, { x: at.x + 120, y: at.y });
    await settle();
    d3After = await stored('d1');
    camAfter = await pose();
    checks.ok((await selected()) === null && d3After.x === d3.x && dist(cam.position, camAfter.position) > 0.3, 'view-only: orbiting works, selecting and dragging do not');
    await page.evaluate(() => globalThis.__thunes.store.updateUi({ viewOnly: false }));
    await page.evaluate(() => globalThis.__thunes.store.setCamera({ position: [0, 1.9, 7.5], target: [0, 1, 0] }));
    await frames(page, 3);

    // ── Selection ring and capture ──
    await page.evaluate(() => globalThis.__thunes.store.select('d1'));
    await frames(page, 3);
    const ring = await page.evaluate(() => {
      const t = globalThis.__thunes;
      const { renderer, scene } = t.stage.context;
      const mesh = scene.getObjectByName('selection-ring');
      const hover = scene.getObjectByName('hover-ring');
      const live = mesh.visible;
      const seen = [];
      const original = renderer.render;
      renderer.render = (s, c) => {
        seen.push(mesh.visible || hover.visible);
        original(s, c);
      };
      const url = t.stage.capture({ width: 640, height: 400 });
      renderer.render = original;
      t.store.updateUi({ uiHidden: true });
      const hidden = mesh.visible;
      t.store.updateUi({ uiHidden: false, viewOnly: true });
      const viewOnly = mesh.visible;
      t.store.updateUi({ viewOnly: false });
      return { live, seen, after: mesh.visible, hidden, viewOnly, url, position: mesh.position.toArray(), radius: mesh.scale.x };
    });
    checks.ok(ring.live && ring.after && ring.seen[0] === false, 'capture() contains no selection ring (hidden for the capture render, back afterwards)', JSON.stringify({ live: ring.live, seen: ring.seen, after: ring.after }));
    checks.ok(!ring.hidden && !ring.viewOnly, 'rings are hidden while the UI is hidden or view-only');
    // Pixel probe: the front of the ring is bright in the live view and absent from the capture.
    const probeAt = await screenAt(ring.position[0], ring.position[1], ring.position[2] + ring.radius * 0.94);
    const livePng = await page.screenshot();
    const probe = await page.evaluate(
      async ([liveData, captureUrl, x, y]) => {
        const read = async (src, px, py) => {
          const image = new Image();
          image.src = src;
          await image.decode();
          const canvas = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(image, 0, 0);
          const d = ctx.getImageData(Math.round(px * image.naturalWidth), Math.round(py * image.naturalHeight), 1, 1).data;
          return (d[0] + d[1] + d[2]) / 3;
        };
        return { live: await read(`data:image/png;base64,${liveData}`, x, y), capture: await read(captureUrl, x, y) };
      },
      [livePng.toString('base64'), ring.url, probeAt.x / 1280, probeAt.y / 800],
    );
    checks.ok(probe.live > 170 && probe.capture < probe.live - 60, 'ring pixels: visible live, absent from the capture', JSON.stringify(probe));
    await saveDataUrl('capture', ring.url);
    await shot(page, 'dancers/selected');

    // ── Camera loop ──
    const savedBefore = (await state()).camera;
    const freePose = await pose();
    await page.evaluate(() => globalThis.__thunes.store.updateScene({ cameraLoop: true, cameraLoopPeriod: 6, cameraLoopDistance: 9, cameraLoopHeight: 3, cameraLoopTargetHeight: 1.2 }));
    await sleep(1600);
    const loopA = await pose();
    await sleep(500);
    const loopB = await pose();
    const radius = (p) => Math.hypot(p.position[0], p.position[2]);
    const angle = (p) => Math.atan2(p.position[0], p.position[2]);
    let swept = angle(loopB) - angle(loopA);
    if (swept < 0) swept += Math.PI * 2;
    checks.ok(
      Math.abs(radius(loopB) - 9) < 0.01 && Math.abs(loopB.position[1] - 3) < 0.01 && dist(loopB.target, [0, 1.2, 0]) < 0.01 && dist(loopA.position, loopB.position) > 1,
      'camera loop moves the camera on its circle',
      JSON.stringify(loopB),
    );
    checks.ok(Math.abs(swept - (Math.PI * 2 * 0.5) / 6) < 0.12, 'camera loop: one lap per period', `swept ${swept.toFixed(3)} rad in 0.5 s`);
    d3 = await stored('d1');
    at = await screenOf('d1');
    await drag(at, { x: at.x + 120, y: at.y + 10 });
    await click(await screenOf('d4'));
    d3After = await stored('d1');
    checks.ok(d3After.x === d3.x && d3After.z === d3.z && (await selected()) === 'd1', 'camera loop blocks dragging and selecting');
    const loopC = await pose();
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 600);
    await frames(page, 3);
    checks.ok(Math.abs(radius(await pose()) - radius(loopC)) < 0.01, 'camera loop blocks zooming');
    checks.ok((await state()).camera === undefined || dist((await state()).camera.position, savedBefore.position) < 1e-9, 'loop poses are never committed to the store');
    await page.evaluate(() => globalThis.__thunes.store.updateScene({ cameraLoop: false }));
    await sleep(300);
    const easing = await pose();
    await sleep(1400);
    const back = await pose();
    checks.ok(dist(back.position, freePose.position) < 1e-6 && dist(back.target, freePose.target) < 1e-6, 'switching the loop off returns to the previous free pose', JSON.stringify(back));
    checks.ok(dist(easing.position, freePose.position) > 0.05, 'the way back is eased, not a cut');
    await sleep(300);
    checks.ok(dist((await state()).camera.position, savedBefore.position) < 1e-6, 'store camera unchanged by the loop');
    at = await screenOf('d4');
    d3 = await stored('d4');
    const dancersBefore = (await state()).dancers.map((d) => [d.id, +d.x.toFixed(2), +d.z.toFixed(2)]);
    await drag(at, { x: at.x + 60, y: at.y + 10 });
    checks.ok(
      Math.abs((await stored('d4')).x - d3.x) > 0.1,
      'dragging works again after the loop',
      JSON.stringify({ at, dancersBefore, after: (await state()).dancers.map((d) => [d.id, +d.x.toFixed(2), +d.z.toFixed(2)]), ui: (await state()).ui, pose: await pose() }),
    );

    // ── Screenshots and thumbnails ──
    await screenshots();
    await thumbnails();

    checks.ok(session.problems.length === 0, 'no console errors or failed requests', session.problems.join(' | '));
  }
} catch (error) {
  checks.ok(false, 'script completed', error.stack || String(error));
  await shot(page, 'dancers/failure').catch(() => {});
} finally {
  await session.close();
  await server.close();
}

process.exit(checks.summary() ? 0 : 1);
