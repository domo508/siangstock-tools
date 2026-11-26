// Pure workflow rules. No network, spreadsheet writes, or AI side effects.
const MS_WORKFLOW_VERSION='20261125-marketing-channel-r3';
const MS_WORKFLOW_READ_VERSIONS=['20261123-marketing-workflow-r1','20261123-marketing-workflow-r2',MS_WORKFLOW_VERSION];
function marketingWorkflowVariantKey_(type,channel,skus){return marketingHash_([type,channel,[...skus].sort()]);}
function marketingWorkflowVariantKeys_(variants){
 const base=variants.map(v=>marketingWorkflowVariantKey_(v.type,v.channel,v.skus));
 const keys=variants.map((v,i)=>base.filter(k=>k===base[i]).length===1?base[i]:marketingHash_(encodeURIComponent(JSON.stringify([base[i],'qualified-variant-r1',v.type,v.channel,v.stores,v.start,v.end,v.threshold,v.quantity,v.relationship,v.restrictions].map(marketingWorkflowNormalize_)))));
 if(new Set(keys).size!==keys.length)throw new Error('同活動的通路／門市／贈品條件仍不唯一，請拆分或確認對應。');return keys;
}
function marketingWorkflowNormalize_(value){return String(value||'').normalize('NFKC').replace(/\s+/g,'').replace(/^[*＊]/,'');}
function marketingWorkflowDateEvidence_(date,text){
 if(!date)return true;
 const m=date.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);if(!m)return false;
 const raw=String(text).normalize('NFKC'),month=Number(m[2]),day=Number(m[3]),hour=Number(m[4]);
 return new RegExp('(?:^|[^0-9])(?:'+m[1]+'[-/年])?0?'+month+'(?:[-/月])0?'+day+'(?:日)?(?:[^0-9]|$)').test(raw)&&new RegExp('(?:^|[^0-9])0?'+hour+':'+m[5]+'(?:[^0-9]|$)').test(raw);
}
// Normalize only unambiguous spellings of the same two channels. Platform,
// marketplace, unknown and mixed unsupported channels must not become website.
function marketingWorkflowChannel_(value,cell,name){
 const raw=String(value),text=raw.normalize('NFKC').replace(/\s+/g,'');
 if(!text)return '';
 const parts=text.split(/[+＋／/、與及和]/);
 if(parts.length<=2&&parts.every(p=>p==='門市'||p==='官網')&&new Set(parts).size===parts.length){
  return parts.length===2?'門市＋官網':parts[0];
 }
 const safe=v=>String(v).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,100);
 throw new Error('AI通路無效：'+safe(cell)+'｜活動「'+safe(name)+'」｜回傳「'+safe(raw)+'」。僅接受門市、官網或門市＋官網；請由管理者核對，原草稿未變更，請勿重複送出。');
}
function marketingWorkflowValidate_(source,extraction){
 if(!extraction||!Array.isArray(extraction.activities)||!extraction.activities.length||extraction.activities.length>100||!Array.isArray(extraction.context))throw new Error('AI未回傳完整活動清單。');
 const cells=new Map(source.cells.map(c=>[c.ref,c])),coverage=new Map(source.cells.map(c=>[c.ref,Array(c.raw.length).fill(false)])),ranges=new Map();
 const cover=(ref,text,unique)=>{const c=cells.get(ref);if(!c||typeof text!=='string'||!text.trim()||!c.raw.includes(text))throw new Error('AI原文依據不符：'+ref);const start=c.raw.indexOf(text);if(unique&&c.raw.indexOf(text,start+1)!==-1)throw new Error('活動原文重複，無法唯一對應：'+ref);if(unique){const r=ranges.get(ref)||[];if(r.some(([a,b])=>start<b&&start+text.length>a))throw new Error('AI活動段落重疊，需人工確認。');r.push([start,start+text.length]);ranges.set(ref,r);}for(let i=start;i<start+text.length;i++)coverage.get(ref)[i]=true;return start;};
 const types=['折扣／商品優惠','限定價','滿額優惠','折扣碼','加價購','滿額／滿件贈','購物贈','買一送一','抽獎資格'];
 const activities=extraction.activities.map((a,index)=>{
  const start=cover(a.cell,a.evidence,true);if(!Array.isArray(a.support)||!Array.isArray(a.variants)||!a.variants.length||a.variants.length>12)throw new Error('活動變體資料不完整。');a.support.forEach(t=>cover(a.cell,t,false));
  const evidence=marketingWorkflowNormalize_([a.evidence,...a.support].join('\n'));
  const variants=a.variants.map(v=>{
   const fields=['name','type','content','start','end','channel','stores','exclusions','restrictions','quantity','threshold','relationship','mode','series'];
   if(fields.some(k=>typeof v[k]!=='string'||v[k].length>5000||/^\s*[=+@-]/.test(v[k]))||!v.name.trim()||!v.content.trim()||!types.includes(v.type)||!['sku','series','keywords','whole','none'].includes(v.mode)||typeof v.needsConfirmation!=='boolean'||!Array.isArray(v.questions)||v.questions.some(t=>typeof t!=='string')||!Array.isArray(v.skus)||!Array.isArray(v.queries)||v.queries.length>50)throw new Error('AI活動欄位不符合格式。');
   const channel=marketingWorkflowChannel_(v.channel,a.cell,v.name);
   for(const date of [v.start,v.end])if(date&&(!/^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date.replace(' ','T')+':00Z').toISOString().slice(0,10)!==date.slice(0,10)))throw new Error('AI日期無效。');
   if(v.start&&v.end&&Date.parse(v.start)>Date.parse(v.end))throw new Error('活動結束早於開始。');
   if(v.skus.some(s=>typeof s!=='string'||!/^[A-Z0-9][A-Z0-9._/-]*$/.test(s)||!evidence.includes(marketingWorkflowNormalize_(s))))throw new Error('AI編造或誤用原文未列品號。');
   if(v.queries.some(q=>!Array.isArray(q)||!q.length||q.length>12||q.some(t=>typeof t!=='string'||!t.trim()||!evidence.includes(marketingWorkflowNormalize_(t)))))throw new Error('商品條件必須有原文依據；同義詞須另行確認。');
   if(v.series&&!evidence.includes(marketingWorkflowNormalize_(v.series)))throw new Error('系列名稱沒有原文依據。');
   const rawEvidence=[a.evidence,...a.support].join('\n'),missingDates=['start','end'].filter(k=>v[k]&&!marketingWorkflowDateEvidence_(v[k],rawEvidence));
   const validated=Object.assign({},v,{channel,skus:[...new Set(v.skus)],questions:[...new Set(v.questions)]});
   if(missingDates.length){missingDates.forEach(k=>validated[k]='');validated.needsConfirmation=true;validated.questions.push('日期／時間原文依據不足，請人工確認開始及結束時間；未沿用AI推測日期。');}
   return marketingScopeApply_(a.evidence,validated);
  });
  const marker=a.evidence.match(/〔活動ID:(M\d{6}-A[a-f0-9]{16})〕/);
  return {index,cell:a.cell,evidence:a.evidence,support:a.support,start,sourceId:marker?marker[1]:'',variants};
 });
 extraction.context.forEach(x=>{if(typeof x.reason!=='string'||!x.reason.trim())throw new Error('共用文字缺少解析說明。');cover(x.cell,x.text,false);});
 source.cells.forEach(c=>{for(let i=0;i<c.raw.length;i++)if(!coverage.get(c.ref)[i]&&!/\s/.test(c.raw[i]))throw new Error('AI遺漏原文內容：'+c.ref+'；未啟用新草稿。');});
 return activities;
}
function marketingWorkflowResolve_(activities,prior,period,mapping,uuid){
 const used=new Set();return activities.map(a=>{
  let sid=a.sourceId||a.allocatedSid,reason=a.allocatedSid&&!a.sourceId?'首次建立':'固定活動識別碼';
  if(sid){if(!new RegExp('^M'+period+'-A[a-f0-9]{16}$').test(sid)||(a.sourceId&&!prior.some(p=>p.sid===sid)))throw new Error('來源活動碼未知或月份不同，需管理者確認。');}
  else{
   const exact=prior.filter(p=>marketingWorkflowNormalize_(p.evidence)===marketingWorkflowNormalize_(a.evidence));
   if(exact.length===1){sid=exact[0].sid;reason='唯一原文一致';}
   else if(mapping&&Object.prototype.hasOwnProperty.call(mapping,String(a.index))){const chosen=mapping[a.index];if(chosen==='new'){sid='M'+period+'-A'+uuid().replace(/-/g,'').slice(0,16);reason='人工確認新增';}else if(prior.some(p=>p.sid===chosen)){sid=chosen;reason='人工確認對應';}else throw new Error('對應活動選擇無效。');}
   else if(!prior.length){sid='M'+period+'-A'+uuid().replace(/-/g,'').slice(0,16);reason='首次建立';}
   else return Object.assign({},a,{sid:'',reason:'需確認對應',options:prior.map(p=>({sid:p.sid,name:p.name||p.evidence.slice(0,60)}))});
  }
  if(used.has(sid))throw new Error('多個活動對應同一固定碼；拆分／合併須明確處理。');used.add(sid);return Object.assign({},a,{sid,reason});
 });
}
function marketingWorkflowCandidates_(v,products){
 const gift=['加價購','滿額／滿件贈','購物贈','買一送一'].includes(v.type),role=gift?(v.type==='加價購'?'加價購品':'贈品'):'優惠商品';
 if(['whole','none'].includes(v.mode)||v.type==='抽獎資格')return {role,candidates:[],notApplicable:true};
 const explicit=v.skus.length?v.skus:[],eligible=products.filter(p=>!marketingProductExclusion_(p));
 const selected=explicit.length?explicit.map(s=>{const p=products.find(p=>p.sku===s);if(!p)throw new Error('主檔沒有明確品號：'+s);if(marketingProductExclusion_(p))throw new Error('明確品號屬排除品：'+s);return p;}):eligible.filter(p=>v.queries.some(q=>q.every(t=>p.search.includes(marketingNorm_(t)))));
 const candidates=selected.filter(product=>marketingScopeProduct_(product,v.scopeGuard).eligible).map(product=>{const scope=marketingScopeProduct_(product,v.scopeGuard);const stopped=/停產|停用|停止/.test(product.status||'');const reasons=['出清','特賣','福利品','寄賣'].filter(t=>v.exclusions.includes(t)&&[product.name,product.category,product.status].join(' ').includes(t));return {product,include:!v.needsConfirmation&&!stopped&&!reasons.length&&!scope.uncertain,basis:(explicit.length?'ERP品號精準命中':'AI原文條件候選')+(v.needsConfirmation?'；範圍需人工確認，不自動納入':'')+(scope.reason?'；'+scope.reason:'')+(stopped?'；主檔狀態待確認':'')+(reasons.length?'；活動排除：'+reasons.join('、'):'')};});
 return {role,candidates,notApplicable:false};
}
function marketingWorkflowPatchText_(raw,evidence,replacement){
 const at=raw.indexOf(evidence);if(!evidence||at<0||raw.indexOf(evidence,at+1)!==-1)throw new Error('原活動段落已變更或不唯一，停止回寫。');
 if(typeof replacement!=='string'||replacement.length>30000)throw new Error('回寫內容超過上限。');return raw.slice(0,at)+replacement+raw.slice(at+evidence.length);
}
function marketingWorkflowSourceText_(sid,variants){
 const blocks=variants.map(v=>{
  const r=v.values,selected=v.products||[],members=selected.map(p=>p.sku+'｜'+p.name).join('、'),scope=v.series?'參加系列：'+v.series+(members?'\n實際納入商品：'+members:''):members?'參加商品：'+members:'適用商品／範圍：'+r[7];
  const conditions=['活動名稱：'+r[1],'完整優惠內容：\n'+String(r[2]).replace(/^\s*[*＊]/,''),'期間：'+r[3]+'～'+r[4],'通路版本：'+r[5],'適用門市：'+r[6],scope,'排除條件：'+r[8],r[9]?'搭配限制：'+r[9]:''];
  if(v.gift)conditions.push('贈品／加購貨號：'+r[11],'每次數量：'+r[12],'門檻／購買前提：'+r[13],'累贈／並贈：'+r[14]);
  return conditions.filter(Boolean).join('\n');
 });return '〔活動ID:'+sid+'〕\n'+blocks.join('\n\n');
}
