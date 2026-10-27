import {readFileSync} from "node:fs";
import vm from "node:vm";
import {it,expect,vi} from "vitest";
const source=readFileSync("../procurement-planning/app.js","utf8");
const start=source.indexOf("  async function activeConsignmentReservations(");
const end=source.indexOf("  function confirmConsignmentReservations",start);
function fixture(payload,ok=true) {
  const fetch=vi.fn(async()=>({ok,status:ok?200:401,json:async()=>payload}));
  const state={batchId:"CURRENT",workflowDrafts:[{id:"STALE",stage:"approved",review:{rows:[{sku:"SYNTH01",supplier:"力榮",finalQty:999}]}}],sharedDrafts:[{id:"DRAFT"}]};
  const ctx={fetch,state,URLSearchParams,AbortSignal,core:{normalizeSku:value=>String(value||"").trim()}};
  vm.createContext(ctx);vm.runInContext(`${source.slice(start,end)};globalThis.run=activeConsignmentReservations`,ctx);
  return {...ctx,fetch};
}
const row=(batchId,quantity=10)=>({batchId,quantity,sku:"SYNTH01",supplier:"力榮",status:"approved"});
it("fresh canonical source wins over stale local/shared drafts, own batch is excluded exactly once",async()=>{
  const ctx=fixture({version:1,source:"approved_not_erp",reservations:[row("CURRENT"),row("FORMAL")]});
  const result=await ctx.run(["力榮"]);
  expect([...result]).toEqual([["SYNTH01",10]]);expect(result.sourcesBySku.get("SYNTH01")[0].batchId).toBe("FORMAL");
  expect(ctx.fetch).toHaveBeenCalledTimes(1);expect(ctx.fetch.mock.calls[0][0]).toContain("consignment-reservations?supplier=");
  expect(ctx.fetch.mock.calls[0][1].cache).toBe("no-store");
});
it.each([
 {version:0,source:"approved_not_erp",reservations:[]},
 {version:1,source:"drafts",reservations:[]},
 {version:1,source:"approved_not_erp",reservations:[row("FORMAL"),row("FORMAL")]},
 {version:1,source:"approved_not_erp",reservations:[row("FORMAL",-1)]},
 {version:1,source:"approved_not_erp",reservations:[{...row("FORMAL"),status:"pending_approval"}]}
])("malformed/old/duplicate sources stop instead of falling back to drafts %j",async payload=>{
 await expect(fixture(payload).run()).rejects.toThrow();
});
it("expired login and network failure fail closed; ordinary non-consignment scope has no occupancy query",async()=>{
 await expect(fixture({error:"需要登入"},false).run()).rejects.toThrow(/登入/);
 const ctx=fixture({});ctx.fetch.mockRejectedValue(new Error("連線失敗"));await expect(ctx.run()).rejects.toThrow(/連線/);
 const direct=fixture({});expect([...(await direct.run(["家禾"]))]).toEqual([]);expect(direct.fetch).not.toHaveBeenCalled();
});
