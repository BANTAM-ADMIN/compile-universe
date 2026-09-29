/** Browser journeys across observed bodies and repeatable generated systems. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const origin = process.env.COMPILEUNIVERSE_URL || 'http://127.0.0.1:8781';
const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url));
const browser = await chromium.launch({ headless: true });
const errors = [], report = {};
async function ready(page) {
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.__compiledAtlas?.ready && __compiledAtlas.data.frame, null, { timeout: 60000 });
}
async function frame(page) {
  const before = await page.evaluate(() => __compiledAtlas.metrics.frames);
  await page.waitForFunction(before => __compiledAtlas.metrics.frames > before, before);
}
async function arriveNow(page, minimumCells = 50) {
  const before = await page.evaluate(() => __compiledAtlas.metrics.frames);
  await page.evaluate(() => __compiledAtlas.travelTo(__compiledAtlas.journey.destination, { instant: true }));
  await page.waitForFunction(before => __compiledAtlas.metrics.frames > before, before);
  assert.equal(await page.evaluate(() => __compiledAtlas.journey), null);
  assert.ok(await page.evaluate(minimum => __compiledAtlas.data.stats.surface_cells > minimum, minimumCells));
  await page.waitForTimeout(200); // Let the deliberately throttled telemetry settle before screenshots.
}
async function map(page, family) {
  await page.locator('#system-map-open').click();
  await page.locator('#system-map:not([hidden])').waitFor();
  if (family) await page.getByRole('button', { name: `${family} + moons`, exact: true }).click();
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await ready(page);
  const count = await page.evaluate(() => __compiledAtlas.bodies.length);
  assert.ok(count >= 482, 'Expanded Solar registry must be loaded');
  assert.equal(await page.evaluate(() => __compiledAtlas.data.stats.planetary_bodies), count);
  report.registry = count;

  // A genuine button-driven, full-duration trip to the Moon, with a lit arrival.
  const start = Date.now();
  await page.getByRole('button', { name: 'Fly to Moon', exact: true }).click();
  await page.waitForFunction(() => __compiledAtlas.journey?.destination.id === 'moon');
  const duration = await page.evaluate(() => __compiledAtlas.journey.duration);
  assert.ok(duration > 2 && duration < 8, 'A short local journey should not use the interstellar duration');
  await page.waitForFunction(() => !__compiledAtlas.journey && __compiledAtlas.selected.id === 'moon');
  await frame(page);
  const moon = await page.evaluate(() => {
    const a = __compiledAtlas, r = a.selected, camera = a.state.position.map((v,i) => v-r.position[i]), light = r.hostPosition.map((v,i) => v-r.position[i]);
    return { cells: a.data.stats.surface_cells, lit: camera.reduce((s,v,i) => s+v*light[i],0)/Math.hypot(...camera)/Math.hypot(...light), altitudeLabel: document.querySelector('#distance-label').textContent };
  });
  assert.ok(moon.cells > 1000 && moon.lit > .6);
  assert.equal(moon.altitudeLabel, 'ABOVE THE SURFACE');
  report.moon = { duration, elapsedSeconds: (Date.now()-start)/1000, ...moon };
  await page.screenshot({ path: `${artifacts}/systems-moon-browser.png` });

  // Search all moons from the whole-system map, then stop and resume a real route.
  await map(page);
  await page.locator('#map-search').fill('Phobos');
  await page.locator('#map-body-list button').filter({ hasText: 'Phobos' }).click();
  await page.waitForFunction(() => __compiledAtlas.journey?.destination.id === 'phobos');
  assert.equal(await page.locator('#system-map').isVisible(), false);
  await page.waitForTimeout(150);
  await page.locator('#cancel-journey').click();
  assert.equal(await page.evaluate(() => __compiledAtlas.journey), null);
  assert.equal(await page.evaluate(() => __compiledAtlas.resumeTarget.id), 'phobos');
  await page.locator('#resume-journey').click();
  await page.waitForFunction(() => __compiledAtlas.journey?.destination.id === 'phobos');
  await arriveNow(page);
  report.phobos = await page.evaluate(() => ({ cells: __compiledAtlas.data.stats.surface_cells, selected: __compiledAtlas.selected.id }));

  // Hundreds of moons remain searchable while the map and initial list stay bounded.
  await map(page, 'Saturn');
  assert.ok(await page.locator('#map-body-list button').count() <= 37);
  assert.ok(await page.locator('#map-svg [role=button]').count() <= 25);
  const beforeMore = await page.locator('#map-body-list button').count();
  await page.locator('#map-more').click();
  assert.ok(await page.locator('#map-body-list button').count() > beforeMore);
  await page.locator('#map-search').fill('Titan');
  await page.locator('#map-body-list button').filter({ hasText: 'Titan' }).click();
  await page.waitForFunction(() => __compiledAtlas.journey?.destination.id === 'titan');
  await arriveNow(page);
  await page.locator('#search-open').click();
  await page.locator('#star-search').fill('Saturn');
  await page.getByRole('button', { name: 'Discover Saturn', exact: true }).click();
  await page.locator('#fly-preview').click();
  await page.waitForFunction(() => __compiledAtlas.journey?.destination.id === 'saturn');
  await arriveNow(page);
  assert.ok(await page.evaluate(() => __compiledAtlas.data.stats.ring_cells > 100));
  await page.screenshot({ path: `${artifacts}/systems-saturn-browser.png` });

  // Sub-kilometer targets retain useful precision; comet arrivals frame the tail.
  report.smallBodies = [];
  for (const id of ['bennu', 'itokawa', 'halley']) {
    const record = await page.evaluate(id => __compiledAtlas.bodies.find(body => body.id === id), id);
    assert.ok(record, `${id} must be available`);
    await page.locator('#search-open').click(); await page.locator('#star-search').fill(record.name);
    await page.getByRole('button', { name: `Discover ${record.name}`, exact: true }).click();
    await page.locator('#fly-preview').click();
    await page.waitForFunction(id => __compiledAtlas.journey?.destination.id === id, id);
    await arriveNow(page, record.kind === 'comet' ? 5 : 50);
    const view = await page.evaluate(() => { const a = __compiledAtlas, body = a.selected; return { name: body.name, radii: Math.hypot(...a.state.position.map((v,i) => v-body.position[i]))/body.radius_pc, cells: a.data.stats.surface_cells, tailCells: a.data.stats.comet_cells }; });
    assert.ok(Math.abs(view.radii - (record.viewDistanceRadii || 3.5)) < .01, 'Arrival must honor body scale and comet view distance');
    if (record.kind === 'comet') assert.ok(view.tailCells > 0, 'The compiled comet activity must be visible');
    report.smallBodies.push(view);
    await page.screenshot({ path: `${artifacts}/systems-${id}-browser.png` });
  }

  // Paused scene time must not disable camera controls or travel.
  await page.evaluate(() => __compiledAtlas.setPaused(true));
  const frozenTime = await page.evaluate(() => __compiledAtlas.state.time);
  await map(page, 'Earth');
  await page.locator('#map-svg [aria-label="Fly to Moon"]').focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => __compiledAtlas.journey?.destination.id === 'moon');
  assert.equal(await page.evaluate(() => __compiledAtlas.paused), true, 'Map activation must not bubble into Space pause shortcut');
  await arriveNow(page);
  assert.equal(await page.evaluate(() => __compiledAtlas.state.time), frozenTime);
  await page.evaluate(() => __compiledAtlas.setPaused(false));

  // Everything needed for a first generated system must already be local.
  const attempts = [];
  await page.context().route('**/*', route => { attempts.push(route.request().url()); return route.abort(); });
  await page.locator('#search-open').click();
  await page.locator('#star-search').fill('Alpha Centauri');
  await page.getByRole('button', { name: 'Discover Alpha Centauri A', exact: true }).click();
  await page.locator('#map-preview').click();
  await page.locator('#system-map:not([hidden])').waitFor();
  const generated = await page.evaluate(() => {
    const system = __compiledAtlas.map.system, world = system.bodies.find(body => body.generated && body.kind === 'planet');
    return { index: world.index, name: world.name, position: world.position, total: system.bodies.length };
  });
  await page.locator(`#map-svg [aria-label="Fly to ${generated.name}"]`).click();
  await page.waitForFunction(index => __compiledAtlas.journey?.destination.index === index, generated.index);
  await arriveNow(page);
  const departure = await page.evaluate(() => __compiledAtlas.selected);
  await page.locator('#search-open').click();await page.locator('#star-search').fill('Sirius');
  await page.getByRole('button', { name: 'Discover Sirius', exact: true }).click();await page.locator('#map-preview').click();
  await page.locator('#system-map:not([hidden])').waitFor();
  const siriusWorld = await page.evaluate(() => __compiledAtlas.map.system.bodies.find(body => body.generated && body.kind === 'planet'));
  await page.locator(`#map-svg [aria-label="Fly to ${siriusWorld.name}"]`).click();
  await page.waitForFunction(index => __compiledAtlas.journey?.destination.index === index, siriusWorld.index);
  await arriveNow(page);
  assert.ok(await page.evaluate(count => __compiledAtlas.data.stats.planetary_bodies > count, count));
  await page.evaluate(record => __compiledAtlas.travelTo(record, { instant: true }), departure);
  await frame(page);
  assert.deepEqual(await page.evaluate(() => __compiledAtlas.selected.position), generated.position);
  assert.equal(await page.evaluate(() => __compiledAtlas.selected.index), generated.index);
  assert.deepEqual(attempts, [], 'New seeded worlds and return visits must work after bootstrap with no further requests');
  report.generated = { alpha: generated.name, sirius: siriusWorld.name, repeatableReturn: true, offlineRequests: attempts.length };
  await page.screenshot({ path: `${artifacts}/systems-generated-browser.png` });
  const cache = await page.evaluate(async () => {
    const a = __compiledAtlas, candidates = a.catalog.stars.filter(star => star.index > 0 && ![a.destinations.alpha.index,a.destinations.sirius.index].includes(star.index)).slice(0, 38);
    const initial = await a.generateForStar(candidates[0]), saved = JSON.parse(JSON.stringify(initial.bodies.find(body => body.generated)));
    for (const star of candidates.slice(1)) await a.generateForStar(star);
    const count = a.systems.filter(system => system.dataClass === 'generated-system').length;
    const evicted = !a.systems.some(system => system.hostStarIndex === candidates[0].index);
    await a.travelTo(saved, { instant: true });
    return { count, evicted, samePosition: a.selected.position.every((v,i) => v === saved.position[i]), sameIndex: a.selected.index === saved.index };
  });
  assert.ok(cache.count <= 32 && cache.evicted && cache.samePosition && cache.sameIndex, 'Bounded cache must reconstruct an evicted world from its seed');
  report.generated.cache = cache;
  await page.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  await ready(phone);
  await map(phone, 'Mars');
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await phone.screenshot({ path: `${artifacts}/systems-map-mobile.png` });
  await phone.locator('#map-body-list button').filter({ hasText: 'Phobos' }).click();
  await phone.waitForFunction(() => __compiledAtlas.selected.id === 'phobos' && !__compiledAtlas.journey);
  await frame(phone);
  assert.ok(await phone.evaluate(() => __compiledAtlas.data.stats.surface_cells > 100));
  report.mobile = { width: 390, map: true, reducedMotion: true, destination: 'Phobos' };
  report.errors = errors; assert.deepEqual(errors, []); report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await writeFile(`${artifacts}/systems-browser-validation.json`, JSON.stringify(report, null, 2)+'\n');
}
