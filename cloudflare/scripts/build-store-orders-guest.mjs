// Reproducible self-contained public guest surface; no company-only asset requests.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,cp,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('wrangler'))('esbuild');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),tool=path.join(root,'store-orders'),out=path.join(tool,'guest');
const {VERSION}=await import(path.join(tool,'core.js'));
await mkdir(out,{recursive:true});
// The deployed HQ entry must match the canonical cloud page used in local acceptance.
await cp(path.join(tool,'cloud.html'),path.join(tool,'index.html'));
const strip={name:'versioned-local-imports',setup(b){b.onResolve({filter:/\.js\?v=/},a=>({path:path.resolve(a.resolveDir,a.path.split('?')[0])}));}};
for(const name of ['cloud','paper'])await build({entryPoints:[path.join(tool,name+'.js')],outfile:path.join(out,name+'.js'),bundle:true,format:'esm',target:'es2022',plugins:[strip]});
let html=await readFile(path.join(tool,'cloud.html'),'utf8');
html=html.replace(/<script async src="https:\/\/accounts.google.com\/gsi\/client"><\/script>/,'').replace('/inventory/assets/xlsx.full.min.js','xlsx.full.min.js').replace('/site.css','site.css').replace(/href="\/"/g,'href="/store-orders/guest/"').replace('雲端串接驗證・尚未開放','門市訪客入口').replace('1．登入公司工具','1．使用門市邀請碼登入').replace('請以已指派門市或總部權限的公司帳號連線。','請輸入總部提供的當班邀請碼。登入後只能查看本次登入所提交的單據。').replace('<div class="actions"><button id="cloud-connect">','<label>門市邀請碼<input id="cloud-guest-code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="30"></label><div class="actions"><button id="cloud-connect">').replace('連線公司工具並授權讀取公司雲端，取得最新商品主檔。','使用當班邀請碼登入，系統自動取得總部提供的商品查詢資料。').replace('保存後核對當日紙本與清單，再閉店結算。','保存後交由總部核對當日紙本與清單，辦理結算。').replace('結算後門市只能查看批次結果；','結算後訪客不再取得已交接訂單內容；').replace('4．整日清單與閉店結算','4．本次登入的單據清單').replace(/公司工具首頁/g,'門市訪客入口').replace(/翔仔居家・公司工具/g,'翔仔居家・門市收單');
html=html.replace('請完成上方「授權並載入商品主檔」，成功後會自動帶入，不需另外匯入。','使用邀請碼登入後會自動載入商品查詢，不需Google授權或手動匯入。').replace('上方授權已自動取得商品主檔，日常不必重做。只有雲端檔案更新或需要重試時，再使用此處。','登入後已自動取得商品查詢，日常不必重做。需要重試或取得總部新同步資料時，再使用此處。').replace('更新雲端商品主檔','更新商品查詢');
await writeFile(path.join(out,'index.html'),html);
let paper=await readFile(path.join(tool,'paper.html'),'utf8');paper=paper.replace('/store-orders/?','/store-orders/guest/?');await writeFile(path.join(out,'paper.html'),paper);
for(const name of ['style.css','paper.css','version.json'])await cp(path.join(tool,name),path.join(out,name));
await cp(path.join(root,'site.css'),path.join(out,'site.css'));await cp(path.join(root,'inventory/assets/xlsx.full.min.js'),path.join(out,'xlsx.full.min.js'));
await rm(path.join(out,'vendor'),{recursive:true,force:true});
for(const name of ['pdf','heic'])await cp(path.join(tool,'vendor',VERSION,name),path.join(out,'vendor',VERSION,name),{recursive:true});
console.log('Guest bundle built for '+VERSION+' (local assets only; no credentials)');
