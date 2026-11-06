-- Additive only: preserve existing totals, business quantities and audit history.
-- NULL denotes an older product-only summary, not confirmed order details.
ALTER TABLE procurement_pending_purchase_snapshot
ADD COLUMN order_details TEXT CHECK (order_details IS NULL OR (json_valid(order_details) AND json_type(order_details) = 'array'));
