PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS prompt_cards (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    prompt_text TEXT NOT NULL,
    example_image_path TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    image_count INTEGER NOT NULL DEFAULT 1 CHECK (image_count > 0),
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

CREATE TABLE IF NOT EXISTS generation_history (
    id INTEGER PRIMARY KEY,
    prompt_card_id INTEGER NOT NULL,
    image_path TEXT NOT NULL,
    model TEXT NOT NULL,
    aspect_ratio TEXT NOT NULL,
    resolution TEXT NOT NULL,
    created_at INTEGER NOT NULL
        DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
    FOREIGN KEY (prompt_card_id)
        REFERENCES prompt_cards(id)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_generation_history_prompt_card
ON generation_history(prompt_card_id);
