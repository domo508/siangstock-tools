// Full-page input: one overview and overlapping native-resolution bands from the SAME page.
export const IMAGE_PIPELINE='full-page-bands-v1';
export const BAND_RANGES=[[0,.36],[.28,.74],[.66,1]];
export function imagePlan(width,height,{full=true}={}){
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>40000000)throw Error('圖片尺寸無效或過大');
 const scale=Math.min(1,4096/Math.max(width,height));
 const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
 const overviewScale=full?Math.min(1,2200/Math.max(w,h)):1;
 return {width:w,height:h,overview:{width:Math.max(1,Math.round(w*overviewScale)),height:Math.max(1,Math.round(h*overviewScale))},bands:full?BAND_RANGES.map(([top,bottom])=>({x:0,y:Math.floor(h*top),width:w,height:Math.ceil(h*bottom)-Math.floor(h*top)})):[]};
}
export function prepareImageInput(image,{left=0,right=100,top=0,bottom=100,full=true}={}){
 if(![left,right,top,bottom].every(Number.isFinite)||left<0||right>100||top<0||bottom>100||left>=right||top>=bottom)throw Error('請輸入有效裁切範圍');
 if(full&&(left!==0||right!==100||top!==0||bottom!==100))throw Error('完整單須保留整張照片，請重新產生預覽');
 const width=Math.max(1,Math.round(image.width*(right-left)/100)),height=Math.max(1,Math.round(image.height*(bottom-top)/100)),plan=imagePlan(width,height,{full});
 const canvas=document.createElement('canvas');canvas.width=plan.width;canvas.height=plan.height;
 const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,image.width*left/100,image.height*top/100,width,height,0,0,canvas.width,canvas.height);
 const encode=(x,y,width,height,outWidth=width,outHeight=height)=>{const c=document.createElement('canvas');c.width=outWidth;c.height=outHeight;c.getContext('2d').drawImage(canvas,x,y,width,height,0,0,outWidth,outHeight);return c.toDataURL('image/jpeg',.95);};
 return {preview:encode(0,0,plan.width,plan.height),image:encode(0,0,plan.width,plan.height,plan.overview.width,plan.overview.height),detailImages:plan.bands.map(b=>encode(b.x,b.y,b.width,b.height)),plan};
}
