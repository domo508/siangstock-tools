// Explicit Drive read-only scope required. Never convert, copy or modify a Drive file.
const MS_MASTER_FOLDER='1wzVoxLUXb9CEJK-cWrH8AMPxO5NVpTeC';
// User explicitly approved Drive read-only + this test-workbook-only processing
// exception on 2026-10-29. This does not authorize any production source switch.
const MS_MASTER_CLOUD_PARSE_APPROVED=true;
function latestMarketingMaster_(){
  const files=DriveApp.getFolderById(MS_MASTER_FOLDER).getFiles(),candidates=[];
  while(files.hasNext()){
    const f=files.next();if(f.getMimeType()!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'||f.isTrashed())continue;
    const parents=f.getParents(),ids=[];while(parents.hasNext())ids.push(parents.next().getId());
    if(ids.length!==1||ids[0]!==MS_MASTER_FOLDER)continue;
    candidates.push({file:f,id:f.getId(),modified:f.getLastUpdated().getTime(),size:f.getSize()});
  }
  candidates.sort((a,b)=>b.modified-a.modified);
  if(!candidates.length||candidates.length>1&&candidates[0].modified===candidates[1].modified)throw new Error('最新商品主檔不是唯一有效.xlsx，停止比對。');
  const selected=candidates[0];if(selected.size>10000000)throw new Error('商品主檔超過10MB驗證上限。');
  selected.identity=selected.id+'|'+selected.modified+'|'+selected.size;return selected;
}
function readMarketingMaster_(){
  if(!MS_MASTER_CLOUD_PARSE_APPROVED)throw new Error('尚未核准Google端解析商品主檔的測試例外；不讀取原始Excel。');
  assertMarketingBook_();
  const selected=latestMarketingMaster_(),blob=selected.file.getBlob(),bytes=blob.getBytes();
  const parts=Utilities.unzip(blob.setContentType('application/zip'));
  const rows=marketingXlsxRows_(parts),products=marketingMasterRows_(rows);
  const sha=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');
  return {products,identity:selected.identity,fingerprint:selected.identity+'|'+sha};
}
function marketingXlsxRows_(parts){
  const files={};let size=0;
  parts.forEach(p=>{size+=p.getBytes().length;if(size>60000000)throw new Error('主檔解壓後超過60MB驗證範圍。');if(files[p.getName()])throw new Error('主檔ZIP路徑重複。');files[p.getName()]=p;});
  const xmlText=name=>{if(!files[name])throw new Error('主檔缺少XML：'+name);const value=files[name].getDataAsString('UTF-8');if(/<!DOCTYPE|<!ENTITY/i.test(value))throw new Error('主檔XML含不支援的外部實體。');return value;};
  const xml=name=>XmlService.parse(xmlText(name)).getRootElement();
  const root=xml('xl/workbook.xml'),ns=root.getNamespace(),sheets=root.getChild('sheets',ns).getChildren('sheet',ns);
  if(sheets.length!==1)throw new Error('商品主檔需為單一已驗證工作表，不自動猜測多頁籤。');
  const relationId=sheets[0].getAttributes().find(a=>a.getName()==='id').getValue();
  const rel=xml('xl/_rels/workbook.xml.rels'),relationship=rel.getChildren().find(e=>e.getAttribute('Id').getValue()===relationId);
  if(!relationship||relationship.getAttribute('TargetMode')?.getValue()==='External')throw new Error('主檔工作表連結不正確。');
  let target=relationship.getAttribute('Target').getValue();target=target.startsWith('/')?target.slice(1):'xl/'+target;
  if(target.includes('..'))throw new Error('主檔工作表路徑不支援。');
  const texts=node=>node.getChildren().map(e=>e.getName()==='t'?e.getText():e.getName()==='r'?texts(e):'').join('');
  const strings=files['xl/sharedStrings.xml']?xml('xl/sharedStrings.xml').getChildren().map(texts):[];
  // A real master has 406,224 cells. Millions of XmlService bridge calls can
  // exceed the execution limit. Stream the large worksheet in strict JS XML;
  // keep only plain row values, not a 400k-node native object tree.
  return marketingWorksheetRows_(xmlText(target),strings);
}
function marketingWorksheetRows_(text,strings){
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('主檔XML含不支援的外部實體。');
  const parser=MS_SAX_.parser(true,{xmlns:true,strictEntities:true,position:false}),rows=[],stack=[];
  let ns='',seenRoot=false,seenData=false,values=null,cell=null;
  const attr=(node,name)=>node.attributes[name]?.value||'';
  parser.onerror=e=>{throw new Error('商品主檔XML格式錯誤：'+e.message);};
  parser.onopentag=node=>{
    const parent=stack[stack.length-1],name=node.local;stack.push(node);
    if(stack.length===1){if(name!=='worksheet')throw new Error('主檔工作表根節點錯誤。');ns=node.uri;seenRoot=true;}
    if(node.uri!==ns)return;
    if(name==='sheetData'&&parent?.local==='worksheet'){if(seenData)throw new Error('主檔工作表資料區重複。');seenData=true;}
    if(name==='row'&&parent?.local==='sheetData'){
      if(rows.length>=30000)throw new Error('商品主檔超過3萬列驗證範圍。');values=[];
    }
    if(name==='c'&&parent?.local==='row'&&values){
      const address=attr(node,'r'),letters=address.match(/^[A-Z]+(?=\d+$)/)?.[0];if(!letters)throw new Error('主檔儲存格缺座標。');
      let col=0;for(const ch of letters)col=col*26+ch.charCodeAt(0)-64;if(col>150)throw new Error('商品主檔欄數超過驗證範圍。');
      if(Object.prototype.hasOwnProperty.call(values,col-1))throw new Error('主檔儲存格座標重複：'+address);
      cell={address,col,type:attr(node,'t'),value:'',inline:''};
      if(cell.type==='e')throw new Error('商品主檔儲存格錯誤：'+address);
    }
    if(cell&&name==='f')throw new Error('商品主檔含公式，請匯出純值版本後重試：'+cell.address);
  };
  const chars=value=>{if(!cell)return;const node=stack[stack.length-1];if(node?.uri!==ns)return;if(node.local==='v')cell.value+=value;else if(node.local==='t'&&stack.some(n=>n.local==='is'&&n.uri===ns))cell.inline+=value;};
  parser.ontext=chars;parser.oncdata=chars;
  parser.onclosetag=()=>{
    const node=stack.pop();if(node.uri!==ns)return;
    if(node.local==='c'&&cell){
      if(cell.type==='s'&&(!/^\d+$/.test(cell.value)||Number(cell.value)>=strings.length))throw new Error('主檔共享字串索引錯誤：'+cell.address);
      values[cell.col-1]=cell.type==='s'?strings[Number(cell.value)]:cell.type==='inlineStr'?cell.inline:cell.value;cell=null;
    }
    if(node.local==='row'&&values){rows.push(values);values=null;}
  };
  // Bounded chunks keep SAX buffers controlled without any network/service call.
  for(let i=0;i<text.length;i+=65536)parser.write(text.slice(i,i+65536));parser.close();
  if(!seenRoot||!seenData)throw new Error('主檔工作表沒有資料。');return rows;
}
