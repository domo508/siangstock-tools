import { RequestValidationError } from "./schema";
export type SupplyRelease = { sku: string; extra_quantity: number; base_releasable: number; hq_available: number };
export async function readSupplyReleases(db: D1Database, batchId: string): Promise<Map<string, SupplyRelease>> {
  const rows = await db.prepare(`SELECT r.sku,r.extra_quantity,c.hq_releasable base_releasable,c.hq_available
    FROM store_transfer_supply_releases r JOIN store_transfer_batch_product_catalog c ON c.batch_id=r.batch_id AND c.sku=r.sku WHERE r.batch_id=?`).bind(batchId).all<SupplyRelease>();
  return new Map(rows.results.map(r=>[r.sku,r]));
}
export function releasedCeiling(base: number, release?: SupplyRelease): number {
  if (!release) return base;
  return Math.min(Number(release.hq_available), Math.max(base, Number(release.base_releasable)) + Number(release.extra_quantity));
}
export function validateRelease(available: unknown, reserve: unknown, base: unknown, extra: number, allocated: number): number {
  const values=[available,reserve,base];
  if(values.some(v=>v==null || !Number.isSafeInteger(Number(v)) || Number(v)<0)) throw new RequestValidationError("本批總倉供應資料未完整保存，不能開放額度。",409);
  const [stock,held,normal]=values.map(Number);
  if(normal>stock || held>stock || normal+held>stock) throw new RequestValidationError("本批總倉供應資料不一致，不能開放額度。",409);
  if(!Number.isSafeInteger(extra) || extra<0 || extra>held || normal+extra>stock) throw new RequestValidationError("額外開放量須為安全保留範圍內的整數，不得超過總倉可用量。",409);
  if(allocated>normal+extra) throw new RequestValidationError("調整後額度低於本批已分配量，請先完成減量再調整額度。",409);
  return normal+extra;
}
