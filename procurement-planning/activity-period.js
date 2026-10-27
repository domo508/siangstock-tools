(function(global){
  "use strict";
  function assertParent(snapshot, parentId) {
    if (!snapshot?.analysis || snapshot.activeWorkUnit || snapshot.id !== parentId || (snapshot.parentBatchId && snapshot.parentBatchId !== parentId) || snapshot.sharedDraftId !== parentId) throw new Error("原公司共用完整母批次不符，已停止；子批次人工量與覆核結果保留。");
    const rule=snapshot.analysis.appliedRules?.activityDemand;
    if (!rule || rule.enabled === false || rule.method !== "monthly-target") throw new Error("原母批次缺少活動依據，不能以供應商子批次代替。");
    if (!Number.isInteger(snapshot.sharedDraftRevision) || snapshot.sharedDraftRevision < 1) throw new Error("原母批次版本不完整，請重新讀取。");
    return rule;
  }
  function createParentPatch(snapshot, parentId, source, correction) {
    const rule=assertParent(snapshot,parentId);
    global.StoreTransferActivity.validateSource(source);
    if (source.name !== rule.name || source.asOfDate !== snapshot.analysis.asOfDate) throw new Error("重建草稿與原母批次活動來源不同，請重新讀取母批次後重建。");
    const planning=global.ProcurementActivityPlanning;
    const originalMonths=planning.months(rule.startDate,rule.endDate);
    if (planning.months(source.startDate,source.endDate).join() !== originalMonths.join() || source.months.map(m=>m.month).join() !== originalMonths.join()) throw new Error("第一階段只更正原有月份內的門市期間，不變更原採購月份。");
    const changed=source.startDate!==rule.startDate || source.endDate!==rule.endDate;
    if (changed && (!correction?.reason?.trim() || correction.startDate!==source.startDate || correction.endDate!==source.endDate || correction.originalStartDate!==rule.startDate || correction.originalEndDate!==rule.endDate)) throw new Error("日期更正原因或原期間不完整，請重新重建草稿。");
    for(const month of source.months){
      const total=Number(rule.monthlyTargets?.[month.month]?.amount);
      if(!Number.isFinite(total) || Math.abs(month.retailTarget+month.onlineAndOtherTarget-total)>0.02) throw new Error("門市與其他通路目標未與原全通路目標守恆，已停止儲存。");
    }
    const patch=structuredClone(snapshot);
    patch.transferActivityDraft=structuredClone(source);
    patch.transferActivityCorrection=correction?structuredClone(correction):null;
    // Deliberately keep analysis, controls, reviews, batch identity and stage byte-equivalent.
    return patch;
  }
  global.ProcurementActivityPeriod={assertParent,createParentPatch};
})(typeof globalThis!=="undefined"?globalThis:window);
