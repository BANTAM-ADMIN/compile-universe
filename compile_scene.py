#!/usr/bin/env python3
"""Extract the measured star records; original JavaScript never runs in playback."""
import json
from compileuniverse.scene import compile_catalog

if __name__ == "__main__":
    print(json.dumps(compile_catalog(), indent=2))
