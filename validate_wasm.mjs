// Node-side fixture runner. Python owns the independent reference and reports.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const [fixtureFile, outputDirectory] = process.argv.slice(2);
if (!fixtureFile || !outputDirectory) throw new Error('Usage: node validate_wasm.mjs fixtures.json output-directory');
const { default: createUniverse } = await import(pathToFileURL(path.join(root, 'web/engine.js')));
const module = await createUniverse({wasmBinary:fs.readFileSync(path.join(root, 'web/engine.wasm'))});
const asset = fs.readFileSync(path.join(root, 'artifacts/universe.bin'));
const assetPointer = module._malloc(asset.length);
module.HEAPU8.set(asset, assetPointer);
if (module._cu_init(assetPointer, asset.length) !== 0) throw new Error('Compiled universe initialization failed');
const fixtures = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
const reports = [];
fs.mkdirSync(outputDirectory, {recursive:true});
for (const [index, fixture] of fixtures.entries()) {
  const p = fixture.position;
  const start = performance.now();
  const result = module._cu_frame(fixture.cols, fixture.rows, p[0], p[1], p[2],
    fixture.yaw, fixture.pitch, fixture.fov, fixture.time, fixture.exposure,
    fixture.bloom ? 1 : 0, fixture.palette === 'ice' ? 1 : 0);
  const frameWallMs = performance.now() - start;
  if (result !== 0) throw new Error(`Fixture ${index}: engine frame failed (${result})`);
  const cells = fixture.cols * fixture.rows;
  const pointer = module._cu_output();
  const bytes = module.HEAPU8.slice(pointer, pointer + cells * 7);
  const filename = `${String(index).padStart(3, '0')}.cells`;
  fs.writeFileSync(path.join(outputDirectory, filename), bytes);
  const statsPointer = module._cu_stats();
  const stats = Array.from(new Float32Array(module.HEAPU8.buffer, statsPointer, 8));
  reports.push({name:fixture.name, filename, frameWallMs, stats});
}
fs.writeFileSync(path.join(outputDirectory, 'manifest.json'), JSON.stringify(reports, null, 2) + '\n');
module._free(assetPointer);
