#!/usr/bin/env python3
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "local-assets" / "past-question-images"


def main() -> int:
    if not SOURCE.is_dir():
        raise FileNotFoundError(f"Image directory not found: {SOURCE}")
    images = sorted(SOURCE.glob("*.png"))
    if not images:
        raise FileNotFoundError(f"No PNG images found in {SOURCE}")

    with tempfile.TemporaryDirectory(prefix="past-question-storage-") as temporary_directory:
        upload_directory = Path(temporary_directory) / "images"
        upload_directory.mkdir()
        for image in images:
            encoded_name = image.name.encode("utf-8").hex() + ".png"
            shutil.copyfile(image, upload_directory / encoded_name)
        return subprocess.run(
            [
                "supabase",
                "storage",
                "--experimental",
                "cp",
                "--linked",
                "--recursive",
                "--jobs",
                "4",
                str(upload_directory),
                "ss:///past-question-content",
            ],
            check=False,
        ).returncode


if __name__ == "__main__":
    raise SystemExit(main())
