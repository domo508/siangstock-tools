import * as C from './core.js?v=20261030-store-orders-r25';
const abs=x=>x<0n?-x:x;
function gcd(a,b){while(b)[a,b]=[b,a%b];return a;}
function egcd(a,b){let x=1n,y=0n,u=0n,v=1n;while(b){const q=a/b;[a,b]=[b,a%b];[x,u]=[u,x-q*u];[y,v]=[v,y-q*v];}return {g:a,x,y};}
function floor(a,b){return a>=0n?a/b:-((-a+b-1n)/b);}
const ceil=(a,b)=>-floor(-a,b);
export function costUnits(value){const s=C.text(value);if(s.length>24||!/^\d+(?:\.\d{1,6})?$/.test(s))throw Error('主檔成本價缺漏或無效');const [a,b='']=s.split('.'),n=BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));if(n<=0n||n>1000000000000000n)throw Error('主檔成本價需為正數，零成本不能自動拆價');return n;}
function pair(total,a,b,ca,cb){if(total<0n)return null;const {g,x,y}=egcd(a,b);if(total%g)return null;const u=x*(total/g),v=y*(total/g),da=b/g,db=a/g,lo=ceil(-u,da),hi=floor(v,db);if(lo>hi)return null;const den=ca*a+cb*b,k=floor(total*ca-u*den,den*da);let best=null;for(let candidate of [k,k+1n,lo,hi]){candidate=candidate<lo?lo:candidate>hi?hi:candidate;const p=u+da*candidate,q=v-db*candidate,error=abs(p*den-total*ca);if(!best||error<best.error)best={p,q,error};}return [best.p,best.q];}
export function allocateBundle(order,group){
 const entries=order.items.flatMap((item,index)=>item.priceGroupId===group.id?[{item,index}]:[]);if(entries.length<2)throw Error('組合至少兩列商品');
 const cents=BigInt(C.cents(group.amount));if(cents%100n)throw Error('組合總價含小數，無法保持整元單價及原總額，請先確認成交總額');
 const total=cents/100n,quantities=entries.map(({item})=>{if(!Number.isSafeInteger(item.quantity)||item.quantity<=0)throw Error('組合數量無效');return BigInt(item.quantity);}),costs=entries.map(({item,index})=>{try{if(item.costSnapshot?.sku!==C.text(item.sku).toUpperCase()||item.costSnapshot?.field!=='成本價'||!C.text(item.costSnapshot?.masterVersion)||item.costSnapshot?.status!=='provided')throw Error('主檔成本價快照缺漏，請重新選用商品');return costUnits(item.costSnapshot.value);}catch(e){throw Error(`第${index+1}列${e.message}`);}}),weight=costs.reduce((n,c,i)=>n+c*quantities[i],0n);
 const base=costs.map(c=>(2n*total*c+weight)/(2n*weight)),difference=total-base.reduce((n,p,i)=>n+p*quantities[i],0n);
 let prices=difference===0n?[...base]:null;
 // Rounding first; correct the whole-dollar residual without changing quantities.
 if(!prices&&abs(difference)<=200000n){const direction=difference>0n?1n:-1n,target=Number(abs(difference)),paths=new Array(target+1);paths[0]=0n;const indices=entries.map((_,i)=>i).filter(i=>total*costs[i]%weight!==0n&&(direction>0n?base[i]===total*costs[i]/weight:base[i]>total*costs[i]/weight)).sort((i,j)=>{const a=total*costs[i]%weight,b=total*costs[j]%weight;return a===b?j-i:(a>b?-1:1)*Number(direction);});let reachable=0;
  for(const i of indices){const q=Number(quantities[i]);reachable=Math.min(target,reachable+q);for(let n=reachable;n>=q;n--)if(paths[n]===undefined&&paths[n-q]!==undefined)paths[n]=paths[n-q]|(1n<<BigInt(i));if(paths[target]!==undefined)break;}
  if(paths[target]!==undefined)prices=base.map((p,i)=>p+((paths[target]&(1n<<BigInt(i)))?direction:0n));
 }
 if(!prices){const pairs=[];for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++)pairs.push({i,j,g:gcd(quantities[i],quantities[j])});pairs.sort((a,b)=>a.g<b.g?-1:a.g>b.g?1:a.i-b.i||a.j-b.j);
  for(const {i,j} of pairs){const rest=base.reduce((n,p,k)=>k===i||k===j?n:n+p*quantities[k],0n),answer=pair(total-rest,quantities[i],quantities[j],costs[i],costs[j]);if(answer){prices=[...base];[prices[i],prices[j]]=answer;break;}}
 }
 if(!prices||prices.some((p,i)=>p<0n||abs(p*weight-total*costs[i])>weight))throw Error('此組合數量與總價無法在成本比例的整元尾差內守恆，請人工確認ERP拆價規則');
 const lines=entries.map(({item,index},i)=>({index,sku:item.sku,quantity:item.quantity,unitCost:String(item.costSnapshot.value),costField:item.costSnapshot.field,masterVersion:item.costSnapshot.masterVersion,unitPrice:Number(prices[i]),amountCents:Number(prices[i]*quantities[i]*100n),weightShare:Number(costs[i]*quantities[i])/Number(weight)}));
 if(lines.reduce((n,l)=>n+l.amountCents,0)!==Number(cents))throw Error('組合拆價金額不守恆');return {groupId:group.id,paperCode:group.paperCode||'',amountCents:Number(cents),method:'cost-weighted-unit-integer-v1',lines};
}
export function resolvedERPPrices(order){const prices=new Map(),groups=[];for(const [i,item] of order.items.entries())if(!C.totalOnlyGroup(order,item))prices.set(i,C.cents(item.unitPrice)/100);for(const group of order.priceGroups||[])if(group.pricingMode==='total_only'){const allocation=allocateBundle(order,group);groups.push(allocation);for(const line of allocation.lines)prices.set(line.index,line.unitPrice);}return {prices,groups};}
