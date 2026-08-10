import sqlite3
from pathlib import Path

import pytest

from app.prompt_card_repository import PromptCardInUseError, PromptCardRepository


SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schema.sql"


@pytest.fixture
def repository(tmp_path: Path):
    connection = sqlite3.connect(tmp_path / "app.db")
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    yield PromptCardRepository(connection)
    connection.close()


def test_create_and_get_prompt_card_preserves_image_count(
    repository: PromptCardRepository,
) -> None:
    card_id = repository.create_prompt_card(
        title="多图卡片",
        prompt_text="完整提示词",
        example_image_path="prompt-images/0001-01.jpg",
        image_count=3,
    )

    card = repository.get_prompt_card(card_id)

    assert card is not None
    assert card.image_count == 3


def test_create_prompt_card_defaults_to_one_image(
    repository: PromptCardRepository,
) -> None:
    card_id = repository.create_prompt_card(
        title="单图卡片",
        prompt_text="完整提示词",
        example_image_path="prompt-images/0002-01.png",
    )

    card = repository.get_prompt_card(card_id)

    assert card is not None
    assert card.image_count == 1


def test_create_prompt_card_with_result_returns_committed_card(
    repository: PromptCardRepository,
) -> None:
    card = repository.create_prompt_card_with_result(
        title="原子创建",
        prompt_text="完整提示词",
        example_image_path="prompt-images/atomic-01.jpg",
        image_count=2,
        sort_order=5,
        category_ids=(),
    )

    assert card.title == "原子创建"
    assert card.prompt_text == "完整提示词"
    assert card.example_image_path == "prompt-images/atomic-01.jpg"
    assert card.image_count == 2
    assert card.sort_order == 5
    assert card.category_ids == ()
    assert repository.get_prompt_card(card.id) == card


def test_create_and_get_prompt_card_with_categories(
    repository: PromptCardRepository,
) -> None:
    person_id = repository.create_category("人物")
    scene_id = repository.create_category("场景")

    card_id = repository.create_prompt_card(
        title="电影感人像",
        prompt_text="电影感的人像摄影",
        example_image_path="prompt-images/cinematic.png",
        sort_order=3,
        category_ids=[person_id, scene_id],
    )

    card = repository.get_prompt_card(card_id)

    assert card is not None
    assert card.id == card_id
    assert card.title == "电影感人像"
    assert card.prompt_text == "电影感的人像摄影"
    assert card.example_image_path == "prompt-images/cinematic.png"
    assert card.sort_order == 3
    assert card.category_ids == (person_id, scene_id)


def test_list_prompt_cards_orders_and_filters_by_category(
    repository: PromptCardRepository,
) -> None:
    person_id = repository.create_category("人物")
    scene_id = repository.create_category("场景")
    first_id = repository.create_prompt_card(
        title="场景卡片",
        prompt_text="场景提示词",
        example_image_path="prompt-images/scene.png",
        sort_order=2,
        category_ids=[scene_id],
    )
    second_id = repository.create_prompt_card(
        title="人物卡片",
        prompt_text="人物提示词",
        example_image_path="prompt-images/person.png",
        sort_order=1,
        category_ids=[person_id],
    )

    assert [card.id for card in repository.list_prompt_cards()] == [
        second_id,
        first_id,
    ]
    assert [card.id for card in repository.list_prompt_cards(person_id)] == [
        second_id
    ]


def test_update_prompt_card_replaces_categories(
    repository: PromptCardRepository,
) -> None:
    old_category_id = repository.create_category("旧分类")
    new_category_id = repository.create_category("新分类")
    card_id = repository.create_prompt_card(
        title="旧标题",
        prompt_text="旧提示词",
        example_image_path="prompt-images/old.png",
        category_ids=[old_category_id],
    )

    updated = repository.update_prompt_card(
        card_id,
        title="新标题",
        prompt_text="新提示词",
        example_image_path="prompt-images/new.png",
        sort_order=4,
        category_ids=[new_category_id],
    )
    card = repository.get_prompt_card(card_id)

    assert updated is True
    assert card is not None
    assert card.title == "新标题"
    assert card.prompt_text == "新提示词"
    assert card.example_image_path == "prompt-images/new.png"
    assert card.sort_order == 4
    assert card.category_ids == (new_category_id,)


def test_update_prompt_card_content_preserves_sort_and_categories(repository):
    category_id = repository.create_category("人物")
    card_id = repository.create_prompt_card(
        title="旧标题",
        prompt_text="旧提示词",
        example_image_path="prompt-images/old-01.jpg",
        image_count=2,
        sort_order=7,
        category_ids=[category_id],
    )

    updated = repository.update_prompt_card_content(
        card_id,
        title="新标题",
        prompt_text="新提示词",
        example_image_path="prompt-images/new-01.png",
        image_count=3,
    )

    card = repository.get_prompt_card(card_id)
    assert updated is True
    assert card is not None
    assert (card.title, card.prompt_text) == ("新标题", "新提示词")
    assert card.example_image_path == "prompt-images/new-01.png"
    assert card.image_count == 3
    assert card.sort_order == 7
    assert card.category_ids == (category_id,)


def test_update_prompt_card_content_with_result_preserves_metadata(repository):
    category_id = repository.create_category("保留分类")
    card_id = repository.create_prompt_card(
        title="旧标题",
        prompt_text="旧提示词",
        example_image_path="prompt-images/old-01.jpg",
        image_count=2,
        sort_order=8,
        category_ids=[category_id],
    )

    card = repository.update_prompt_card_content_with_result(
        card_id,
        title="新标题",
        prompt_text="新提示词",
        example_image_path="prompt-images/new-01.png",
        image_count=3,
    )

    assert card is not None
    assert card.id == card_id
    assert card.title == "新标题"
    assert card.prompt_text == "新提示词"
    assert card.example_image_path == "prompt-images/new-01.png"
    assert card.image_count == 3
    assert card.sort_order == 8
    assert card.category_ids == (category_id,)
    assert repository.get_prompt_card(card_id) == card


def test_update_prompt_card_content_with_result_returns_none_for_missing_card(
    repository: PromptCardRepository,
) -> None:
    assert repository.update_prompt_card_content_with_result(
        999,
        title="标题",
        prompt_text="提示词",
        example_image_path="prompt-images/missing-01.jpg",
        image_count=1,
    ) is None


def test_delete_prompt_card_with_generation_history_raises(repository):
    card_id = repository.create_prompt_card(
        title="已使用卡片",
        prompt_text="提示词",
        example_image_path="prompt-images/used-01.jpg",
    )
    repository._connection.execute(
        "INSERT INTO generation_history "
        "(prompt_card_id, image_path, model, aspect_ratio, resolution) "
        "VALUES (?, ?, ?, ?, ?)",
        (card_id, "generated/1.png", "model", "1:1", "1K"),
    )
    repository._connection.commit()

    with pytest.raises(PromptCardInUseError):
        repository.delete_prompt_card(card_id)

    assert repository.get_prompt_card(card_id) is not None

def test_update_and_delete_missing_card_return_false(
    repository: PromptCardRepository,
) -> None:
    assert repository.update_prompt_card(
        999,
        title="标题",
        prompt_text="提示词",
        example_image_path="prompt-images/example.png",
        sort_order=0,
        category_ids=[],
    ) is False
    assert repository.delete_prompt_card(999) is False
    assert repository.get_prompt_card(999) is None


def test_delete_prompt_card_removes_category_links(
    repository: PromptCardRepository,
) -> None:
    category_id = repository.create_category("人物")
    card_id = repository.create_prompt_card(
        title="卡片",
        prompt_text="提示词",
        example_image_path="prompt-images/example.png",
        category_ids=[category_id],
    )

    assert repository.delete_prompt_card(card_id) is True
    assert repository.get_prompt_card(card_id) is None
    assert repository.list_prompt_cards() == []


def test_list_categories_orders_by_sort_order(
    repository: PromptCardRepository,
) -> None:
    late_id = repository.create_category("后分类", sort_order=2)
    early_id = repository.create_category("前分类", sort_order=1)

    categories = repository.list_categories()

    assert [category.id for category in categories] == [early_id, late_id]


def test_category_can_be_read_updated_and_deleted(
    repository: PromptCardRepository,
) -> None:
    category_id = repository.create_category("旧分类", sort_order=2)

    category = repository.get_category(category_id)
    updated = repository.update_category(
        category_id,
        name="新分类",
        sort_order=1,
    )
    updated_category = repository.get_category(category_id)
    deleted = repository.delete_category(category_id)

    assert category is not None
    assert category.name == "旧分类"
    assert category.sort_order == 2
    assert updated is True
    assert updated_category is not None
    assert updated_category.name == "新分类"
    assert updated_category.sort_order == 1
    assert deleted is True
    assert repository.get_category(category_id) is None
