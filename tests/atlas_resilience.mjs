/** Browser resilience: failed asset recovery, no-WebGL display, and offline use. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const origin = process.env.COMPILEUNIVERSE_URL || 'http://127.0.0.1:8781';
const browser = await chromium.launch({ headless: true });
const report = { url: origin, scenarios: [] };
const ready = page => page.waitForFunction(() => window.__compiledAtlas?.ready && window.__compiledAtlas?.data.frame, null, { timeout: 45000 });

async function observedPage(context) {
  const page = await context.newPage(), errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  context.on('request', r => requests.push(r.url()));
  return { page, errors, requests };
}

try {
  // Fail the first catalog binary request, including requests from its worker.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page, errors, requests } = await observedPage(context);
    let catalogAttempts = 0;
    await context.route('**/artifacts/gaia-atlas.bin', route => {
      catalogAttempts++;
      return catalogAttempts === 1
        ? route.fulfill({ status: 503, contentType: 'text/plain', body: 'Injected temporary catalog failure' })
        : route.continue();
    });
    await page.goto(origin);
    await page.locator('#error:not([hidden])').waitFor({ timeout: 30000 });
    const shownError = await page.locator('#error-message').textContent();
    assert.ok(shownError.trim(), 'The user must receive a readable failure state');
    await page.locator('#retry').click();
    await ready(page);
    assert.ok(catalogAttempts >= 2, 'Retry must request the failed asset again');
    assert.equal(await page.locator('#error').isVisible(), false);
    assert.equal(await page.evaluate(() => __compiledAtlas.data.stats.catalog_stars), 1000983);
    assert.equal(requests.filter(url => url.includes('/api/frame')).length, 0);
    assert.deepEqual(errors, []);
    report.scenarios.push({ name: 'initial-catalog-failure-retry', catalogAttempts, shownError, passed: true });
    await context.close();
  }

  // Force the exact capability failure used on devices without WebGL.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      window.__contextAttempts = [];
      HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
        window.__contextAttempts.push(kind);
        if (String(kind).includes('webgl')) return null;
        return original.call(this, kind, ...args);
      };
    });
    const { page, errors, requests } = await observedPage(context);
    await page.goto(origin); await ready(page);
    const first = await page.evaluate(() => __compiledAtlas.metrics.frames);
    await page.waitForFunction(n => __compiledAtlas.metrics.frames >= n + 4, first);
    const display = await page.evaluate(() => {
      const canvas = document.querySelector('#glyphscreen');
      const context = canvas.getContext('2d');
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let coloredPixels = 0;
      for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 20) coloredPixels++;
      return { attempts: window.__contextAttempts, coloredPixels, width: canvas.width, height: canvas.height,
        displayMs: __compiledAtlas.metrics.displayMs, grid: [__compiledAtlas.state.cols, __compiledAtlas.state.rows] };
    });
    assert.ok(display.attempts.includes('webgl2'));
    assert.ok(display.attempts.includes('2d'));
    assert.ok(display.coloredPixels > 100, 'Canvas2D fallback must paint a visible character field');
    await page.locator('#info-open').click();
    await page.locator('#display-mode').selectOption('text');
    await page.waitForFunction(() => document.querySelector('#textscreen').textContent.trim().length > 0);
    const text = await page.locator('#textscreen').textContent();
    const dims = await page.evaluate(() => [__compiledAtlas.data.frame.cols, __compiledAtlas.data.frame.rows]);
    assert.equal(text.split('\n').length, dims[1]);
    assert.ok(text.split('\n').every(row => row.length === dims[0]));
    assert.match(text, /^[\x20-\x7e\n]+$/);
    assert.equal(requests.filter(url => url.includes('/api/frame')).length, 0);
    assert.deepEqual(errors, []);
    report.scenarios.push({ name: 'no-webgl-canvas2d-and-selectable-text', ...display, passed: true,
      note: 'Capability fallback check, not a physical low-end hardware performance measurement.' });
    await context.close();
  }

  // The entire catalog/search and engine must already be local after bootstrap.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const { page, errors } = await observedPage(context);
    await page.goto(origin); await ready(page);
    const start = await page.evaluate(() => ({ frames: __compiledAtlas.metrics.frames, position: [...__compiledAtlas.state.position] }));
    const blocked = [];
    await context.route('**/*', route => { blocked.push(route.request().url()); return route.abort('internetdisconnected'); });
    await page.locator('#search-open').click();
    await page.locator('#star-search').fill('Proxima');
    await page.getByRole('button', { name: 'Discover Proxima Centauri', exact: true }).click();
    await page.locator('#fly-preview').click();
    await page.waitForFunction(() => __compiledAtlas.selected.id === 70666 && !__compiledAtlas.journey);
    await page.waitForFunction(n => __compiledAtlas.metrics.frames > n + 3, start.frames);
    const atProxima = await page.evaluate(() => ({ position: [...__compiledAtlas.state.position],
      target: __compiledAtlas.selected.position, radius: __compiledAtlas.selected.radius_pc,
      glyphs: [...__compiledAtlas.data.frame.glyphsUint8], frames: __compiledAtlas.metrics.frames }));
    assert.notDeepEqual(atProxima.position, start.position);
    assert.ok(Math.hypot(...atProxima.position.map((v, i) => v - atProxima.target[i])) < atProxima.radius * 20);
    assert.ok(atProxima.glyphs.every(code => code >= 32 && code < 127));
    await page.locator('#look-sun').click();
    assert.equal(await page.evaluate(() => __compiledAtlas.selected.index), 0);
    await page.locator('#info-open').click();
    await page.locator('#reset-earth').click();
    await page.waitForFunction(() => __compiledAtlas.selected.index === -2 && !__compiledAtlas.journey);
    await page.evaluate(() => __compiledAtlas.setPaused(true));
    await page.waitForTimeout(150);
    const plainDownloadPromise = page.waitForEvent('download');
    await page.evaluate(() => __compiledAtlas.snapshot(false));
    const plainDownload = await plainDownloadPromise;
    const plain = await readFile(await plainDownload.path(), 'utf8');
    const ansiDownloadPromise = page.waitForEvent('download');
    await page.evaluate(() => __compiledAtlas.snapshot(true));
    const ansiDownload = await ansiDownloadPromise;
    const ansi = await readFile(await ansiDownload.path(), 'utf8');
    assert.match(ansi, /\x1b\[38;2;/);
    assert.equal(ansi.replace(/\x1b\[[0-9;]*m/g, ''), plain);
    assert.equal(blocked.length, 0, 'After bootstrap search, travel, navigation and export must make no network requests');
    assert.deepEqual(errors, []);
    report.scenarios.push({ name: 'offline-search-travel-return-and-ansi', blockedRequests: blocked,
      displayedFrames: atProxima.frames - start.frames, plainBytes: plain.length, ansiBytes: ansi.length, passed: true });
    await context.close();
  }
} finally {
  await browser.close();
}

await writeFile(fileURLToPath(new URL('../artifacts/atlas-resilience.json', import.meta.url)), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
