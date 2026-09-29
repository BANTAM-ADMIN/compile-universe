"""The displayed ink of a smooth, sunlit ocean must not make target rings."""
import unittest
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from test_atlas_renderer import NativeAtlas, catalog, LIBRARY

FONT = Path('/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf')


@unittest.skipUnless(LIBRARY.exists() and FONT.exists(), 'Needs native atlas and the default display font')
class PlanetShading(unittest.TestCase):
    def test_front_lit_ocean_fades_outward_without_bright_rings(self):
        # Independently measure the visible glyph ink, rather than treating the
        # character's position in an alphabet as its displayed brightness.
        font = ImageFont.truetype(str(FONT), 32)
        ink = np.zeros(256)
        for code in range(32, 127):
            tile = Image.new('L', (20, 36))
            ImageDraw.Draw(tile).text((0, 0), chr(code), font=font, fill=255)
            alpha = np.asarray(tile) / 255
            ink[code] = np.sum(alpha * (2-alpha))
        engine = NativeAtlas(catalog([((10, 0, 0), 100, 1e-12)]))
        try:
            engine.body(-2, color=(0, 5, 65), host=(0, 0, -1))
            frame, _ = engine.frame(position=(0, 0, -3e-7), cols=320, rows=160)
            later, _ = engine.frame(position=(0, 0, -3e-7), cols=320, rows=160, time=50)
            np.testing.assert_array_equal(frame, later, 'Dithering must never animate a uniform ocean')
            n = 320*160
            glyphs = frame[:n].reshape(160, 320)
            foreground = frame[n:4*n].reshape(160, 320, 3)
            luminance = ink[glyphs] * foreground[:, :, 2] / 255
            y, x = np.mgrid[:160, :320]
            radial = np.hypot((x-159.5)/1.8, y-79.5)
            profile = np.array([luminance[(radial >= r) & (radial < r+3)].mean()
                                for r in range(0, 49, 3)])
            # Allow small spatial-rounding variations, not rings that brighten
            # toward the limb as in the former non-monotonic alphabet.
            self.assertLess(np.max(np.diff(profile)), 1.3, profile)
            self.assertLess(profile[-1], profile[0]*.9)
        finally:
            engine.lib.atlas_shutdown()
