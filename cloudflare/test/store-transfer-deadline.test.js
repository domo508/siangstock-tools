import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';

const migration = readFileSync('worker/migrations/0050_store_transfer_reply_1800.sql', 'utf8');
it('回覆期限遷移只延長有效待處理批次，不改品項、件數、狀態與到貨日', () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const f of readdirSync('worker/migrations').filter(f => f.endsWith('.sql') && f < '0050').sort()) db.exec(readFileSync(`worker/migrations/${f}`, 'utf8'));
    const cases = [
      ['active', 'open', '2099-01-01T01:00:00.000Z', 'pending', null],
      ['saved', 'review', '2099-01-01T01:00:00Z', 'saved', null],
      ['submitted', 'open', '2099-01-01T01:00:00.000Z', 'submitted', null],
      ['historical', 'open', '2000-01-01T01:00:00.000Z', 'pending', null],
      ['approved', 'approved', '2099-01-01T01:00:00.000Z', 'approved', null],
      ['erp', 'erp_created', '2099-01-01T01:00:00.000Z', 'approved', '2099-01-01'],
      ['cancelled', 'cancelled', '2099-01-01T01:00:00.000Z', 'pending', null],
      ['custom', 'open', '2099-01-01T02:00:00.000Z', 'pending', null],
      ['all-approved', 'open', '2099-01-01T01:00:00.000Z', 'approved', null],
      ['deleted', 'open', '2099-01-01T01:00:00.000Z', 'pending', null]
    ];
    for (const [id, status, lock, storeStatus, erp] of cases) {
      db.prepare(`INSERT INTO store_transfer_batches(id,week_key,proposal_date,response_due_at,lock_at,status,store_codes,item_count,suggested_quantity,created_at,created_by,updated_at,updated_by,arrival_schedule,deleted_at) VALUES(?,'2099-W01','2098-12-31',?,?,?,'["R06"]',1,2,'2098-12-31','test','2098-12-31','test','{"R06":{"currentArrivalDate":"2099-01-03"}}',?)`).run(id,lock,lock,status,id==='deleted'?'2098-12-31':null);
      db.prepare(`INSERT INTO store_transfer_store_status(batch_id,store_code,status,updated_at,erp_created_at) VALUES(?,'R06',?,'2098-12-31',?)`).run(id,storeStatus,erp);
      db.prepare(`INSERT INTO store_transfer_items(batch_id,store_code,sku,product_name,suggested_quantity,store_confirmed_quantity,store_reason,updated_at,updated_by,item_type) VALUES(?,'R06','SYNTH','合成商品',2,0,'明確取消','2098-12-31','test','regular')`).run(id);
    }
    const before = db.prepare('SELECT * FROM store_transfer_batches ORDER BY id').all();
    const items = db.prepare('SELECT * FROM store_transfer_items ORDER BY id').all();
    const states = db.prepare('SELECT * FROM store_transfer_store_status ORDER BY batch_id').all();
    db.exec(migration);
    const audits = db.prepare('SELECT * FROM store_transfer_deadline_adjustments ORDER BY batch_id').all();
    expect(audits.map(a=>a.batch_id)).toEqual(['active','saved','submitted']);
    for (const row of before) {
      const after = db.prepare('SELECT * FROM store_transfer_batches WHERE id=?').get(row.id);
      if (['active','saved','submitted'].includes(row.id)) {
        expect(after.lock_at).toBe('2099-01-01T10:00:00.000Z');
        expect(after.response_due_at).toBe(after.lock_at);
        expect(after.revision).toBe(row.revision+1);
        const audit=audits.find(a=>a.batch_id===row.id);
        expect(audit.previous_lock_at).toBe(row.lock_at);
        expect(audit.previous_revision).toBe(row.revision);
        for (const key of Object.keys(row).filter(k=>!['lock_at','response_due_at','revision','updated_at','updated_by'].includes(k))) expect(after[key]).toEqual(row[key]);
      } else expect(after).toEqual(row);
    }
    expect(db.prepare('SELECT * FROM store_transfer_items ORDER BY id').all()).toEqual(items);
    expect(db.prepare('SELECT * FROM store_transfer_store_status ORDER BY batch_id').all()).toEqual(states);
  } finally { db.close(); }
});

it('新批次預設18:00，欄位及操作手冊同步',()=>{
  const app=readFileSync('../store-transfer/app.js','utf8');
  const html=readFileSync('../store-transfer/index.html','utf8');
  expect(app).toContain('`${lock}T18:00`');
  expect(app).not.toContain('`${lock}T09:00`');
  expect(html).toContain('下一工作日18:00');
  expect(html).not.toContain('09:00');
});
