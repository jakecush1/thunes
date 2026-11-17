// Smoke test: the app boots, renders a non-blank frame and logs no errors.
// Usage: node scripts/e2e/smoke.mjs [--preview]
import { createChecks, frames, imageStats, openPage, shot, startServer, waitForApp } from './harness.mjs';

const mode = process.argv.includes('--preview') ? 'preview' : 'dev';
const server = await startServer({ mode });
const session = await openPage();
const checks = createChecks();

try {
  await session.page.goto(server.url);
  await waitForApp(session.page);
  await frames(session.page, 5);
  const file = await shot(session.page, 'smoke');
  const stats = await imageStats(session.page, await session.page.screenshot());
  checks.ok(stats.stddev > 2 && stats.distinctColors > 8, 'renders a non-blank frame', JSON.stringify(stats));
  checks.ok(session.problems.length === 0, 'no console errors or failed requests', session.problems.join(' | '));
  console.log(`screenshot: ${file}`);
} finally {
  await session.close();
  await server.close();
}

process.exit(checks.summary() ? 0 : 1);
