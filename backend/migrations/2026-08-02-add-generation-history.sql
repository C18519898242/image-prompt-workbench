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
