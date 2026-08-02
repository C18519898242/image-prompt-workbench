from pathlib import Path

_SUPPORTED_EXTENSIONS = {".jpg", ".png"}
# 与前端 Vite / 生产 Nginx 挂载的公开前缀一致：/media → data/
MEDIA_URL_PREFIX = "/media"


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


def build_public_image_refs(
    example_image_path: str,
    image_count: int,
) -> list[tuple[int, str, str]]:
    """根据首图相对路径与数量，生成 (序号, 相对路径, 公开 URL)。

    相对路径相对于 data/ 根，例如 prompt-images/0001-01.jpg。
    公开 URL 形如 /media/prompt-images/0001-01.jpg，由 Vite 或 Nginx 映射到磁盘。
    """
    relative_parent = Path(example_image_path).parent
    file_paths = derive_image_paths(example_image_path, image_count, Path("."))
    refs: list[tuple[int, str, str]] = []
    for index, file_path in enumerate(file_paths, start=1):
        relative_path = (relative_parent / file_path.name).as_posix().lstrip("./")
        public_url = f"{MEDIA_URL_PREFIX}/{relative_path}"
        refs.append((index, relative_path, public_url))
    return refs


def get_image_media_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".jpg":
        return "image/jpeg"
    if suffix == ".png":
        return "image/png"
    raise ValueError("unsupported image extension")
