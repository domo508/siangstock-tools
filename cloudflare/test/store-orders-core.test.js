import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, it, expect } from "vitest";
import * as C from "../../store-orders/core.js";
import { VersionGuard } from "../../store-orders/runtime.js";
const context={console,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder};context.globalThis=context;vm.createContext(context);vm.runInContext(readFileSync("../inventory/assets/xlsx.full.min.js","utf8"),context);const X=context.XLSX;
export function example() {
  const o=C.newOrder("test-order-001","R00","2026-10-23");
  Object.assign(o,{paperNumber:"0000123",clerk:"合成測試人",status:"reviewed",reviewed:true,paperTotal:250,paperRowCount:2,masterVersion:"synthetic-v1",sources:[{fileId:"source-file-001",pages:1,verified:true}]});
  o.items=[{sku:"00001",name:"合成商品",color:"白",size:"均碼",quantity:2,unitPrice:100,saleType:"銷貨",matchStatus:"unique"},{sku:"TEST02",name:"另一商品",color:"藍",size:"大",quantity:1,unitPrice:50,saleType:"訂貨",matchStatus:"unique"}];o.payments["現金"]=150;o.payments["中信信用卡"]=100;return o;
}
describe("門市訂單規則與POS真實格式往返",()=>{
  it("未修改直接覆核、結算、實際BIFF8寫出重讀，列數件數與收款守恆",()=>{
    const o=example();expect(C.validateOrder(o,{complete:true}).errors).toEqual([]);expect(C.settlementSummary([o])).toEqual({orders:1,rows:2,quantity:3,amountCents:25000,paidCents:25000,unpaidCents:0});
    const bytes=X.write(C.buildPOS([o],X,{mode:"test"}),C.WRITE_OPTIONS);expect([...new Uint8Array(bytes).slice(0,4)]).toEqual([208,207,17,224]);
    const wb=X.read(bytes,C.READ_OPTIONS),rows=X.utils.sheet_to_json(wb.Sheets.Sheet1,{header:1,raw:true,defval:""});expect(rows[1]).toEqual(C.POS_HEADERS);
    expect(rows[2].slice(0,9)).toEqual(["0000123","2026/10/23","R00","R00","R00","","銷貨","測試檔・未完成ERP驗收","00001"]);
    expect(rows[3].slice(2,7)).toEqual(["R00","R00","T00","","訂貨"]);expect(rows[2][14]).toBe("");expect(rows[2][15]).toBe(100);expect(rows[2].slice(17)).toEqual([100,150,0,0]);expect(rows[3].slice(17)).toEqual(["","","",""]);C.assertConservation([o],rows.slice(2));
  });
  it("人工改量改價、加入同貨號不同銷別及價格，不合併列",()=>{
    const o=example();o.items[0].quantity=3;o.items[1].unitPrice=45.5;o.items.push({...o.items[0],saleType:"訂貨",quantity:1,unitPrice:30});o.paperRowCount=3;o.paperTotal=375.5;o.payments["現金"]=275.5;
    expect(C.validateOrder(o,{complete:true}).errors).toEqual([]);const rows=C.posRows([o]);expect(rows).toHaveLength(3);expect(rows.map(r=>r[16])).toEqual([3,1,1]);expect(rows[2][4]).toBe("T00");expect(C.totals(o).amountCents).toBe(37550);
  });
  it.each([0,-1,1.2,null,""])("數量%j不可偷偷回復成建議量",q=>{const o=example();o.items[0].quantity=q;expect(C.validateOrder(o,{complete:true}).errors.join()).toMatch(/數量/);expect(()=>C.posRows([o])).toThrow();});
  it("零元需明確確認，數量與列仍保留",()=>{const o=example();o.items[0].unitPrice=0;o.paperTotal=50;o.payments["現金"]=50;o.payments["中信信用卡"]=0;expect(C.validateOrder(o,{complete:true}).errors.join()).toMatch(/零元/);o.items[0].zeroConfirmed=true;expect(C.posRows([o])).toHaveLength(2);});
  it("找不到商品只警示，但人工補齊前不能產檔；停用品不阻擋",()=>{const o=example();o.items[0].matchStatus="missing";o.items[0].discontinued=true;expect(()=>C.posRows([o])).toThrow(/人工確認/);o.items[0].manualConfirmed=true;expect(C.validateOrder(o,{complete:true}).warnings).toHaveLength(2);expect(C.posRows([o])).toHaveLength(2);});
  it("不同付款分配且未收款守恆，不以收款掩蓋成交差異",()=>{const o=example();o.payments["現金"]=100;o.unpaid=50;expect(C.posRows([o])[0].slice(17)).toEqual([100,100,0,0]);o.paperTotal=200;expect(()=>C.posRows([o])).toThrow(/紙本總額/);});
  it("輸出缺列、改件數或重複收款一律阻擋",()=>{const o=example(),rows=C.posRows([o]);expect(()=>C.assertConservation([o],rows.slice(1))).toThrow();const copied=structuredClone(rows);copied[1][17]=100;expect(()=>C.assertConservation([o],copied)).toThrow(/收款/);});
  it("正式匯出沒有前端旗標繞過途徑",()=>{expect(()=>C.posRows([example()],{mode:"production",accepted:true})).toThrow(/禁止正式/);});
  it("缺頁、少收紙本列、雙重銷別、空尺碼與未覆核均不可通過",()=>{for(const mutate of [o=>o.pageCount=2,o=>o.paperRowCount=3,o=>o.sources[0].verified=false,o=>o.items[0].saleType="銷貨訂貨",o=>o.items[0].size="",o=>o.reviewed=false]){const o=example();mutate(o);expect(()=>C.posRows([o])).toThrow();}});
  it("真實日期與台灣午夜，不使用裝置時區歸日",()=>{expect(C.taipeiDate("2026-10-22T16:01:00Z")).toBe("2026-10-23");expect(C.validDate("2026-02-30")).toBe(false);});
  it("單號前導零保留，公式樣文字寫成純文字，客戶資料不出現在POS",()=>{const o=example();o.customer={name:"敏感姓名",phone:"0900000000",address:"敏感地址"};o.items[0].sku="=1+1";const wb=X.read(X.write(C.buildPOS([o],X),C.WRITE_OPTIONS),C.READ_OPTIONS);expect(wb.Sheets.Sheet1.I3.t).toBe("s");expect(wb.Sheets.Sheet1.I3.f).toBeUndefined();expect(JSON.stringify(wb)).not.toContain("敏感");});
  it("重複紙本單號不產生重複ERP訂單",()=>{expect(()=>C.posRows([example(),example()])).toThrow(/重複/);});
  it("補件或取消需原因；待覆核不可以被結算悄悄略過",()=>{const o=example();o.status="pending";expect(()=>C.settlementSummary([],[o])).toThrow(/異常/);o.status="needs_info";o.exceptionReason="待重拍";expect(C.settlementSummary([],[o]).orders).toBe(0);});
});
describe("商品主檔同一讀取器、實際xlsx往返",()=>{
  function master(rows,sheets=1){const w=X.utils.book_new();for(let i=0;i<sheets;i++)X.utils.book_append_sheet(w,X.utils.aoa_to_sheet(rows),`主檔${i}`);return X.read(X.write(w,{type:"array",bookType:"xlsx"}),C.READ_OPTIONS);}
  const headers=["貨號","品名","顏色","尺碼","已下架"];
  it("主檔唯一命中自動帶入顏色尺碼，前導零保留",()=>{const m=C.parseMaster(master([headers,["00001","合成商品","藍","均碼","是"]]),X,"v1");expect(C.matchProduct(m,"00001").matches[0]).toMatchObject({color:"藍",size:"均碼",discontinued:true});expect(C.matchProduct(m,"O0001").status).toBe("missing");});
  it("同貨號不同規格列多候選，不先取第一筆",()=>{const m=C.parseMaster(master([headers,["A01","商品","藍","M",""],["A01","商品","藍","L",""]]),X,"v1");expect(C.matchProduct(m,"A01").status).toBe("ambiguous");});
  it.each([[[]],[["貨號"],["A01"]],[headers],[headers,["A01","","藍","M",""]]])("空白缺欄或異常全列%j明確阻擋",rows=>{expect(()=>C.parseMaster(master(rows),X,"v1")).toThrow();});
  it("多張候選表不猜測",()=>expect(()=>C.parseMaster(master([headers,["A01","品名","白","均",""]],2),X,"v1")).toThrow(/唯一/));
  it("貨號誤帶日期格式仍以原始文字匹配",()=>{const w=master([headers,["A001","品名","白","均",""]]);w.Sheets.主檔0.A2.z="yyyy/mm/dd";const roundtrip=X.read(X.write(w,{type:"array",bookType:"xlsx"}),C.READ_OPTIONS);expect(C.matchProduct(C.parseMaster(roundtrip,X,"v1"),"A001").status).toBe("unique");});
});
describe("簡寫品名僅輔助，貨號與主檔優先",()=>{
  const product={sku:"00001",name:"Harmony天絲雙人床包組",color:"霧藍",size:"5尺",colorCode:"02",sizeCode:"05",discontinued:false};
  it("簡寫或完全未填品名均可通過，正式名稱、規格與成交資料不受影響",()=>{
    for(const paperName of ["天絲床包","Harmony","床包組",""]){const o=example();o.items[0]=C.applyProduct({...o.items[0],paperName},product);expect(o.items[0].name).toBe(product.name);expect(o.items[0].quantity).toBe(2);expect(o.items[0].unitPrice).toBe(100);expect(C.validateOrder(o,{complete:true}).errors).toEqual([]);expect(C.posRows([o])[0].slice(8,13)).toEqual(["00001","霧藍","02","5尺","05"]);}
  });
  it("枕頭對到床包會提醒，明確確認後仍保留原貨號，不自動換品",()=>{
    const o=example();o.items[0]=C.applyProduct({...o.items[0],paperName:"好眠枕頭"},product);expect(C.nameReference(o.items[0].name,o.items[0].paperName).conflict).toBe(true);expect(()=>C.posRows([o])).toThrow(/品名差異/);o.items[0].nameHintAcknowledged=true;expect(C.posRows([o])[0][8]).toBe("00001");
  });
  it("床包枕套組的簡寫枕套不誤報；無法確定類型時不猜測",()=>{expect(C.nameReference("天絲床包枕套組","枕套").conflict).toBe(false);expect(C.nameReference("天絲床包","Harmony").conflict).toBe(false);expect(C.nameReference("枕套","枕頭套").conflict).toBe(false);expect(C.nameReference("枕套","枕頭").conflict).toBe(true);});
  it("簡寫搜尋只列候選，同貨號不同尺寸均保留，必須明確選用",()=>{
    const p2={...product,sku:"A02",size:"6尺"},p3={...product,sku:"A02",size:"7尺"};const master={bySku:new Map([[product.sku,[product]],["A02",[p2,p3]]])};const original={sku:"錯字",paperName:"天絲床包",quantity:3,unitPrice:99,saleType:"訂貨"};
    const candidates=C.searchProducts(master,original.paperName);expect(candidates).toHaveLength(3);expect(original.sku).toBe("錯字");const chosen=C.applyProduct(original,p3,{manual:true});expect(chosen).toMatchObject({sku:"A02",size:"7尺",manualConfirmed:true,matchStatus:"selected",quantity:3,unitPrice:99,saleType:"訂貨",paperName:"天絲床包"});expect(C.searchProducts(master,"")).toEqual([]);
  });
  it("主檔後續變更不覆蓋已確認快照，人工選用也不改價或移除停用品",()=>{const record={...product,discontinued:true};const item=C.applyProduct({quantity:2,unitPrice:0,zeroConfirmed:true,paperName:"床包"},record,{manual:true});record.name="新版名稱";record.color="新版色";expect(item.name).toBe(product.name);expect(item.color).toBe("霧藍");expect(item.discontinued).toBe(true);expect(item.unitPrice).toBe(0);});
});
describe("版本與資產",()=>{
  it("版本不一致或查詢失敗停止操作，更新網址穿透快取",async()=>{const g=new VersionGuard(async()=>({ok:true,json:async()=>({version:"future"})}));expect(await g.check()).toBe(false);await expect(g.require()).rejects.toThrow(/重新載入/);expect(g.reloadUrl()).toMatch(/deploy=future&reload=\d+/);const bad=new VersionGuard(async()=>{throw Error();});expect(await bad.check()).toBe(false);});
  it("執行版本、HTML資產、首頁入口與所有操作頁的no-store一致",()=>{const html=readFileSync("../store-orders/index.html","utf8"),home=readFileSync("../index.html","utf8"),headers=readFileSync("../_headers","utf8"),version=JSON.parse(readFileSync("../store-orders/version.json","utf8"));expect(version.version).toBe(C.VERSION);expect(html).toContain(`cloud.js?v=${C.VERSION}`);const catalog=JSON.parse(readFileSync("../homepage/catalog.json","utf8")),entry=catalog.tools.find(t=>t.id==="store-orders");if(entry.href===null){expect(entry.status).toBe("開發中");expect(home).not.toContain('href="/store-orders/');}else{expect(entry.href).toBe(`/store-orders/?deploy=${C.VERSION}`);expect(home).toContain(entry.href);}for(const path of ["/store-orders","/store-orders/","/store-orders/index.html","/store-orders/paper.html","/store-orders/version.json"])expect(headers).toContain(`${path}\n  Cache-Control: no-store, max-age=0, must-revalidate`);expect(html).not.toContain(" 'unsafe-eval'");});
});

it("其它門市代號保持POS三倉與數量金額",()=>{
 const o=example();o.storeCode="TEST-99";expect(C.validateOrder(o,{complete:true}).errors).toEqual([]);
 const bytes=X.write(C.buildPOS([o],X,{mode:"test"}),C.WRITE_OPTIONS),wb=X.read(bytes,C.READ_OPTIONS),rows=X.utils.sheet_to_json(wb.Sheets.Sheet1,{header:1,raw:true,defval:""});
 expect(rows[2].slice(2,5)).toEqual(["TEST-99","TEST-99","TEST-99"]);expect(rows[3].slice(2,5)).toEqual(["TEST-99","TEST-99","T00"]);C.assertConservation([o],rows.slice(2));
 for(const code of ["", "其它", "r99", "R 99", "=R99", "A".repeat(17)]){o.storeCode=code;expect(C.validateOrder(o).errors).toContain("門市代號格式錯誤");expect(()=>C.warehouses(code,"銷貨")).toThrow();}
});

it("已確認組合分配的POS真實格式往返，保留列數件數收款與混合銷別",()=>{const o=example();o.items.forEach(i=>i.priceGroupId="bundle-001");o.priceGroups=[{id:"bundle-001",amount:250,allocationConfirmed:true}];const bytes=X.write(C.buildPOS([o],X,{mode:"test"}),C.WRITE_OPTIONS),wb=X.read(bytes,C.READ_OPTIONS),rows=X.utils.sheet_to_json(wb.Sheets.Sheet1,{header:1,raw:true,defval:""});expect(rows.slice(2).map(r=>r[16])).toEqual([2,1]);expect(rows[2].slice(2,5)).toEqual(["R00","R00","R00"]);expect(rows[3].slice(2,5)).toEqual(["R00","R00","T00"]);C.assertConservation([o],rows.slice(2));expect(C.totals(o).amountCents).toBe(25000);});

it("發布版本與資產雜湊JSON必須明確允許提交，不能被通用資料保護規則排除",()=>{const ignore=readFileSync("../.gitignore","utf8");for(const file of ["store-orders/version.json","store-orders/guest/version.json","store-orders/vendor/SHA256.json"])expect(ignore.split(/\r?\n/)).toContain("!"+file);expect(ignore).not.toContain("!store-orders/**/*.json");});

it("全新人工訂單初始化空組合清單，未辨識也可直接新增商品",()=>{const o=C.newOrder("manual-draft-001","R14","2026-10-30");expect(o.priceGroups).toEqual([]);o.items.push({sku:"A103088",quantity:1,unitPrice:100,saleType:"銷貨"});expect(o.priceGroups.find(g=>g.id===o.items[0].priceGroupId)).toBeUndefined();expect(C.totals(o).amountCents).toBe(10000);});

it('門市顯示去除代號與名稱相同的重複值',()=>{for(const name of ['R14',' R14 ','',undefined])expect(C.storeLabel('R14',name)).toBe('R14');expect(C.storeLabel('R01','台中北屯門市')).toBe('R01・台中北屯門市');});
