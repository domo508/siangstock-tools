ALTER TABLE store_transfer_items
ADD COLUMN decision_snapshot TEXT NOT NULL DEFAULT '{}'
CHECK (length(decision_snapshot) <= 2000);
