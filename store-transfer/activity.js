(function (root) {
  "use strict";
  const BUFFER_DAYS = 2;
  const STORES = ["R00", "R01", "R03", "R10", "R07", "R06"];
  const DAY = 86400000;
  const add = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
  function validDate(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || "") && Number.isFinite(Date.parse(`${d}T00:00:00Z`)) && add(d, 0) === d; }
  const monthDays = m => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)).getUTCDate();
  function validateSource(source) {
    if (source?.version !== 1 || !String(source.name || "").trim() || !validDate(source.startDate) || !validDate(source.endDate) || source.endDate < source.startDate || !validDate(source.asOfDate) || source.endDate <= source.asOfDate || (Date.parse(source.endDate) - Date.parse(source.asOfDate)) / DAY > 366) throw new Error("活動來源日期或版本無效，請由主採購重新提供。");
    if (!Array.isArray(source.months) || !source.months.length || !Array.isArray(source.rows) || !source.rows.length || source.rows.length > 20000) throw new Error("活動來源缺少逐店／逐品號需求，或超過20000筆。");
    const seen = new Set();
    for (const row of source.rows) {
      const key = `${row.storeCode}|${row.sku}`;
      if (!STORES.includes(row.storeCode) || !row.sku || seen.has(key) || !row.quantities || !Object.keys(row.quantities).length || Object.values(row.quantities).some(q => !Number.isFinite(q) || q < 0)) throw new Error("活動來源品號重複或數量格式錯誤。");
      seen.add(key);
    }
    const months = new Set();
    for (const month of source.months) {
      if (!/^\d{4}-\d{2}$/.test(month.month || "") || !validDate(`${month.month}-01`) || months.has(month.month) || !Number.isFinite(month.retailTarget) || month.retailTarget <= 0) throw new Error("活動月份或實體門市目標無效。");
      months.add(month.month);
      for (const store of STORES) {
        const target = month.targets?.[store] ?? 0, weights = month.weights?.[store];
        if (!Number.isFinite(target) || target < 0 || !Array.isArray(weights) || weights.length !== monthDays(month.month) || weights.some(v => !Number.isFinite(v) || v < 0) || Math.abs(weights.reduce((a,b) => a+b, 0) - 1) > 1e-6) throw new Error("活動逐店目標或每日分布無效。");
      }
      if (Math.abs(STORES.reduce((sum,s) => sum + month.targets[s], 0) - month.retailTarget) > 0.01) throw new Error("來源門市目標加總不守恆。");
    }
    for (const row of source.rows) if (Object.keys(row.quantities).some(m => !months.has(m))) throw new Error("品項月份不在活動目標範圍。");
    for(let d=source.startDate;d<=source.endDate;d=add(d,1)) if(!months.has(d.slice(0,7))) throw new Error("活動跨月目標不完整。");
    return source;
  }
  function validatePlan(plan) {
    const source = validateSource(plan.source);
    const config = plan.config;
    if (!config || !validDate(config.startProposalDate) || config.startProposalDate > source.endDate || new Date(`${config.startProposalDate}T00:00:00Z`).getUTCDay() !== 1 || !String(config.reason || "").trim()) throw new Error("請選擇開始備貨的星期一並填寫確認原因。");
    for (const month of source.months) {
      const targets = config.targets?.[month.month];
      if (!targets || STORES.some(s => !Number.isFinite(targets[s]) || targets[s] < 0)) throw new Error(`${month.month}逐店業績目標不完整。`);
      if (Math.abs(STORES.reduce((sum,s) => sum + targets[s], 0) - month.retailTarget) > 0.01) throw new Error(`${month.month}逐店目標加總須等於實體門市目標。`);
      for (const store of STORES) if (targets[store] > 0 && !(month.targets[store] > 0)) throw new Error(`${store}缺少可用歷史，請先在主採購補足預估基準，不可直接分配目標。`);
    }
    return plan;
  }
  function draftConfig(source, rules = {}) {
    validateSource(source);
    let proposal = source.startDate;
    while (new Date(`${proposal}T00:00:00Z`).getUTCDay() !== 1) proposal = add(proposal, -1);
    while (schedule(proposal, rules).usableDate >= source.startDate) proposal = add(proposal, -7);
    return { startProposalDate: proposal, targets: Object.fromEntries(source.months.map(m => [m.month, { ...m.targets }])), reason: "" };
  }
  function schedule(proposalDate, rules = {}, approvalDate = "") {
    if (!validDate(proposalDate) || (approvalDate && (!validDate(approvalDate) || approvalDate<proposalDate))) throw new Error("活動調撥日期無效。");
    const approval = approvalDate || root.StoreTransferCore.nextWorkingDay(add(proposalDate, 1), rules.workdayHolidays || []);
    const arrivalDate = add(approval, 2), usableDate = add(arrivalDate, BUFFER_DAYS);
    const nextApproval = root.StoreTransferCore.nextWorkingDay(add(proposalDate, 8), rules.workdayHolidays || []);
    const nextUsableDate = add(nextApproval, 4);
    return { approvalDate: approval, arrivalDate, usableDate, nextUsableDate, protectionEnd: add(nextUsableDate, -1), bufferDays: BUFFER_DAYS };
  }
  function prepare(plan, proposalDate, approvalDate, rules) {
    validatePlan(plan);
    if (plan.status !== "confirmed") throw new Error("活動分配尚未由總部確認，不能產生調撥建議。");
    const timing = schedule(proposalDate, rules, approvalDate);
    const active = proposalDate >= plan.config.startProposalDate && timing.arrivalDate <= plan.source.endDate;
    const rows = new Map(plan.source.rows.map(row => [`${row.storeCode}|${row.sku}`, row]));
    function daily(store, sku, d, fallback) {
      if (!active || d < plan.source.startDate || d > plan.source.endDate) return fallback;
      const month = plan.source.months.find(m => m.month === d.slice(0,7)), row = rows.get(`${store}|${sku}`);
      if (!month || !row || !(month.targets[store] > 0)) return fallback;
      return (row.quantities[month.month] || 0) * plan.config.targets[month.month][store] / month.targets[store] * month.weights[store][Number(d.slice(8))-1];
    }
    function demand(store, sku, from, to, fallback) {
      let total = 0;
      for (let d = from; d <= to; d = add(d, 1)) total += daily(store, sku, d, fallback);
      return total;
    }
    function timeline(store, sku, from, physical, display, inbound, fallback) {
      let balance=physical-display, need=0, openingRisk=false, atArrival=0;
      for(let d=from;d<=timing.protectionEnd;d=add(d,1)) {
        balance += inbound.filter(t=>add(t.date,2)===d || (d===from && add(t.date,2)<from)).reduce((s,t)=>s+t.quantity,0);
        if(d===timing.usableDate) atArrival=Math.max(0,balance);
        balance -= daily(store,sku,d,fallback);
        if(d<timing.usableDate && balance<0) { openingRisk=true; balance=0; }
        if(d>=timing.usableDate) need=Math.max(need,-balance);
      }
      return { need:Math.max(0,Math.ceil(need-1e-9)), openingRisk, atArrival, inbound };
    }
    return { active, timing, demand, timeline, has: (store,sku) => rows.has(`${store}|${sku}`) && plan.source.months.some(m=>plan.config.targets[m.month][store]>0), planId: plan.id, revision: plan.revision, name: plan.source.name };
  }
  function projection(usage, base, displayGap, quantity) {
    if(!Array.isArray(usage) || !usage.length) return "活動逐日資料不足，請重新計算";
    let stock=Math.max(0,Number(base))+Math.max(0,Number(quantity)-Number(displayGap));
    for(const [d,q,inbound=0] of usage) {
      stock+=inbound;
      if(stock+1e-9<q) return `不足支撐${d}需求`;
      stock-=q;
    }
    return `至少可售至${usage.at(-1)[0]}（本輪保障範圍）`;
  }
  root.StoreTransferActivity = { BUFFER_DAYS, STORES, add, validDate, validateSource, validatePlan, draftConfig, schedule, prepare, projection };
})(typeof globalThis !== "undefined" ? globalThis : window);
