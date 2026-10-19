ALTER TABLE store_transfer_manual_item_facts
ADD COLUMN physical_inventory REAL NOT NULL DEFAULT 0 CHECK (physical_inventory >= 0);

ALTER TABLE store_transfer_manual_item_facts
ADD COLUMN pending_submitted_quantity REAL NOT NULL DEFAULT 0 CHECK (pending_submitted_quantity >= 0);

ALTER TABLE store_transfer_manual_item_facts
ADD COLUMN in_transit_quantity REAL NOT NULL DEFAULT 0 CHECK (in_transit_quantity >= 0);

ALTER TABLE store_transfer_manual_item_facts
ADD COLUMN current_quantity REAL NOT NULL DEFAULT 0 CHECK (current_quantity >= 0);

ALTER TABLE store_transfer_manual_item_facts
ADD COLUMN local_sales_42 REAL NOT NULL DEFAULT 0 CHECK (local_sales_42 >= 0);

ALTER TABLE store_transfer_manual_item_facts
ADD COLUMN b3_sales_42 REAL NOT NULL DEFAULT 0 CHECK (b3_sales_42 >= 0);

ALTER TABLE store_transfer_manual_item_facts
ADD COLUMN target_quantity REAL NOT NULL DEFAULT 0 CHECK (target_quantity >= 0);

ALTER TABLE store_transfer_manual_item_facts
ADD COLUMN display_quantity REAL NOT NULL DEFAULT 0 CHECK (display_quantity >= 0);

ALTER TABLE store_transfer_manual_item_facts
ADD COLUMN current_arrival_date TEXT NOT NULL DEFAULT '';

ALTER TABLE store_transfer_manual_item_facts
ADD COLUMN next_arrival_date TEXT NOT NULL DEFAULT '';

ALTER TABLE store_transfer_manual_item_facts
ADD COLUMN pre_arrival_stockout_risk INTEGER NOT NULL DEFAULT 0 CHECK (pre_arrival_stockout_risk IN (0, 1));
