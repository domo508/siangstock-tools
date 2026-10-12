ALTER TABLE store_transfer_manual_item_facts
ADD COLUMN hq_available INTEGER CHECK (hq_available >= 0);

ALTER TABLE store_transfer_manual_item_facts
ADD COLUMN hq_reserve INTEGER CHECK (hq_reserve >= 0);

ALTER TABLE store_transfer_manual_item_facts
ADD COLUMN hq_releasable INTEGER CHECK (hq_releasable >= 0);

ALTER TABLE store_transfer_batch_product_catalog
ADD COLUMN hq_available INTEGER CHECK (hq_available >= 0);

ALTER TABLE store_transfer_batch_product_catalog
ADD COLUMN hq_reserve INTEGER CHECK (hq_reserve >= 0);

ALTER TABLE store_transfer_batch_product_catalog
ADD COLUMN hq_releasable INTEGER CHECK (hq_releasable >= 0);
