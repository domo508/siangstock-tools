import {it,expect} from 'vitest';
import {costUnits,allocateBundle,resolvedERPPrices} from '../../store-orders/bundle-pricing.js';
import * as C from '../../store-orders/core.js';
const item=(cost,quantity=1)=>({sku:'S',quantity,unitPrice:'',priceGroupId:'g',costSnapshot:{sku:'S',value:cost,field:'成本價',masterVersion:'MASTER-1',status:'provided'}});
const order=(items,amount=2974)=>({items,priceGroups:[{id:'g',paperCode:'A',pricingMode:'total_only',amount}]});
it('2974元依成本1比2拆價，量價與總價守恆且不改寫紙本價格',()=>{const o=order([item(100),item(200)]),before=structuredClone(o),a=allocateBundle(o,o.priceGroups[0]);expect(a.lines.map(l=>l.unitPrice)).toEqual([991,1983]);expect(a.lines.reduce((n,l)=>n+l.amountCents,0)).toBe(297400);expect(o).toEqual(before);expect(resolvedERPPrices(o).prices.get(0)).toBe(991);});
it('成本權重包含數量，ERP每列單價而非列總額',()=>{const o=order([item(200,2),item(300)],700),a=allocateBundle(o,o.priceGroups[0]);expect(a.lines.map(l=>l.unitPrice)).toEqual([200,300]);expect(a.lines.map(l=>l.amountCents)).toEqual([40000,30000]);});
it('整元單價尾差仍保持數量不變，無法守恆時阻擋',()=>{const o=order([item(100,2),item(200,2)]),a=allocateBundle(o,o.priceGroups[0]);expect(a.lines.reduce((n,l)=>n+l.quantity*C.cents(l.unitPrice),0)).toBe(297400);expect(()=>allocateBundle(order([item(100,2),item(200,2)],2974.01),{id:'g',amount:2974.01})).toThrow(/含小數/);});
it('三列組合及零元整組可分配且只計一次，成本仍須有效',()=>{for(const amount of [0,1,2974]){const o=order([item(100),item(200),item(300)],amount),a=allocateBundle(o,o.priceGroups[0]);expect(a.lines.reduce((n,l)=>n+l.amountCents,0)).toBe(C.cents(amount));expect(a.lines).toHaveLength(3);}});
it.each(['',null,0,-1,'#VALUE!','abc','1.1234567'])('缺漏零成本或無效成本 %s 不猜比例',cost=>{const o=order([item(cost),item(200)]);expect(()=>allocateBundle(o,o.priceGroups[0])).toThrow(/成本/);});
it('成本欄位與版本記錄不完整拒絕，六位內小數成本精確保留',()=>{expect(costUnits('12.1234')).toBe(12123400n);const o=order([item(100),item(200)]);delete o.items[0].costSnapshot.masterVersion;expect(()=>allocateBundle(o,o.priceGroups[0])).toThrow(/快照/);});

it('四捨五入尾差可分配到多列，每列皆整元且不更改數量',()=>{const o=order(Array.from({length:10},()=>item(100)),5),a=allocateBundle(o,o.priceGroups[0]);expect(a.lines.map(l=>l.unitPrice).sort()).toEqual([0,0,0,0,0,1,1,1,1,1]);expect(a.lines.every(l=>Number.isInteger(l.unitPrice)&&l.quantity===1)).toBe(true);expect(a.lines.reduce((n,l)=>n+l.amountCents,0)).toBe(500);});
it('總價為整元但數量約束不相容時不偷改價格或拆列',()=>{const o=order([item(100,2),item(200,2)],2973);expect(()=>allocateBundle(o,o.priceGroups[0])).toThrow(/整元/);});

it('貨號更換不能沿用舊貨號成本',()=>{const o=order([item(100),item(200)]);o.items[0].sku='OTHER';expect(()=>allocateBundle(o,o.priceGroups[0])).toThrow(/快照/);});
it('無法在合理整元尾差內符合成本比例時不將全部金額硬塞另一列',()=>{const o=order([item(100,100000),item(100)],2974);expect(()=>allocateBundle(o,o.priceGroups[0])).toThrow(/尾差/);});
