ALTER TABLE store_transfer_manual_item_facts
ADD COLUMN auto_excluded INTEGER NOT NULL DEFAULT 0 CHECK (auto_excluded IN (0, 1));

ALTER TABLE store_transfer_manual_item_facts
ADD COLUMN exclusion_reason TEXT NOT NULL DEFAULT '' CHECK (length(exclusion_reason) <= 500);

ALTER TABLE store_transfer_batch_product_catalog
ADD COLUMN auto_exclusions TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(auto_exclusions));
