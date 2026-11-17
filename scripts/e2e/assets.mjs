// The asset pipeline in a real browser (lab/assets.html): uploads, persistence
// across reloads, removal, tempo detection, retargeting between uploaded and
// built-in assets, and discovery of files dropped into public/assets.
//
//   THUNES_FIXTURES=/path/to/fixtures node scripts/e2e/assets.mjs
//
// The fixtures folder holds Xbot.glb, Michelle.glb, Soldier.glb,
// "Samba Dancing.fbx", RobotExpressive.glb and pirouette.bvh. Without
// THUNES_FIXTURES the model checks are skipped (the generated audio and the
// folder discovery are still checked).
//
//   --no-watch   skip the dev-server discovery check (it writes a probe file into public/assets/music)
//
// Screenshots land in .e2e/assets/
import { createServer } from 'vite';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { ROOT, createChecks, frames, imageStats, openPage, shot, startServer, waitForApp } from './harness.mjs';

const FIXTURES = process.env.THUNES_FIXTURES;
const args = process.argv.slice(2);
const checks = createChecks();

/** A mono 16-bit WAV click track: a kick on every beat and a quieter tick on the off-beats. */
function clickTrackWav(bpm, seconds, sampleRate = 22050) {
  const samples = new Float32Array(Math.floor(seconds * sampleRate));
  const beat = (60 / bpm) * sampleRate;
  for (let b = 0; b * beat < samples.length; b += 0.5) {
    const start = Math.round(b * beat);
    const onBeat = Number.isInteger(b);
    const length = Math.floor(sampleRate * (onBeat ? 0.12 : 0.03));
    for (let i = 0; i < length && start + i < samples.length; i++) {
      const t = i / sampleRate;
      const envelope = Math.exp(-t * (onBeat ? 30 : 150));
      // Deterministic pseudo-noise for the tick, a falling sine for the kick.
      const tone = onBeat ? Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-t * 40)) * t) : ((((start + i) * 1103515245 + 12345) >>> 8) % 2000) / 1000 - 1;
      samples[start + i] += envelope * tone * (onBeat ? 0.9 : 0.25);
    }
  }
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buffer;
}

const catalogue = (page) => page.evaluate(() => globalThis.__thunes.lab.catalogue());
const uploadsOf = (list) => list.filter((entry) => entry.source === 'upload');

/** Uploads through the file input and returns the report of that upload. */
async function uploadFiles(page, files, timeout = 180000) {
  const before = await page.evaluate(() => globalThis.__thunes.lab.state.reports.length);
  await page.setInputFiles('#files', files);
  await page.waitForFunction((n) => globalThis.__thunes.lab.state.reports.length > n, before, { timeout });
  return page.evaluate((n) => globalThis.__thunes.lab.state.reports[n], before);
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Plays a dance on a character in the page and checks that it loads, moves and stays sane. */
async function checkPlays(page, label, characterId, danceId) {
  let probe;
  try {
    probe = await page.evaluate(([c, d]) => globalThis.__thunes.lab.probe(c, d, 12), [characterId, danceId]);
  } catch (error) {
    checks.ok(false, `${label}: the retargeted clip loads`, String(error).split('\n')[0]);
    return null;
  }
  checks.ok(probe.duration > 0.2, `${label}: the retargeted clip loads (${probe.duration.toFixed(2)} s)`);
  const first = probe.frames[0];
  const travel = (name) => Math.max(...probe.frames.map((frame) => distance(frame[name], first[name])));
  const moved = { hands: Math.max(travel('LeftHand'), travel('RightHand')), feet: Math.max(travel('LeftFoot'), travel('RightFoot')), hips: travel('Hips') };
  checks.ok(moved.hands > 0.05 * probe.height, `${label}: the hands move`, JSON.stringify(moved));
  const finite = probe.frames.every((frame) => Object.values(frame).every((p) => p && p.every(Number.isFinite)));
  checks.ok(finite, `${label}: every landmark is finite`);
  const heads = probe.frames.map((frame) => frame.Head[1] / probe.height);
  const hips = probe.frames.map((frame) => frame.Hips[1] / probe.height);
  const lowFoot = probe.frames.map((frame) => Math.min(frame.LeftFoot[1], frame.RightFoot[1]) / probe.height);
  checks.ok(hips.every((y) => y > 0.25 && y < 0.8), `${label}: the hips stay at a sane height`, hips.map((y) => y.toFixed(2)).join(' '));
  checks.ok(heads.every((y) => y > 0.5 && y < 1.15), `${label}: the head stays up`, heads.map((y) => y.toFixed(2)).join(' '));
  checks.ok(lowFoot.every((y) => y > -0.06 && y < 0.25), `${label}: the lower foot stays near the floor`, lowFoot.map((y) => y.toFixed(3)).join(' '));
  const drift = Math.max(...probe.frames.map((frame) => Math.hypot(frame.Hips[0], frame.Hips[2])));
  checks.ok(drift < 1.5 * probe.height, `${label}: the dancer stays near its spot`, drift.toFixed(2));
  return probe;
}

async function uploadChecks(page, url) {
  const wav = { name: 'click 120.wav', mimeType: 'audio/wav', buffer: clickTrackWav(120, 16) };
  const start = await catalogue(page);
  checks.ok(start.dances.some((d) => d.id === 'library:example-side-sway'), 'the example scheme in public/assets/dances is a library dance');
  checks.ok(uploadsOf(start.characters).length + uploadsOf(start.dances).length + uploadsOf(start.songs).length === 0, 'a fresh profile has no uploads');
  const example = await checkPlays(page, 'library example on the mannequin', 'builtin:mannequin', 'library:example-side-sway');
  if (example) checks.ok(true, 'the example scheme compiles and plays');

  // — Audio —
  const audioReport = await uploadFiles(page, [wav]);
  const song = audioReport.songs[0];
  checks.ok(audioReport.songs.length === 1 && audioReport.problems.length === 0, 'the generated WAV becomes a song', JSON.stringify(audioReport.problems));
  checks.ok(song && song.id.startsWith('upload:') && song.title === 'Click 120', `the song is titled from the file name (${song?.title})`);
  checks.ok(song && Math.abs(song.bpm - 120) <= 2, `tempo detected at upload: ${song?.bpm} bpm`);
  checks.ok(audioReport.persisted === true, 'the upload is persisted');
  if (song) {
    const tempo = await page.evaluate((id) => globalThis.__thunes.lab.engineTempo(id), song.id);
    checks.ok(tempo.status === 'playing', 'the uploaded song plays through the audio engine', JSON.stringify(tempo));
    checks.ok(tempo.bpm !== null && Math.abs(tempo.bpm - 120) <= 2 && tempo.stored !== null && Math.abs(tempo.stored - 120) <= 2, `engine tempo hook: ${tempo.bpm} bpm, stored ${tempo.stored}`, JSON.stringify(tempo));
  }

  const ids = { song: song?.id };
  if (!FIXTURES) {
    console.log('  skip  THUNES_FIXTURES is not set: model upload checks skipped');
  } else {
    const names = ['Xbot.glb', 'Michelle.glb', 'Soldier.glb', 'Samba Dancing.fbx', 'RobotExpressive.glb', 'pirouette.bvh'];
    const missing = names.filter((name) => !fs.existsSync(path.join(FIXTURES, name)));
    checks.ok(missing.length === 0, 'all fixtures exist', missing.join(', '));
    const report = await uploadFiles(page, names.filter((name) => !missing.includes(name)).map((name) => path.join(FIXTURES, name)));
    console.log(`  characters: ${report.characters.map((d) => `${d.name} [${d.id}]`).join(', ')}`);
    console.log(`  dances: ${report.dances.map((d) => `${d.name} [${d.id}${d.clip !== undefined ? ` clip=${d.clip}` : ''}]`).join(', ')}`);
    for (const problem of report.problems) console.log(`  problem: ${problem.file}: ${problem.reason}`);
    const character = (word) => report.characters.find((d) => d.name.toLowerCase().includes(word));
    for (const word of ['xbot', 'michelle', 'soldier']) checks.ok(character(word), `${word} becomes a character`);
    const dancesFrom = (word) => report.dances.filter((d) => `${d.name} ${d.id}`.toLowerCase().includes(word));
    const michelleDance = dancesFrom('michelle')[0];
    const fbxDance = dancesFrom('samba dancing')[0] ?? report.dances.find((d) => d.format === 'fbx');
    const bvhDance = report.dances.find((d) => d.format === 'bvh');
    checks.ok(michelleDance, "Michelle's clip becomes a dance");
    checks.ok(fbxDance, "the FBX's clip becomes a dance");
    const bvhProblem = report.problems.find((p) => p.file === 'pirouette.bvh');
    checks.ok(Boolean(bvhDance) !== Boolean(bvhProblem), bvhDance ? 'the BVH becomes a dance' : `the BVH is refused with a reason: ${bvhProblem?.reason}`);
    const robot = report.problems.find((p) => p.file === 'RobotExpressive.glb');
    checks.ok(robot && robot.reason.length > 20 && /humanoid|bone/i.test(robot.reason), `RobotExpressive is refused readably: ${robot?.reason}`);
    checks.ok(!report.characters.some((d) => /robot/i.test(d.name)) && !report.dances.some((d) => /robotexpressive/i.test(`${d.name} ${d.url}`)), 'RobotExpressive adds nothing');
    checks.ok([...report.characters, ...report.dances].every((d) => /^upload:[A-Za-z0-9._-]+$/.test(d.id) || /^upload:[A-Za-z0-9:._-]+$/.test(d.id)), 'ids start with upload:');

    Object.assign(ids, { xbot: character('xbot')?.id, michelle: character('michelle')?.id, soldier: character('soldier')?.id, michelleDance: michelleDance?.id, fbxDance: fbxDance?.id, bvhDance: bvhDance?.id });

    if (ids.xbot) await checkPlays(page, 'built-in groove on uploaded Xbot', ids.xbot, 'builtin:groove');
    if (ids.soldier) await checkPlays(page, 'library example on uploaded Soldier', ids.soldier, 'library:example-side-sway');
    if (ids.michelleDance) await checkPlays(page, "Michelle's samba on the built-in mannequin", 'builtin:mannequin', ids.michelleDance);
    if (ids.fbxDance && ids.michelle) await checkPlays(page, 'FBX samba on uploaded Michelle', ids.michelle, ids.fbxDance);
    if (ids.fbxDance) await checkPlays(page, 'FBX samba on the built-in robot', 'builtin:robot', ids.fbxDance);
    if (ids.bvhDance) await checkPlays(page, 'BVH pirouette on the built-in mannequin', 'builtin:mannequin', ids.bvhDance);

    // One contact sheet to look at.
    const rows = [
      ids.xbot && { characterId: ids.xbot, danceId: 'builtin:groove' },
      ids.michelleDance && { characterId: 'builtin:mannequin', danceId: ids.michelleDance },
      ids.michelle && ids.fbxDance && { characterId: ids.michelle, danceId: ids.fbxDance },
      ids.soldier && ids.bvhDance && { characterId: ids.soldier, danceId: ids.bvhDance },
    ].filter(Boolean);
    if (rows.length > 0) {
      await page.evaluate((r) => globalThis.__thunes.lab.sheet(r, [0.15, 0.45, 0.75]), rows);
      await frames(page, 3);
      await page.evaluate((r) => globalThis.__thunes.lab.sheet(r, [0.15, 0.45, 0.75]), rows);
      await frames(page, 2);
      const file = await shot(page.locator('#view'), 'assets/sheet');
      const stats = await imageStats(page, await page.locator('#view').screenshot());
      checks.ok(stats.stddev > 6 && stats.distinctColors > 150, 'the contact sheet renders', JSON.stringify(stats));
      console.log(`  screenshot: ${file}`);
    }
  }

  // — Persistence —
  const beforeReload = await catalogue(page);
  await page.goto(url);
  await waitForApp(page);
  const afterReload = await catalogue(page);
  const key = (c) => JSON.stringify([uploadsOf(c.characters), uploadsOf(c.dances), uploadsOf(c.songs)]);
  checks.ok(uploadsOf(afterReload.songs).length >= 1 && key(afterReload) === key(beforeReload), `uploads survive a reload (${uploadsOf(afterReload.characters).length} characters, ${uploadsOf(afterReload.dances).length} dances, ${uploadsOf(afterReload.songs).length} songs)`);
  if (ids.xbot && ids.fbxDance) await checkPlays(page, 'after reload: FBX samba on uploaded Xbot (parsed lazily)', ids.xbot, ids.fbxDance);
  if (ids.song) {
    const bytes = await page.evaluate(async (id) => (await globalThis.__thunes.registry.loadSong(id)).data?.byteLength, ids.song);
    checks.ok(bytes > 100000, `after reload: the stored song bytes load (${bytes} bytes)`);
  }

  // — Removal —
  if (ids.song) {
    await page.evaluate((id) => globalThis.__thunes.registry.removeUpload(id), ids.song);
    checks.ok(!(await catalogue(page)).songs.some((d) => d.id === ids.song), 'removing a song unregisters it');
  }
  if (ids.michelle) {
    await page.evaluate((id) => globalThis.__thunes.registry.removeUpload(id), ids.michelle);
    const now = await catalogue(page);
    checks.ok(!now.characters.some((d) => d.id === ids.michelle), 'removing a character unregisters it');
    checks.ok(now.dances.some((d) => d.id === ids.michelleDance), 'the dance from the same file stays until it is removed too');
  }
  const rest = await catalogue(page);
  for (const entry of [...uploadsOf(rest.characters), ...uploadsOf(rest.dances), ...uploadsOf(rest.songs)]) {
    await page.evaluate((id) => globalThis.__thunes.registry.removeUpload(id), entry.id);
  }
  const emptied = await catalogue(page);
  checks.ok(uploadsOf(emptied.characters).length + uploadsOf(emptied.dances).length + uploadsOf(emptied.songs).length === 0, 'every upload can be removed');
  await page.goto(url);
  await waitForApp(page);
  const final = await catalogue(page);
  checks.ok(uploadsOf(final.characters).length + uploadsOf(final.dances).length + uploadsOf(final.songs).length === 0, 'removed uploads stay removed after a reload');
  const records = await page.evaluate(() => globalThis.__thunes.registry.uploads.records().length);
  checks.ok(records === 0, 'no upload records are left in storage', String(records));
}

/** Dev-server discovery: a file dropped into public/assets appears after an automatic reload, and disappears again. */
async function discoveryChecks() {
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  const cacheDir = path.join(ROOT, 'node_modules', '.vite-e2e', `assets-watch-${process.pid}`);
  const probeFile = path.join(ROOT, 'public', 'assets', 'music', `zz-e2e-probe-${process.pid}.wav`);
  const probeId = `library:zz-e2e-probe-${process.pid}`;
  const server = await createServer({ root: ROOT, cacheDir, logLevel: 'error', clearScreen: false, server: { port, host: '127.0.0.1', strictPort: true } });
  let session;
  try {
    await server.listen();
    session = await openPage({ viewport: { width: 900, height: 600 } });
    const { page } = session;
    await page.goto(`http://127.0.0.1:${port}/lab/assets.html`);
    await waitForApp(page);
    const listed = async () => {
      try {
        return await page.evaluate((id) => Boolean(globalThis.__thunes?.ready) && globalThis.__thunes.lab.catalogue().songs.some((d) => d.id === id), probeId);
      } catch {
        return null; // navigating
      }
    };
    const until = async (expected, timeout = 15000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if ((await listed()) === expected) return true;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return false;
    };
    checks.ok((await listed()) === false, 'discovery: the probe song is not listed yet');
    await page.evaluate(() => (globalThis.__probeMark = true));
    fs.writeFileSync(probeFile, clickTrackWav(120, 0.5, 8000));
    checks.ok(await until(true), 'discovery: a file added to public/assets/music appears');
    checks.ok((await page.evaluate(() => globalThis.__probeMark)) === undefined, 'discovery: the page was reloaded');
    const def = await page.evaluate((id) => globalThis.__thunes.registry.getSong(id), probeId);
    checks.ok(def && def.source === 'library' && /\/assets\/music\/zz-e2e-probe-/.test(def.url ?? ''), `discovery: the song is a library song (${def?.title}, ${def?.url})`);
    fs.rmSync(probeFile, { force: true });
    checks.ok(await until(false), 'discovery: removing the file removes the song');
  } finally {
    fs.rmSync(probeFile, { force: true });
    await session?.close();
    await server.close();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
}

const server = await startServer();
const session = await openPage({ viewport: { width: 1500, height: 1000 } });
try {
  const url = `${server.url}/lab/assets.html`;
  await session.page.goto(url);
  await waitForApp(session.page);
  await uploadChecks(session.page, url);
  checks.ok(session.problems.length === 0, 'no console errors or failed requests', session.problems.join(' | '));
} catch (error) {
  checks.ok(false, 'the upload checks run to the end', error?.stack ?? String(error));
  if (session.problems.length > 0) console.log(session.problems.join('\n'));
} finally {
  await session.close();
  await server.close();
}

if (!args.includes('--no-watch')) {
  try {
    await discoveryChecks();
  } catch (error) {
    checks.ok(false, 'the discovery checks run to the end', error?.stack ?? String(error));
  }
}

process.exit(checks.summary() ? 0 : 1);
