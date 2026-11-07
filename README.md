# Compile Universe — compact standalone atlas

Live site: https://bantam-admin.github.io/compile-universe/

The complete application is contained in `index.html`: **19.98 MB**,
with **117,401 catalog stars**, 490 bodies, planets, nebulae, black
holes, search, maps, generated systems, the Grand Tour, and text/ANSI export.
There are no external scripts, libraries, astronomy assets, or API dependencies.
You can save `index.html` and open it directly in a current browser offline.

Compact edition: all 109,401 HYG stars plus 8,000 brightness-selected Gaia observations (4,000 nearby and 4,000 LMC). The full million-star Gaia field is omitted. Moon maps are 512x256; black-hole optical tables and background/disk charts use lower resolution. Other scenes, named destinations and controls are retained. 

This branch contains the deployable page. Original application source is on
`main`, revision `6bee836729cace5ff2beb2de9e991763a4049e2f`. The standalone builder and compact
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
