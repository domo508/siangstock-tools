// Candidate matching only. No replenishment, purchase or approval side effects.
const MS_PRODUCT_POLICY='20261105-marketing-batch-policy-r10';
const MS_STORE_NAMES=[['R00','台北中山',['台北中山','中山']],['R01','台中北屯',['台中北屯','北屯']],['R03','新竹東區',['新竹東區','新竹']],['R06','文心秀泰',['文心秀泰','文心']],['R07','誠品480',['誠品480','誠品４８０']],['R10','新莊',['新莊']]];
function marketingStoreScope_(channel,text){
  if(!channel.includes('門市'))return channel==='待確認'?'待確認':'不適用（非門市通路）';
  text=channel+'\n'+text;
  // Never turn an unknown or negated explicit restriction into all stores.
  if(/指定門市|部分門市|門市名單|排除.*門市|除.*門市|門市不適用|不含.*門市/.test(text))return '指定門市待確認';
  if(MS_STORE_NAMES.some(s=>s[2].some(n=>new RegExp('(?:排除|不含|不適用|除外)[^\n]{0,8}'+n).test(text))))return '指定門市待確認';
  const explicitLocations=[...text.matchAll(/(?:^|[、，])\s*([\u4e00-\u9fff]{2,8})(?:門市|分店)(?=$|[限定：:\s、，])/gm)].map(m=>m[1]);
  if(explicitLocations.some(n=>!/^(全部|全台|所有|一般|實體|全省|全館|本活動|本次活動|活動|官網)$/.test(n)&&!MS_STORE_NAMES.some(s=>s[2].some(alias=>n.includes(alias)))))return '指定門市待確認';
  const names=MS_STORE_NAMES.filter(s=>s[2].some(n=>text.includes(n))||new RegExp('(?:^|[^A-Z0-9])'+s[0]+'(?![A-Z0-9])','i').test(text)).map(s=>s[0]+s[1]);
  if(names.length)return names.join('、');
  if(/(?:限定|僅限|限於|適用)[：:\s]*[^\n，,；;]{1,16}(?:門市|分店)/.test(text)&&!/全部門市|全台門市/.test(text))return '指定門市待確認';
  const specific=text.replace(/(?:本活動|本次活動|活動|商品|優惠|全台|全部|實體)?門市限定/g,'門市限定');
  if(/(?:[\u4e00-\u9fff]{2,8})(?:店限定|門市限定)/.test(specific))return '指定門市待確認';
  return '全部門市';
}
function marketingNorm_(s){return String(s||'').normalize('NFKC').toLowerCase().replace(/[\s\[\]【】()（）「」『』\-－—_，,。:：/／｜|×*]/g,'');}
// Hard exclusions apply to automatic matching and manual additions alike.
// Dimensions alone are not evidence of customization: many normal items have L/W/H.
function marketingProductExclusion_(p){
  const sku=String(p.sku||'').normalize('NFKC').trim().toUpperCase();
  if(/^(?:SA|SB|OA|OB)/.test(sku))return '客製品號開頭（SA／SB／OA／OB）';
  const off=String(p.off??'').normalize('NFKC').trim().toLowerCase();
  if(/^(?:是|true|1|y|yes|已下架|下架)$/.test(off))return '商品主檔已下架';
  if(/客製|客制|訂製|訂制/.test(String(p.name||'')))return '品名明示客製／訂製';
  if(['C41879','C41888','C41889','C41891','C41892','C41894','C41899','C41904','C41909','C41910','C41918','C41921','C41922'].includes(sku))return '已確認特殊規格品號';
  const name=String(p.name||'').normalize('NFKC'),size=String(p.size||'').normalize('NFKC');
  if(/床包|床裙|被套/.test(name)&&/(?:其它|其他|特殊|非標準)尺寸|特殊規格|客製/.test(size)&&/\d+(?:\.\d+)?\s*[xX×＊*]\s*\d+(?:\.\d+)?(?:\s*[xX×＊*]\s*\d+(?:\.\d+)?)?\s*(?:cm|公分)/i.test(name))return '主檔非標準尺寸床寢品（疑似客製）';
  return '';
}
function marketingMasterRows_(rows){
  const aliases={sku:['貨號','ERP品號','品號','商品編號'],name:['品名','商品名稱','商品品名'],category:['主類別','大類','商品大類'],material:['款式類別','材質'],size:['尺碼','尺寸','尺碼組'],series:['系列'],brand:['品牌','品牌英文名稱'],status:['貨品狀態'],off:['已下架']};
  const headers=rows.slice(0,10).map((r,i)=>({r,i})).filter(x=>aliases.sku.some(a=>x.r.includes(a))&&aliases.name.some(a=>x.r.includes(a)));
  if(headers.length!==1)throw new Error('商品主檔需有唯一貨號／品名表頭。');
  const h=headers[0],fields={};Object.keys(aliases).forEach(k=>fields[k]=aliases[k].map(a=>h.r.indexOf(a)).filter(i=>i>=0));
  const products=[],seen=new Set();
  rows.slice(h.i+1).forEach((row,i)=>{
    const get=k=>{const values=fields[k].map(j=>String(row[j]||'').trim()).filter(Boolean);if(['sku','name'].includes(k)){if(new Set(values).size>1)throw new Error('主檔同列有互相衝突的'+k+'欄位。');return values[0]||'';}return values.join(' ');};
    const sku=get('sku').toUpperCase(),name=get('name');if(!sku&&!name)return;
    if(!sku||!name||!/^[A-Z0-9][A-Z0-9._/-]*$/.test(sku))throw new Error('商品主檔第'+(h.i+i+2)+'列貨號／品名不完整。');
    if(seen.has(sku))throw new Error('商品主檔貨號重複：'+sku);seen.add(sku);
    const p={sku,name,category:get('category'),material:get('material'),size:get('size'),series:get('series'),brand:get('brand'),status:get('status'),off:get('off')};
    p.search=marketingNorm_([p.name,p.category,p.material,p.size,p.series,p.brand].join(' '));products.push(p);
  });
  if(!products.length)throw new Error('商品主檔沒有可比對品項，不使用空集合。');return products;
}
function marketingProductQuery_(row,gift){
  const text=String(row[2]||'').split('\n')[0];
  // A numbered limited-price list carries its product after the heading separator.
  let query=text.includes('｜')?text.split('｜').pop():text;
  if(gift&&row[0]!=='買一送一'&&/贈(?:送)?|即送|就送/.test(query))query=query.split(/(?:再)?贈(?:送)?|即送|就送/).slice(1).join(' ').split(/[（(，,]/)[0].replace(/(?:乙|一|\d+)\s*(?:入|組|張|包|份|顆|雙|罐)\s*$/,'');
  query=query.split(/不額外|不同享|不與|排除|折扣碼/)[0];
  query=query.replace(/^\d+[、.．]\s*/,'').replace(/^(?:商品優惠|限定優惠價)[：:]?\s*/,'');
  query=query.split(/原價|特價|售價|優惠價|單件現折|系列滿|滿\s*\$?\s*\d|\s*\d{1,2}\s*折|[-－]\s*\$|\$\s*\d/)[0];
  return query.replace(/買一送一.*$/,'').replace(/^(全館|全站)不限金額/,'$1').trim();
}
function marketingProductCandidates_(row,products,gift){
  const explicit=gift?String(row[11]||'').split(/[、,，\s]+/).filter(Boolean):marketingSkus_(row[2]);
  const role=gift?(row[0]==='加價購'?'加價購品':'贈品'):'優惠商品';
  if(gift&&row[0]==='抽獎資格')return {label:'抽獎資格（非配發商品）',role:'抽獎資格',candidates:[],notApplicable:true};
  if(!gift&&marketingWholeStoreOffer_(row))return {label:'全館優惠，不需逐品號確認',role:'全館優惠',candidates:[],notApplicable:true};
  const query=marketingProductQuery_(row,gift),q=marketingNorm_(query),all=/^(全館|全站|全系列)/.test(query);
  const tokens=['華爾紗','埃及棉','精梳棉','精梳純棉','純棉','天絲','雙層紗','水洗棉','印花樂','pingu','semo','secondmorning','primario','sybil','兩用被套','薄被套','床包','床裙','枕套','抱枕套','浴巾','毛巾','蓋毯','四季被','枕頭','枕墊','麻糬被','熊冷墊','熊暖墊','髮帶','零錢包','床墊','洗衣膠囊','搓澡球','擦澡球'];
  // Prefer the most specific nested term (e.g. 薄被套 rather than 被套).
  const terms=tokens.filter(t=>q.includes(t)).filter(t=>!tokens.some(o=>o!==t&&q.includes(o)&&o.includes(t)));
  const dimensions=['單人','雙人','加大','特大'].filter(t=>q.includes(t));
  let residual=q.replace(/全館|全站|全系列|全尺寸|系列|床寢|寢具|商品|小物/g,'');
  [...terms,...dimensions].forEach(t=>residual=residual.replace(t,''));residual=residual.replace(/\d+入/g,'');
  const pack=q.match(/\d+入/)?.[0]||'';
  let candidates=[];
  if(explicit.length){
    candidates=explicit.map(sku=>{const p=products.find(p=>p.sku===sku.toUpperCase());return {product:p||{sku:sku.toUpperCase(),name:'主檔無此品號'},basis:p?'ERP品號精準命中':'主檔無此品號，禁止確認',missing:!p};});
  }else if(q){
    candidates=products.filter(p=>{
      if(all&&!q.replace(/^(全館|全站|全系列)/,'').trim())return true;
      if(!terms.length){
        if(!p.search.includes(q))return false;
        if(/枕$|枕頭$/.test(query)&&/枕套|抱枕套/.test(p.name))return false;
        if(!/贈品|組合/.test(query)&&(/^(?:O[A-Z0-9])/.test(p.sku)||/^(?:贈品|贈-)/.test(p.name)))return false;
        return true;
      }
      if(!terms.every(t=>p.search.includes(t)))return false;
      if(residual&&!p.search.includes(residual))return false;
      if(pack&&!p.search.includes(pack))return false;
      if(/床寢|寢具/.test(query)&&!/床包|床裙|被套|枕套/.test(p.search))return false;
      if(dimensions.length&&!dimensions.some(d=>d==='單人'?/單人|3\.5尺|4\.5.*6\.5/.test(p.search):d==='雙人'?/雙人|5尺|6x7|6×7/.test(p.search):p.search.includes(d)))return false;
      return true;
    }).map(product=>({product,basis:(gift?'贈品／加購名稱候選（不是購買資格商品）；':'')+(all?'全館範圍候選，排除條件須覆核':terms.length?'商品條件：'+terms.join('＋')+(dimensions.length?'；尺寸：'+dimensions.join('／'):''):'商品名稱包含：'+query)}));
  }
  const exclusion=String(row[8]||'');
  candidates=candidates.filter(c=>!marketingProductExclusion_(c.product));
  candidates=candidates.map(c=>{
    const p=c.product,reasons=[];
    if(!explicit.length&&/小物/.test(query))reasons.push('小物範圍需人工確認，不自動納入整個品牌');
    for(const word of ['出清','特賣','福利品','寄賣','限定折扣'])if(exclusion.includes(word)&&[p.name,p.category,p.status].join(' ').includes(word))reasons.push('活動排除：'+word);
    if(/停產|停用|停止/.test(p.status||''))reasons.push('主檔狀態：'+p.status);
    if(/SEMO買一送一/i.test(exclusion)&&/semo|secondmorning/.test(p.search||''))reasons.push('SEMO買一送一排除條件需人工確認');
    return {...c,include:!c.missing&&!reasons.length,basis:[c.basis,...reasons].join('；')};
  });
  return {label:explicit.length?(role+'品號精準比對'):query||'商品條件待確認',role,candidates,notApplicable:false};
}
function enrichMarketingProducts_(draft,master,run){
  const snapshots=[];draft['活動商品明細']=[];
  ['活動案型','贈品／加價購案型'].forEach(name=>draft[name].forEach(row=>{
    const h=MS_TABLES[name],id=row[h.indexOf('案型識別碼')],m=marketingProductCandidates_(row,master.products,name==='贈品／加價購案型');
    if(row[7]==='請依完整內容確認商品集合'&&m.candidates.length)row[7]=name==='活動案型'?m.label:'購買資格依完整優惠內容；贈品／加價購品見商品明細';
    const details=m.candidates.map(c=>[Boolean(c.include),c.product.sku,c.product.name,c.basis,m.role,'待確認','返回主表',id,run,master.fingerprint,name,0]);
    if(!details.length&&!m.notApplicable)details.push([false,'','未找到可確認的商品，請補明確品號或商品條件','未命中；不可當成空集合已確認',m.role,'待確認','返回主表',id,run,master.fingerprint,name,0]);
    const status=m.notApplicable?'不適用（免逐品號確認）':'待確認';
    row.push(m.notApplicable?'':m.label+'\n候選'+m.candidates.length+'筆｜已選'+details.filter(d=>d[0]&&d[1]).length+'筆｜待確認',status,m.notApplicable?'':'查看品項明細');
    snapshots.push({id,run,name,notApplicable:m.notApplicable,offerHash:marketingOfferHash_(row),matchHash:marketingMatchHash_(row),details});
    draft['活動商品明細'].push(...details);
  }));
  if(draft['活動商品明細'].length>200000)throw new Error('商品候選超過20萬筆，停止產生，請縮小活動範圍。');
  return snapshots;
}
function marketingOfferHash_(row){return marketingHash_(row.slice(0,10).concat(row.length>=20?row.slice(11,15):[]).map(String));}
function marketingMatchHash_(row){return marketingHash_([row[0],row[2],row[7],row[8],...(row.length>=20?[row[11]]:[])].map(String));}
function marketingDetailHash_(rows,includeSelection){return marketingHash_(rows.map(r=>[...(includeSelection?[r[0]]:[]),...r.slice(1,5),...r.slice(7,12)]).sort((a,b)=>{const x=JSON.stringify(a),y=JSON.stringify(b);return x<y?-1:x>y?1:0;}));}
