#!/usr/bin/env python3
"""Bundle the original Compile Universe atlas into an offline HTML file.

Uses only the Python standard library. Run after compiling upstream's assets,
or pass --compile to regenerate them using upstream's build dependencies.
"""
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
BUILD_STEPS = [
    "compile_catalog.py", "compile_gaia.py", "compile_solar.py",
    "compile_surfaces.py", "compile_systems.py", "compile_destinations.py",
    "compile_galaxy.py", "compile_lensing.py", "compile_appearance.py",
    "compile_web.py", "compile_phenomena.py",
]
MODULES = [
    "glyph-display.js", "ascii-interface.js", "surface-compiler.js",
    "earth-orientation.js", "system-generator.js", "atlas-engine.js",
    "engine.js", "phenomena-engine.js", "atlas-worker.js", "atlas.js",
]
# Only files used by the atlas; HYG's standalone atlas.bin is already included
# in gaia-atlas.bin. Keep all texture variants for generated systems as well.
ASSETS = [
    "atlas.json", "atlas-search.json", "gaia.json", "gaia-atlas.bin",
    "gaia-light.bin", "gaia-observations.bin", "solar.json", "systems.json",
    "surface-metadata.json", "earth.bin", "earth-night.bin", "earth-night.json",
    "earth-orientation.bin", "earth-orientation.json", "galaxy-stars.bin",
    "galaxy-stars.json", "phenomena-destinations.json", "phenomena.bin",
    "universe.bin", "relief-moon.bin", "rings-saturn.bin", "rings-haumea.bin",
]


def safe_json(value):
    return json.dumps(value, ensure_ascii=True, separators=(",", ":")).replace("<", "\\u003c")


BOOTSTRAP = r"""
(async () => {
  'use strict';
  const message = document.getElementById('loading-message');
  const fail = error => {
    document.getElementById('loading').hidden = true;
    document.getElementById('error').hidden = false;
    document.getElementById('error-message').textContent =
      'Could not open the offline atlas: ' + error.message;
    console.error(error);
  };
  try {
    if (!globalThis.WebAssembly || !globalThis.DecompressionStream)
      throw new Error('Use a current browser with WebAssembly and DecompressionStream support.');
    message.textContent = 'Unpacking the embedded star catalogs…';
    const assets = Object.create(null);
    // Decode in small pieces to avoid a second full-size binary string.
    for (const element of document.querySelectorAll('script[data-asset]')) {
      const encoded = element.textContent.trim(), parts = [];
      for (let offset = 0; offset < encoded.length; offset += 262144) {
        const binary = atob(encoded.slice(offset, offset + 262144));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        parts.push(bytes);
      }
      assets[element.dataset.asset] = {
        blob: new Blob(parts, {type:'application/gzip'}),
        mime: element.dataset.mime
      };
      element.remove();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    // This same function is installed inside the rendering worker. Only blob
    // URLs and embedded assets are readable; no HTTP connection is needed.
    function installFetch(table) {
      const nativeFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (input, options) => {
        const name = typeof input === 'string' ? input : input.url || input.href;
        if (name.startsWith('blob:')) return nativeFetch(input, options);
        const path = new URL(name, 'https://offline.invalid/').pathname;
        const asset = table[path];
        if (!asset) throw new Error('Missing embedded asset: ' + path);
        const response = new Response(asset.blob);
        return new Response(response.body.pipeThrough(new DecompressionStream('gzip')),
          {headers:{'Content-Type':asset.mime}});
      };
    }
    installFetch(assets);
    const sourceElement = document.getElementById('offline-modules');
    const sources = JSON.parse(sourceElement.textContent);
    sourceElement.remove();
    const urls = Object.create(null);
    const moduleURL = name => {
      if (urls[name]) return urls[name];
      if (!(name in sources)) throw new Error('Missing embedded module: ' + name);
      const source = sources[name].replace(/(['"])\.\/([^'"\s]+\.js)\1/g,
        (_, quote, dependency) => JSON.stringify(moduleURL(dependency)));
      return urls[name] = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
    };
    const NativeWorker = globalThis.Worker;
    const workers = new Set();
    globalThis.Worker = class OfflineWorker extends NativeWorker {
      constructor(name, options) {
        if (name !== '/atlas-worker.js') throw new Error('Unknown embedded worker: ' + name);
        // Chromium restricts module workers on file:// pages. The same engine
        // modules are scoped into one classic worker, with no external imports.
        const script = `self.onmessage=event=>{\n` +
          `if(event.data.type!=='offline-bootstrap')throw Error('Offline bootstrap expected');\n` +
          `(${installFetch.toString()})(event.data.assets);\n` +
          sources['offline-worker.js'] + '\n};';
        const url = URL.createObjectURL(new Blob([script], {type:'text/javascript'}));
        super(url, {...options, type:'classic'});
        this.offlineURL = url;
        workers.add(this);
        // Blob objects are cloned by reference. The worker reads them directly;
        // file:// workers cannot fetch blob URLs created by the parent page.
        this.postMessage({type:'offline-bootstrap', assets});
      }
      terminate() {
        super.terminate();
        URL.revokeObjectURL(this.offlineURL);
        workers.delete(this);
      }
    };
    addEventListener('pagehide', event => {
      if (event.persisted) return;
      for (const worker of workers) worker.terminate();
      for (const url of Object.values(urls)) URL.revokeObjectURL(url);
    });
    message.textContent = 'Opening the offline universe…';
    await import(moduleURL('atlas.js'));
  } catch (error) { fail(error); }
})();
"""


def worker_bundle(modules):
    """Scope the worker's fixed ESM dependencies into one classic worker."""
    exports = {
        "atlas-engine.js": {"default": "createAtlas"},
        "engine.js": {"default": "createUniverse"},
        "phenomena-engine.js": {"default": "createPhenomena"},
        "surface-compiler.js": {name: name for name in (
            "SURFACE_VERSION", "SURFACE_WIDTH", "SURFACE_HEIGHT", "surfaceSeed", "compileSurface")},
        "earth-orientation.js": {name: name for name in ("earthRotationAngle", "earthOrientation")},
    }
    chunks = ['const __offlineModules=Object.create(null);']
    for name, names in exports.items():
        source = modules[name].replace("import.meta.url", json.dumps("/" + name))
        source = re.sub(r"export default \w+;?", "", source)
        source = re.sub(r"\bexport (?=const |function )", "", source)
        result = ",".join(json.dumps(key) + ":" + value for key, value in names.items())
        chunks.append(f'__offlineModules[{json.dumps(name)}]=(()=>{{\n{source}\nreturn {{{result}}};\n}})();')
    source = modules["atlas-worker.js"]
    source = re.sub(r"^import (\w+) from './([^']+)';", lambda match:
        f'const {match[1]}=__offlineModules[{json.dumps(match[2])}].default;', source, flags=re.M)
    source = re.sub(r"^import (\{[^}]+\}) from './([^']+)';", lambda match:
        f'const {match[1]}=__offlineModules[{json.dumps(match[2])}];', source, flags=re.M)
    source = re.sub(r"import\('./([^']+)'\)", lambda match:
        f'Promise.resolve(__offlineModules[{json.dumps(match[1])}])', source)
    chunks.append(source)
    return "\n".join(chunks)


def build(source: Path, output: Path, *, revision=None, edition="full"):
    web, artifacts = source / "web", source / "artifacts"
    names = ASSETS + sorted(p.name for p in artifacts.glob("surface-*.bin"))
    files = [("/artifacts/" + name, artifacts / name) for name in names]
    files += [("/" + name, web / name) for name in (
        "atlas-engine.wasm", "engine.wasm", "phenomena-engine.wasm")]
    missing = [str(path) for _, path in files if not path.is_file()]
    if missing:
        raise SystemExit("Missing compiled assets. Run python3 build.py --compile.\n" + "\n".join(missing))
    modules = {name: (web / name).read_text() for name in MODULES}
    for name in ("atlas-engine", "engine", "phenomena-engine"):
        # Emscripten normally resolves this alongside the external JS file.
        modules[name + ".js"] = modules[name + ".js"].replace(
            f'new URL("{name}.wasm",import.meta.url).href', f'"/{name}.wasm"')
    modules["offline-worker.js"] = worker_bundle(modules)
    page = (web / "atlas.html").read_text()
    page = page.replace('<link rel="stylesheet" href="/atlas.css">',
                        "<style>" + (web / "atlas.css").read_text() + "</style>")
    page = page.replace('<script type="module" src="/atlas.js"></script>', "")
    page = page.replace("<title>Gaia · Earth → The Stars · Compile Universe</title>",
                        "<title>Compile Universe · Offline Atlas</title>")
    page = page.replace("GAIA EXPERIMENT", "OFFLINE ATLAS")
    # Show the original loading/error UI until the character interface starts.
    page = page.replace('class="atlas ascii-ui"', 'class="atlas"')
    page = page.replace("</head>", "<link rel=\"icon\" href=\"data:,\">\n</head>")
    page = page.replace("</body>", "").replace("</html>", "")
    provenance = {
        "repository": "https://github.com/BANTAM-ADMIN/compile-universe",
        "revision": revision or subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip(),
        "edition": edition,
        "credits": {name: (source / "data" / name).read_text() for name in (
            "HYG-LICENSE.md", "PHENOMENA-SOURCES.md", "GRAND-TOUR-SOURCES.md")},
        "assets": [],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="\n") as target:
        target.write(page)
        for url, path in files:
            raw = path.read_bytes()
            packed = gzip.compress(raw, compresslevel=9, mtime=0)
            mime = {".json": "application/json", ".wasm": "application/wasm"}.get(
                path.suffix, "application/octet-stream")
            provenance["assets"].append({"url": url, "bytes": len(raw),
                "gzipBytes": len(packed), "sha256": hashlib.sha256(raw).hexdigest()})
            target.write(f'\n<script type="application/octet-stream" data-asset="{url}" data-mime="{mime}">')
            target.write(base64.b64encode(packed).decode("ascii"))
            target.write("</script>\n")
        target.write('<script type="application/json" id="offline-provenance">' + safe_json(provenance) + '</script>\n')
        target.write('<script type="application/json" id="offline-modules">' + safe_json(modules) + '</script>\n')
        target.write("<script>" + BOOTSTRAP + "</script>\n</body>\n</html>\n")
    print(f"Built {output}: {output.stat().st_size / 1e6:.1f} MB, {len(files)} embedded assets")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "upstream")
    parser.add_argument("--output", type=Path, default=ROOT / "index.html")
    parser.add_argument("--compile", action="store_true", help="Regenerate astronomy assets first")
    args = parser.parse_args()
    source = args.source.resolve()
    if args.compile:
        for script in BUILD_STEPS:
            subprocess.run([sys.executable, script], cwd=source, check=True)
    build(source, args.output.resolve())
