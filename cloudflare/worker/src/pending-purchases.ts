import { RequestValidationError } from "./schema";

export async function readPendingPurchaseSnapshot(db: D1Database) {
  const run = await db.prepare("SELECT source_date, updated_at FROM procurement_pending_purchase_runs WHERE id = 1").first();
  const rows = await db.prepare("SELECT sku, product_name, pending_quantity, expected_delivery_date, source_date, updated_at, order_details FROM procurement_pending_purchase_snapshot ORDER BY sku").all();
  return { available: Boolean(run), sourceDate: run?.source_date || null, updatedAt: run?.updated_at || null, rows: rows.results };
}

export function validatePendingOrders(raw: unknown, total: number, sku: string) {
  if (raw == null) return null;
  if (!Array.isArray(raw) || raw.length > 2000) throw new RequestValidationError(`${sku}未交採購明細格式錯誤。`);
  const orders = raw.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestValidationError(`${sku}未交採購明細格式錯誤。`);
    const row = value as Record<string, unknown>;
    const quantity = row.quantity;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0) throw new RequestValidationError(`${sku}未交採購明細數量錯誤。`);
    const documentCode = String(row.documentCode || "").normalize("NFKC").trim();
    const deliveryDate = String(row.deliveryDate || "").trim();
    const parsedDate = new Date(`${deliveryDate}T00:00:00Z`);
    if (documentCode.length > 120 || (deliveryDate && (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== deliveryDate))) throw new RequestValidationError(`${sku}未交採購單號或日期錯誤。`);
    return { quantity, documentCode, deliveryDate: deliveryDate || null };
  });
  if (Math.abs(orders.reduce((sum, row) => sum + row.quantity, 0) - total) > 0.000001) throw new RequestValidationError(`${sku}未交總量與採購明細不一致，未儲存摘要。`);
  return orders;
}
