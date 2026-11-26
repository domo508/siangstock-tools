import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {xml2js} from 'xml-js';
export function xmlService(){
  const wrap=node=>({getName:()=>node.name.split(':').pop(),getNamespace:()=>'',
    getText:()=> (node.elements||[]).map(e=>e.text??e.cdata??'').join(''),
    getChildren:(name)=> (node.elements||[]).filter(e=>e.type==='element'&&(!name||e.name.split(':').pop()===name)).map(wrap),
    getChild(name){return this.getChildren(name)[0]||null;},
    getAttributes:()=>Object.entries(node.attributes||{}).map(([k,v])=>({getName:()=>k.split(':').pop(),getValue:()=>String(v)})),
    getAttribute:name=>node.attributes?.[name]===undefined?null:{getValue:()=>String(node.attributes[name])}
  });
  return {parse:text=>({getRootElement:()=>wrap(xml2js(text,{compact:false}).elements.find(e=>e.type==='element'))})};
}
export function runtime(extra={}){
  const entries=new Map(),cache={get:k=>{const r=entries.get(k);return r&&Date.now()<r.until?r.value:null;},getAll:keys=>Object.fromEntries(keys.map(k=>[k,cache.get(k)]).filter(([,v])=>v!==null)),put:(k,value,ttl)=>entries.set(k,{value,until:Date.now()+ttl*1000}),putAll:(values,ttl)=>Object.entries(values).forEach(([k,v])=>cache.put(k,v,ttl)),remove:k=>entries.delete(k)};
  extra={CacheService:{getDocumentCache:()=>cache},...extra};
  const ctx=vm.createContext({console,XmlService:xmlService(),Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,v)=>[...crypto.createHash('sha256').update(typeof v==='string'?v:Buffer.from(v)).digest()]},...extra});
  if(process.env.MARKETING_TEST_BUNDLE){vm.runInContext(fs.readFileSync(process.env.MARKETING_TEST_BUNDLE,'utf8'),ctx);return ctx;}
  for(const file of ['XlsxSax','CodeV2','ProductMatch','MasterReader','ProductsReview','Navigation','PreviewStorage','ReviewTools','UnifiedReview','ReviewPanel','PeriodPicker','MonthResume','History','ScopeRules','WorkflowCore','Workflow','WorkflowEdit','BatchActions','WorkflowSetup','WorkflowPanel'])vm.runInContext(fs.readFileSync(new URL('../../../procurement-planning/marketing-sync/'+file+'.gs',import.meta.url),'utf8'),ctx);
  return ctx;
}
const header=['貨號','品名','主類別','款式類別','尺碼','系列','品牌','貨品狀態','已下架'];
const rows=[header,['A1','華爾紗兩用被套 雙人','被套','華爾紗','6x7','','','','否'],['A2','華爾紗兩用被套 單人','被套','華爾紗','單人','','','','否'],['A3','埃及棉浴巾','浴巾','埃及棉','','','','','否'],['A4','特賣天絲床包','床包','天絲','','','','','否'],['A5','天絲床包','床包','天絲','','','','停產','是'],['N1','贈品-Sybil抱枕套','抱枕套','','','Sybil','','','否']];
export function spreadsheetFixture(){
  let active,nextId=1,failWrite=false,failPromotion=false;const properties=new Map(),alerts=[];
  const chain=()=>{let proxy;const b={build:()=>proxy};proxy=new Proxy(b,{get:(t,p)=>t[p]||((...args)=>{t.lastCall=[p,args];return proxy;})});return proxy;};
  class Range{
    constructor(sheet,r,col,n=1,m=1){Object.assign(this,{sheet,r,col,n,m});}
    getValues(){return Array.from({length:this.n},(_,i)=>Array.from({length:this.m},(_,j)=>this.sheet.rows[this.r+i-1]?.[this.col+j-1]??''));}
    getDisplayValues(){return this.getValues().map(r=>r.map(v=>String(v)));}getValue(){return this.getValues()[0][0];}getDisplayValue(){return String(this.getValue());}
    setValues(values){if(failWrite&&this.sheet.name==='活動商品明細')throw new Error('injected detail write failure');if(failPromotion&&this.sheet.name==='同步控制台'&&this.r===7)throw new Error('injected promotion failure');values.forEach((r,i)=>r.forEach((v,j)=>{this.sheet.rows[this.r+i-1]??=[];this.sheet.rows[this.r+i-1][this.col+j-1]=typeof v==='boolean'&&this.sheet.formats.get((this.r+i)+':'+(this.col+j))==='@'?String(v):v;}));return this;}
    setValue(v){return this.setValues(Array.from({length:this.n},()=>Array(this.m).fill(v)));}
    setRichTextValue(v){return this.setValue(v.text);}setRichTextValues(v){return this.setValues(v.map(r=>r.map(v=>v.text)));}
    getRow(){return this.r;}getColumn(){return this.col;}getNumRows(){return this.n;}getNumColumns(){return this.m;}getSheet(){return this.sheet;}setNote(){return this;}
    createFilter(){const f={criteria:{},remove:()=>this.sheet.filter=null,setColumnFilterCriteria(col,c){this.criteria[col]=c;return this;}};this.sheet.filter=f;return f;}
    setNumberFormat(format){for(let i=0;i<this.n;i++)for(let j=0;j<this.m;j++)this.sheet.formats.set((this.r+i)+':'+(this.col+j),format);return this;}setBackground(){return this;}setFontColor(){return this;}setFontWeight(){return this;}setWrap(){return this;}setVerticalAlignment(){return this;}setWrapStrategy(){return this;}setDataValidation(){return this;}
  }
  class Sheet{
    constructor(name,rows=[]){Object.assign(this,{name,rows,id:nextId++,maxRows:1000,maxCols:26,filter:null,selected:2,hidden:[],formats:new Map()});}
    getRange(r,col,n,m){if(typeof r==='string'){const [a,b=a]=r.split(':'),parse=v=>{const x=v.match(/^([A-Z]+)(\d+)$/);return [+x[2],[...x[1]].reduce((n,ch)=>26*n+ch.charCodeAt(0)-64,0)];},[r1,c1]=parse(a),[r2,c2]=parse(b);return new Range(this,r1,c1,r2-r1+1,c2-c1+1);}return new Range(this,r,col,n,m);}
    getDataRange(){return this.getRange(1,1,Math.max(1,this.getLastRow()),Math.max(1,this.getLastColumn()));}getLastRow(){return this.rows.length;}getLastColumn(){return Math.max(0,...this.rows.map(r=>r.length));}
    getMaxColumns(){return this.maxCols;}getMaxRows(){return this.maxRows;}insertColumnsAfter(_,n){this.maxCols+=n;}insertRowsAfter(_,n){this.maxRows+=n;}
    hideColumns(col,n=1){this.hidden.push([col,n]);}setFrozenRows(){}setTabColor(){}setColumnWidths(){}setColumnWidth(){}getSheetId(){return this.id;}getName(){return this.name;}getActiveRange(){return this.getRange(this.selected,1);}
    getFilter(){return this.filter;}getConditionalFormatRules(){return [];}setConditionalFormatRules(){}appendRow(r){this.rows.push(r);}
  }
  const sheets=new Map(),ss={getSheets:()=>[...sheets.values()],getId:()=> '1eOXzJB_r01FLsibHhGxUnu7cXPzg7_DotB6caN81sMM',getSheetByName:n=>sheets.get(n)||null,insertSheet:n=>{const s=new Sheet(n);sheets.set(n,s);return s;},setActiveSheet:s=>active=s,getActiveSheet:()=>active,setActiveRange:r=>{active=r.sheet;active.selected=r.r;},moveActiveSheet(){},toast(){}};
  const control=ss.insertSheet('同步控制台'),source=ss.insertSheet('26來源');control.getRange('B2:B4').setValues([['26來源'],[2026],[11]]);
  source.rows=[['分類','11月'],['短促','*華爾紗兩用被套85折\n門市：11/11 00:00 - 11/15 23:59']];
  const SpreadsheetApp={getActive:()=>ss,flush(){},WrapStrategy:{CLIP:'clip'},newDataValidation:chain,newConditionalFormatRule:chain,newFilterCriteria:chain,newRichTextValue:()=>{const r={text:'',setText(t){this.text=t;return this;},setLinkUrl(){return this;},build(){return this;}};return r;},getUi:()=>({alert:m=>alerts.push(m),showModalDialog(){}})};
  const props={getProperty:k=>properties.get(k)||null,setProperty:(k,v)=>{if(Buffer.byteLength(v,'utf8')>9*1024)throw new Error('Google property value size limit');return properties.set(k,v);},deleteProperty:k=>properties.delete(k),getProperties:()=>Object.fromEntries(properties)},c=runtime({SpreadsheetApp,PropertiesService:{getDocumentProperties:()=>props},LockService:{getDocumentLock:()=>({tryLock:()=>true,releaseLock(){}}),getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})}});
  c.Utilities.formatDate=()=> '20261029-123000';let sequence=0;c.Utilities.getUuid=()=>String(++sequence).padStart(8,'0');
  c.confirmMarketingProducts=()=>c.commitMarketingOffer_(ss,c.marketingSelectedOffer_(ss),c.readMarketingMaster_());
  let fingerprint='master';c.readMarketingMaster_=()=>({products:c.marketingMasterRows_(rows),fingerprint,identity:fingerprint});c.latestMarketingMaster_=()=>({identity:fingerprint});
  return {c,ss,control,source,alerts,props,setMaster:v=>fingerprint=v,fail:()=>failWrite=true,failPromotion:()=>failPromotion=true};
}
