// Historical UI harness for regression-only scenarios. Fixtures are not site assets.
const fs=require('node:fs'),path=require('node:path');
module.exports=async(context,origin)=>{
 const fixture=path.resolve(__dirname,'../test/fixtures/store-orders');
 await context.route(origin+'/store-orders/validation.html**',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(fixture,'validation-r22.html'),'utf8')}));
 await context.route(origin+'/store-orders/validation.js**',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(fixture,'validation-r22.js'),'utf8')}));
};
