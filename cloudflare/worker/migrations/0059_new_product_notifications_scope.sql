-- Additive metadata only. No retrospective notification jobs or quantity changes.
CREATE TABLE new_product_notifications (
 plan_id TEXT NOT NULL REFERENCES new_product_plans(id),
 store_code TEXT NOT NULL, recipient TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','unknown','not_required')),
 attempts INTEGER NOT NULL DEFAULT 0, last_attempt_at TEXT, sent_at TEXT,
 provider_message_id TEXT, error_summary TEXT, PRIMARY KEY(plan_id,store_code)
);
CREATE TABLE new_product_weekly_items (
 batch_id TEXT NOT NULL REFERENCES store_transfer_batches(id) ON DELETE CASCADE,
 store_code TEXT NOT NULL, sku TEXT NOT NULL,
 plan_id TEXT NOT NULL REFERENCES new_product_plans(id),
 first_approved_quantity INTEGER NOT NULL, remaining_quantity INTEGER NOT NULL,
 PRIMARY KEY(batch_id,store_code,sku)
);
-- Existing linked first allocations get presentation metadata; approved quantities stay intact.
INSERT INTO new_product_weekly_items
 SELECT c.batch_id,c.store_code,c.sku,c.plan_id,r.approved_quantity,c.quantity
 FROM new_product_transfer_claims c JOIN new_product_plan_rows r
 ON r.plan_id=c.plan_id AND r.store_code=c.store_code AND r.sku=c.sku;
