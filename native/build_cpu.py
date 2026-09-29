#!/usr/bin/env python3
"""Build the dependency-free CPU sphere BVH shared library."""
import os
from pathlib import Path
import shlex
import subprocess


def build() -> Path:
    native = Path(__file__).resolve().parent
    output = native / "build" / "libuniverse_cpu.so"
    output.parent.mkdir(exist_ok=True)
    command = [
        *shlex.split(os.environ.get("CXX", "g++")),
        "-std=c++17", "-O3", "-DNDEBUG", "-fPIC", "-shared",
        "-Wall", "-Wextra", "-Wpedantic",
        str(native / "cpu_bvh.cpp"), "-o", str(output),
    ]
    subprocess.run(command, check=True)
    return output


if __name__ == "__main__":
    print(build())
