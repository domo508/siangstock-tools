-- New-product first allocations are independent of weekly shortages and ERP.
CREATE TABLE new_product_registry (
 sku TEXT PRIMARY KEY, name TEXT NOT NULL, listed_date TEXT NOT NULL,
 registered_at TEXT NOT NULL, registered_by TEXT NOT NULL,
 first_stock_seen_at TEXT, first_stock_date TEXT
);
CREATE TABLE new_product_plans (
 id TEXT PRIMARY KEY, procurement_batch_id TEXT NOT NULL UNIQUE REFERENCES procurement_batches(id),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 status TEXT NOT NULL DEFAULT 'pending_purchase' CHECK(status IN ('pending_purchase','store_confirmation','waiting_stock')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
);
CREATE TABLE new_product_plan_rows (
 plan_id TEXT NOT NULL REFERENCES new_product_plans(id), store_code TEXT NOT NULL,
 sku TEXT NOT NULL REFERENCES new_product_registry(sku), name TEXT NOT NULL,
 reference_daily REAL NOT NULL DEFAULT 0 CHECK(reference_daily>=0),
 suggested_quantity INTEGER NOT NULL CHECK(suggested_quantity>=0),
 confirmed_quantity INTEGER CHECK(confirmed_quantity>=0), approved_quantity INTEGER CHECK(approved_quantity>=0),
 archived_dispatched_quantity INTEGER NOT NULL DEFAULT 0 CHECK(archived_dispatched_quantity>=0),
 store_reason TEXT NOT NULL DEFAULT '', hq_reason TEXT NOT NULL DEFAULT '',
 evidence TEXT NOT NULL, PRIMARY KEY(plan_id,store_code,sku), UNIQUE(store_code,sku)
);
CREATE TABLE new_product_store_status (
 plan_id TEXT NOT NULL REFERENCES new_product_plans(id), store_code TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','saved','submitted')),
 PRIMARY KEY(plan_id,store_code)
);
CREATE TABLE new_product_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id TEXT NOT NULL REFERENCES new_product_plans(id),
 action TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL
);
CREATE TABLE new_product_transfer_claims (
 batch_id TEXT NOT NULL REFERENCES store_transfer_batches(id), plan_id TEXT NOT NULL REFERENCES new_product_plans(id),
 store_code TEXT NOT NULL, sku TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0),
 PRIMARY KEY(batch_id,plan_id,store_code,sku)
);
CREATE INDEX new_product_rows_sku ON new_product_plan_rows(sku,store_code);
CREATE VIEW new_product_claim_usage AS
 SELECT c.batch_id,c.plan_id,c.store_code,c.sku,MIN(c.quantity,COALESCE(i.hq_approved_quantity,i.store_confirmed_quantity,i.suggested_quantity)) quantity,
 CASE WHEN s.erp_created_at IS NOT NULL THEN 1 ELSE 0 END erp_created
 FROM new_product_transfer_claims c JOIN store_transfer_batches b ON b.id=c.batch_id
 JOIN store_transfer_items i ON i.batch_id=c.batch_id AND i.store_code=c.store_code AND i.sku=c.sku AND i.item_type='regular'
 JOIN store_transfer_store_status s ON s.batch_id=c.batch_id AND s.store_code=c.store_code
 WHERE b.deleted_at IS NULL AND b.status NOT IN ('cancelled','closed_cancelled');
CREATE TRIGGER new_product_claim_guard AFTER INSERT ON new_product_transfer_claims BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM new_product_plan_rows r JOIN new_product_plans p ON p.id=r.plan_id
 JOIN procurement_batches b ON b.id=p.procurement_batch_id
 WHERE r.plan_id=NEW.plan_id AND r.store_code=NEW.store_code AND r.sku=NEW.sku AND p.status='waiting_stock'
 AND b.status IN ('approved','erp_created','received') AND r.approved_quantity >= r.archived_dispatched_quantity +
 (SELECT COALESCE(SUM(u.quantity),0) FROM new_product_claim_usage u WHERE u.plan_id=NEW.plan_id AND u.store_code=NEW.store_code AND u.sku=NEW.sku))
 THEN RAISE(ABORT,'new_product_claim_conflict') END;
END;
CREATE TRIGGER new_product_item_guard AFTER UPDATE OF store_confirmed_quantity,hq_approved_quantity ON store_transfer_items
 WHEN EXISTS(SELECT 1 FROM new_product_transfer_claims c WHERE c.batch_id=NEW.batch_id AND c.store_code=NEW.store_code AND c.sku=NEW.sku) BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM new_product_plan_rows r WHERE r.sku=NEW.sku AND r.store_code=NEW.store_code AND r.approved_quantity< r.archived_dispatched_quantity +
 (SELECT COALESCE(SUM(u.quantity),0) FROM new_product_claim_usage u WHERE u.plan_id=r.plan_id AND u.store_code=r.store_code AND u.sku=r.sku))
 THEN RAISE(ABORT,'new_product_claim_conflict') END;
END;
