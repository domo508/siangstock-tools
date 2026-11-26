import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { describe, it, expect, vi } from 'vitest';
const root = '../procurement-planning/';
const app = readFileSync(root+'app.js','utf8');
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function runtime(extra={}) {
  const c={console, File, Blob, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, AbortController, crypto:webcrypto, setTimeout, clearTimeout, ...extra};
  vm.createContext(c);
  for(const path of ['assets/xlsx-js-style.bundle.js','xlsx-style-runtime.js','../inventory/assets/xlsx.full.min.js','core.js','master-source-guard.js']) vm.runInContext(readFileSync(root+path,'utf8'),c);
  return c;
}
const c=runtime(), X=c.XLSX, W=c.ProcurementXlsxWriter, C=c.ProcurementPlanningCore, G=c.ProcurementMasterSourceGuard;
const plain=x=>JSON.parse(JSON.stringify(x));
const round=b=>X.read(W.write(b,{type:'array',bookType:'xlsx',compression:true}),{type:'array',cellDates:true,cellStyles:true,nodim:true});
function masterFile(supplier='家禾', name='old.xlsx') {
  const b=X.utils.book_new();X.utils.book_append_sheet(b,X.utils.aoa_to_sheet([
    ['貨號','品名','供應商簡稱','進貨價','最小配貨數','貨品狀態','已下架','款式類別'],
    ['SYNTH-1','合成水洗棉床包',supplier,100,1,'尚可追加','否','寢具_長絨棉']
  ]),'主檔');return new File([W.write(b,{type:'array',bookType:'xlsx',compression:true})],name,{type:MIME});
}
const oldFile=masterFile(),newFile=masterFile('普優瑪寢具有限公司','new.xlsx');
const oldMeta={id:'old',name:'old.xlsx',modifiedTime:'2026-11-16T10:15:00Z',size:String(oldFile.size),md5Checksum:'old-md5',parents:['folder'],mimeType:MIME};
const newMeta={...oldMeta,id:'new',name:'new.xlsx',modifiedTime:'2026-11-26T10:06:00Z',size:String(newFile.size),md5Checksum:'new-md5'};
async function fixture({latest=newMeta,fail=false}={}) {
  const calls=[];let client;const files={old:oldFile,new:newFile};
  const c=runtime({google:{accounts:{oauth2:{initTokenClient:()=>{client={requestAccessToken:()=>client.callback({access_token:'synthetic',expires_in:3600})};return client;}}}},fetch:async(url,options)=>{
    calls.push({url,options});if(fail) return {ok:false,status:403,json:async()=>({error:{message:'synthetic denied'}})};
    if(url.includes('alt=media'))return{ok:true,status:200,blob:async()=>files[url.includes('/new?')?'new':'old']};
    return{ok:true,status:200,json:async()=>({files:[latest]})};
  }});
  vm.runInContext(readFileSync(root+'google-sources.js','utf8'),c);c.ProcurementGoogleSources.initialize('test');await c.ProcurementGoogleSources.authorize();
  const metadata={...oldMeta,sha256:await G.sha256(oldFile)};
  c.masterGuard=c.ProcurementMasterSourceGuard;c.googleSources=c.ProcurementGoogleSources;
  c.state={masterFile:oldFile,masterWorkbook:null,sourceMetadata:{master:{file:oldFile,metadata}},config:{fixedSources:{productMasterFolderId:'folder'}},analysis:{meta:{sourceHashes:{master:metadata.sha256}},rows:[{sku:'SYNTH-1',supplier:'家禾',finalQty:0}]},inventoryFile:{id:'inventory'},pendingFiles:[{id:'pending'}],salesFiles:[{id:'sales'}],transferFile:{id:'transfer'}};
  c.elements=Object.fromEntries(['masterGuardStatus','masterRefresh','masterRecheck','calculationMaster','masterFileName'].map(k=>[k,{textContent:'',hidden:false,disabled:false}]));
  c.updateReadyState=vi.fn();c.checkRuntimeVersion=vi.fn(async()=>true);c.validateAutoMaster=vi.fn();c.sourceProof=(_id,m)=>m.name;
  c.readWorkbook=async file=>X.read(await file.arrayBuffer(),{type:'array',cellDates:true,cellStyles:true,nodim:true});
  for(const name of ['renderCalculationMaster','masterGuardMessage','latestPlanningMaster','verifyPlanningMaster','assertPlanningMasterUnchanged','assertBaseMasterCurrent','refreshPlanningMaster','recheckPlanningMaster']) {
    const start=app.search(new RegExp('  (?:async )?function '+name+'\\('));const next=[app.indexOf('\n  function ',start+1),app.indexOf('\n  async function ',start+1)].filter(n=>n>start);
    vm.runInContext(app.slice(start,Math.min(...next)),c);
  }
  return{c,calls};
}
describe('new calculation master source guard',()=>{
  it('blocks old master even when a new calculation is requested',async()=>{const f=await fixture(),before=JSON.stringify(f.c.state.analysis);await expect(f.c.verifyPlanningMaster()).rejects.toMatchObject({code:'MASTER_CHANGED'});expect(f.c.elements.masterGuardStatus.textContent).toContain('old.xlsx');expect(f.c.elements.masterGuardStatus.textContent).toContain('new.xlsx');expect(f.c.elements.masterRefresh.hidden).toBe(false);expect(JSON.stringify(f.c.state.analysis)).toBe(before);expect(f.calls.some(x=>x.url.includes('alt=media'))).toBe(false);});
  it('refreshes only master, preserves files and original cancelled quantities, and does not calculate',async()=>{const {c,calls}=await fixture(),analysis=JSON.stringify(c.state.analysis),files=[c.state.inventoryFile,c.state.pendingFiles,c.state.salesFiles,c.state.transferFile];await c.refreshPlanningMaster();expect(c.state.masterFile.name).toBe('new.xlsx');expect(c.state.sourceMetadata.master.metadata.sha256).toBe(await G.sha256(newFile));expect(JSON.stringify(c.state.analysis)).toBe(analysis);expect([c.state.inventoryFile,c.state.pendingFiles,c.state.salesFiles,c.state.transferFile]).toEqual(files);expect(c.elements.masterGuardStatus.textContent).toContain('再次按');expect(calls.every(x=>!x.options.method||x.options.method==='GET')).toBe(true);});
  it('after explicit refresh validates before and after computation',async()=>{const {c}=await fixture();await c.refreshPlanningMaster();const proof=await c.verifyPlanningMaster();await expect(c.assertPlanningMasterUnchanged(proof)).resolves.toBeUndefined();expect(proof.proof).toMatchObject({id:'new',name:'new.xlsx',sourceMode:'Google自動'});});
  it('failure never treats unknown as current or overwrites original files',async()=>{const {c}=await fixture({fail:true});const original=c.state.masterFile,analysis=JSON.stringify(c.state.analysis);await expect(c.verifyPlanningMaster()).rejects.toThrow('無法核對');await c.refreshPlanningMaster();expect(c.state.masterFile).toBe(original);expect(JSON.stringify(c.state.analysis)).toBe(analysis);expect(c.elements.masterRefresh.hidden).toBe(false);});
  it('version rejection prevents refresh requests and source replacement',async()=>{const {c,calls}=await fixture();c.checkRuntimeVersion=async()=>false;await c.refreshPlanningMaster();expect(calls).toHaveLength(0);expect(c.state.masterFile).toBe(oldFile);});
  it('duplicate refresh or recheck during calculation does nothing',async()=>{const {c,calls}=await fixture();c.state.newCalculationBusy=true;await c.refreshPlanningMaster();await c.recheckPlanningMaster();expect(calls).toHaveLength(0);});
  it('rapid repeated refreshes share the busy lock even while checking tool version',async()=>{const {c,calls}=await fixture();let finish;let checks=0;c.checkRuntimeVersion=()=>++checks===1?new Promise(resolve=>{finish=resolve;}):Promise.resolve(true);const first=c.refreshPlanningMaster(),second=c.refreshPlanningMaster();expect(c.state.masterGuardBusy).toBe(true);finish(true);await Promise.all([first,second]);expect(calls.filter(x=>x.url.includes('alt=media'))).toHaveLength(1);});
  it('manual same-name wrong-content backup is rejected; exact latest bytes pass',async()=>{const hash=await G.sha256(newFile);await expect(G.verify({file:oldFile,latest:newMeta,download:async()=>newFile})).rejects.toMatchObject({code:'MASTER_CHANGED'});expect((await G.verify({file:newFile,latest:newMeta,download:async()=>newFile})).sha256).toBe(hash);});
  it('cannot reuse old automatic metadata after a manual file replacement',async()=>{const {c}=await fixture();c.state.masterFile=newFile;expect((await c.verifyPlanningMaster()).proof.sourceMode).toContain('手動備援');});
  it('matching metadata cannot hide changed loaded bytes',async()=>await expect(G.verify({file:newFile,metadata:{...newMeta,sha256:'wrong'},latest:newMeta})).rejects.toThrow('不一致'));
  it.each([{id:'replaced'},{modifiedTime:'2026-11-27T00:00:00Z'},{md5Checksum:'changed'},{size:'999'}])('rejects changes during calculation: %j',change=>expect(()=>G.assertUnchanged(newMeta,{...newMeta,...change},true)).toThrow('結果未採用'));
  it('rejects changed selected file even if latest metadata is the same',()=>expect(()=>G.assertUnchanged(newMeta,newMeta,false)).toThrow('結果未採用'));
  it('a new special purchase cannot silently reuse a legacy base',async()=>{const {c}=await fixture();c.state.baseAnalysis=c.state.analysis;await expect(c.assertBaseMasterCurrent()).rejects.toThrow('重新產生一般建議');});
  it('legacy source display is read-only and never invents a filename',()=>{const a={meta:{sourceHashes:{master:'a'.repeat(64)}},manualAdditionCatalog:{sourceModifiedTime:oldMeta.modifiedTime},rows:[{finalQty:0}]},before=JSON.stringify(a);expect(G.describe(G.proofForAnalysis(a))).toContain('舊批次未保存檔名');expect(G.describe(G.proofForAnalysis(a))).toContain('台北時間');expect(JSON.stringify(a)).toBe(before);expect(G.describe(G.proofForAnalysis({}))).toContain('無法追溯確認');});
  it('real XLSX roundtrip carries source proof without changing suggestions, review, zero cancellations or ERP',async()=>{
    const w=X.read(await newFile.arrayBuffer(),{type:'array',cellDates:true,cellStyles:true,nodim:true}),master=C.parseProductMasterWorkbook(w,X);
    const a=C.buildProcurementRecommendations({master,consignment:{unavailable:true,dataAvailable:false,records:[]},inventory:{records:[],bySku:new Map()},pendingReports:[],transferReports:[],salesReports:[{records:[{sku:'SYNTH-1',name:'合成床包',date:'2026-11-25',quantity:10,actualAmount:1000,warehouseCode:'R01',salesType:'銷貨',sourceRow:2}]}],asOfDate:'2026-11-26',inventoryDate:'2026-11-26',orderDate:'2026-11-26',checkpoint:'mid-month',blacklist:[]});
    const original=JSON.stringify(a.rows),without=round(C.buildRecommendationWorkbook(a,W));a.meta={masterSource:{...newMeta,sha256:await G.sha256(newFile),checkedAt:'2026-11-26T10:00:00Z'},sourceHashes:{master:await G.sha256(newFile)}};
    const withProof=round(C.buildRecommendationWorkbook(a,W));const tab=withProof.SheetNames.find(n=>/^03B/.test(n)&&X.utils.sheet_to_json(withProof.Sheets[n]).some(r=>r['ERP品號']==='SYNTH-1'));expect(plain(X.utils.sheet_to_json(withProof.Sheets[tab],{defval:''}))).toEqual(plain(X.utils.sheet_to_json(without.Sheets[tab],{defval:''})));expect(JSON.stringify(a.rows)).toBe(original);
    const summary=X.utils.sheet_to_json(withProof.Sheets['01_採購摘要'],{header:1});expect(summary.some(r=>r[0]==='計算主檔檔名'&&r[1]==='new.xlsx')).toBe(true);
    const opts={baselineBySku:new Map(a.rows.map(r=>[r.sku,r])),allowedSkuSet:new Set(['SYNTH-1']),exportedSkuSet:new Set(['SYNTH-1'])};const review=C.reviewReturnedWorkbook(withProof,X,opts);expect(review.errors).toHaveLength(0);const second=C.reviewSecondApprovalWorkbook(round(C.buildSecondReviewWorkbook(review,W)),X,{baselineBySku:new Map(review.rows.map(r=>[r.sku,r]))});expect(second.errors).toHaveLength(0);const erp=round(C.buildErpPurchaseWorkbook(second,W,{approved:true}));expect(X.utils.sheet_to_json(erp.Sheets['通用貨品數量']).reduce((n,r)=>n+r['數量']*r['價格'],0)).toBe(second.totals.approvedAmount);
    const zero=round(withProof),arr=X.utils.sheet_to_json(zero.Sheets[tab],{header:1,defval:''});const headers=arr[0];zero.Sheets[tab][X.utils.encode_cell({r:1,c:headers.indexOf('人工確認採購量')})]={t:'n',v:0};zero.Sheets[tab][X.utils.encode_cell({r:1,c:headers.indexOf('人工調整原因類別')})]={t:'s',v:'庫存／銷售風險，人工降低數量'};const cancelled=C.reviewReturnedWorkbook(round(zero),X,opts);expect(cancelled.errors).toHaveLength(0);expect(cancelled.rows[0].finalQty).toBe(0);expect(cancelled.totals.approvedAmount).toBe(0);
  });
});
