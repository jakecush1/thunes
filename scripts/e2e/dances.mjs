// Contact sheets of the built-in dances (lab/dances.html): eight evenly spaced
// frames of one loop, front view above side view, one image per dance.
//
//   node scripts/e2e/dances.mjs                      every dance on the mannequin
//   node scripts/e2e/dances.mjs groove twist         only the dances whose slug contains one of the words
//   node scripts/e2e/dances.mjs groove --character=toy --count=12 --from=0 --to=4
//
// Screenshots land in .e2e/dances/<slug>[-<character>].png
import { createChecks, frames, imageStats, openPage, shot, startServer, waitForApp } from './harness.mjs';

const args = process.argv.slice(2);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];
const filters = args.filter((arg) => !arg.startsWith('--'));
const character = option('character') ?? 'mannequin';
const count = Number(option('count') ?? 8);

const server = await startServer();
const session = await openPage({ viewport: { width: 1680, height: 880 } });
const checks = createChecks();

try {
  // Discover the dances from the page itself.
  await session.page.goto(`${server.url}/lab/dances.html?sheet=1`);
  await waitForApp(session.page);
  const all = await session.page.evaluate(() => globalThis.__thunes.dances);
  checks.ok(all.includes('builtin:groove'), 'the fallback dance builtin:groove exists');
  checks.ok(all.length >= 6, `at least six dances (${all.length})`);
  const selected = all.filter((id) => filters.length === 0 || filters.some((word) => id.split(':')[1].includes(word)));

  for (const id of selected) {
    const slug = id.split(':')[1];
    const query = new URLSearchParams({ sheet: '1', dance: slug, character, count: String(count) });
    for (const name of ['from', 'to', 'spacing', 'skeleton']) if (option(name)) query.set(name, option(name));
    await session.page.goto(`${server.url}/lab/dances.html?${query}`);
    await waitForApp(session.page);
    await frames(session.page, 4);
    const file = await shot(session.page, `dances/${slug}${character === 'mannequin' ? '' : `-${character}`}`);
    const stats = await imageStats(session.page, await session.page.screenshot());
    checks.ok(stats.stddev > 8 && stats.distinctColors > 200, `${slug}: the sheet renders`, JSON.stringify(stats));
    const info = await session.page.evaluate(() => {
      const { dance, duration, beats, bpm, tracks, frames } = globalThis.__thunes;
      return { dance, duration, beats, bpm, tracks, frames };
    });
    checks.ok(info.dance === id, `${slug}: the page plays ${id}`, info.dance);
    checks.ok(Math.abs(info.duration - (info.beats * 60) / info.bpm) < 1e-6, `${slug}: ${info.beats} beats at ${info.bpm} bpm last ${info.duration.toFixed(2)} s`);
    checks.ok(info.tracks === 23, `${slug}: hips position plus 22 bone tracks`, `${info.tracks}`);
    const hips = info.frames.map((frame) => frame.hipsY);
    checks.ok(hips.every((y) => Number.isFinite(y) && y > 0.3 && y < 2), `${slug}: hips stay at a sane height`, hips.map((y) => y.toFixed(2)).join(' '));
    const feet = info.frames.map((frame) => frame.lowestFootBone);
    checks.ok(feet.every((y) => y > -0.01 && y < 0.6), `${slug}: no foot bone sinks below the floor`, feet.map((y) => y.toFixed(3)).join(' '));
    console.log(`  screenshot: ${file}`);
  }
  if (filters.length === 0) {
    // The player view: one dancer, animated in real time.
    await session.page.setViewportSize({ width: 900, height: 700 });
    await session.page.goto(`${server.url}/lab/dances.html?dance=side-clap&character=robot&view=three`);
    await waitForApp(session.page);
    await frames(session.page, 20);
    const first = await session.page.screenshot();
    await frames(session.page, 20);
    const second = await session.page.screenshot();
    checks.ok(!first.equals(second), 'player: the dancer moves between frames');
    const file = await shot(session.page, 'dances/player');
    console.log(`  screenshot: ${file}`);
    const poses = await session.page.evaluate(() => [0, 0.5, 1, 1.5].map((beat) => globalThis.__thunes.measureAt(beat)));
    checks.ok(new Set(poses.map((pose) => pose.hipsY.toFixed(3))).size > 1, 'player: the hips bounce over a beat', JSON.stringify(poses));
    checks.ok(poses.every((pose) => pose.lowestFootBone > -0.01), 'player: feet stay above the floor on another character', JSON.stringify(poses));
  }
  checks.ok(session.problems.length === 0, 'no console errors or failed requests', session.problems.join(' | '));
} finally {
  await session.close();
  await server.close();
}

process.exit(checks.summary() ? 0 : 1);
