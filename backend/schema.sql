PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS prompt_cards (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    prompt_text TEXT NOT NULL,
    example_image_path TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS prompt_card_categories (
    prompt_card_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    PRIMARY KEY (prompt_card_id, category_id),
    FOREIGN KEY (prompt_card_id)
        REFERENCES prompt_cards(id)
        ON DELETE CASCADE,
    FOREIGN KEY (category_id)
        REFERENCES categories(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_prompt_card_categories_category
ON prompt_card_categories(category_id, prompt_card_id);
