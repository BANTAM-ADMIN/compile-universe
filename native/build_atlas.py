#!/usr/bin/env python3
"""Compile the portable CPU stellar-atlas character interpreter."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess


def main():
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--emxx", default=None)
    parser.add_argument("--native", action="store_true")
    args = parser.parse_args()
    if args.native:
        (here / "build").mkdir(exist_ok=True)
        subprocess.run([os.environ.get("CXX", "g++"), "-std=c++17", "-O3", "-fPIC", "-shared",
                        str(here / "atlas_engine.cpp"), "-o", str(here / "build/libuniverse_atlas.so")], check=True)
    candidates = [args.emxx, shutil.which("em++"), "/tmp/compileuniverse-emsdk/upstream/emscripten/em++"]
    compiler = next((str(p) for p in candidates if p and Path(p).is_file()), None)
    if not compiler:
        parser.error("Emscripten em++ not found; pass --emxx or activate emsdk")
    exports = '["_malloc","_free","_atlas_init","_atlas_set_earth","_atlas_add_body","_atlas_set_body_relief","_atlas_set_body_emission","_atlas_set_body_orientation","_atlas_add_destination","_atlas_set_local_destination","_atlas_set_body_shape","_atlas_set_body_comet","_atlas_clear_generated","_atlas_add_belt","_atlas_clear_belts","_atlas_frame","_atlas_set_environment","_atlas_set_galaxy","_atlas_set_survey","_atlas_set_camera_roll","_atlas_overlay_layers","_atlas_output","_atlas_hide_star","_atlas_overlay","_atlas_stats","_atlas_labels","_atlas_label_indices","_atlas_label_count","_atlas_pick","_atlas_error","_atlas_shutdown"]'
    subprocess.run([compiler, str(here / "atlas_engine.cpp"), "-std=c++17", "-O3", "-fno-exceptions",
                    "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sEXPORT_NAME=createAtlas",
                    "-sENVIRONMENT=web,worker,node", "-sALLOW_MEMORY_GROWTH=1", "-sINITIAL_MEMORY=33554432",
                    "-sMAXIMUM_MEMORY=268435456", "-sFILESYSTEM=0", "-sEXPORTED_FUNCTIONS=" + exports,
                    '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPU8","HEAPF32"]',
                    "-o", str(here.parent / "web/atlas-engine.js")], check=True)
    print("Built web/atlas-engine.js and web/atlas-engine.wasm")


if __name__ == "__main__":
    main()
