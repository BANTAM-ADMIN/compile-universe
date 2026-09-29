#!/usr/bin/env python3
"""Build the portable direct-text engine using Emscripten (no GPU required)."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess


def main():
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--emxx", default=None)
    parser.add_argument("--native", action="store_true", help="Also build a native library for independent parity tests")
    args = parser.parse_args()
    if args.native:
        (here / "build").mkdir(exist_ok=True)
        subprocess.run([os.environ.get("CXX", "g++"), "-std=c++17", "-O3", "-fPIC", "-shared",
                        str(here / "text_engine.cpp"), "-o", str(here / "build/libuniverse_text.so")], check=True)
    candidates = [args.emxx, shutil.which("em++"), "/tmp/compileuniverse-emsdk/upstream/emscripten/em++"]
    compiler = next((str(p) for p in candidates if p and Path(p).is_file()), None)
    if not compiler:
        parser.error("Emscripten em++ not found; pass --emxx or activate emsdk")
    exports = '["_malloc","_free","_cu_init","_cu_frame","_cu_output","_cu_mask","_cu_object_mask","_cu_set_overlay","_cu_set_environment","_cu_set_galaxy","_cu_set_lens_strength","_cu_set_point_source","_cu_stats","_cu_error","_cu_shutdown"]'
    subprocess.run([compiler, str(here / "text_engine.cpp"), "-std=c++17", "-O3", "-fno-exceptions",
                    "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sEXPORT_NAME=createUniverse",
                    "-sENVIRONMENT=web,worker,node", "-sALLOW_MEMORY_GROWTH=1", "-sINITIAL_MEMORY=67108864",
                    "-sMAXIMUM_MEMORY=268435456",
                    "-sFILESYSTEM=0", "-sEXPORTED_FUNCTIONS=" + exports,
                    '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPU8","HEAPF32"]',
                    "-o", str(here.parent / "web/engine.js")], check=True)
    print("Built web/engine.js and web/engine.wasm")


if __name__ == "__main__":
    main()
