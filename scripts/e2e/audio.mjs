// Audio checks: renders every built-in song in headless Chrome via the lab page
// and asserts loop length, peak, loudness, seam continuity, determinism; then
// drives a real audio engine (unlock, play, tempo, switching, mute, errors).
// Usage: node scripts/e2e/audio.mjs [--no-engine] [--song=<slug-part>]
import { createChecks, frames, openPage, shot, startServer, waitForApp } from './harness.mjs';

const skipEngine = process.argv.includes('--no-engine');
const only = process.argv.find((arg) => arg.startsWith('--song='))?.slice(7);

const server = await startServer();
const session = await openPage({ viewport: { width: 1290, height: 900 } });
const checks = createChecks();
const near = (value, target, tolerance) => Math.abs(value - target) <= tolerance;

try {
  const { page } = session;
  await page.goto(`${server.url}/lab/audio.html${only ? `?song=${only}` : ''}`);
  await waitForApp(page, { timeout: 120000 });
  await frames(page, 3);
  const songs = await page.evaluate(() => globalThis.__thunes.songs);

  console.log('\nsong                     bpm bars   peak    rms  crest limited  seam  render  kickgrid  corr  bands(sub bass lowmid mid high air)');
  for (const s of songs) {
    console.log(
      `${s.id.padEnd(24)} ${String(s.bpm).padStart(3)} ${String(s.bars).padStart(4)} ${s.peakDb.toFixed(2).padStart(6)} ${s.rmsDb.toFixed(2).padStart(6)} ` +
        `${s.crestDb.toFixed(1).padStart(5)} ${s.limitedDb.toFixed(1).padStart(7)} ${s.seam.toFixed(2).padStart(5)} ${String(s.renderMs).padStart(5)}ms(mix ${s.mixMs}, frame ${s.longestFrameMs}) ${s.kickOnGrid.toFixed(1).padStart(8)} ` +
        `${s.stereoCorrelation.toFixed(2).padStart(5)}  ${Object.values(s.bands).join(' ')}`,
    );
  }
  console.log('');

  if (!only) checks.ok(songs.length === 6, 'six built-in songs', `got ${songs.length}`);
  for (const s of songs) {
    const name = s.id.replace('builtin:', '');
    if (!checks.ok(s.error === null, `${name}: renders`, s.error ?? '')) continue;
    checks.ok(s.length === s.expectedLength && s.channels === 2, `${name}: stereo, exactly ${s.bars * 4} beats long`, `${s.length} vs ${s.expectedLength}, ${s.channels} ch`);
    checks.ok(s.peakDb <= -1 && s.peakDb > -6, `${name}: peak at or below -1 dBFS`, `${s.peakDb.toFixed(2)} dBFS`);
    checks.ok(s.seam <= 1.5, `${name}: seam is continuous`, `seam step is ${s.seam.toFixed(2)}x the 99.9th percentile step`);
    checks.ok(s.deterministic, `${name}: two renders are bit-identical`);
    checks.ok(s.renderMs < 8000, `${name}: renders in reasonable time`, `${s.renderMs} ms`);
    checks.ok(s.longestFrameMs < 100, `${name}: rendering does not freeze the page`, `longest frame ${s.longestFrameMs} ms`);
    checks.ok(s.kickOnGrid > 2, `${name}: kicks land on the grid`, `low-band energy after/before scheduled kicks: ${s.kickOnGrid.toFixed(2)}`);
    checks.ok(s.limitedDb <= 6, `${name}: limiter works gently`, `${s.limitedDb.toFixed(1)} dB of peak reduction`);
    checks.ok(s.bands.sub + 0 > -14 || s.bands.bass > -6, `${name}: not bass-starved`, JSON.stringify(s.bands));
    checks.ok(s.bands.high < -8 && s.bands.air < -14, `${name}: highs are not harsh`, JSON.stringify(s.bands));
  }
  const rms = songs.filter((s) => !s.error).map((s) => s.rmsDb);
  checks.ok(Math.max(...rms) - Math.min(...rms) <= 3, 'RMS of all songs within 3 dB', rms.map((v) => v.toFixed(2)).join(', '));
  const tempos = new Set(songs.map((s) => s.bpm));
  if (!only) checks.ok(tempos.size === songs.length && songs.every((s) => s.bpm >= 85 && s.bpm <= 142), 'distinct tempos between ~90 and ~140', [...tempos].join(', '));

  const file = await shot(page, 'audio', { fullPage: true });
  console.log(`screenshot: ${file}`);

  // The same song rendered after a fresh page load must give the very same samples.
  if (!only) {
    const first = songs[0];
    const again = await session.context.newPage();
    await again.goto(`${server.url}/lab/audio.html?song=${first.id.replace('builtin:', '')}`);
    await waitForApp(again, { timeout: 120000 });
    const repeat = (await again.evaluate(() => globalThis.__thunes.songs))[0];
    checks.ok(repeat.checksum === first.checksum && first.checksum.length === 8, 'a render after a page reload is bit-identical', `${repeat.checksum} vs ${first.checksum}`);
    await again.close();
  }

  if (!skipEngine) {
    const r = await page.evaluate(() => globalThis.__thunes.engineTest());
    console.log('\nengine report:', JSON.stringify(r, null, 1));
    checks.ok(r.lockedUnlocked === false && r.lockedStatus === 'idle', 'locked: idle and not unlocked before unlock()');
    checks.ok(near(r.lockedTempo, r.defaultBpm, 0.5), 'locked: clock free-runs at the default tempo', `${r.lockedTempo}`);
    checks.ok(r.lockedLevel === 0, 'locked: levels are zero');
    checks.ok(r.unlocked === true, 'unlock() unlocks');
    checks.ok(r.firstPlaying && r.firstStatus.state === 'playing' && r.firstStatus.bpm === r.firstBpm, 'status reaches playing with the song tempo', JSON.stringify(r.firstStatus));
    checks.ok(near(r.firstTempo, r.firstBpm, 1.5), 'beat advances at the song tempo', `${r.firstTempo} vs ${r.firstBpm}`);
    checks.ok(r.firstLevelMax > 0.1 && r.firstBassMax > 0.1, 'levels are non-zero while playing', `level ${r.firstLevelMax}, bass ${r.firstBassMax}`);
    checks.ok(r.firstBassOnBeat > 1.15, 'bass level peaks on the clock beat (song 1)', `${r.firstBassOnBeat}`);
    checks.ok(r.statusDuringSwitch === 'loading' && r.secondPlaying, 'switching songs goes through loading to playing');
    checks.ok(r.beatAcrossSwitch[1] >= r.beatAcrossSwitch[0], 'beat does not go backwards across a switch', JSON.stringify(r.beatAcrossSwitch));
    checks.ok(near(r.secondTempo, r.secondBpm, 1.5), 'beat follows the new tempo after switching', `${r.secondTempo} vs ${r.secondBpm}`);
    checks.ok(r.secondBassOnBeat > 1.15, 'bass level peaks on the clock beat after re-anchoring (song 2)', `${r.secondBassOnBeat}`);
    checks.ok(r.mutedLevelMax === 0, 'mute zeroes the levels', `${r.mutedLevelMax}`);
    checks.ok(r.mutedStatus === 'playing' && near(r.mutedTempo, r.secondBpm, 2), 'mute keeps playback and the clock running', `${r.mutedStatus} ${r.mutedTempo}`);
    checks.ok(r.unmutedLevelMax > 0.1, 'levels return after unmuting', `${r.unmutedLevelMax}`);
    checks.ok(r.rapidPlaying && r.rapidStarted.length === 1 && r.rapidStarted[0] === r.rapidFinal.songId, 'rapid switching: only the last request starts', JSON.stringify(r.rapidStarted));
    checks.ok(r.errorReached && typeof r.errorStatus.message === 'string' && r.errorStatus.message.length > 3, 'missing song: error status with a message', JSON.stringify(r.errorStatus));
    checks.ok(near(r.errorTempo, r.rapidFinal.bpm, 0.5) && r.errorLevelMax === 0, 'after an error the clock free-runs at the last tempo and levels are zero', `${r.errorTempo} ${r.errorLevelMax}`);
    checks.ok(r.recovered, 'recovers from an error when a good song is chosen');
    checks.ok(r.idleStatus === 'idle' && r.idleLevelMax === 0 && near(r.idleTempo, r.firstBpm, 0.5), 'null song: idle, silent, clock still running at the last tempo', `${r.idleStatus} ${r.idleLevelMax} ${r.idleTempo}`);
    checks.ok(r.beatDecreases === 0, 'beat never decreases', `${r.beatDecreases} decreases in ${r.frames} frames`);
    checks.ok(r.maxBeatStep < 1.5, 'no large beat jumps', `${r.maxBeatStep}`);
  }

  checks.ok(session.problems.length === 0, 'no console errors or failed requests', session.problems.join(' | '));
} finally {
  await session.close();
  await server.close();
}

process.exit(checks.summary() ? 0 : 1);
