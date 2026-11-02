import {readFileSync} from "node:fs";
import vm from "node:vm";
import {it,expect} from "vitest";
const source=readFileSync("../procurement-planning/app.js","utf8");
const fn=source.slice(source.indexOf("  async function activeConsignmentReservations("),source.indexOf("  function confirmConsignmentReservations("));
async function call(data,{status=200,planning=true}={}){
 let url;const ctx={URLSearchParams,Map,Set,AbortSignal,state:{batchId:"self"},core:{normalizeSku:s=>s},fetch:async u=>{url=u;return{ok:status===200,status,json:async()=>data};}};
 vm.createContext(ctx);vm.runInContext(fn+";globalThis.run=activeConsignmentReservations",ctx);
 const result=await ctx.run([],{planning});return{result,url};
}
const valid={version:1,source:"approved_not_erp",purpose:"planning",verified:true,issues:[],reservations:[{batchId:"other",sku:"A1",supplier:"力榮",status:"approved",quantity:3}]};
it("planning transport carries explicit uncertainty while retaining verified reservation quantity",async()=>{
 const {result,url}=await call({...valid,verified:false,issues:[{code:"incomplete_approved_detail",batchId:"legacy",suppliers:["力榮"],message:"舊帳待確認"}]});
 expect(url).toContain("purpose=planning");expect(result.get("A1")).toBe(3);expect(result.unverifiedSupplierGroups.has("lirong")).toBe(true);expect(result.issues[0].batchId).toBe("legacy");
 const strict=await call(valid,{planning:false});expect(strict.url).not.toContain("purpose=");
});
it("malformed warning, old server, auth and duplicate reservations never become a successful empty map",async()=>{
 for(const data of [{...valid,verified:false},{...valid,purpose:undefined},{...valid,issues:[{code:"incomplete_approved_detail",batchId:"legacy",suppliers:[],message:"bad"}],verified:false},{...valid,reservations:[...valid.reservations,...valid.reservations]}])await expect(call(data)).rejects.toThrow();
 for(const status of [401,403,409,500])await expect(call({error:"synthetic"},{status})).rejects.toThrow();
});
