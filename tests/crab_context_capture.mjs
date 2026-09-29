/** Capture the actual Crab pulsar journey and its surrounding remnant. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const origin = process.env.COMPILEUNIVERSE_URL || 'http://127.0.0.1:8781';
const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url));
const browser = await chromium.launch({ headless: true }), errors = [], report = { samples: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.__compiledAtlas?.ready && __compiledAtlas.data.frame, null, { timeout: 60000 });
  await page.locator('#info-open').click(); await page.locator('#density').selectOption('220,94'); await page.locator('#close-panel').click();
  await page.evaluate(() => __compiledAtlas.travelTo('crab-pulsar'));
  await page.waitForFunction(() => __compiledAtlas.journey?.destination.id === 'crab-pulsar');
  report.duration = await page.evaluate(() => __compiledAtlas.journey.duration);
  async function capture(name) {
    report.samples.push(await page.evaluate(name => {
      const a = __compiledAtlas, frame = a.data.frame, n = frame.cols * frame.rows;
      let glyphs = 0, signal = 0;
      for (let i=0;i<n;i++) {
        const f = Math.max(...frame.foregroundRGBUint8.subarray(i*3,i*3+3)), b = Math.max(...frame.backgroundRGBUint8.subarray(i*3,i*3+3));
        if (frame.glyphsUint8[i] !== 32 && f > 20) glyphs++;
        signal += Math.max(b, frame.glyphsUint8[i] !== 32 ? f*.3 : 0);
      }
      return { name, elapsed: a.journey?.elapsed ?? null, position: [...a.state.position], yaw: a.state.yaw,
        pitch: a.state.pitch, paused: a.paused, mode: a.mode, stats: a.data.stats, glyphs, meanSignal: signal/n };
    }, name));
    await page.screenshot({ path: `${artifacts}/crab-pulsar-${name}.png` });
  }
  for (const second of [5, 10, 14]) {
    await page.waitForFunction(second => !__compiledAtlas.journey || __compiledAtlas.journey.elapsed >= second, second);
    await capture(`journey-${second}`);
  }
  await page.waitForFunction(() => !__compiledAtlas.journey);
  assert.equal(await page.evaluate(() => __compiledAtlas.selected.id), 'crab-pulsar');
  await page.locator('#pause').click();
  await page.locator('#mode-toggle').click(); await page.locator('#viewport').focus();
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(1600); await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(150); await capture('look-right');
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(2700); await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(150); await capture('look-back');
  assert.ok(report.samples.at(-1).glyphs > 50, 'The pulsar lives inside a visible surrounding remnant');
  assert.equal(report.samples.at(-1).paused, true); assert.equal(report.samples.at(-1).mode, 'free');
  assert.deepEqual(report.samples.at(-1).position, report.samples.at(-2).position, 'Free look rotates without translating');
  assert.deepEqual(errors, []); report.errors = errors; report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close(); await writeFile(`${artifacts}/crab-pulsar-context.json`, JSON.stringify(report,null,2)+'\n');
}
