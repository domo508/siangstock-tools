// Fictional test data only. The rendered form uses print fonts, not a handwriting model.
export function syntheticFullOrder(){return {header:{paperNumber:"TEST-FULL-0001",storeCode:"R00",businessDate:"115年08月30日",clerk:"測試同仁甲",pageNumber:1,pageCount:1,paperRowCount:3,customer:{name:"測試客戶甲",phone:"0000000000",address:"測試市測試區測試路0號"},note:"虛構資料，非真實交易",uncertainFields:[]},payments:{"中信信用卡":500,"現金":200,"百貨現金卷":0,"LinePay":0},paperTotal:700,rows:[{row:1,sku:"SAMPLE01",paperName:"測試床包",quantity:1,unitPrice:400,saleType:"銷貨",gift:false,uncertain:false},{row:2,sku:"SAMPLE02",paperName:"測試被套",quantity:2,unitPrice:150,saleType:"訂貨",gift:false,uncertain:false},{row:3,sku:"",paperName:"測試香氛噴霧",quantity:1,unitPrice:0,saleType:"銷貨",gift:true,uncertain:false}],sharedPrices:[],warnings:[]};}
export function renderSyntheticForm(){
 const data=syntheticFullOrder(),canvas=document.createElement("canvas");canvas.width=1654;canvas.height=2339;const ctx=canvas.getContext("2d");ctx.fillStyle="white";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle="black";ctx.strokeStyle="black";ctx.lineWidth=2;
 const text=(value,x,y,size=30)=>{ctx.font=`${size}px "BiauKai", "KaiTi", serif`;ctx.fillText(value,x,y);};
 text("翔仔居家｜完整訂購單測試",100,110,48);text("全部為虛構資料；印刷字案例，非手寫準確率驗收",100,170,27);
 const h=data.header;text(`訂單編號：${h.paperNumber}`,100,245);text(`門市代號：${h.storeCode}`,100,310);text(`訂購日期：${h.businessDate}`,750,310);text(`經手人：${h.clerk}`,100,380);text("頁碼：1／共1頁",950,380);text("整單商品列數（不含空白列）：3列",100,450);
 text(`姓名：${h.customer.name}`,100,525);text(`電話：${h.customer.phone}`,750,525);text(`地址：${h.customer.address}`,100,600);
 const xs=[100,160,410,850,950,1110,1250,1550],start=680,rowHeight=105;
 const titles=["序","完整貨號","品名／規格","數量","成交單價","小計","銷別"];
 for(let i=0;i<xs.length;i++){ctx.beginPath();ctx.moveTo(xs[i],start);ctx.lineTo(xs[i],start+rowHeight*9);ctx.stroke();}
 for(let i=0;i<=9;i++){ctx.beginPath();ctx.moveTo(xs[0],start+i*rowHeight);ctx.lineTo(xs.at(-1),start+i*rowHeight);ctx.stroke();}
 titles.forEach((v,i)=>text(v,xs[i]+10,start+62,25));
 data.rows.forEach((row,i)=>{const y=start+(i+1)*rowHeight+62;const values=[row.row,row.sku,row.paperName,row.quantity,row.gift?"贈品":row.unitPrice,row.gift?"0":row.quantity*row.unitPrice,row.saleType==="銷貨"?"☑銷貨 □訂貨":"□銷貨 ☑訂貨"];values.forEach((v,j)=>text(String(v),xs[j]+10,y,j===6?26:29));});
 text("付款方式／各項實收金額",100,1740);text("☑信用卡：500元",100,1810);text("☑現金：200元",850,1810);text("□百貨卷：0元",100,1880);text("□電子支付：0元",850,1880);text("成交總額：700元",100,1980,38);text(`備註：${h.note}`,100,2070);text("請用虛構資料手寫另一張，再拍照測試；勿上傳真實客戶資料。",100,2210,25);
 return canvas;
}
