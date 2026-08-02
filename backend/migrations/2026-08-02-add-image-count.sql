ALTER TABLE prompt_cards
ADD COLUMN image_count INTEGER NOT NULL DEFAULT 1
CHECK (image_count > 0);
