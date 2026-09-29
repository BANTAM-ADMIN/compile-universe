#!/usr/bin/env python3
"""Build the optional RTX visibility backend (CUDA toolkit + OptiX 7.7+ headers)."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess


def main():
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cuda", type=Path, default=None, help="CUDA toolkit root")
    parser.add_argument("--optix", type=Path, default=None, help="OptiX SDK root or include directory")
    parser.add_argument("--arch", default="compute_75", help="Virtual PTX architecture (default: compute_75)")
    args = parser.parse_args()
    nvcc_found = shutil.which("nvcc")
    cuda_candidates = [args.cuda, os.environ.get("CUDA_HOME"),
                       Path(nvcc_found).resolve().parent.parent if nvcc_found else None,
                       Path("/usr/local/cuda"), Path("/usr/local/cuda-12.4")]
    cuda = next((Path(p) for p in cuda_candidates if p and (Path(p) / "bin/nvcc").is_file()), None)
    if cuda is None:
        parser.error("CUDA toolkit not found; pass --cuda or set CUDA_HOME")
    optix_candidates = [args.optix, os.environ.get("OPTIX_INCLUDE_DIR"),
                        os.environ.get("OPTIX_ROOT"),
                        Path.home() / "NVIDIA-OptiX-SDK-8.0.0-linux64-x86_64",
                        Path.home() / "Desktop/PROJECTAI/dlog3/tau_v2/RT_TAU/owl/3rdParty/optix/include"]
    optix = None
    for candidate in optix_candidates:
        if candidate:
            for directory in (Path(candidate), Path(candidate) / "include"):
                if (directory / "optix.h").is_file():
                    optix = directory
                    break
        if optix:
            break
    if optix is None:
        parser.error("OptiX headers not found; pass --optix or set OPTIX_INCLUDE_DIR")
    cxx = os.environ.get("CXX", "g++")
    build = here / "build"
    build.mkdir(exist_ok=True)
    commands = [
        [str(cuda / "bin/nvcc"), "--ptx", "-std=c++17", "-O3", f"--gpu-architecture={args.arch}",
         "-I", str(optix), "-I", str(here), str(here / "rt_device.cu"),
         "-o", str(build / "rt_device.ptx")],
        [cxx, "-std=c++17", "-O3", "-fPIC", "-shared", "-Wall", "-Wextra",
         "-isystem", str(cuda / "include"), "-isystem", str(optix), str(here / "rt_host.cpp"),
         "-L", str(cuda / "lib64"), f"-Wl,-rpath,{cuda / 'lib64'}", "-lcudart", "-ldl",
         "-o", str(build / "libuniverse_rt.so")],
    ]
    for command in commands:
        print("Building", Path(command[-1]).name, flush=True)
        subprocess.run(command, check=True)
    print(f"Built {build / 'libuniverse_rt.so'}")
    print(f"PTX   {build / 'rt_device.ptx'}")


if __name__ == "__main__":
    main()
