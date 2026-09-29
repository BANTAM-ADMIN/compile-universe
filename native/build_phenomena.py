#!/usr/bin/env python3
"""Compile CPU-only direct-character real-phenomenon illustrative studies."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess


def main():
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native", action="store_true")
    parser.add_argument("--emxx")
    args = parser.parse_args()
    if args.native:
        (here / "build").mkdir(exist_ok=True)
        subprocess.run([os.environ.get("CXX", "g++"), "-std=c++17", "-O3", "-fPIC", "-shared",
                        str(here / "phenomena_engine.cpp"), "-o", str(here / "build/libuniverse_phenomena.so")], check=True)
    candidates = [args.emxx, shutil.which("em++"), "/tmp/compileuniverse-emsdk/upstream/emscripten/em++"]
    compiler = next((str(p) for p in candidates if p and Path(p).is_file()), None)
    if not compiler:
        parser.error("Emscripten em++ not found; pass --emxx or activate emsdk")
    exports = '["_malloc","_free","_phenomena_init","_phenomena_frame","_phenomena_frame_camera","_phenomena_output","_phenomena_mask","_phenomena_stats","_phenomena_error","_phenomena_shutdown"]'
    subprocess.run([compiler, str(here / "phenomena_engine.cpp"), "-std=c++17", "-O3", "-fno-exceptions",
                    "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sEXPORT_NAME=createPhenomena",
                    "-sENVIRONMENT=web,worker,node", "-sALLOW_MEMORY_GROWTH=1", "-sINITIAL_MEMORY=16777216",
                    "-sMAXIMUM_MEMORY=134217728", "-sFILESYSTEM=0", "-sEXPORTED_FUNCTIONS=" + exports,
                    '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPU8","HEAPF32"]',
                    "-o", str(here.parent / "web/phenomena-engine.js")], check=True)
    print("Built web/phenomena-engine.js and web/phenomena-engine.wasm")


if __name__ == "__main__":
    main()
