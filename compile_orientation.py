#!/usr/bin/env python3
"""Compile Earth's slowly changing celestial pole/origin; spin stays UTC driven."""
from pathlib import Path
import gzip
import hashlib
import json
import erfa
import numpy as np

ROOT = Path(__file__).resolve().parent


def compile_orientation():
    start = np.datetime64('2000-01-01', 'ms').astype(np.int64)
    stop = np.datetime64('2051-01-01', 'ms').astype(np.int64)
    times = np.arange(start, stop+86400000, 86400000, dtype=np.int64)
    # TT drives only the slowly changing pole; this approximation differs by
    # seconds across the table, below the daily interpolation's visual precision.
    jd = times/86400000 + 2440587.5 + 69.184/86400
    matrices = erfa.c2i06a(2451545., jd-2451545.)
    raw = np.stack((matrices[:, 0, :], matrices[:, 2, :]), axis=1).astype('<f4').tobytes()
    metadata = dict(startUtcMs=int(start), stepMs=86400000, count=len(times), components=6,
                    url='/artifacts/earth-orientation.bin', bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
                    model='IAU 2006 precession / IAU 2000A nutation, ERFA c2i06a',
                    source='https://www.iausofa.org/cookbooks', erfaVersion=erfa.__version__,
                    format='Daily float32 CIO x-axis then celestial north pole, in ICRS/GCRS axes',
                    limitations='UTC approximates UT1; no live Earth-orientation bulletin or polar motion. TT-UTC approximated as 69.184 seconds. Planet centers and sunlight geometry retain the fixed J2000 scene epoch.')
    out=ROOT/'artifacts'
    (out/'earth-orientation.bin').write_bytes(raw)
    (out/'earth-orientation.bin.gz').write_bytes(gzip.compress(raw, mtime=0))
    (out/'earth-orientation.json').write_text(json.dumps(metadata, indent=2)+'\n')
    print(f'Compiled Earth orientation: {len(times)} daily records, {len(raw):,} bytes')


if __name__=='__main__':
    compile_orientation()
