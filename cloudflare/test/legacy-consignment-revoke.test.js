import { DatabaseSync } from "node:sqlite";
import { readFileSync,readdirSync } from "node:fs";
import { it,expect } from "vitest";
const filename="0049_revoke_initial_lirong_history.sql", target="HIST-202609-LIRONG-0911";
const migration=readFileSync(`worker/migrations/${filename}`,"utf8");
function database(){const db=new DatabaseSync(":memory:");for(const f of readdirSync("worker/migrations").filter(f=>f.endsWith(".sql")&&f<filename).sort())db.exec(readFileSync(`worker/migrations/${f}`,"utf8"));return db;}
it("targeted historical reversal preserves source amounts, all other batches and notifications; rerun is idempotent",()=>{
 const db=database();try{
 const before=db.prepare("SELECT * FROM procurement_batches WHERE id=?").get(target);
 const others=db.prepare("SELECT * FROM procurement_batches WHERE id<>? ORDER BY id").all(target);
 const notes=db.prepare("SELECT * FROM procurement_notifications").all();
 db.exec(migration);const after=db.prepare("SELECT * FROM procurement_batches WHERE id=?").get(target);
 expect(after).toMatchObject({...before,status:"revoked",revision:before.revision+1,updated_at:after.updated_at});
 const event=db.prepare("SELECT * FROM procurement_events WHERE idempotency_key='legacy-lirong-revoke-20261102'").get();
 expect(event).toMatchObject({batch_id:target,event_type:"revoked",amount_before:before.approved_amount,amount_delta:-before.approved_amount,amount_after:0});
 expect(db.prepare("SELECT * FROM procurement_batches WHERE id<>? ORDER BY id").all(target)).toEqual(others);
 expect(db.prepare("SELECT * FROM procurement_notifications").all()).toEqual(notes);
 db.exec(migration);expect(db.prepare("SELECT * FROM procurement_batches WHERE id=?").get(target)).toEqual(after);
 expect(db.prepare("SELECT COUNT(*) n FROM procurement_events WHERE idempotency_key='legacy-lirong-revoke-20261102'").get().n).toBe(1);
 }finally{db.close();}
});
it.each(["UPDATE procurement_batches SET erp_reference='already-linked' WHERE id=?", "UPDATE procurement_batches SET status='erp_created' WHERE id=?"])("does not revoke a record changed since diagnosis: %s",query=>{
 const db=database();try{db.prepare(query).run(target);const before=db.prepare("SELECT * FROM procurement_batches WHERE id=?").get(target);db.exec(migration);expect(db.prepare("SELECT * FROM procurement_batches WHERE id=?").get(target)).toEqual(before);}finally{db.close();}
});
it("failure to write the reversal audit aborts the status change",()=>{
 const db=database();try{
 db.exec("CREATE TRIGGER reject_reversal BEFORE INSERT ON procurement_events WHEN NEW.idempotency_key='legacy-lirong-revoke-20261102' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
 expect(()=>db.exec(migration)).toThrow(/audit failure/);
 expect(db.prepare("SELECT status FROM procurement_batches WHERE id=?").get(target).status).toBe("approved");
 }finally{db.close();}
});
