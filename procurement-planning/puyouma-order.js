(function (global) {
  "use strict";
  const text = value => String(value ?? "").normalize("NFKC").trim();
  const skuKey = value => text(value).toUpperCase();
  const isPuyouma = value => ["普優瑪", "普優瑪寢具有限公司"].includes(text(value));
  function shipmentDate(value) {
    const date = text(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("請填寫完整出貨日期。");
    const parsed = new Date(`${date}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error("出貨日期無效。");
    return { iso: date, label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}出貨` };
  }
  function parseSource(workbook, XLSX, core) {
    const parsed = core.parseConsignmentWorkbook(workbook, XLSX);
    const sheet = workbook.Sheets[parsed.sheetName];
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    let stockColumn = -1;
    for (let col = range.s.c; col <= range.e.c; col++) {
      if (text(sheet[XLSX.utils.encode_cell({ r: range.s.r, c: col })]?.v) === text(parsed.currentHeader)) stockColumn = col;
    }
    // The general planning parser has a legacy zero fallback. A supplier order
    // must retain the distinction between an actual zero and a missing/bad cell.
    const records = parsed.records.map(row => ({ ...row, currentQty: core.parseNumber(sheet[XLSX.utils.encode_cell({ r: row.sourceRow - 1, c: stockColumn })]?.v) }));
    return { ...parsed, records };
  }
  function buildOrder(payload, source, XLSX, options = {}) {
    const date = shipmentDate(options.shipmentDate);
    const batch = payload?.batch;
    if (!batch?.id || !["approved", "erp_created", "received"].includes(batch.status)) throw new Error("只能匯出已確認且未撤銷的採購批次。");
    const items = payload.items || [];
    if (!items.length) throw new Error("這筆歷史批次缺少完整逐品項明細，請先補齊台帳；不能以金額反推數量。");
    const sum = items.reduce((total, row) => total + Number(row.approved_amount), 0);
    if (!Number.isFinite(sum) || Math.abs(sum - Number(batch.approved_amount)) > 0.011) throw new Error("批次明細與台帳金額不一致，已停止匯出，請先核對ERP差異。");
    const selected = items.filter(row => isPuyouma(row.supplier));
    if (!selected.length) throw new Error("此批次沒有普優瑪品項。");
    const errors = [], rows = [], seen = new Set();
    for (const item of selected) {
      const sku = skuKey(item.sku);
      // approved_quantity is the current confirmed ledger quantity. erp_quantity
      // may still be the schema default zero after merely recording an ERP number.
      const quantity = item.approved_quantity;
      if (!sku || seen.has(sku)) { errors.push(`${sku || "空白品號"}：採購明細品號重複或缺漏`); continue; }
      seen.add(sku);
      if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 0) { errors.push(`${sku}：確認採購量無效`); continue; }
      if (quantity === 0) continue;
      const matches = (source?.records || []).filter(row => skuKey(row.sku) === sku);
      if (matches.length !== 1) { errors.push(`${sku}：寄庫表${matches.length ? "有多筆對應" : "找不到對應"}`); continue; }
      const found = matches[0];
      const missing = [];
      if (!text(found.supplierSku)) missing.push("產品編號");
      if (!text(found.name)) missing.push("商品名稱");
      if (typeof found.unitCost !== "number" || !Number.isFinite(found.unitCost) || found.unitCost < 0) missing.push("有效成品價");
      if (typeof found.currentQty !== "number" || !Number.isFinite(found.currentQty) || found.currentQty < 0) missing.push("有效最新庫存");
      if (missing.length) { errors.push(`${sku}：寄庫表缺少${missing.join("、")}`); continue; }
      rows.push({ sku, quantity, sourceRow: found.sourceRow, values: [text(found.supplierSku), sku, text(found.name), found.unitCost, found.currentQty, quantity] });
    }
    if (errors.length) throw new Error(`無法完整匯出：\n${errors.join("\n")}`);
    if (!rows.length) throw new Error("此批次沒有確認採購量大於0的普優瑪品項。");
    if (!source?.currentHeader) throw new Error("寄庫表未提供最新庫存欄位，已停止匯出。");
    rows.sort((a, b) => a.sourceRow - b.sourceRow || a.sku.localeCompare(b.sku, "zh-Hant", { numeric: true }));
    const headers = ["產品編號", "編號", "商品名稱", "成品價", source.currentHeader, date.label, "排序"];
    const data = [headers, ...rows.map((row, index) => [...row.values, index + 1])];
    const sheet = XLSX.utils.aoa_to_sheet(data);
    sheet["!cols"] = [30, 16, 58, 12, 15, 15, 8].map(wch => ({ wch }));
    sheet["!rows"] = [{ hpt: 45 }, ...rows.map(row => ({ hpt: Math.max(25, Math.ceil(row.values[2].replace(/[^\x00-\xff]/g, "XX").length / 54) * 17) }))];
    sheet["!autofilter"] = { ref: sheet["!ref"] };
    sheet["!margins"] = { left: .3, right: .3, top: .5, bottom: .5, header: .2, footer: .2 };
    for (let r = 0; r < data.length; r++) for (let c = 0; c < 7; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      cell.s = { fill: { patternType: "solid", fgColor: { rgb: "FFFFFFFF" } }, font: { name: "微軟正黑體", sz: 11, bold: r === 0, color: { rgb: "FF000000" } }, alignment: { vertical: "center", horizontal: c < 3 ? "left" : "center", wrapText: true }, border: Object.fromEntries(["top", "bottom", "left", "right"].map(side => [side, { style: "thin", color: { rgb: "FFD8E4E8" } }])) };
      if (r === 0 && c < 5) cell.s.fill = { patternType: "solid", fgColor: { rgb: c === 4 ? "FFFFCC99" : "FFC0C0C0" } };
      if (r > 0 && c >= 3) cell.z = c === 3 ? "#,##0.##" : "#,##0.###";
    }
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, "普");
    const quantity = rows.reduce((total, row) => total + row.quantity, 0);
    const exported = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }).slice(1);
    if (exported.length !== rows.length || exported.reduce((total, row) => total + Number(row[5]), 0) !== quantity) throw new Error("匯出品項或數量核對失敗，已停止下載。");
    // Keep core metadata on one line: Excel rejects the writer's xml:space
    // attribute on a multiline dc:description. The visible stock header stays multiline.
    workbook.Props = { Title: "普優瑪專屬採購單", Subject: `${batch.id} v${batch.revision}；出貨${date.iso}；${rows.length}品號／${quantity}件`, Comments: `庫存欄：${text(source.currentHeader).replace(/\s+/g, " ")}。價格及庫存來自本次讀取寄庫表；下載不代表再次下單。` };
    return { workbook, rows, quantity, shipmentDate: date.iso, fileName: `${String(batch.id).replace(/[\\/:*?"<>|]/g, "-")}_普優瑪_${date.iso}_採購單.xlsx` };
  }
  global.PuyoumaOrder = { isPuyouma, shipmentDate, parseSource, buildOrder };
})(typeof globalThis !== "undefined" ? globalThis : window);
