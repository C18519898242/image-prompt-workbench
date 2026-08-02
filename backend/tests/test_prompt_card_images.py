from pathlib import Path

import pytest

from app.prompt_card_images import derive_image_paths, get_image_media_type


def test_derive_image_paths_uses_first_extension(tmp_path: Path) -> None:
    paths = derive_image_paths(
        "prompt-images/0001-01.jpg",
        2,
        tmp_path,
    )

    assert paths == [
        tmp_path / "0001-01.jpg",
        tmp_path / "0001-02.jpg",
    ]


def test_derive_image_paths_rejects_non_positive_count(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="image_count"):
        derive_image_paths("prompt-images/0001-01.jpg", 0, tmp_path)


def test_derive_image_paths_rejects_unsupported_extension(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="unsupported image extension"):
        derive_image_paths("prompt-images/0001-01.webp", 1, tmp_path)


def test_get_image_media_type_for_jpg_and_png(tmp_path: Path) -> None:
    assert get_image_media_type(tmp_path / "a.jpg") == "image/jpeg"
    assert get_image_media_type(tmp_path / "b.png") == "image/png"
