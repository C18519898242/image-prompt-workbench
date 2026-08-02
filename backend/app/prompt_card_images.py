from pathlib import Path

_SUPPORTED_EXTENSIONS = {".jpg", ".png"}


def derive_image_paths(
    example_image_path: str,
    image_count: int,
    image_directory: Path,
) -> list[Path]:
    count = int(image_count)
    if count < 1:
        raise ValueError("image_count must be positive")

    first_name = Path(example_image_path).name
    first_path = Path(first_name)
    prefix, separator, first_index = first_path.stem.rpartition("-")
    if separator != "-" or first_index != "01":
        raise ValueError("example_image_path must end with -01")

    suffix = first_path.suffix.lower()
    if suffix not in _SUPPORTED_EXTENSIONS:
        raise ValueError("unsupported image extension")

    return [
        image_directory / f"{prefix}-{index:02d}{suffix}"
        for index in range(1, count + 1)
    ]


def get_image_media_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".jpg":
        return "image/jpeg"
    if suffix == ".png":
        return "image/png"
    raise ValueError("unsupported image extension")
