#!/usr/bin/env python3
"""Compile reusable disk charts and a filtered illustrative distant sky."""
import json
from compileuniverse.appearance import compile_appearance

if __name__ == "__main__":
    print(json.dumps(compile_appearance(), indent=2))
