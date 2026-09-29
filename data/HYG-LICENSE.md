# HYG catalog attribution and derived data

The source file `hygdata_v42.csv.gz` is the **HYG Database, version 4.2**,
published by **Astronomy Nexus**, downloaded from its
[official catalog download](https://www.astronexus.com/downloads/catalogs/hygdata_v42.csv.gz).
See the [project](https://www.astronexus.com/projects/hyg) and
[field documentation](https://www.astronexus.com/projects/hyg-details).

HYG is licensed under **Creative Commons Attribution-ShareAlike 4.0
International (CC BY-SA 4.0)**. The source catalog and the derived catalog
data in `artifacts/atlas.bin`, `atlas.bin.gz`, `atlas.json`, and
`atlas-search.json` are distributed under that same license. See the
[license terms](https://creativecommons.org/licenses/by-sa/4.0/) and
[legal code](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en).
This notice does not change the license of unrelated application code or assets.

Pinned original gzip SHA256:
`5ca9431ff364c8002a4a3efa91b2b9296746aea1543374db4cb6b4fab049d601`.

The COMPILEUNIVERSE catalog compiler modifies the source by removing the
100,000 pc unknown-distance sentinel, substituting a documented Sun at the
coordinate origin, adding approximate visual appearance parameters, packing
the remaining records, compiling a spatial hierarchy, and extracting a search
subset. Source HYG IDs and valid positions are retained. Four stellar radii
use published interferometric measurements listed in `stellar-radii.json`;
other non-Sun radii are explicitly illustrative estimates. `atlas.json`
records exact counts, coordinate conventions, modifications, and limitations.

This is a fixed J2000 heliocentric star catalog, not a complete Milky Way
census, a present-day ephemeris, or a precision model of binary orbits.
The catalog inherits the source's heterogeneous measurement quality and does
not provide individual astrometric uncertainty estimates.
