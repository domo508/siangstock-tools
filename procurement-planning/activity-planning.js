(function (global) {
  "use strict";
  const DAY = 86400000;
  const MODELS = ["近期6週", "近期12週", "去年同月", "近期70%＋同月30%", "近期50%＋同月50%", "近期30%＋同月70%"];
  const core = () => global.ProcurementPlanningCore;
  const positive = (value) => Math.max(0, Number(value) || 0);
  function date(value) {
    const s = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : "";
  }
  function add(value, count) { return new Date(Date.parse(`${value}T00:00:00Z`) + count * DAY).toISOString().slice(0, 10); }
  function between(a, b) { return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY) + 1; }
  function monthEnd(month) { return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10); }
  function shiftMonth(month, n) { return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + n, 1)).toISOString().slice(0, 7); }
  function months(start, end) {
    if (!date(start) || !date(end) || start > end || between(start, end) > 366) return [];
    const result = [];
    for (let m = start.slice(0, 7); m <= end.slice(0, 7); m = shiftMonth(m, 1)) result.push(m);
    return result;
  }
  function attachTransferSource(result, settings, monthly, index, input, affected) {
    // Only derived forecast quantities and store-level date weights cross tools;
    // no transactions, workbook names, or customer identifiers are included.
    const transferMonths = settings.months.map(month => {
      const targets = {}, weights = {}, weekdayBasis = {};
      for (const store of global.StoreTransferActivity?.STORES || ["R00", "R01", "R03", "R10", "R07", "R06"]) {
        const projection = monthly.get(`${month}\t${store}`);
        targets[store] = projection?.target || 0;
        const weekdayTotals = Array(7).fill(0), weekdayDays = Array(7).fill(0);
        for (let d = add(input.asOfDate, -83); d <= input.asOfDate; d = add(d, 1)) {
          const day = new Date(`${d}T00:00:00Z`).getUTCDay();
          weekdayDays[day] += 1;
          weekdayTotals[day] += positive(index.channel.get(store)?.get(d)?.[1]);
        }
        const averages = weekdayTotals.map((v,i) => v / Math.max(1, weekdayDays[i]));
        const verified = index.covered(add(input.asOfDate, -83), input.asOfDate) && averages.reduce((a,b) => a+b,0) > 0;
        weekdayBasis[store] = verified ? "近12週各星期實收營收分布" : "資料不足，採均勻分布；總部須確認";
        const raw = Array.from({ length: between(`${month}-01`, monthEnd(month)) }, (_,i) => (projection?.shape.weights[i] || 1) * (verified ? averages[new Date(`${month}-${String(i+1).padStart(2,"0")}T00:00:00Z`).getUTCDay()] : 1));
        const total = raw.reduce((a,b) => a+b,0);
        weights[store] = raw.map(v => total > 0 ? v / total : 1/raw.length);
      }
      const retailTarget = Object.values(targets).reduce((a,b) => a+b,0);
      return { month, retailTarget, onlineAndOtherTarget: Math.max(0, settings.monthlyTargets[month].amount - retailTarget), targets, weights, weekdayBasis };
    });
    const transferRows = [];
    for (const row of affected) {
      if (row.externalPurchaseBlocked || row.manualSupplierReview || row.sellThroughStop) continue;
      for (const store of Object.keys(transferMonths[0]?.targets || {})) {
        const local = positive(row.storeDailyByCode?.[store]), direct = positive(row.storeDirectDailyByCode?.[store]);
        // B3 remains a headquarters shipment; it must not become store stock.
        const localShare = local + direct > 0 ? local / (local + direct) : 0;
        const quantities = Object.fromEntries(row.activityPlanning.monthlyDetails.filter(d => d.channel === store && settings.months.includes(d.month)).map(d => [d.month, d.monthlyQty * localShare]));
        if (Object.values(quantities).some(q => q > 0)) transferRows.push({ storeCode: store, sku: row.sku, quantities });
      }
    }
    result.activityTransferSource = { version: 1, name: settings.name, startDate: settings.startDate, endDate: settings.endDate, asOfDate: input.asOfDate, scope: settings.scope, months: transferMonths, rows: transferRows };
    return result;
  }
  function normalize(settings, asOfDate) {
    if (!date(asOfDate)) throw new Error("活動備貨缺少有效資料截止日。");
    const startDate = date(settings.startDate), endDate = date(settings.endDate);
    if (!String(settings.name || "").trim()) throw new Error("請填寫活動名稱。");
    if (!startDate || !endDate || endDate < startDate) throw new Error("活動日期不完整，或結束日早於開始日。");
    if (endDate <= asOfDate) throw new Error("活動已結束，請確認活動年份與資料截止日。");
    const list = months(startDate, endDate);
    if (!list.length || between(asOfDate, endDate) > 366) throw new Error("活動備貨最多規劃未來366天。");
    const supplied = settings.monthlyTargets || {};
    const monthlyTargets = {};
    for (const month of list) {
      const source = supplied[month];
      const amount = Number(typeof source === "object" ? source?.amount : source);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) throw new Error(`${month}請填寫大於0且不超過一兆元的整月營收目標（已含活動）。`);
      const retailAmount = source?.retailAmount == null || source?.retailAmount === "" ? null : Number(source.retailAmount);
      if(retailAmount!=null && (!Number.isFinite(retailAmount) || retailAmount<0 || retailAmount>amount)) throw new Error(`${month}實體六店目標不可超過全通路目標。`);
      monthlyTargets[month] = { amount, retailAmount, source: String(source?.source || "本次活動草稿"), updatedAt: String(source?.updatedAt || "") };
    }
    return { enabled: true, name: String(settings.name).trim(), method: "monthly-target", methodLabel: "整月目標分配（已含活動）", startDate, endDate, scope: settings.scope || "all", monthlyTargets, months: list };
  }

  // Identity keys remain in worker memory only. The returned history contains no order IDs or customer fields.
  function createHistoryBuilder() {
    const cells = new Map(), signatures = new Map(), fingerprints = new Map(), intervals = [], sources = [];
    let duplicates = 0, accepted = 0;
    function ingest(report, metadata = {}) {
      const counts = new Map(), identities = new Map();
      let added = 0, skipped = 0;
      const staged = [];
      for (const row of report.records || []) {
        if (!core().DEMAND_SALE_TYPES.includes(row.saleType) || !date(row.date) || !row.sku) continue;
        if (!Number.isFinite(Number(row.quantity)) || !Number.isFinite(Number(row.actualAmount))) throw new Error(`歷史銷售第${row.sourceRow || "?"}列數量或金額無效。`);
        const order = row.posOrder || row.sourceOrder || row.pickupOrder;
        const identity = order ? [row.saleType, row.transactionTimestamp || row.date, row.sku, row.warehouseCode, order].join("¦") : "";
        const fingerprint = [row.quantity, row.deductQuantity, row.actualAmount].join("¦");
        if (identity && fingerprints.has(identity) && !fingerprints.get(identity).has(fingerprint)) throw new Error("歷史銷售跨檔相同交易的數量或金額不同，已停止活動備貨，請先確認來源。");
        if (identity) { if (!identities.has(identity)) identities.set(identity, new Set()); identities.get(identity).add(fingerprint); }
        const signature = [row.saleType, row.transactionTimestamp || row.date, row.sku, row.quantity, row.deductQuantity, row.warehouseCode, row.shipWarehouseCode, row.posOrder, row.sourceOrder, row.pickupOrder, row.actualAmount, row.purchaseCostAmount, row.storeCostAmount, row.registeredWarehouseCostAmount].map(v => String(v ?? "").normalize("NFKC").trim()).join("||");
        const count = (counts.get(signature) || 0) + 1; counts.set(signature, count);
        if (count <= (signatures.get(signature) || 0)) { skipped += 1; continue; }
        staged.push(row);
      }
      for (const row of staged) {
        const key = JSON.stringify([row.date, core().salesChannelKey(row), row.sku]);
        const cell = cells.get(key) || [row.date, core().salesChannelKey(row), row.sku, 0, 0];
        cell[3] += Number(row.quantity); cell[4] += Number(row.actualAmount); cells.set(key, cell); added += 1;
      }
      for (const [key, count] of counts) signatures.set(key, Math.max(signatures.get(key) || 0, count));
      for (const [key, values] of identities) { if (!fingerprints.has(key)) fingerprints.set(key, new Set()); values.forEach(v => fingerprints.get(key).add(v)); }
      if (date(report.minDate) && date(report.maxDate)) intervals.push([report.minDate, report.maxDate]);
      sources.push({ id: metadata.id || "", modifiedTime: metadata.modifiedTime || "", checksum: metadata.md5Checksum || "", minDate: report.minDate || "", maxDate: report.maxDate || "" });
      accepted += added; duplicates += skipped;
      return { acceptedRows: added, duplicateRows: skipped };
    }
    return { ingest, finalize: () => ({ version: 1, cells: [...cells.values()], intervals, sources, acceptedRows: accepted, duplicateRows: duplicates }) };
  }
  function buildIndex(history, reports, cutoff) {
    if (history?.version !== 1 || !Array.isArray(history.cells) || !Array.isArray(history.intervals)) throw new Error("活動備貨尚缺已驗證的歷史銷售彙總，請完成公司Google授權後再產生建議。");
    const channel = new Map(), sku = new Map();
    const insert = (map, key, d, q, a) => { if (!map.has(key)) map.set(key, new Map()); const v = map.get(key).get(d) || [0, 0]; v[0] += q; v[1] += a; map.get(key).set(d, v); };
    for (const cell of history.cells) {
      if (!Array.isArray(cell) || !date(cell[0]) || !Number.isFinite(cell[3]) || !Number.isFinite(cell[4])) throw new Error("活動歷史彙總格式異常，請重新取得來源。");
      if (cell[0] > cutoff) continue;
      insert(channel, cell[1], cell[0], cell[3], cell[4]); insert(sku, `${cell[2]}\t${cell[1]}`, cell[0], cell[3], cell[4]);
    }
    // Recent reports are ingested by the worker together with historical files to use one cross-file de-duplication rule.
    const intervals = history.intervals.filter(i => date(i[0]) && date(i[1])).map(i => [i[0], i[1] < cutoff ? i[1] : cutoff]).sort((a, b) => a[0].localeCompare(b[0]));
    function covered(from, to) { let cursor = from; for (const [a, b] of intervals) { if (a > cursor) break; if (b >= cursor) cursor = add(b, 1); if (cursor > to) return true; } return false; }
    return { channel, sku, covered, reports };
  }
  // Prefix totals keep per-SKU rolling backtests bounded when loading several years of sales.
  const totalsCache = new WeakMap();
  function sum(series, from, to, field) {
    if (!series || from > to) return 0;
    let cached = totalsCache.get(series);
    if (!cached) {
      const days = [...series.keys()].sort(), totals = [[0], [0]];
      for (const d of days) for (let f = 0; f < 2; f += 1) totals[f].push(totals[f].at(-1) + Number(series.get(d)?.[f] || 0));
      cached = { days, totals }; totalsCache.set(series, cached);
    }
    const bound = (d, inclusive) => { let low = 0, high = cached.days.length; while (low < high) { const mid = (low + high) >>> 1; if (cached.days[mid] < d || (inclusive && cached.days[mid] === d)) low = mid + 1; else high = mid; } return low; };
    return Math.max(0, cached.totals[field][bound(to, true)] - cached.totals[field][bound(from, false)]);
  }
  function latestOrderDate(deadline, leadDays, rules) {
    let candidate = add(deadline, -Math.ceil(leadDays));
    for (let i = 0; i < 366; i += 1, candidate = add(candidate, -1)) if (core().holidayCoverageAdjustment(candidate, leadDays, rules).adjustedDate <= deadline) return candidate;
    return "";
  }
  function prediction(series, month, cutoff, model, field, covered) {
    const end = monthEnd(month), n = between(`${month}-01`, end);
    const six = covered(add(cutoff, -41), cutoff) ? sum(series, add(cutoff, -41), cutoff, field) / 42 * n : null;
    const twelve = covered(add(cutoff, -83), cutoff) ? sum(series, add(cutoff, -83), cutoff, field) / 84 * n : null;
    const prior = shiftMonth(month, -12), priorEnd = monthEnd(prior);
    const previous = priorEnd <= cutoff && covered(`${prior}-01`, priorEnd) ? sum(series, `${prior}-01`, priorEnd, field) : null;
    if (model === MODELS[0]) return six;
    if (model === MODELS[1]) return twelve;
    if (model === MODELS[2]) return previous;
    if (six == null || previous == null) return null;
    const weight = model === MODELS[3] ? 0.7 : model === MODELS[4] ? 0.5 : 0.3;
    return six * weight + previous * (1 - weight);
  }
  function forecast(series, month, cutoff, field, covered) {
    const lead = Math.max(0, between(cutoff, `${month}-01`) - 1);
    const eligibleModels = MODELS.filter(model => prediction(series, month, cutoff, model, field, covered) != null);
    const metrics = eligibleModels.map(model => ({ model, actual: 0, error: 0, samples: 0 }));
    let target = shiftMonth(cutoff.slice(0, 7), -1);
    for (let i = 0; i < 12; i += 1, target = shiftMonth(target, -1)) {
      const end = monthEnd(target), trainCutoff = add(`${target}-01`, -lead);
      if (end > cutoff || !covered(`${target}-01`, end) || trainCutoff >= `${target}-01`) continue;
      const actual = sum(series, `${target}-01`, end, field);
      if (actual <= 0) continue;
      const predictions = metrics.map(m => prediction(series, target, trainCutoff, m.model, field, covered));
      if (predictions.some(p => p == null)) continue;
      metrics.forEach((m, i) => { m.actual += actual; m.error += Math.abs(predictions[i] - actual); m.samples += 1; });
    }
    const available = metrics.filter(m => m.samples >= 3 && m.actual > 0 && prediction(series, month, cutoff, m.model, field, covered) != null).sort((a, b) => a.error / a.actual - b.error / b.actual || MODELS.indexOf(a.model) - MODELS.indexOf(b.model));
    let selected = available[0];
    if (!selected) { const model = MODELS.find(m => prediction(series, month, cutoff, m, field, covered) != null); if (!model) throw new Error("歷史與近期銷售期間不足，無法估算活動月份；請補足完整近6週資料。"); selected = { model, samples: 0, error: 0, actual: 0 }; }
    return { value: positive(prediction(series, month, cutoff, selected.model, field, covered)), model: selected.model, samples: selected.samples, wape: selected.actual > 0 ? selected.error / selected.actual : null, basis: selected.samples >= 3 ? "提前採購同距離回測" : "回測樣本不足，採可用近期基準" };
  }
  function distribution(series, month, settings, online, cutoff, covered) {
    const length = between(`${month}-01`, monthEnd(month));
    const activeDays = Array.from({ length }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`).filter(d => d >= settings.startDate && d <= settings.endDate);
    if (!activeDays.length) return { weights: Array(length).fill(1 / length), source: "非活動月份正常需求" };
    const prior = shiftMonth(month, -12), n = between(`${prior}-01`, monthEnd(prior));
    if (monthEnd(prior) > cutoff || !covered(`${prior}-01`, monthEnd(prior))) return { weights: Array(length).fill(1 / length), source: "缺去年完整同月，活動分布未驗證；均勻基準" };
    const amounts = Array.from({ length: n }, (_, i) => positive(series?.get(`${prior}-${String(i + 1).padStart(2, "0")}`)?.[1]));
    const total = amounts.reduce((a, b) => a + b, 0), window = Math.min(n, online ? Math.max(7, activeDays.length) : activeDays.length);
    if (total <= 0) return { weights: Array(length).fill(1 / length), source: "去年同月無有效金額，活動分布未驗證；均勻基準" };
    let peak = 0;
    for (let i = 0; i <= n - window; i += 1) peak = Math.max(peak, amounts.slice(i, i + window).reduce((a, b) => a + b, 0));
    // The event redistributes a fixed monthly total; it never adds a second multiplier to that total.
    const outside = window < n ? (total - peak) / (n - window) : total / n;
    const ratio = outside > 0 ? Math.max(1, peak / window / outside) : 1;
    const denominator = length - activeDays.length + ratio * activeDays.length;
    return { weights: Array.from({ length }, (_, i) => { const d = `${month}-${String(i + 1).padStart(2, "0")}`; return (d >= settings.startDate && d <= settings.endDate ? ratio : 1) / denominator; }), source: online ? "去年同月活動週期集中度；不以ERP入帳高峰當下單日" : "去年同月活動區間集中度", ratio };
  }
  function scopeApplies(scope, row) {
    if (scope === "all") return true;
    if (scope === "puyouma-tencel") return /普優[瑪碼]/.test(row.supplier) && row.purchaseTab === "天絲＋天絲棉";
    if (scope === "puyouma-long-staple") return /普優[瑪碼]/.test(row.supplier) && row.purchaseTab === "長絨棉";
    if (scope === "puyouma-no-size") return /普優[瑪碼]/.test(row.supplier) && row.purchaseTab === "無尺寸品項";
    return ({ "supplier-lirong": /力榮/, "supplier-shanglin": /上林/, "supplier-runtai": /潤泰羽絨/, "supplier-taineng": /泰能脊康/ })[scope]?.test(row.supplier) || false;
  }
  function prepare(input) {
    const settings = normalize(input.activityDemand, input.asOfDate);
    const index = buildIndex(input.activityHistory, input.salesReports, input.asOfDate);
    const plannedStores = new Set((input.revenueChannels || []).filter(r => Number(r.amount) > 0).map(r => core().plannedChannelKey(r)));
    const channels = [...index.channel.keys()].filter(channel => !/^R\d{2}$/.test(channel) || channel === "R09" || sum(index.channel.get(channel), add(input.asOfDate, -83), input.asOfDate, 0) > 0 || plannedStores.has(channel));
    const monthly = new Map(), notes = new Set();
    const planningStartMonth = settings.months[0] === input.asOfDate.slice(0, 7) ? settings.months[0] : shiftMonth(input.asOfDate.slice(0, 7), 1);
    const planningMonths = months(`${planningStartMonth}-01`, settings.endDate);
    for (const month of planningMonths) {
      if (month === input.asOfDate.slice(0, 7) && !index.covered(`${month}-01`, input.asOfDate)) throw new Error("當月活動須涵蓋月初至資料截止日的銷售，才能扣除已實現營收。");
      const projections = channels.map(channel => ({ channel, ...forecast(index.channel.get(channel), month, input.asOfDate, 1, index.covered) }));
      const baseline = projections.reduce((s, p) => s + p.value, 0);
      if (!(baseline > 0)) throw new Error(`${month}缺少可用的通路營收基準，無法分配整月目標。`);
      const target = settings.monthlyTargets[month]?.amount ?? baseline;
      const retailAmount=settings.monthlyTargets[month]?.retailAmount;
      const retailStores=new Set(["R00","R01","R03","R10","R07","R06"]);
      const retailBaseline=projections.filter(p=>retailStores.has(p.channel)).reduce((s,p)=>s+p.value,0),otherBaseline=baseline-retailBaseline;
      if(retailAmount!=null && ((retailAmount>0 && retailBaseline<=0) || (target-retailAmount>0 && otherBaseline<=0))) throw new Error(`${month}缺少實體或其他通路歷史，無法依指定目標分配。`);
      for (const p of projections) {
        const shape = distribution(index.channel.get(p.channel), month, settings, !/^R\d{2}$/.test(p.channel), input.asOfDate, index.covered);
        const factor = retailAmount==null ? target/baseline : retailStores.has(p.channel) ? (retailBaseline>0?retailAmount/retailBaseline:0) : (otherBaseline>0?(target-retailAmount)/otherBaseline:0);
        if (factor > 1.5 || factor < 0.5) notes.add(`${month}整月目標為資料推估的${factor.toFixed(2)}倍，請核對目標與供貨風險。`);
        if (shape.source.includes("未驗證")) notes.add(`${p.channel}：${shape.source}`);
        monthly.set(`${month}\t${p.channel}`, { ...p, target: p.value*factor, factor, shape, baseline });
      }
    }
    return { settings, index, monthly, planningMonths, notes };
  }
  function buildRecommendations(input, baseBuilder) {
    const context = prepare(input), { settings, index, monthly } = context;
    const candidates = new Set();
    for (const [key, series] of index.sku) { const sku = key.split("\t")[0], master = input.master.bySku.get(sku); if (master && scopeApplies(settings.scope, { supplier: master.supplier, purchaseTab: core().classifyPuyoumaPurchaseTab(master, master.name) }) && settings.months.some(m => sum(series, `${shiftMonth(m, -12)}-01`, monthEnd(shiftMonth(m, -12)), 0) > 0)) candidates.add(sku); }
    const result = baseBuilder({ ...input, activityCandidateSkus: candidates, activityDemand: { enabled: false } });
    const purchaseDate = date(input.orderDate) || input.asOfDate;
    if (purchaseDate < input.asOfDate) throw new Error("預計下單日不能早於活動需求資料截止日。");
    const readyBy = add(settings.startDate, -1), rows = result.rows;
    for (const row of rows) {
      if (!scopeApplies(settings.scope, row)) continue;
      const channelNeeds = new Map(), monthlyDetails = [];
      for (const channel of new Set([...monthly.values()].map(p => p.channel))) {
        const series = index.sku.get(`${row.sku}\t${channel}`);
        if (!series) continue;
        let quantity = 0;
        for (const month of context.planningMonths) {
          const projection = monthly.get(`${month}\t${channel}`);
          if (!projection || projection.value <= 0) continue;
          const quantityForecast = forecast(series, month, input.asOfDate, 0, index.covered);
          const recentQty = sum(series, add(input.asOfDate, -83), input.asOfDate, 0);
          const recentAmount = sum(series, add(input.asOfDate, -83), input.asOfDate, 1);
          const recentUnitPrice = recentQty > 0 && recentAmount > 0 ? recentAmount / recentQty : null;
          const modelAmount = prediction(series, month, input.asOfDate, quantityForecast.model, 1, index.covered);
          const modelUnitPrice = quantityForecast.value > 0 && modelAmount > 0 ? modelAmount / quantityForecast.value : null;
          const priceAdjustment = recentUnitPrice && modelUnitPrice ? modelUnitPrice / recentUnitPrice : 1;
          const futureWeight = projection.shape.weights.reduce((total, weight, i) => total + (`${month}-${String(i + 1).padStart(2, "0")}` > input.asOfDate ? weight : 0), 0);
          const actualMonthRevenue = month === input.asOfDate.slice(0, 7) ? sum(index.channel.get(channel), `${month}-01`, input.asOfDate, 1) : 0;
          const remainingAdjustment = month === input.asOfDate.slice(0, 7) ? (projection.target > 0 && futureWeight > 0 ? Math.max(0, projection.target - actualMonthRevenue) / projection.target / futureWeight : 0) : 1;
          const monthlyQty = quantityForecast.value * projection.factor * priceAdjustment * remainingAdjustment;
          if (!recentUnitPrice || !modelUnitPrice) context.notes.add("部分SKU缺少可比較的實收單價，需求以件數基準估算，請覆核促銷折扣與商品組合。");
          let fraction = 0;
          for (let i = 0; i < projection.shape.weights.length; i += 1) { const d = `${month}-${String(i + 1).padStart(2, "0")}`; if (d > input.asOfDate && d <= settings.endDate) fraction += projection.shape.weights[i]; }
          quantity += monthlyQty * fraction;
          monthlyDetails.push({ month, channel, monthlyQty, model: quantityForecast.model, samples: quantityForecast.samples, wape: quantityForecast.wape, recentUnitPrice, modelUnitPrice, priceAdjustment, actualMonthRevenue, remainingAdjustment, distribution: projection.shape.source });
        }
        channelNeeds.set(channel, quantity);
      }
      // The period before a future target month still consumes today's stock.
      const firstMonthStart = `${settings.months[0]}-01`;
      const preEnd = add(firstMonthStart, -1) < monthEnd(input.asOfDate.slice(0, 7)) ? add(firstMonthStart, -1) : monthEnd(input.asOfDate.slice(0, 7));
      const preDays = Math.max(0, between(add(input.asOfDate, 1), preEnd));
      let hqNeed = positive(row.hqDailyQty) * preDays, storeNeed = 0, earliestHqDeadline = readyBy;
      const storeNeeds = {}, storeDeadlines = {}, storeReadyDates = {};
      for (const [channel, quantity] of channelNeeds) {
        if (!/^R\d{2}$/.test(channel) || channel === "R09") { hqNeed += quantity; continue; }
        const recent = positive(row.storeDailyByCode?.[channel]) + positive(row.storeDirectDailyByCode?.[channel]);
        const directShare = recent > 0 ? positive(row.storeDirectDailyByCode?.[channel]) / recent : 0;
        hqNeed += quantity * directShare;
        const need = Math.max(quantity * (1 - directShare) + positive(row.storeDailyByCode?.[channel]) * preDays + core().storeTargetQty(positive(row.storeDailyByCode?.[channel]), row.tier) - positive(row.storeInventoryByCode?.[channel]), positive(row.storeTransferNeedByCode?.[channel]));
        storeNeeds[channel] = need; storeNeed += need;
        if (need > 0) {
          if (!global.StoreTransferCore?.storeSchedule) throw new Error("門市到店排程模組未載入，已停止活動備貨。");
          let last = "";
          for (let proposal = purchaseDate; proposal <= readyBy; proposal = add(proposal, 1)) { const schedule = global.StoreTransferCore.storeSchedule(proposal, channel, input.storeInventoryRules || {}); if (schedule.currentArrivalDate <= readyBy) { last = proposal; storeReadyDates[channel] = schedule.currentArrivalDate; } }
          storeDeadlines[channel] = last;
          if (!last) context.notes.add(`${channel}依現行到店排程已趕不上活動前備妥；請人工協調，不視為可備妥。`);
          else if (last < earliestHqDeadline) earliestHqDeadline = last;
        }
      }
      hqNeed += positive(row.hqDailyQty) * positive(row.safetyBufferDays);
      const grossNeed = hqNeed + storeNeed;
      const purchase = result.pending.bySku.get(row.sku);
      const datedPending = (purchase?.deliveries || []).reduce((total, delivery) => total + (date(delivery.deliveryDate) && delivery.deliveryDate <= earliestHqDeadline ? positive(delivery.quantity) : 0), 0);
      const pending = Math.min(positive(row.pendingQty), datedPending);
      const net = Math.max(0, grossNeed - positive(row.inventoryQty) - pending);
      const reserved = positive(input.reservedConsignmentBySku?.get?.(row.sku));
      const isConsignment = /普優[瑪碼]|力榮/.test(row.supplier);
      const verified = !isConsignment || row.consignmentDataAvailable !== false;
      const availableConsignment = isConsignment && verified ? Math.max(0, positive(row.consignmentCurrentQty) - positive(row.pendingQty) - reserved) : 0;
      const blocked = row.externalPurchaseBlocked || row.manualSupplierReview;
      const plannedRaw = Math.max(positive(row.releasedPurchaseQty), net);
      const planned = blocked ? positive(row.suggestedPurchaseQty) : Math.max(positive(row.suggestedPurchaseQty), Math.ceil(plannedRaw / row.packSize) * row.packSize);
      const capped = row.sellThroughStop ? Math.min(planned, availableConsignment) : planned;
      const extra = Math.max(0, capped - positive(row.suggestedPurchaseQty));
      const arrival = core().holidayCoverageAdjustment(purchaseDate, positive(row.supplierLeadDays), input.storeInventoryRules || {}).adjustedDate;
      const onTime = arrival <= earliestHqDeadline;
      const pull = isConsignment && verified && onTime ? Math.min(net, availableConsignment) : 0;
      const productionDays = isConsignment ? positive(row.consignmentProductionDays) : 0;
      const productionArrival = core().holidayCoverageAdjustment(purchaseDate, positive(row.supplierLeadDays) + productionDays, input.storeInventoryRules || {}).adjustedDate;
      const replenishment = !blocked && !row.sellThroughStop && (isConsignment ? verified && productionArrival <= earliestHqDeadline : onTime) ? Math.max(0, net - pull) : 0;
      const storeScheduleMissing = Object.values(storeDeadlines).some(v => !v);
      const transferDateUnverified = positive(row.transferSubmittedQty) + positive(row.transferInTransitQty) > 0;
      if (transferDateUnverified) context.notes.add("既有待發／在途調撥沿用主工具預計庫存口徑，但缺可確認到店日；相關SKU不標示活動前已備妥，須核對物流。");
      const gap = verified && !transferDateUnverified ? Math.max(0, net - pull - replenishment, storeScheduleMissing ? storeNeed : 0) : null;
      const status = !verified ? "寄庫資料未驗證" : transferDateUnverified ? "既有調撥到店日待確認" : storeScheduleMissing ? "門市到店排程來不及" : gap > 0 ? "活動前仍有缺口" : net > 0 ? "需要採購／寄庫拉貨" : "現有供貨可備妥";
      row.activityDemandApplied = true; row.activityDemandName = settings.name; row.activityDemandMethod = settings.methodLabel; row.activityDemandScope = settings.scope; row.activityDemandMultiplier = null;
      row.activityDemandCoverageDays = between(settings.startDate > input.asOfDate ? settings.startDate : add(input.asOfDate, 1), settings.endDate);
      row.activityDemandAdditionalRawQty = Math.max(0, net - positive(row.releasedPurchaseQty)); row.activityDemandAdditionalSuggestedQty = extra;
      row.activityPlanning = { grossNeed, hqNeed, storeNeed, storeNeeds, pendingTimelyQty: pending, pendingExcludedQty: Math.max(0, positive(row.pendingQty) - pending), netNeed: net, readyBy, hqDeadline: earliestHqDeadline, storeDeadlines, storeReadyDates, purchaseDate, expectedArrival: arrival, expectedProductionArrival: productionArrival, lastOrderDate: latestOrderDate(earliestHqDeadline, positive(row.supplierLeadDays), input.storeInventoryRules || {}), lastProductionOrderDate: latestOrderDate(earliestHqDeadline, positive(row.supplierLeadDays) + productionDays, input.storeInventoryRules || {}), availableConsignment: verified ? availableConsignment : null, pullQty: verified ? pull : null, onTimePurchaseCapacity: verified ? pull + replenishment : null, productionNeed: verified && isConsignment ? Math.max(0, net - pull) : null, shortage: gap, status, verified, transferDateUnverified, monthlyDetails };
      row.suggestedPurchaseQty = capped; row.suggestedPurchaseAmount = capped * row.unitCost;
      row.releasedPurchaseQty = Math.max(row.releasedPurchaseQty, net); row.baseSuggestedPurchaseQty = Math.max(row.baseSuggestedPurchaseQty, Math.ceil(net));
      row.rawPurchaseQty = Math.max(row.rawPurchaseQty, net); row.hqDemandQty = Math.max(row.hqDemandQty, hqNeed); row.storeDemandQty = Math.max(row.storeDemandQty, storeNeed);
      if (isConsignment && verified && !blocked && !row.sellThroughStop) { row.immediateConsignmentGap = Math.max(row.immediateConsignmentGap, Math.max(0, capped + row.pendingQty + reserved - positive(row.consignmentCurrentQty))); row.suggestedConsignmentQty = Math.max(row.suggestedConsignmentQty, Math.ceil(row.immediateConsignmentGap)); }
      if (extra > 0) row.recommendationSource = [row.recommendationSource, "活動提前備貨"].filter(Boolean).join("；");
      row.supplyStatus = `${row.supplyStatus}；${settings.name}：${status}`;
    }
    result.rows.sort((a, b) => b.suggestedPurchaseAmount - a.suggestedPurchaseAmount || a.sku.localeCompare(b.sku));
    result.suggestedRows = rows.filter(r => r.suggestedPurchaseQty > 0);
    result.consignmentRows = rows.filter(r => r.suggestedConsignmentQty > 0 || r.immediateConsignmentGap > 0);
    const affected = rows.filter(r => r.activityPlanning);
    Object.assign(result.totals, { suggestedSkuCount: result.suggestedRows.length, suggestedPurchaseQty: result.suggestedRows.reduce((s, r) => s + r.suggestedPurchaseQty, 0), suggestedPurchaseAmount: result.suggestedRows.reduce((s, r) => s + r.suggestedPurchaseAmount, 0), immediateShortageSkuCount: result.consignmentRows.filter(r => r.immediateConsignmentGap > 0).length, consignmentSuggestionSkuCount: result.consignmentRows.length, activityDemandSkuCount: affected.length, activityDemandAdditionalRawQty: affected.reduce((s, r) => s + r.activityDemandAdditionalRawQty, 0), activityDemandAdditionalSuggestedQty: affected.reduce((s, r) => s + r.activityDemandAdditionalSuggestedQty, 0), activityDemandAdditionalAmount: affected.reduce((s, r) => s + r.activityDemandAdditionalSuggestedQty * r.unitCost, 0) });
    result.appliedRules.activityDemand = { ...settings, scopeLabel: core().activityDemandScopeLabel(settings.scope), policy: "整月目標已含活動；SKU各自回測件數並依近12週實收單價校正，促銷價與未來商品組合仍須人工覆核；跨月需求統一扣抵，不另加乘，原始來源僅於瀏覽器處理", sources: input.activityHistory.sources, notes: [...context.notes], monthlyForecasts: settings.months.map(month => { const values = [...monthly.values()].filter(v => monthly.get(`${month}\t${v.channel}`) === v); return { month, target: settings.monthlyTargets[month].amount, forecast: values.reduce((s, r) => s + r.value, 0), channels: values.map(v => ({ channel: v.channel, forecast: v.value, target: v.target, model: v.model, samples: v.samples, wape: v.wape, distribution: v.shape.source })) }; }) };
    result.activitySummary = { ready: affected.filter(r => r.activityPlanning.status === "現有供貨可備妥").length, action: affected.filter(r => r.activityPlanning.status === "需要採購／寄庫拉貨").length, shortage: affected.filter(r => !["現有供貨可備妥", "需要採購／寄庫拉貨"].includes(r.activityPlanning.status)).length };
    return attachTransferSource(result, settings, monthly, index, input, affected);
  }
  function transferDraftFromAnalysis(analysis, retailTargets, history, period = {}) {
    const rule = analysis?.appliedRules?.activityDemand;
    if (!rule || rule.enabled === false || rule.method !== "monthly-target") throw new Error("此分析缺少新版活動依據，請恢復原活動完整母批次，不能只用金額猜測品號需求。");
    const settings = normalize({...rule,startDate:period.startDate || rule.startDate,endDate:period.endDate || rule.endDate}, analysis.asOfDate);
    const changedPeriod=settings.startDate!==rule.startDate || settings.endDate!==rule.endDate;
    if(changedPeriod && (settings.months.join()!==months(rule.startDate,rule.endDate).join() || settings.months.some(m=>m<=analysis.asOfDate.slice(0,7)))) throw new Error("保留採購結果的日期更正僅限原有未來月份；跨月或當月請另行重新分析。");
    let source;
    if (analysis.activityTransferSource && !changedPeriod) source = JSON.parse(JSON.stringify(analysis.activityTransferSource));
    else {
      if (!history) throw new Error("舊分析尚無逐日門市草稿，須先授權讀取歷史銷售；不會重新計算採購量。");
      const context = prepare({activityDemand:settings,asOfDate:analysis.asOfDate,activityHistory:history,salesReports:[]});
      for (const month of settings.months) {
        const saved = rule.monthlyForecasts?.find(m => m.month === month);
        if (!saved?.channels?.length || Math.abs(saved.channels.reduce((s,c)=>s+Number(c.target),0)-Number(settings.monthlyTargets[month].amount)) > 0.02) throw new Error(`${month}缺少原通路分配依據，請恢復完整活動母批次。`);
        for (const channel of saved.channels) {
          const projection=context.monthly.get(`${month}\t${channel.channel}`);
          if (!projection || !Number.isFinite(channel.target) || channel.target < 0) throw new Error(`${month}原通路歷史無法完整配對，不能重建草稿。`);
          projection.target=channel.target;
        }
      }
      const rows=analysis.rows || [];
      if (!rows.some(r=>r.activityPlanning?.monthlyDetails?.length)) throw new Error("此分析沒有逐品號活動依據，請恢復完整母批次，不能使用供應商篩選後的報表代替。");
      source=attachTransferSource({},settings,context.monthly,context.index,{asOfDate:analysis.asOfDate},rows).activityTransferSource;
    }
    for (const month of source.months) {
      const target=Number(retailTargets[month.month]),total=settings.monthlyTargets[month.month]?.amount;
      if (!Number.isFinite(target) || target <= 0 || target > total) throw new Error(`${month.month}門市目標須大於0且不可超過原全通路整月目標。`);
      if (!(month.retailTarget > 0)) throw new Error(`${month.month}原分析沒有可用門市分配基準，不能將零歷史直接放大。`);
      const factor=target/month.retailTarget;
      for (const store of Object.keys(month.targets)) month.targets[store]*=factor;
      for (const row of source.rows) if (row.quantities[month.month]!=null) row.quantities[month.month]*=factor;
      month.retailTarget=target;month.onlineAndOtherTarget=total-target;
    }
    if (!source.rows.length) throw new Error("原分析缺少可用的門市現場需求，無法重建分配草稿。");
    return source;
  }
  global.ProcurementActivityPlanning = { MODELS, date, add, months, normalize, createHistoryBuilder, buildIndex, forecast, distribution, latestOrderDate, prepare, buildRecommendations, transferDraftFromAnalysis };
})(typeof globalThis !== "undefined" ? globalThis : window);
