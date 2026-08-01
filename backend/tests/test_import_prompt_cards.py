import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import sqlite3
from pathlib import Path
from threading import Thread

import pytest

from app.import_prompt_cards import (
    import_prompt_cards,
    normalize_source_url,
    parse_prompt_cards,
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
    assert (image_dir / "0001-01.png").read_bytes() == b"png-one"
    assert (image_dir / "0001-02.jpg").read_bytes() == b"jpg-two"
    assert category_count == 0
