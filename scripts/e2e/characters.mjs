// Contact sheets of the built-in characters (lab/characters.html).
// Each screenshot stacks four bands; a band shows all characters in one pose and view.
//
//   node scripts/e2e/characters.mjs                 all sheets
//   node scripts/e2e/characters.mjs bends           only the sheets whose name contains "bends"
//   node scripts/e2e/characters.mjs --only=robot,toy --rows=squat:three,bow:side --band=600   a custom close-up sheet
//                                                   (--band = pixel height of each band)
//   node scripts/e2e/characters.mjs --only=robot --cols=squat,bow,twist --rows=x:three,x:back --band=470
//                                                   one character in several poses side by side
//
// Screenshots land in .e2e/characters-<sheet>.png
import { createChecks, frames, imageStats, openPage, shot, startServer, waitForApp } from './harness.mjs';

const SHEETS = {
  rest: 'rest:front,rest:three,rest:side,rest:back',
  arms: 'armsDown:front,headTurn:three,overhead:front,overhead:three',
  bends: 'bend90:three,bend90:side,bend140:front,bend140:side',
  torso: 'squat:three,squat:side,twist:front,bow:side',
};

const args = process.argv.slice(2);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];
const filters = args.filter((arg) => !arg.startsWith('--'));
const only = option('only');
const customRows = option('rows');
const cols = option('cols');
const band = Number(option('band') ?? (only ? 420 : 310));

const sheets = customRows
  ? { custom: customRows }
  : Object.fromEntries(Object.entries(SHEETS).filter(([name]) => filters.length === 0 || filters.some((f) => name.includes(f))));

const server = await startServer();
const rowCount = Math.max(...Object.values(sheets).map((rows) => rows.split(',').length));
const session = await openPage({ viewport: { width: 1560, height: band * rowCount } });
const checks = createChecks();

try {
  for (const [name, rows] of Object.entries(sheets)) {
    const query = new URLSearchParams({ rows });
    if (only) {
      query.set('only', only);
      query.set('spacing', option('spacing') ?? '1.9');
    }
    if (cols) query.set('cols', cols);
    for (const name of ['fit', 'lookY']) if (option(name)) query.set(name, option(name));
    await session.page.goto(`${server.url}/lab/characters.html?${query}`);
    await waitForApp(session.page);
    await frames(session.page, 4);
    const file = await shot(session.page, `characters-${name}${only ? `-${only.replaceAll(',', '+')}` : ''}`);
    const stats = await imageStats(session.page, await session.page.screenshot());
    checks.ok(stats.stddev > 8 && stats.distinctColors > 200, `${name}: renders the characters`, JSON.stringify(stats));
    console.log(`  screenshot: ${file}`);

    const info = await session.page.evaluate(() => globalThis.__thunes.characters);
    if (!only) checks.ok(info.length === 6, `${name}: six characters on stage`, `got ${info.length}`);
    for (const character of info) {
      const top = character.bounds.max[1];
      const bottom = character.bounds.min[1];
      checks.ok(
        Math.abs(top - character.height) < 0.02 * character.height && Math.abs(bottom) < 0.01,
        `${name}: ${character.id} stands ${character.height} m tall on the floor (${character.triangles} triangles, radius ${character.radius.toFixed(2)} m)`,
        `bounds y ${bottom.toFixed(3)}..${top.toFixed(3)}`,
      );
      checks.ok(character.triangles <= 8000, `${name}: ${character.id} within the triangle budget`, `${character.triangles}`);
    }
  }
  checks.ok(session.problems.length === 0, 'no console errors or failed requests', session.problems.join(' | '));
} finally {
  await session.close();
  await server.close();
}

process.exit(checks.summary() ? 0 : 1);
