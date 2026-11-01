#!/usr/bin/env python3
import sys
from pathlib import Path, PurePosixPath
from tempfile import NamedTemporaryFile
from zipfile import BadZipFile, ZipFile


ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "local-assets" / "past-question-images"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_FILES = 1000
MAX_FILE_SIZE = 5 * 1024 * 1024
MAX_TOTAL_SIZE = 150 * 1024 * 1024


def decode_name(name: str) -> str:
    try:
        return name.encode("cp437").decode("utf-8")
    except UnicodeError:
        return name


def main() -> int:
    arguments = sys.argv[1:]
    replace_existing = "--replace" in arguments
    arguments = [argument for argument in arguments if argument != "--replace"]
    if len(arguments) != 1:
        print(f"Usage: {Path(sys.argv[0]).name} [--replace] path/to/images.zip", file=sys.stderr)
        return 2

    archive_path = Path(arguments[0]).expanduser().resolve()
    if not archive_path.is_file():
        print(f"Archive not found: {archive_path}", file=sys.stderr)
        return 2

    DESTINATION.mkdir(parents=True, exist_ok=True)
    imported = 0
    skipped = 0
    total_size = 0
    names: set[str] = set()

    try:
        with ZipFile(archive_path) as archive:
            for entry in archive.infolist():
                if entry.is_dir():
                    continue
                name = decode_name(entry.filename).replace("\\", "/")
                path = PurePosixPath(name)
                if path.is_absolute() or ".." in path.parts:
                    raise ValueError(f"Unsafe archive path: {entry.filename}")
                if "__MACOSX" in path.parts or path.name.startswith("._"):
                    skipped += 1
                    continue
                if path.suffix.lower() != ".png":
                    skipped += 1
                    continue
                if entry.file_size > MAX_FILE_SIZE:
                    raise ValueError(f"Image exceeds the 5 MB limit: {path.name}")

                file_name = path.name
                if file_name in names:
                    raise ValueError(f"Duplicate image filename: {file_name}")
                names.add(file_name)
                total_size += entry.file_size
                if len(names) > MAX_FILES or total_size > MAX_TOTAL_SIZE:
                    raise ValueError("Archive exceeds the import limits (1000 images / 150 MB).")

                image = archive.read(entry)
                if not image.startswith(PNG_SIGNATURE):
                    raise ValueError(f"Invalid PNG file: {file_name}")

                destination = DESTINATION / file_name
                if destination.is_symlink():
                    raise ValueError(f"Refusing to overwrite a symbolic link: {destination}")
                if destination.exists():
                    if not replace_existing and destination.read_bytes() != image:
                        raise FileExistsError(f"Different image already exists: {destination}")
                    if destination.read_bytes() == image:
                        skipped += 1
                        continue

                with NamedTemporaryFile(dir=DESTINATION, prefix=".image-import-", delete=False) as output:
                    temporary = Path(output.name)
                    output.write(image)
                temporary.replace(destination)
                imported += 1
    except (BadZipFile, OSError, ValueError) as error:
        print(f"Import failed: {error}", file=sys.stderr)
        return 1

    action = "Imported/replaced" if replace_existing else "Imported"
    print(f"{action} {imported} images ({total_size:,} uncompressed bytes) in {DESTINATION}")
    print(f"Skipped {skipped} metadata/unsupported/unchanged entries.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
