const MS_WORKFLOW_ENTRY_VERSION='20261123-marketing-entry-r2';
function showMarketingWorkflow(){
 const ss=assertMarketingBook_();marketingWorkflowActor_();ss.toast('正在開啟活動同步與覆核工作台；讀取不會同步、覆核或修改原企劃。','行銷活動',8);
 SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(MS_WORKFLOW_HTML).setWidth(1000).setHeight(760),'活動同步與覆核');
}
// This read-only diagnostic prints only the public audience and sheet binding.
// Neither an identity token nor an API key is logged or returned.
function diagnoseMarketingAIIdentity(){
 const ss=assertMarketingBook_();if(marketingWorkflowActor_()!=='siang01@siangapato.com.tw')throw new Error('僅供既有管理者核對服務綁定。');const token=ScriptApp.getIdentityToken();if(!token)throw new Error('請先完成新增身分範圍授權。');const payload=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(token.split('.')[1])).getDataAsString());
 const result={version:MS_WORKFLOW_VERSION,spreadsheetId:ss.getId(),audience:payload.aud,company:payload.hd==='siangapato.com.tw',verified:payload.email_verified===true};console.log(JSON.stringify(result));return result;
}

// Deployment activation only: no sync, approvals, rows or source changes.
function activateMarketingWorkflow(){
 const ss=assertMarketingBook_();if(marketingWorkflowActor_()!=='siang01@siangapato.com.tw')throw new Error('僅限既有管理者啟用新版入口。');
 PropertiesService.getDocumentProperties().setProperty('marketing-workflow-enabled',MS_WORKFLOW_VERSION);
 console.log(JSON.stringify({version:MS_WORKFLOW_VERSION,activated:PropertiesService.getDocumentProperties().getProperty('marketing-workflow-enabled')===MS_WORKFLOW_VERSION,spreadsheetId:ss.getId()}));
}
