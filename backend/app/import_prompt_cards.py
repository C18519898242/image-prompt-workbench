from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import re
import sqlite3
import sys
from urllib.error import HTTPError
from urllib.parse import (
    SplitResult,
    quote,
    urljoin,
    urlparse,
    urlsplit,
    urlunsplit,
)
from urllib.request import Request, urlopen

from app.prompt_card_repository import PromptCardRepository


DEFAULT_SOURCE_URL = (
    "https://raw.githubusercontent.com/"
    "YouMind-OpenLab/awesome-nano-banana-pro-prompts/"
    "main/README_zh.md"
)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE_PATH = PROJECT_ROOT / "data/app.db"
DEFAULT_IMAGE_DIRECTORY = PROJECT_ROOT / "data/prompt-images"
_CARD_PATTERN = re.compile(r"^###\s+No\.\s*\d+\s*:\s*(.+?)\s*$", re.MULTILINE)
# 兼容「#### 提示词」与上游「#### 📝 提示词」等带 emoji 的标题
_PROMPT_SECTION_PATTERN = re.compile(
    r"^####\s+.*?提示词\s*$([\s\S]*?)(?=^####\s|\Z)",
    re.MULTILINE,
)
_PROMPT_BLOCK_PATTERN = re.compile(r"```[^\r\n]*\r?\n([\s\S]*?)\r?\n?```")
_IMAGE_SECTION_PATTERN = re.compile(
    r"^####\s+.*生成图片.*$([\s\S]*?)(?=^####\s|\Z)",
    re.MULTILINE,
)
_IMAGE_MARKDOWN_PATTERN = re.compile(r"!\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)")
_IMAGE_HTML_PATTERN = re.compile(
    r"""<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']""",
    re.IGNORECASE,
)

@dataclass(frozen=True)
class ParsedPromptCard:
    title: str
    prompt_text: str
    image_urls: tuple[str, ...]


def parse_prompt_cards(markdown: str) -> list[ParsedPromptCard]:
    card_matches = list(_CARD_PATTERN.finditer(markdown))
    cards: list[ParsedPromptCard] = []
    for index, card_match in enumerate(card_matches):
        section_end = (
            card_matches[index + 1].start()
            if index + 1 < len(card_matches)
            else len(markdown)
        )
        section = markdown[card_match.end() : section_end]
        prompt_text = _extract_prompt_text(section)
        image_urls = _extract_image_urls(section)
        cards.append(
            ParsedPromptCard(
                title=card_match.group(1).strip(),
                prompt_text=prompt_text,
                image_urls=image_urls,
            )
        )
    return cards


def import_prompt_cards(
    *,
    source_url: str,
    database_path: str | Path = DEFAULT_DATABASE_PATH,
    image_dir: str | Path = DEFAULT_IMAGE_DIRECTORY,
    progress: bool = True,
) -> int:
    source_url = normalize_source_url(source_url)
    _log(progress, f"正在获取来源：{redact_url_for_log(source_url)}")
    markdown = _fetch_text(source_url)
    cards = parse_prompt_cards(markdown)
    total_cards = len(cards)
    total_images = sum(len(card.image_urls) for card in cards)
    _log(progress, f"已解析 {total_cards} 张卡片，共 {total_images} 张图片")
    database_path = Path(database_path)
    image_dir = Path(image_dir)
    image_dir.mkdir(parents=True, exist_ok=True)
    relative_image_directory = _relative_image_directory(database_path, image_dir)

    connection = sqlite3.connect(database_path)
    try:
        repository = PromptCardRepository(connection)
        imported_count = 0
        downloaded_images = 0
        for card_number, card in enumerate(cards, start=1):
            if not card.prompt_text:
                raise ValueError(f"第 {card_number} 张卡片缺少提示词")
            if not card.image_urls:
                raise ValueError(f"第 {card_number} 张卡片缺少图片")

            image_count = len(card.image_urls)
            _log(
                progress,
                f"[{card_number}/{total_cards}] {card.title}（{image_count} 张图片）",
            )
            image_paths = []
            for image_number, image_url in enumerate(card.image_urls, start=1):
                destination = image_dir / _image_filename(
                    card_number,
                    image_number,
                    image_url,
                )
                resolved_url = urljoin(source_url, image_url)
                downloaded_images += 1
                _log(
                    progress,
                    f"  下载图片 [{downloaded_images}/{total_images}] "
                    f"{image_number}/{image_count} -> {destination.name}",
                )
                _log(progress, f"    {redact_url_for_log(resolved_url)}")
                _download_image(image_url, source_url, destination)
                size_kb = destination.stat().st_size / 1024
                _log(progress, f"    完成 {size_kb:.1f} KB")
                image_paths.append(
                    (relative_image_directory / destination.name).as_posix()
                )

            repository.create_prompt_card(
                title=card.title,
                prompt_text=card.prompt_text,
                example_image_path=image_paths[0],
                sort_order=card_number,
                category_ids=(),
            )
            imported_count += 1
            _log(progress, f"  已写入数据库（第 {imported_count} 张）")
        return imported_count
    finally:
        connection.close()


def _log(progress: bool, message: str) -> None:
    if progress:
        print(message, flush=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.import_prompt_cards",
        description="从远程 README_zh.md 导入提示词卡片并下载图片",
    )
    parser.add_argument(
        "--source-url",
        default=DEFAULT_SOURCE_URL,
        help="远程 README_zh.md 地址",
    )
    parser.add_argument(
        "--database",
        default=str(DEFAULT_DATABASE_PATH),
        help="SQLite 数据库文件路径",
    )
    parser.add_argument(
        "--image-dir",
        default=str(DEFAULT_IMAGE_DIRECTORY),
        help="图片保存目录",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        imported_count = import_prompt_cards(
            source_url=args.source_url,
            database_path=args.database,
            image_dir=args.image_dir,
        )
    except (HTTPError, OSError, sqlite3.Error, ValueError) as error:
        print(f"导入失败：{error}", file=sys.stderr)
        return 1

    print(f"已导入 {imported_count} 张提示词卡片")
    return 0


def _extract_prompt_text(section: str) -> str:
    prompt_section = _PROMPT_SECTION_PATTERN.search(section)
    if prompt_section is None:
        return ""
    prompt_block = _PROMPT_BLOCK_PATTERN.search(prompt_section.group(1))
    if prompt_block is None:
        return ""
    return prompt_block.group(1).strip()


def _extract_image_urls(section: str) -> tuple[str, ...]:
    image_section = _IMAGE_SECTION_PATTERN.search(section)
    if image_section is None:
        return ()
    body = image_section.group(1)
    matches: list[tuple[int, str]] = []
    for match in _IMAGE_MARKDOWN_PATTERN.finditer(body):
        matches.append((match.start(), match.group(1)))
    for match in _IMAGE_HTML_PATTERN.finditer(body):
        matches.append((match.start(), match.group(1)))
    matches.sort(key=lambda item: item[0])
    return tuple(url for _, url in matches)

def _fetch_text(source_url: str) -> str:
    request = Request(
        encode_url(source_url),
        headers={"User-Agent": "ImagePromptWorkbench/1.0"},
    )
    with urlopen(request, timeout=30) as response:
        encoding = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(encoding)


def normalize_source_url(source_url: str) -> str:
    parsed_url = urlparse(source_url)
    path_parts = parsed_url.path.strip("/").split("/")
    if (
        parsed_url.netloc.lower() == "github.com"
        and len(path_parts) >= 5
        and path_parts[2] == "blob"
    ):
        owner, repository, _, branch = path_parts[:4]
        file_path = "/".join(path_parts[4:])
        return (
            f"https://raw.githubusercontent.com/"
            f"{owner}/{repository}/{branch}/{file_path}"
        )
    return source_url


def encode_url(url: str) -> str:
    """将可能含非 ASCII 字符的 IRI 转为 urllib 可请求的 URI。

    - 路径 / 查询 / 片段：百分号编码
    - 主机名：IDNA（如中文域名 → xn--…）
    """
    parts = urlsplit(url)
    return urlunsplit(
        (
            parts.scheme,
            _encode_netloc(parts),
            quote(parts.path, safe="/%"),
            quote(parts.query, safe="=&%"),
            quote(parts.fragment, safe="%"),
        )
    )


def redact_url_for_log(url: str) -> str:
    """进度日志用：去掉 query 与 fragment，避免泄露 token 等敏感参数。"""
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def _encode_netloc(parts: SplitResult) -> str:
    """将 SplitResult 的主机名转为 IDNA ASCII，并保留 userinfo / 端口。"""
    hostname = parts.hostname
    if hostname is None:
        return parts.netloc

    try:
        hostname_idna = hostname.encode("idna").decode("ascii")
    except UnicodeError as error:
        raise ValueError(f"无法将主机名编码为 IDNA：{hostname}") from error

    # IPv6 在 netloc 中需要方括号
    if ":" in hostname_idna:
        host = f"[{hostname_idna}]"
    else:
        host = hostname_idna

    auth = ""
    if parts.username is not None:
        user = quote(parts.username, safe="")
        if parts.password is not None:
            auth = f"{user}:{quote(parts.password, safe='')}@"
        else:
            auth = f"{user}@"

    if parts.port is not None:
        return f"{auth}{host}:{parts.port}"
    return f"{auth}{host}"


def _download_image(image_url: str, source_url: str, destination: Path) -> None:
    resolved_url = urljoin(source_url, image_url)
    request = Request(
        encode_url(resolved_url),
        headers={"User-Agent": "ImagePromptWorkbench/1.0"},
    )
    with urlopen(request, timeout=30) as response:
        destination.write_bytes(response.read())


def _image_filename(card_number: int, image_number: int, image_url: str) -> str:
    suffix = Path(urlparse(image_url).path).suffix.lower()
    if suffix not in {".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"}:
        suffix = ".bin"
    return f"{card_number:04d}-{image_number:02d}{suffix}"


def _relative_image_directory(database_path: Path, image_dir: Path) -> Path:
    try:
        return image_dir.relative_to(database_path.parent)
    except ValueError:
        return Path(image_dir.name)


if __name__ == "__main__":
    raise SystemExit(main())
