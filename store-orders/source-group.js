// Read every selected source before the caller replaces a visible order draft.
export async function loadSourceGroup(ids,{register,read,decode,existingSources=[]}){
 if(!ids.length)throw Error('請先選取同一訂單的照片');
 if(new Set(ids).size!==ids.length)throw Error('照片不可重複選取');
 const seen=new Set(existingSources.map(s=>s.fileId)),sources=[],pages=[];
 for(const id of ids){
  if(seen.has(id))throw Error('此來源已加入目前訂單，請勿重複追加');
  const result=await register(id);
  if(result.existing){
   if(ids.length===1&&!existingSources.length)return {existing:result.existing};
   throw Error('其中照片已屬其他訂單，未合併；請重新檢查選取範圍');
  }
  if(!result.id||seen.has(result.id))throw Error('原圖重複或來源無效，未合併');
  const decoded=await decode(await read(result.id));
  if(!decoded.length)throw Error('其中原圖沒有可解析頁面，未合併');
  if(pages.length+decoded.length+existingSources.reduce((n,s)=>n+s.pages,0)>30)throw Error('同一訂單最多30頁，請檢查選取範圍');
  seen.add(result.id);sources.push({fileId:result.id,pages:decoded.length,verified:true});
  decoded.forEach((blob,index)=>pages.push({fileId:result.id,index,blob}));
 }
 return {sources,pages};
}
