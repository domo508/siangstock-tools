-- Additive lifecycle classification only; no existing batches or ERP writes.
CREATE TABLE new_product_master_state(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL CHECK(revision>0),source_hash TEXT NOT NULL,source_at TEXT NOT NULL,updated_at TEXT NOT NULL);
INSERT INTO new_product_master_state VALUES(1,1,'','','');
CREATE TABLE new_product_master_seen(sku TEXT PRIMARY KEY,created_date TEXT NOT NULL,first_seen_at TEXT NOT NULL);
CREATE TABLE new_product_candidates(sku TEXT PRIMARY KEY REFERENCES new_product_master_seen(sku) DEFERRABLE INITIALLY DEFERRED,name TEXT NOT NULL,created_date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','prelaunch','ordinary')),first_stock_date TEXT,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL);
CREATE TABLE new_product_candidate_events(id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL);
CREATE TRIGGER new_product_candidate_decision_guard BEFORE UPDATE OF status ON new_product_candidates
WHEN EXISTS(SELECT 1 FROM new_product_registry g WHERE g.sku=NEW.sku) OR OLD.first_stock_date IS NOT NULL OR EXISTS(SELECT 1 FROM procurement_batch_items i WHERE i.sku=NEW.sku AND i.received_quantity>0)
BEGIN SELECT RAISE(ABORT,'new_product_candidate_lifecycle_conflict'); END;
