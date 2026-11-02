-- User authorized removal of this initial development ledger on 2026-11-02.
-- Keep the batch and its original amounts. The trigger writes the reversal atomically
-- with the status change, without sending mail or changing any ERP transaction.
CREATE TRIGGER legacy_lirong_revoke_audit_20261102
AFTER UPDATE OF status ON procurement_batches
WHEN OLD.id = 'HIST-202609-LIRONG-0911' AND OLD.status = 'approved' AND NEW.status = 'revoked'
BEGIN
  INSERT INTO procurement_events
    (batch_id,event_type,amount_before,amount_delta,amount_after,reason,created_at,created_by,idempotency_key)
  VALUES (NEW.id,'revoked',OLD.approved_amount,-OLD.approved_amount,0,
    '依使用者2026-11-02指示停用9月開發初期歷史批次；保留原始紀錄，不代表實際ERP採購取消或已收貨。',
    NEW.updated_at,'user-authorized-maintenance','legacy-lirong-revoke-20261102');
END;
UPDATE procurement_batches
SET status='revoked',revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='HIST-202609-LIRONG-0911' AND status='approved'
  AND COALESCE(erp_reference,'')=''
  AND NOT EXISTS (SELECT 1 FROM procurement_batch_items WHERE batch_id=procurement_batches.id)
  AND NOT EXISTS (SELECT 1 FROM procurement_batch_erp_documents WHERE batch_id=procurement_batches.id)
  AND NOT EXISTS (SELECT 1 FROM procurement_batch_store_needs WHERE batch_id=procurement_batches.id);
DROP TRIGGER legacy_lirong_revoke_audit_20261102;
