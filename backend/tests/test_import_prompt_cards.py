import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import sqlite3
from pathlib import Path
from threading import Thread

import pytest

from app.import_prompt_cards import (
    encode_url,
    import_prompt_cards,
    normalize_source_url,
    parse_prompt_cards,
    redact_url_for_log,
)
from app.prompt_card_repository import PromptCardRepository


SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schema.sql"


@pytest.fixture
def remote_readme(tmp_path: Path):
    site_dir = tmp_path / "site"
    image_dir = site_dir / "public" / "images"
    image_dir.mkdir(parents=True)
    (image_dir / "one.png").write_bytes(b"png-one")
    (image_dir / "two.jpg").write_bytes(b"jpg-two")
    (site_dir / "README_zh.md").write_text(
        """### No. 1: 远程卡片
#### 提示词
```
远程提示词
```
#### 生成图片
![图片一](public/images/one.png)
![图片二](public/images/two.jpg)
""",
        encoding="utf-8",
    )

    handler = functools.partial(SimpleHTTPRequestHandler, directory=site_dir)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/README_zh.md"
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


def test_parse_prompt_cards_reads_title_prompt_and_all_images() -> None:
    markdown = """### No. 1: 测试卡片
#### 提示词
```
这是提示词内容
第二行
```
#### 生成图片
![图片一](images/one.png)
![图片二](images/two.jpg)
"""

    cards = parse_prompt_cards(markdown)

    assert len(cards) == 1
    assert cards[0].title == "测试卡片"
    assert cards[0].prompt_text == "这是提示词内容\n第二行"
    assert cards[0].image_urls == ("images/one.png", "images/two.jpg")


def test_parse_prompt_cards_accepts_emoji_headings_and_html_images() -> None:
    """上游 README 现用「#### 📝 提示词」标题，示例图为 HTML <img>。"""
    markdown = """### No. 1: 带肖像的宽引言卡
![Language-ZH](https://img.shields.io/badge/Language-ZH-blue)

#### 📖 描述

一段描述文字。

#### 📝 提示词

```
一张宽幅引言卡片
第二行
```

#### 🖼️ 生成图片

##### Image 1

<div align="center">
<img src="https://cdn.example.com/one.jpg" width="700" alt="Image 1">
</div>

##### Image 2

<div align="center">
<img src='https://cdn.example.com/two.png' width="700" alt="Image 2">
</div>

#### 📌 详情

- **作者:** Someone
"""

    cards = parse_prompt_cards(markdown)

    assert len(cards) == 1
    assert cards[0].title == "带肖像的宽引言卡"
    assert cards[0].prompt_text == "一张宽幅引言卡片\n第二行"
    assert cards[0].image_urls == (
        "https://cdn.example.com/one.jpg",
        "https://cdn.example.com/two.png",
    )


def test_normalize_source_url_accepts_github_blob_url() -> None:
    source_url = (
        "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts/"
        "blob/main/README_zh.md"
    )

    assert normalize_source_url(source_url) == (
        "https://raw.githubusercontent.com/"
        "YouMind-OpenLab/awesome-nano-banana-pro-prompts/"
        "main/README_zh.md"
    )


def test_encode_url_percent_encodes_non_ascii_path() -> None:
    source_url = "https://raw.githubusercontent.com/用户/仓库/main/README_zh.md"

    assert encode_url(source_url) == (
        "https://raw.githubusercontent.com/"
        "%E7%94%A8%E6%88%B7/%E4%BB%93%E5%BA%93/main/README_zh.md"
    )


def test_encode_url_does_not_double_encode_existing_percent_sequences() -> None:
    source_url = (
        "https://raw.githubusercontent.com/"
        "%E7%94%A8%E6%88%B7/repo/main/README_zh.md"
    )

    assert encode_url(source_url) == source_url


def test_encode_url_idna_encodes_non_ascii_hostname() -> None:
    source_url = "https://例子.测试/文档/README.md?token=secret#section"

    encoded = encode_url(source_url)

    assert encoded == (
        "https://xn--fsqu00a.xn--0zwm56d/"
        "%E6%96%87%E6%A1%A3/README.md?token=secret#section"
    )
    assert all(ord(char) < 128 for char in encoded)


def test_encode_url_idna_preserves_port_and_userinfo() -> None:
    source_url = "https://user:pass@例子.测试:8443/path"

    assert encode_url(source_url) == (
        "https://user:pass@xn--fsqu00a.xn--0zwm56d:8443/path"
    )


def test_redact_url_for_log_strips_query_and_fragment() -> None:
    source_url = (
        "https://cdn.example.com/images/one.jpg"
        "?token=super-secret&sig=abc#frag"
    )

    assert redact_url_for_log(source_url) == (
        "https://cdn.example.com/images/one.jpg"
    )


def test_import_fetches_readme_with_non_ascii_url_path(tmp_path: Path) -> None:
    """Regression: urllib raises UnicodeEncodeError on non-ASCII URL paths."""
    site_dir = tmp_path / "site"
    doc_dir = site_dir / "文档"
    image_dir = doc_dir / "public" / "images"
    image_dir.mkdir(parents=True)
    (image_dir / "one.png").write_bytes(b"png-one")
    (doc_dir / "README_zh.md").write_text(
        """### No. 1: 远程卡片
#### 提示词
```
远程提示词
```
#### 生成图片
![图片一](public/images/one.png)
""",
        encoding="utf-8",
    )

    handler = functools.partial(SimpleHTTPRequestHandler, directory=site_dir)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        source_url = (
            f"http://127.0.0.1:{server.server_port}/文档/README_zh.md"
        )
        database_path = tmp_path / "data" / "app.db"
        database_path.parent.mkdir()
        connection = sqlite3.connect(database_path)
        connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        connection.close()
        prompt_image_dir = tmp_path / "data" / "prompt-images"

        imported_count = import_prompt_cards(
            source_url=source_url,
            database_path=database_path,
            image_dir=prompt_image_dir,
        )
    finally:
        server.shutdown()
        thread.join()
        server.server_close()

    assert imported_count == 1
    assert (prompt_image_dir / "0001-01.png").read_bytes() == b"png-one"


def test_import_fetches_remote_readme_downloads_images_and_skips_categories(
    remote_readme: str,
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "data" / "app.db"
    database_path.parent.mkdir()
    connection = sqlite3.connect(database_path)
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    connection.close()
    image_dir = tmp_path / "data" / "prompt-images"

    imported_count = import_prompt_cards(
        source_url=remote_readme,
        database_path=database_path,
        image_dir=image_dir,
    )

    repository_connection = sqlite3.connect(database_path)
    card = PromptCardRepository(repository_connection).get_prompt_card(1)
    category_count = repository_connection.execute(
        "SELECT COUNT(*) FROM categories"
    ).fetchone()[0]
    repository_connection.close()

    assert imported_count == 1
    assert card is not None
    assert card.title == "远程卡片"
    assert card.category_ids == ()
    assert card.example_image_path == "prompt-images/0001-01.png"
    assert card.image_count == 2
    assert (image_dir / "0001-01.png").read_bytes() == b"png-one"
    assert (image_dir / "0001-02.jpg").read_bytes() == b"jpg-two"
    assert category_count == 0


def test_import_warns_on_mixed_image_extensions(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    site_dir = tmp_path / "site"
    image_dir = site_dir / "public" / "images"
    image_dir.mkdir(parents=True)
    (image_dir / "one.jpg").write_bytes(b"jpg-one")
    (image_dir / "two.png").write_bytes(b"png-two")
    (site_dir / "README_zh.md").write_text(
        """### No. 1: 混合扩展名卡片
#### 提示词
```
混合提示词
```
#### 生成图片
![图片一](public/images/one.jpg)
![图片二](public/images/two.png)
""",
        encoding="utf-8",
    )

    handler = functools.partial(SimpleHTTPRequestHandler, directory=site_dir)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        source_url = f"http://127.0.0.1:{server.server_port}/README_zh.md"
        database_path = tmp_path / "data" / "app.db"
        database_path.parent.mkdir()
        connection = sqlite3.connect(database_path)
        connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        connection.close()
        prompt_image_dir = tmp_path / "data" / "prompt-images"

        with caplog.at_level("WARNING"):
            imported_count = import_prompt_cards(
                source_url=source_url,
                database_path=database_path,
                image_dir=prompt_image_dir,
                progress=False,
            )
    finally:
        server.shutdown()
        thread.join()
        server.server_close()

    assert imported_count == 1
    assert "第 1 张卡片图片扩展名不一致" in caplog.text
