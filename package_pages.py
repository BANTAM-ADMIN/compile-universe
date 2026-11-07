#!/usr/bin/env python3
"""Prepare the compact, standalone atlas for direct GitHub Pages hosting."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import shutil

ROOT = Path(__file__).resolve().parent


def package(html, output):
    if html.stat().st_size > 20_000_000:
        raise ValueError("Publish the compact edition, which must be no larger than 20 MB")
    content = html.read_bytes()
    match = re.search(rb'id="offline-provenance">([^<]+)</script>', content)
    if not match:
        raise ValueError("The standalone atlas's source provenance is missing")
    provenance = json.loads(match[1])
    edition = provenance.get("edition", {})
    if not isinstance(edition, dict) or edition.get("name") != "compact":
        raise ValueError("The HTML is not the compact edition")
    manifest = {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(),
                "source": provenance["repository"], "revision": provenance["revision"],
                "edition": edition}
    output.mkdir(parents=True, exist_ok=True)
    (output / "index.html").write_bytes(content)
    (output / ".nojekyll").touch()
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (output / ".gitignore").write_text("__pycache__/\n")
    (output / "README.md").write_text(f'''# Compile Universe — compact standalone atlas

Live site: https://bantam-admin.github.io/compile-universe/

The complete application is contained in `index.html`: **{len(content) / 1e6:.2f} MB**,
with **{edition['stars']:,} catalog stars**, 490 bodies, planets, nebulae, black
holes, search, maps, generated systems, the Grand Tour, and text/ANSI export.
There are no external scripts, libraries, astronomy assets, or API dependencies.
You can save `index.html` and open it directly in a current browser offline.

{edition['note']}

This branch contains the deployable page. Original application source is on
`main`, revision `{provenance['revision']}`. The standalone builder and compact
data compiler are retained under `tools/`; the HTML embeds source credits,
scientific limitations, and hashes of all included assets.

## GitHub Pages

Pages publishes the **root of the `gh-pages` branch**. `.nojekyll` makes this a
plain static deployment. Push an updated `index.html` to this branch to redeploy.

To package a newly built compact HTML into this checkout:

```sh
python3 package_pages.py --html /path/to/compact.html --output .
git add index.html manifest.json README.md .nojekyll package_pages.py tools
git commit -m "Update compact universe atlas"
git push origin gh-pages
```

`manifest.json` contains the exact page size and SHA-256 checksum. This deployment
contains no server code and needs no credentials at runtime.

## Data credits

HYG 4.2 is by Astronomy Nexus; derived HYG catalog data remains under CC BY-SA 4.0.
Additional sources include ESA/Gaia/DPAC, NASA, and JPL Horizons. Full credits and
compact-edition limitations are available in Observatory inside the page.
''')
    script = output / "package_pages.py"
    if script.resolve() != Path(__file__).resolve():
        shutil.copyfile(__file__, script)
    tools = output / "tools"
    tools.mkdir(exist_ok=True)
    for name in ("build.py", "build_compact.py"):
        source = ROOT / name
        if source.exists() and source.resolve() != (tools / name).resolve():
            shutil.copyfile(source, tools / name)
    print(f"Ready for Pages: {len(content):,} bytes, SHA-256 {manifest['sha256']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--html", type=Path, default=ROOT / "compact.html")
    parser.add_argument("--output", type=Path, default=ROOT / "github-pages-compact")
    args = parser.parse_args()
    package(args.html.resolve(), args.output.resolve())
