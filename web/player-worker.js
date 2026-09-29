/* The scene evaluates to characters in WASM. This worker never draws pixels. */
let engine = null;
let assetBytes = 0;
let initialization = null;
let assetPointer = 0;

async function initialize(assetUrl) {
  if (initialization) return initialization;
  initialization = (async () => {
    postMessage({ type: 'progress', message: 'Loading the compiled light field…' });
    const { default: createUniverse } = await import('./engine.js');
    const response = await fetch(assetUrl || '/artifacts/universe.bin');
    if (!response.ok) throw new Error(`Compiled universe: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assetBytes = bytes.byteLength;
    engine = await createUniverse({ locateFile: file => new URL(file, import.meta.url).href });
    assetPointer = engine._malloc(assetBytes);
    if (!assetPointer) throw new Error('The local player could not allocate its light field.');
    engine.HEAPU8.set(bytes, assetPointer);
    if (engine._cu_init(assetPointer, assetBytes) !== 0)
      throw new Error(engine.UTF8ToString(engine._cu_error()));
    postMessage({ type: 'ready', assetBytes });
  })();
  return initialization;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      await initialize(data.assetUrl);
      return;
    }
    if (data.type !== 'frame') return;
    if (!engine) throw new Error('The compiled universe is still loading.');
    const state = data.state;
    const { cols, rows } = state;
    const start = performance.now();
    const result = engine._cu_frame(cols, rows, ...state.position, state.yaw,
      state.pitch, state.fov, state.time, state.exposure, state.bloom ? 1 : 0,
      state.palette === 'ice' ? 1 : 0);
    if (result !== 0) throw new Error(engine.UTF8ToString(engine._cu_error()));
    const pointer = engine._cu_output(), count = cols * rows;
    // Copy out once; transfer ownership so the main thread receives no cloned arrays.
    const cells = engine.HEAPU8.slice(pointer, pointer + count * 7);
    const statsPointer = engine._cu_stats() >>> 2;
    const measured = engine.HEAPF32.slice(statsPointer, statsPointer + 8);
    const stats = {
      scene: 'blackhole', backend: 'compiled-wasm', cols, rows, time: state.time,
      exposure: state.exposure, frame_ms: measured[0], lookup_ms: measured[1],
      geometry_ms: measured[1], disk_ms: measured[2], glow_ms: measured[3],
      shadow_cells: measured[4], disk_cells: measured[5], cached_geometry: Boolean(measured[6]),
      camera_radius: measured[7], asset_bytes: assetBytes, samples: count,
      worker_ms: performance.now() - start,
    };
    postMessage({ type: 'frame', id: data.id, buffer: cells.buffer, stats }, [cells.buffer]);
  } catch (error) {
    postMessage({ type: 'error', id: data.id, message: error?.message || String(error) });
  }
};
