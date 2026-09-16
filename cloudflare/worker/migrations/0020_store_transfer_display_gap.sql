ALTER TABLE store_transfer_items
ADD COLUMN display_gap INTEGER NOT NULL DEFAULT 0
CHECK (display_gap >= 0);
