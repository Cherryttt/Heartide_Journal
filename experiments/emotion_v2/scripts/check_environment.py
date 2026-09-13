from __future__ import annotations

import argparse
import importlib
import platform
import subprocess
import sys
from pathlib import Path


def module_version(name: str) -> str:
    try:
        module = importlib.import_module(name)
    except Exception as exc:
        return f"MISSING: {exc}"
    return str(getattr(module, "__version__", "installed"))


def nvidia_smi() -> str:
    try:
        result = subprocess.run(["nvidia-smi"], capture_output=True, text=True, check=False, timeout=10)
    except Exception as exc:
        return f"unavailable: {exc}"
    if result.returncode != 0:
        return f"unavailable: {result.stderr.strip() or result.stdout.strip()}"
    return result.stdout.strip()


def build_report() -> str:
    lines = [
        "# Heartide Emotion V2 Environment",
        "",
        f"- Python executable: `{sys.executable}`",
        f"- Python version: `{sys.version.replace(chr(10), ' ')}`",
        f"- Platform: `{platform.platform()}`",
        "",
        "## Packages",
        "",
        "| Package | Version |",
        "|---|---|",
    ]
    for name in ["numpy", "sklearn", "scipy", "jieba", "joblib", "torch", "transformers", "pandas"]:
        lines.append(f"| `{name}` | `{module_version(name)}` |")

    try:
        import torch

        cuda_available = torch.cuda.is_available()
        device_count = torch.cuda.device_count()
        device_name = torch.cuda.get_device_name(0) if cuda_available else "cpu only"
        torch_line = [
            "",
            "## Torch Device",
            "",
            f"- CUDA available: `{cuda_available}`",
            f"- CUDA device count: `{device_count}`",
            f"- Selected device: `{device_name}`",
            f"- Full MacBERT training status: `{'available' if cuda_available else 'blocked_by_cpu_only_environment'}`",
        ]
        lines.extend(torch_line)
    except Exception as exc:
        lines.extend(["", "## Torch Device", "", f"- Torch import failed: `{exc}`"])

    lines.extend(["", "## nvidia-smi", "", "```text", nvidia_smi(), "```", ""])
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(build_report(), encoding="utf-8")
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
