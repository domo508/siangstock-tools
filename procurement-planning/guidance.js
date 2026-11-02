/* Read-only procurement guidance: booleans and stage labels only. No business actions. */
(function(root){
  'use strict';
  const step=(title,hint,target,busy=false)=>({title,hint,target,busy});
  const resumed=s=>s.approved||s.batch||s.review||s.firstReview||s.returnScope;
  const forecastNeeded=s=>s.monthStart&&(!s.forecastSaved||s.forecastDirty);
  function forecastStep(s){
    if(s.historyMode)return step('歷史業績預估僅供查看','舊月份快照不可改寫；若要重新規劃，請切換目前可操作月份。','#history-mode-banner');
    if(!s.canManageBudget)return step('先由有權限同仁完成本月業績預估','請確認本月各通路／門市預估及公司共用快照；目前帳號只能查看，請由可管理月份額度的同仁填寫並儲存。','#channel-forecast-title');
    if(!s.forecastComplete)return step('第一步：填寫本月業績預估','請先填各公司、通路／門市的整月預估營收；上月沿用的空白金額仍需填寫，無營收請明確填0，重複通路須合併。','#channel-forecast-title');
    return step('下一步：儲存本月業績預估與額度','預估已填妥，請核對通路金額及可採購額度，再按「儲存本月額度」；儲存成功後才會引導準備採購來源。','#save-budget-button');
  }
  function resolve(s){
    if(!s.loggedIn)return step('先確認公司登入與權限','請查看帳號與載入訊息；接續批次也需要公司權限。','#account-badge');
    if(s.summaryBusy)return step(s.approved?'核准已完成，正在處理摘要／同步':'正在核准／處理摘要','請等待原操作結果，不要重複核准；這個階段不需要重新匯入四類來源檔案。','#workflow-status',true);
    if(s.context==='activity-settings'){
      if(s.activityBusy)return step('正在讀取／保存活動設定','請等本次活動操作結果；不需匯入四類來源。','#activity-registry-status',true);
      if(!s.activityEnabled)return step('設定本次大活動備貨','需要活動時勾選「本次納入活動備貨」，再沿用既有活動或建立新活動。','#activity-enabled');
      if(!s.canManageActivities)return step('查看活動設定（唯讀）','活動日期及目標由有權限的同仁保存；目前不需重新匯入來源檔案。','#activity-registry-status');
      if(!s.activityAvailable)return step('先讀取公司共用活動','請先重新讀取活動清單，再帶入既有活動；不要另建同一活動。','#activity-registry-refresh');
      if(!s.activityValid)return step('核對活動日期與整月目標','請依活動卡片提示補齊名稱、日期及各月目標；保存設定不會重算原採購。','#activity-demand-fields');
      if(s.activityDirty||!s.activitySelected){
        if(!s.activityReason)return step('填寫活動設定／修改原因','日期或目標修改後，填寫原因，再按原本的保存按鈕。','#activity-registry-reason');
        return step('下一步：保存活動設定','請自行按「保存活動設定」；保存不等於已重算採購或發布週調撥。','#activity-registry-save');
      }
      return step('活動設定已保存','若要重新評估採購，用最新資料產生下一次建議；門市交接則核對原批次／最新分析的草稿，不直接把新設定當作已發布。',s.analysis?'#activity-transfer-result':'#source-title');
    }
    if(s.context==='activity-handoff'){
      if(s.transferBusy||s.transferSyncing)return step('正在更新門市活動分配','請等待本次讀取、重建或發布結果；原採購決策保留，不需重新匯入四類來源。','#transfer-activity-status',true);
      if(s.transferError)return step('門市共用期間尚未讀取完成','請查看卡片錯誤並重新讀取共用期間；先不要重建或發布。','#refresh-transfer-activity-period');
      if(!s.transferAvailable)return step('先接續含活動的完整批次','請恢復原母批次或其子批次，再核對門市活動草稿。','#resume-draft-card');
      if(s.transferDirty||!s.transferDraft)return step('下一步：重建門市分配草稿','先核對更正日期、原因與六店目標，再自行重建；此操作不重算採購。','#activity-transfer-backfill');
      if(s.canSaveTransfer)return step('下一步：保存門市分配','確認草稿後儲存至原母批次，供其他子批次接續；儲存不等於發布。','#save-transfer-activity-draft');
      if(s.canPublishTransfer)return step('下一步：核對並發布門市分配','核對六店分配及期間，再自行發布至週調撥；不需等待採購回匯。','#publish-transfer-activity');
      return step('核對門市交接狀態','請查看本卡片的發布結果與回饋；已完成的操作不用重做。','#transfer-activity-status');
    }
    if(s.context==='budget' && !s.summaryBusy){
      if(!s.dates)return step('下一步：確認月份與時點','先確認分析月份、時點與下單日。','#analysis-month');
      if(s.historyMode||!s.forecastSaved||s.forecastDirty)return forecastStep(s);
      return step('本月業績預估已保存','可核對公司共用的通路／門市預估與額度，再準備本次採購資料；接續既有批次則依原回匯流程操作。','#budget-plan-status');
    }
    if(s.approved)return {...step('本批已核准：核對摘要及 ERP','摘要若失敗只接續補寄；不要重新核准或重新匯入四類來源。ERP請依原流程核對下載。','#workflow-panel'),keepState:true};
    if(s.batch)return step(s.canApprove?'下一步：核對待核准批次':'等待採購核准者處理','請以本批回匯與台帳狀態接續；不需重新建立採購建議或補選四類來源。','#workflow-panel');
    if(s.review||s.firstReview)return step(s.reviewErrors?'先處理回匯阻擋':'下一步：確認覆核與異動','依覆核結果修正；全部沿用可送待核准，有異動只回匯變更列。不需重新匯入四類來源。','#workflow-panel');
    if(s.returnScope)return step('下一步：第一次人工回匯','接續本批已下載報表，選擇人工回匯檔並產生覆核表；不需重新匯入四類來源。','#review-file-label');
    if(s.monthEnd)return step('核對月底驗證結果','請核對摘要及警示，依原有下載流程操作。','#month-end-panel');
    if(s.analysis)return step('下一步：選擇分批審核單位','建議已產生，核對後複選供應商／分類並下載；無須重新補選來源檔案。','#work-unit-title');
    if(!s.dates)return step('下一步：確認月份與時點','先確認分析月份、時點與下單日。','#analysis-month');
    if(forecastNeeded(s))return forecastStep(s);
    if(!s.master)return step('下一步：取得商品主檔與來源','僅新建或重新計算採購需要準備來源；接續既有批次請先恢復草稿。','#source-title');
    for(const [key,label,target] of [['inventory','最新庫存','#inventory-file'],['pending','全部狀態採購單','#pending-files'],['transfer','期間調撥單','#transfer-file'],['sales','銷售明細','#sales-files']])if(!s[key])return step('下一步：選擇'+label,'目前是新建採購，請依本次日期範圍提供來源。',target);
    return step(s.analyzeReady?'下一步：產生採購建議':'確認必要來源與計算基準','核對日期、來源及季節模型後，再自行按原本的執行按鈕。',s.analyzeReady?'#analyze-button':'#source-title');
  }
  function progress(s){
    if(s.summaryBusy)return {message:s.approved?'回匯／核准：已核准，摘要或後續同步處理中':'回匯／核准：正在處理本批次'};
    if(s.context==='activity-settings')return {message:'目前步驟：活動日期／目標設定（與新建採購匯入分開）'};
    if(s.context==='activity-handoff')return {message:'目前步驟：門市活動分配／保存／發布（沿用原批次）'};
    if(s.context==='budget')return {message:'目前步驟：整月業績預估與可採購額度（保存成功才算完成）'};
    if(resumed(s))return {message:'接續既有批次：使用已保存的採購與覆核資料，不需重新匯入四類來源'};
    if(s.analysis||s.monthEnd)return {message:'本批分析已完成，正在處理結果與後續作業'};
    if(forecastNeeded(s))return {message:'月初採購先確認本月業績預估及保存額度，再準備來源檔案'};
    if(s.importProgress&&!s.importProgress.stopped)return {...s.importProgress,message:`必要檔案：已讀取 ${s.importProgress.current}／${s.importProgress.total} 份（不含後續計算）`};
    return {current:s.fileCount,total:4,message:`新建採購來源：已選妥 ${s.fileCount}／4 類（選檔完成不代表解析完成）`};
  }
  root.ProcurementGuidance=Object.freeze({resolve,progress});
})(globalThis);
