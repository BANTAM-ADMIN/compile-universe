/** Real-browser local-player integration checks; run against a running viewer. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const origin = process.env.COMPILEUNIVERSE_URL || 'http://127.0.0.1:8766/index.html';
const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url));
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [], report = {};
async function ready(page) {
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.__compiledUniverse?.localReady && window.__compiledUniverse?.data, { timeout: 45000 });
}
async function frameMatches(page, predicate, arg) {
  await page.waitForFunction(predicate, arg, { timeout: 30000 });
}
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  let apiRequests = 0;
  page.on('request', request => { if (request.url().endsWith('/api/frame')) apiRequests++; });
  await ready(page);
  assert.equal(await page.locator('#glyphscreen').isVisible(), true);
  assert.equal(await page.locator('#screen').isVisible(), false);
  const firstFrames = await page.evaluate(() => __compiledUniverse.metrics.frames);
  await page.waitForTimeout(1000);
  const nextFrames = await page.evaluate(() => __compiledUniverse.metrics.frames);
  assert.ok(nextFrames > firstFrames + 20, 'Local player must keep displaying frames without server requests');
  assert.equal(apiRequests, 0, 'Black-hole playback must not request server frames');

  for (const [preset, radius, fov] of [['horizon', 60, 22], ['above', 22, 60], ['ring', 60, 18]]) {
    const oldFrames = await page.evaluate(() => __compiledUniverse.metrics.frames);
    await page.locator(`#preset-${preset}`).click();
    await frameMatches(page, expected => __compiledUniverse.metrics.frames > expected.oldFrames && Math.abs(__compiledUniverse.data.stats.camera_radius - expected.radius) < .001, { radius, oldFrames });
    assert.equal(await page.evaluate(() => __compiledUniverse.state.fov), fov);
    assert.equal(await page.locator(`#preset-${preset}`).getAttribute('aria-pressed'), 'true');
  }
  await page.locator('#preset-free').click();
  const beforeMove = await page.evaluate(() => [...__compiledUniverse.state.position]);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(150); await page.keyboard.up('KeyW');
  const afterMove = await page.evaluate(() => [...__compiledUniverse.state.position]);
  assert.notDeepEqual(afterMove, beforeMove, 'Free flight must move');
  await page.keyboard.down('KeyR'); await page.waitForTimeout(100); await page.keyboard.up('KeyR');
  const raised = await page.evaluate(() => __compiledUniverse.state.position[1]);
  assert.ok(raised > afterMove[1]);
  await page.keyboard.down('KeyV'); await page.waitForTimeout(100); await page.keyboard.up('KeyV');
  assert.ok(await page.evaluate(() => __compiledUniverse.state.position[1]) < raised);

  await page.locator('#preset-horizon').click(); await page.locator('#pause').click();
  await page.waitForTimeout(150);
  const frozen = await page.evaluate(() => ({ time: __compiledUniverse.state.time, requests: __compiledUniverse.metrics.requestCount }));
  await page.waitForTimeout(200);
  assert.deepEqual(await page.evaluate(() => ({ time: __compiledUniverse.state.time, requests: __compiledUniverse.metrics.requestCount })), frozen,
    'Paused unchanged scene must stop computation, not just stop its clock');
  await page.locator('#cinematic').click();
  const azimuth = await page.evaluate(() => __compiledUniverse.state.yaw);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => __compiledUniverse.state.yaw), azimuth);
  await page.locator('#pause').click(); await page.waitForTimeout(150);
  assert.notEqual(await page.evaluate(() => __compiledUniverse.state.yaw), azimuth);
  await page.locator('#cinematic').click();

  await page.locator('#settings').click();
  await page.locator('#exposure').evaluate(input => { input.value = '1.65'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await frameMatches(page, () => Math.abs(__compiledUniverse.data.stats.exposure - 1.65) < .001);
  await page.locator('#palette').selectOption('ice'); await page.locator('#bloom').uncheck();
  assert.equal(await page.evaluate(() => __compiledUniverse.state.palette), 'ice');
  assert.equal(await page.evaluate(() => __compiledUniverse.state.bloom), false);
  await page.locator('#resolution').selectOption('280,118');
  await frameMatches(page, () => __compiledUniverse.data.stats.cols === 280 && __compiledUniverse.data.stats.rows === 118);
  await page.waitForTimeout(500);
  assert.deepEqual(await page.evaluate(() => [__compiledUniverse.state.cols, __compiledUniverse.state.rows]), [280, 118], 'Manual density must stay fixed');
  await page.locator('#resolution').selectOption('160,70');
  await page.locator('#display-mode').selectOption('text');
  await frameMatches(page, () => __compiledUniverse.data.rows?.length === 70 && document.querySelector('#screen').textContent.split('\n').length === 70);
  assert.equal(await page.locator('#screen').isVisible(), true); assert.equal(await page.locator('#glyphscreen').isVisible(), false);
  assert.deepEqual(await page.evaluate(() => [...new Set(document.querySelector('#screen').textContent.split('\n').map(row => [...row].length))]), [160]);
  await page.locator('#pause').click(); await page.waitForTimeout(100);
  const plainDownload = page.waitForEvent('download'); await page.locator('#save-text').click();
  const plain = await plainDownload;
  assert.equal(plain.suggestedFilename(), 'sagittarius-a.txt');
  const plainText = await readFile(await plain.path(), 'utf8');
  assert.equal(plainText.trimEnd().split('\n').length, 70);
  const ansiDownload = page.waitForEvent('download'); await page.locator('#save-ansi').click();
  assert.ok((await readFile(await (await ansiDownload).path(), 'utf8')).includes('\x1b[48;2;'));
  await page.locator('#display-mode').selectOption('accelerated'); await page.locator('#resolution').selectOption('adaptive');
  await page.locator('#palette').selectOption('ember'); await page.locator('#bloom').check();
  await page.locator('#exposure').evaluate(input => { input.value = '1'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#drawer').isVisible(), false);
  assert.equal(apiRequests, 0, 'No black-hole controls may fall back to server rendering');

  await page.locator('#scene').selectOption('lab');
  await frameMatches(page, () => __compiledUniverse.data.stats.visible_stars !== undefined);
  assert.equal(await page.locator('#object-title').textContent(), 'A sparse universe');
  await page.locator('#settings').click(); await page.locator('#planet').uncheck();
  await frameMatches(page, () => __compiledUniverse.data.stats.blocked_stars === 0 && __compiledUniverse.data.stats.surface_cells === 0);
  await page.locator('#close-drawer').click(); await page.locator('#scene').selectOption('blackhole');
  await frameMatches(page, () => __compiledUniverse.data.stats.scene === 'blackhole');
  await page.locator('#preset-horizon').click(); await page.waitForTimeout(180);
  await page.screenshot({ path: `${artifacts}/blackhole-desktop.png` });
  await page.locator('#fullscreen').click(); await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await page.evaluate(() => document.exitFullscreen());
  assert.equal(await page.locator('#error').isVisible(), false);
  report.desktop = { initialFramesPerSecond: nextFrames - firstFrames,
    finalComputeMs: await page.evaluate(() => __compiledUniverse.metrics.computeMs),
    finalDisplayMs: await page.evaluate(() => __compiledUniverse.metrics.displayMs),
    localInputSamples: await page.evaluate(() => __compiledUniverse.metrics.inputLatencyMs.length) };
  await page.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true,
    isMobile: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  await ready(phone);
  const mobileLayout = await phone.evaluate(() => {
    const bounds = document.querySelector('#glyphscreen').getBoundingClientRect();
    return { width: bounds.width, height: bounds.height, scrollWidth: document.documentElement.scrollWidth,
      innerWidth, innerHeight, cols: __compiledUniverse.state.cols, rows: __compiledUniverse.state.rows,
      cinematic: __compiledUniverse.cinematic, reducedMotion: __compiledUniverse.reducedMotion };
  });
  assert.ok(mobileLayout.width >= 390 * .95 && mobileLayout.height >= 844 * .95);
  assert.ok(mobileLayout.scrollWidth <= mobileLayout.innerWidth);
  assert.equal(mobileLayout.cinematic, false); assert.equal(mobileLayout.reducedMotion, true);
  await phone.locator('#settings').tap(); assert.equal(await phone.locator('#drawer').isVisible(), true);
  await phone.locator('#close-drawer').tap();
  const beforeDrag = await phone.evaluate(() => [...__compiledUniverse.state.position]);
  await phone.mouse.move(200, 320); await phone.mouse.down(); await phone.mouse.move(255, 345, { steps: 4 }); await phone.mouse.up();
  assert.notDeepEqual(await phone.evaluate(() => __compiledUniverse.state.position), beforeDrag);
  await phone.locator('#preset-horizon').tap(); await phone.locator('#pause').tap();
  await phone.waitForTimeout(250); await phone.screenshot({ path: `${artifacts}/blackhole-mobile.png` });
  report.mobile = { layout: mobileLayout, computeMs: await phone.evaluate(() => __compiledUniverse.metrics.computeMs) };
  assert.equal(await phone.locator('#error').isVisible(), false);
  await phone.close(); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, ...report }, null, 2));
} finally {
  await browser.close();
  if (errors.length) console.error(JSON.stringify({ errors }, null, 2));
}
