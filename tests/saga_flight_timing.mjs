/** The Galactic-center approach stays continuous and leaves time for the lens. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const origin = process.env.COMPILEUNIVERSE_URL || 'http://127.0.0.1:8781';
const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url));
const browser = await chromium.launch({ headless: true });
const report = {}, errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.__compiledAtlas?.ready && __compiledAtlas.data.frame, null, { timeout: 60000 });
  await page.locator('#info-open').click(); await page.locator('#density').selectOption('220,94'); await page.locator('#close-panel').click();
  await page.locator('#blackhole-open').click();
  await page.waitForFunction(() => __compiledAtlas.journey?.destination.id === 'sagittarius-a');
  const envelope = await page.evaluate(() => ({ duration: __compiledAtlas.journey.duration, ...__compiledAtlas.journey.closeApproach }));
  assert.equal(envelope.duration, 18); assert.equal(envelope.closeStart, 10); assert.equal(envelope.closeSeconds, 8);
  await page.evaluate(() => {
    window.__sagaPath = [];
    const collect = () => {
      const a = __compiledAtlas, travel = a.journey, radius = a.selected.radius_pc;
      const offset = a.state.position.map((value, i) => (value - a.selected.position[i]) / radius);
      __sagaPath.push({ elapsed: travel?.elapsed ?? 18, radius: Math.hypot(...offset), offset,
        yaw: a.state.yaw, pitch: a.state.pitch, cols: a.state.cols, rows: a.state.rows });
      if (travel) requestAnimationFrame(collect);
    }; requestAnimationFrame(collect);
  });
  report.samples = [];
  for (const second of [2, 5, 8, 10, 12, 18]) {
    await page.waitForFunction(second => !__compiledAtlas.journey || __compiledAtlas.journey.elapsed >= second, second);
    const sample = await page.evaluate(() => {
      const a = __compiledAtlas, target = a.selected, frame = a.data.frame, n = frame.cols * frame.rows;
      let glyphs = 0, backgroundCells = 0, signal = 0;
      for (let i = 0; i < n; i++) {
        const f = Math.max(...frame.foregroundRGBUint8.subarray(i * 3, i * 3 + 3)), b = Math.max(...frame.backgroundRGBUint8.subarray(i * 3, i * 3 + 3));
        if (frame.glyphsUint8[i] !== 32 && f > 20) glyphs++;
        if (b > 10) backgroundCells++;
        signal += Math.max(b, frame.glyphsUint8[i] !== 32 ? f * .3 : 0);
      }
      const distance = Math.hypot(...a.state.position.map((value, i) => value - target.position[i]));
      return { elapsed: a.journey?.elapsed ?? 18, distancePc: distance, radiusRs: distance / target.radius_pc,
        glyphs, backgroundCells, meanSignal: signal / n, stats: a.data.stats,
        hudUnit: document.querySelector('#distance-unit').textContent };
    });
    report.samples.push(sample);
    await page.screenshot({ path: `${artifacts}/saga-after-${second}.png` });
  }
  const path = await page.evaluate(() => __sagaPath), near = path.filter(sample => sample.elapsed >= 10);
  assert.ok(Math.abs(report.samples[3].radiusRs - 4096) < 150, 'Enter the compiled lens region with eight seconds left');
  assert.ok(report.samples[4].radiusRs > 380 && report.samples[4].radiusRs < 470, 'The close approach must unfold across several seconds');
  assert.ok(Math.abs(report.samples[5].radiusRs - 24) < .001);
  assert.equal(report.samples[5].hudUnit, 'SCHWARZSCHILD RADII', 'Arrival HUD changes in the same frame as the camera');
  let largestStep = 0, largestAngularSpeed = 0, largestLogSpeed = 0;
  for (let i = 1; i < near.length; i++) {
    assert.ok(near[i].radius <= near[i - 1].radius + .002, 'The arrival must approach monotonically');
    const step = Math.hypot(...near[i].offset.map((value, axis) => value - near[i - 1].offset[axis]));
    if (near[i - 1].elapsed >= 14) largestStep = Math.max(largestStep, step);
    const dt = near[i].elapsed - near[i - 1].elapsed;
    if (dt > 1e-5) {
      largestLogSpeed = Math.max(largestLogSpeed, Math.abs(Math.log(near[i].radius / near[i - 1].radius)) / dt);
      const dyaw = Math.atan2(Math.sin(near[i].yaw - near[i - 1].yaw), Math.cos(near[i].yaw - near[i - 1].yaw));
      largestAngularSpeed = Math.max(largestAngularSpeed, Math.hypot(dyaw * Math.cos(near[i].pitch), near[i].pitch - near[i - 1].pitch) * 180 / Math.PI / dt);
    }
  }
  assert.ok(largestStep < 5, 'The last four seconds must not jump through world coordinates');
  assert.ok(largestLogSpeed < 1.35, 'The full eight-second approach must respect the continuous logarithmic flight envelope');
  assert.ok(largestAngularSpeed < .03, 'Approach along the final bearing before entering the lens region');
  report.envelope = envelope; report.nearFrames = near.length; report.largestNearStepRs = largestStep;
  report.largestAngularDegreesPerSecond = largestAngularSpeed;
  report.largestLogRadiusChangePerSecond = largestLogSpeed;
  report.nearGrids = [...new Set(near.map(row => `${row.cols}x${row.rows}`))];
  if (process.env.CHECK_CORE_VISIBILITY === '1') {
    for (const sample of report.samples) assert.ok(sample.glyphs > 50 && sample.meanSignal > .05, `The approach must not black out at ${sample.elapsed.toFixed(1)}s`);
  }
  await page.locator('#viewport').focus();
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(600); await page.keyboard.up('ArrowRight');
  await page.screenshot({ path: `${artifacts}/saga-after-orbit.png` });
  const orbit = await page.evaluate(() => ({ radius: Math.hypot(...__compiledAtlas.state.position.map((value,i) => value-__compiledAtlas.selected.position[i]))/__compiledAtlas.selected.radius_pc, error: !document.querySelector('#error').hidden }));
  assert.ok(Math.abs(orbit.radius - 24) < .001); assert.equal(orbit.error, false);
  // Replanning after a mid-flight stop must retain a journey, not classify the
  // distant but selected object as a nearby camera inspection.
  await page.evaluate(async () => { await __compiledAtlas.returnEarth({ instant: true }); await __compiledAtlas.travelTo(__compiledAtlas.destinations['sagittarius-a']); });
  await page.waitForFunction(() => __compiledAtlas.journey);
  await page.waitForFunction(() => Math.hypot(...__compiledAtlas.state.position.map((value,i) => value-__compiledAtlas.destinations.earth.position[i])) > .1);
  await page.locator('#cancel-journey').click(); await page.locator('#resume-journey').click();
  await page.waitForFunction(() => __compiledAtlas.journey);
  assert.equal(await page.evaluate(() => __compiledAtlas.journey.sameTarget), false);
  await page.evaluate(() => __compiledAtlas.cancelJourney());
  report.errors = errors; assert.deepEqual(errors, []); report.passed = true;
  console.log(JSON.stringify({ envelope, samples: report.samples.map(({ elapsed, radiusRs, glyphs, meanSignal }) => ({ elapsed, radiusRs, glyphs, meanSignal })), largestStep, passed: true }, null, 2));
} finally {
  await browser.close();
  await writeFile(`${artifacts}/saga-approach-after.json`, JSON.stringify(report, null, 2)+'\n');
}
