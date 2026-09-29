"""Published context asset contract and reproducible offline compilation."""
import gzip
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import compile_galaxy as compiler


class GalacticContextTests(unittest.TestCase):
    def test_published_payload_matches_decoder_and_provenance(self):
        path = ROOT / 'artifacts/galaxy.bin'
        blob = path.read_bytes()
        metadata = json.loads(path.with_suffix('.json').read_text())
        self.assertEqual((metadata['width'], metadata['height'], metadata['channels']), (1024, 512, 3))
        self.assertEqual(len(blob), 1024 * 512 * 3)
        self.assertEqual(metadata['bytes'], len(blob))
        self.assertEqual(metadata['linearScale'], 4)
        self.assertEqual(metadata['sha256'], hashlib.sha256(blob).hexdigest())
        self.assertEqual(gzip.decompress(path.with_suffix('.bin.gz').read_bytes()), blob)
        self.assertEqual(metadata['dataClass'], 'authored illustrative Galactic context')
        pixels = np.frombuffer(blob, np.uint8).reshape(512, 1024, 3)
        # Detect a corrupt/blank atlas or a uniform glow masquerading as stars.
        self.assertGreater(np.count_nonzero(pixels.max(-1) > 32), 1000)
        self.assertGreater(np.count_nonzero(pixels.max(-1) == 0), pixels.shape[0] * pixels.shape[1] // 3)

    def test_independent_rebuild_reproduces_published_asset_and_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'galaxy.bin'
            compiler.compile_galaxy(path)
            for suffix in ('.bin', '.bin.gz', '.json', '.json.gz'):
                self.assertEqual(path.with_suffix(suffix).read_bytes(),
                                 (ROOT / 'artifacts/galaxy.bin').with_suffix(suffix).read_bytes(),
                                 f'Stale or nondeterministic galaxy artifact: {suffix}')


if __name__ == '__main__':
    unittest.main()
