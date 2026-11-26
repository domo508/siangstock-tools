// Shared pure rules: embedded in Apps Script and imported by the AI Worker.
export const MS_SCOPE_POLICY='20261123-marketing-scope-r2';
const scopeNorm=value=>String(value||'').normalize('NFKC').replace(/\s+/g,'');
const scopeMaterials=['精梳純棉','有機棉','水洗棉','雙層紗','二重紗','華爾紗','竹纖維','埃及棉','長纖棉','石墨烯','羊毛','鴨絨','鵝絨','純棉','天絲'];
const scopeTerms=line=>[...new Set(line.split(/[、,，／/()]/).flatMap(part=>scopeMaterials.filter(t=>part.includes(t)).filter(t=>!scopeMaterials.some(o=>o!==t&&o.includes(t)&&part.includes(o)))))];
export function marketingScopeAnalyze_(evidence){
 const text=String(evidence||'').normalize('NFKC');
 // Explicit final membership and restricted lists remain authoritative.
 if(/實際納入商品[：:]|(?:僅限|僅適用|只限)(?!門市|官網|平台|會員|通路)|(?:限定|實際參加)(?:商品|品號|清單)[：:]|以[^\n]{0,35}(?:清單|名單|品號)[^\n]{0,8}為準/.test(text))return null;
 const negative=text.split('\n').map(line=>line.split(/排除|不含|不適用/).slice(1).join(' ')).filter(Boolean).join('\n');
 const excludedMaterials=scopeTerms(negative);
 const lines=text.split('\n').filter(line=>!/^\s*(?:排除|不含|不適用|商品名稱|補充品名|補充商品|例示|例如|期間|贈品)/.test(line));
 for(const rawLine of lines){
  const line=rawLine.split(/排除|不含|不適用/)[0];
  if(!/[、,，／/]/.test(line)||/新品|出清|小物/.test(line))continue;
  const materials=scopeTerms(line);
  if(materials.length<2)continue;
  const kind=/冬(?:季)?(?:被胎|被)|冬被/.test(line)?'winter-duvet':/被胎/.test(line)?'duvet':/床寢|寢具/.test(line)?'bedding':/床包/.test(line)?'fitted-sheet':/枕頭|枕芯/.test(line)?'pillow':'';
  if(kind)return {policy:MS_SCOPE_POLICY,kind,materials,evidence:line,excludedMaterials,hasExclusions:!!negative};
 }
 return null;
}
export function marketingScopeApply_(evidence,variant){
 // Gift membership describes the gift, never the qualifying purchase materials.
 const {scopeGuard:ignored,...clean}=variant;
 if(!['折扣／商品優惠','限定價'].includes(variant.type))return clean;
 const scope=marketingScopeAnalyze_(evidence);if(!scope)return clean;
 return {...clean,mode:'keywords',skus:[],series:'',queries:scope.materials.map(t=>[t]),scopeGuard:scope,needsConfirmation:!!clean.needsConfirmation||scope.hasExclusions,questions:[...(clean.questions||[]),...(scope.hasExclusions?['原文另有排除條件，請核對活動範圍；不自動納入候選。']:[])]};
}
export function marketingScopeProduct_(product,scope){
 if(!scope)return {eligible:true,uncertain:false,reason:''};
 const name=scopeNorm(product.name),category=scopeNorm(product.category),kind=scope.kind;
 if((scope.excludedMaterials||[]).some(t=>scopeNorm(product.search||product.name).includes(scopeNorm(t))))return {eligible:false,uncertain:false,reason:'原文明列排除材質'};
 if(kind==='winter-duvet'||kind==='duvet'){
  const categoryMatches=/被胎/.test(category),nameMatches=/冬被|冬季被|羽絨被|機能被|被胎/.test(name)&&!/被套|外袋|收納袋/.test(name);
  if(category?!categoryMatches:!nameMatches)return {eligible:false,uncertain:false,reason:'不屬活動被胎品類'};
  if(kind==='winter-duvet'&&/夏季|夏被|涼被|涼感|四季被/.test(name))return {eligible:false,uncertain:false,reason:'冬季範圍排除夏季／涼被／四季被'};
  const uncertain=!category||(kind==='winter-duvet'&&!/冬被|冬季被/.test(name))||/大量採購|專用|專案/.test(name);
  return {eligible:true,uncertain,reason:uncertain?'材質符合；季節、品類或特殊用途仍須人工確認':'明列材質任一符合，且品類符合'};
 }
 const matches=kind==='bedding'?/床包|床裙|被套|枕套/.test(category):kind==='fitted-sheet'?/床包/.test(category):kind==='pillow'?/枕頭|枕芯/.test(category):false;
 return {eligible:matches,uncertain:false,reason:matches?'明列材質任一符合，且品類符合':'不屬活動指定品類'};
}
