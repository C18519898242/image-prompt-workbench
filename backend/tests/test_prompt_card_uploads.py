from io import BytesIO

import pytest
from PIL import Image

import app.prompt_card_uploads as uploads_module
from app.prompt_card_uploads import (
    ExistingSelection,
    IncomingImage,
    PromptCardValidationError,
    UploadSelection,
    parse_image_manifest,
    prepare_final_images,
)


def image_bytes(format_name: str, color=(255, 0, 0, 255)) -> bytes:
    mode = "RGBA" if format_name == "PNG" else "RGB"
    image = Image.new(mode, (4, 4), color if mode == "RGBA" else color[:3])
    output = BytesIO()
    image.save(output, format=format_name)
    return output.getvalue()


def test_parse_image_manifest_accepts_mixed_order():
    result = parse_image_manifest(
        '[{"kind":"existing","image_index":2},'
        '{"kind":"upload","file_index":0}]'
    )
    assert result == (ExistingSelection(2), UploadSelection(0))


@pytest.mark.parametrize(
    "raw",
    [
        "not-json",
        "{}",
        "[]",
        '[{"kind":"existing","image_index":1},'
        '{"kind":"existing","image_index":1}]',
        '[{"kind":"upload","file_index":-1}]',
    ],
)
def test_parse_image_manifest_rejects_invalid_shape(raw):
    with pytest.raises(PromptCardValidationError) as captured:
        parse_image_manifest(raw)
    assert captured.value.code in {"invalid_manifest", "empty_images"}


def test_prepare_final_images_keeps_all_jpeg():
    uploads = [IncomingImage("one.jpg", image_bytes("JPEG"))]
    result = prepare_final_images((UploadSelection(0),), {}, uploads)
    assert result.extension == ".jpg"
    assert result.contents == (uploads[0].content,)


def test_prepare_final_images_converts_mixed_input_to_png():
    uploads = [
        IncomingImage("one.jpg", image_bytes("JPEG")),
        IncomingImage("two.png", image_bytes("PNG")),
    ]
    result = prepare_final_images(
        (UploadSelection(0), UploadSelection(1)), {}, uploads
    )
    assert result.extension == ".png"
    for content in result.contents:
        with Image.open(BytesIO(content)) as image:
            image.verify()
            assert image.format == "PNG"


def test_prepare_final_images_converts_decompression_bomb_to_validation_error(monkeypatch):
    def raise_decompression_bomb(*args, **kwargs):
        raise Image.DecompressionBombError("图片像素数过大")

    monkeypatch.setattr(uploads_module.Image, "open", raise_decompression_bomb)
    with pytest.raises(PromptCardValidationError) as captured:
        prepare_final_images(
            (UploadSelection(0),), {}, [IncomingImage("one.jpg", b"content")]
        )
    assert captured.value.code == "invalid_image"


def test_prepare_final_images_converts_real_decompression_bomb_warning(
    monkeypatch,
):
    content = image_bytes("JPEG")
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 8)
    monkeypatch.setattr(
        uploads_module,
        "MAX_ALLOWED_IMAGE_PIXELS",
        100,
        raising=False,
    )

    with pytest.raises(PromptCardValidationError) as captured:
        prepare_final_images(
            (UploadSelection(0),),
            {},
            [IncomingImage("warning.jpg", content)],
        )

    assert captured.value.code == "invalid_image"


@pytest.mark.parametrize(
    ("constant_name", "limit"),
    (
        ("MAX_IMAGE_WIDTH", 3),
        ("MAX_IMAGE_HEIGHT", 3),
        ("MAX_ALLOWED_IMAGE_PIXELS", 15),
    ),
)
def test_encode_png_rejects_real_image_dimensions_before_loading(
    monkeypatch,
    constant_name,
    limit,
):
    content = image_bytes("PNG")
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", None)
    monkeypatch.setattr(uploads_module, constant_name, limit, raising=False)

    with pytest.raises(PromptCardValidationError) as captured:
        uploads_module._encode_png(content)

    assert captured.value.code == "invalid_image"


def test_encode_png_converts_decompression_bomb_to_validation_error(monkeypatch):
    def raise_decompression_bomb(*args, **kwargs):
        raise Image.DecompressionBombError("图片像素数过大")

    monkeypatch.setattr(uploads_module.Image, "open", raise_decompression_bomb)
    with pytest.raises(PromptCardValidationError) as captured:
        uploads_module._encode_png(b"content")
    assert captured.value.code == "invalid_image"


def test_prepare_final_images_rejects_fake_jpeg():
    with pytest.raises(PromptCardValidationError) as captured:
        prepare_final_images(
            (UploadSelection(0),), {}, [IncomingImage("fake.jpg", b"not-image")]
        )
    assert captured.value.code == "invalid_image"


def test_prepare_final_images_rejects_single_file_limit(monkeypatch):
    monkeypatch.setattr(uploads_module, "MAX_IMAGE_BYTES", 3)
    with pytest.raises(PromptCardValidationError) as captured:
        prepare_final_images(
            (UploadSelection(0),), {}, [IncomingImage("large.jpg", b"1234")]
        )
    assert captured.value.code == "image_too_large"


def test_prepare_final_images_rejects_total_limit(monkeypatch):
    first = IncomingImage("one.jpg", image_bytes("JPEG"))
    second = IncomingImage("two.jpg", image_bytes("JPEG"))
    monkeypatch.setattr(
        uploads_module,
        "MAX_TOTAL_UPLOAD_BYTES",
        len(first.content) + len(second.content) - 1,
    )
    with pytest.raises(PromptCardValidationError) as captured:
        prepare_final_images(
            (UploadSelection(0), UploadSelection(1)), {}, [first, second]
        )
    assert captured.value.code == "total_too_large"


def test_prepare_final_images_rejects_count_limit(monkeypatch):
    monkeypatch.setattr(uploads_module, "MAX_IMAGE_COUNT", 1)
    with pytest.raises(PromptCardValidationError) as captured:
        prepare_final_images(
            (UploadSelection(0), UploadSelection(1)),
            {},
            [IncomingImage("one.jpg", b"x"), IncomingImage("two.jpg", b"y")],
        )
    assert captured.value.code == "too_many_images"


@pytest.mark.parametrize(
    ("selections", "existing", "uploads"),
    [
        ((ExistingSelection(2),), {1: image_bytes("JPEG")}, []),
        ((UploadSelection(1),), {}, [IncomingImage("one.jpg", image_bytes("JPEG"))]),
        (
            (UploadSelection(0),),
            {},
            [
                IncomingImage("one.jpg", image_bytes("JPEG")),
                IncomingImage("unused.jpg", image_bytes("JPEG")),
            ],
        ),
    ],
)
def test_prepare_final_images_rejects_missing_references(selections, existing, uploads):
    with pytest.raises(PromptCardValidationError) as captured:
        prepare_final_images(selections, existing, uploads)
    assert captured.value.code == "invalid_manifest"
