INSERT OR IGNORE INTO store_transfer_procurement_need_history (
  batch_id, store_code, sku, product_name, approved_demand_quantity,
  allocated_quantity, unfilled_quantity, needed_by, reason, created_at, created_by
)
SELECT s.batch_id, s.store_code, s.sku, s.product_name, s.demand_quantity,
       s.allocated_quantity, s.unfilled_quantity, s.next_arrival_date, s.reason,
       b.updated_at, b.updated_by
FROM store_transfer_shortages s
JOIN store_transfer_batches b ON b.id = s.batch_id
WHERE b.status IN ('approved', 'erp_created', 'closed');

INSERT OR IGNORE INTO store_transfer_procurement_needs (
  store_code, sku, product_name, source_batch_id, approved_demand_quantity,
  allocated_quantity, unfilled_quantity, covered_quantity, needed_by, reason,
  handling_mode, status, created_at, updated_at, updated_by
)
SELECT store_code, sku, product_name, batch_id, demand_quantity,
       allocated_quantity, unfilled_quantity, 0, next_arrival_date, reason,
       'pending_decision', CASE WHEN unfilled_quantity > 0 THEN 'awaiting_decision' ELSE 'resolved' END,
       updated_at, updated_at, updated_by
FROM (
  SELECT s.*, b.updated_at, b.updated_by,
         ROW_NUMBER() OVER (PARTITION BY s.store_code, s.sku ORDER BY b.updated_at DESC, s.batch_id DESC) AS rn
  FROM store_transfer_shortages s
  JOIN store_transfer_batches b ON b.id = s.batch_id
  WHERE b.status IN ('approved', 'erp_created', 'closed')
)
WHERE rn = 1;
