/* 庫存分類核心：沒有網路呼叫，也不接觸頁面介面。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.InventoryCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const RESULT_COLUMNS = ["分類結果", "判斷原因", "命中的關鍵字"];
  const PURCHASE_AMOUNT_COLUMN = "實際庫存進貨額";
  const PURCHASE_AMOUNT_SOURCE_COLUMNS = {
    inventory: ["實際庫存"],
    inventoryCost: ["實際庫存成本額"],
    purchasePrice: ["進貨價"]
  };
  const RULE_LIST_KEYS = ["排除關鍵字", "待人工確認關鍵字", "指定品名白名單"];
  const CATEGORY_TO_SHEET = {
    "正常商品": "乾淨商品",
    "排除項目": "排除項目",
    "待人工確認": "待確認項目"
  };

  class InventoryWebError extends Error {
    constructor(message) {
      super(message);
      this.name = "InventoryWebError";
    }
  }

  function normalize(value) {
    if (value === null || value === undefined) return "";
    return String(value).normalize("NFKC").toLocaleLowerCase("zh-Hant").trim().replace(/\s+/g, "");
  }

  function normalizeExact(value) {
    if (value === null || value === undefined) return "";
    return String(value).normalize("NFKC").toLocaleLowerCase("zh-Hant").trim();
  }

  function normalizeRules(rules) {
    if (!rules || typeof rules !== "object" || Array.isArray(rules)) {
      throw new InventoryWebError("規則檔內容不是正確的物件格式。")
    }
    if (!rules["欄位辨識"] || !Array.isArray(rules["欄位辨識"]["品名"])) {
      throw new InventoryWebError("規則檔缺少「欄位辨識」中的品名設定。")
    }
    const normalized = JSON.parse(JSON.stringify(rules));
    for (const key of RULE_LIST_KEYS) {
      const source = normalized[key];
      if (source === undefined && key === "指定品名白名單") {
        normalized[key] = [];
        continue;
      }
      if (!Array.isArray(source)) {
        throw new InventoryWebError(`規則檔的「${key}」必須是一份清單。`);
      }
      const seen = new Set();
      normalized[key] = source
        .map((value) => String(value ?? "").normalize("NFKC").trim())
        .filter((value) => {
          const identity = normalizeExact(value);
          if (!identity || seen.has(identity)) return false;
          seen.add(identity);
          return true;
        });
    }
    return normalized;
  }

  function cloneRules(rules) {
    return normalizeRules(rules);
  }

  function addRuleItem(rules, key, value) {
    if (!RULE_LIST_KEYS.includes(key)) throw new InventoryWebError(`不支援的規則類型：${key}`);
    const item = String(value ?? "").normalize("NFKC").trim();
    if (!item) throw new InventoryWebError("請先輸入要新增的文字。")
    const next = cloneRules(rules);
    if (next[key].some((existing) => normalizeExact(existing) === normalizeExact(item))) {
      throw new InventoryWebError(`「${item}」已經在這份清單裡。`);
    }
    next[key].push(item);
    return next;
  }

  function removeRuleItem(rules, key, value) {
    if (!RULE_LIST_KEYS.includes(key)) throw new InventoryWebError(`不支援的規則類型：${key}`);
    const next = cloneRules(rules);
    const identity = normalizeExact(value);
    next[key] = next[key].filter((item) => normalizeExact(item) !== identity);
    return next;
  }

  function parseRulesJson(text) {
    try {
      return normalizeRules(JSON.parse(text));
    } catch (error) {
      if (error instanceof InventoryWebError) throw error;
      throw new InventoryWebError(`規則 JSON 格式錯誤：${error.message || error}`);
    }
  }

  function serializeRules(rules) {
    return `${JSON.stringify(normalizeRules(rules), null, 2)}\n`;
  }

  function displayHeader(value) {
    return value === null || value === undefined || String(value).trim() === ""
      ? "（空白欄名）"
      : String(value);
  }

  function candidateIndex(headers, candidates) {
    const normalizedHeaders = headers.map(normalize);
    for (const candidate of candidates || []) {
      const target = normalize(candidate);
      const index = normalizedHeaders.indexOf(target);
      if (index !== -1) return index;
    }
    return null;
  }

  function cellValue(cell) {
    if (!cell) return null;
    if (cell.t === "e") return cell.w || String(cell.v ?? "");
    return cell.v === undefined ? null : cell.v;
  }

  function worksheetRows(worksheet, XLSX) {
    if (!worksheet || !worksheet["!ref"]) return { rows: [], startRow: 0 };
    const range = XLSX.utils.decode_range(worksheet["!ref"]);
    const rows = [];
    for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
      const row = [];
      for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
        row.push(cellValue(worksheet[address]));
      }
      rows.push(row);
    }
    return { rows, startRow: range.s.r };
  }

  function trimTrailingEmptyRows(rows) {
    const copy = rows.map((row) => row.slice());
    while (copy.length && copy[copy.length - 1].every((value) => value === null || value === undefined)) {
      copy.pop();
    }
    return copy;
  }

  function locateDataSheet(workbook, XLSX, rules) {
    const candidates = rules["欄位辨識"]["品名"];
    const scanRows = Number(rules["表頭搜尋列數"] || 20);
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const extracted = worksheetRows(worksheet, XLSX);
      const maxScan = Math.min(scanRows, extracted.rows.length);
      for (let relativeRow = 0; relativeRow < maxScan; relativeRow += 1) {
        const headers = extracted.rows[relativeRow];
        const productIndex = candidateIndex(headers, candidates);
        if (productIndex !== null) {
          return {
            sheetName,
            worksheet,
            allRows: extracted.rows,
            headerRelativeRow: relativeRow,
            headerRow: extracted.startRow + relativeRow + 1,
            headers: headers.slice(),
            productIndex
          };
        }
      }
    }
    throw new InventoryWebError(
      "找不到品名欄位。請確認 Excel 內有「品名」欄；若公司使用其他欄名，請通知規則管理者調整集中規則。"
    );
  }

  function strictNumber(value) {
    if (value === null || value === undefined || typeof value === "boolean" || value instanceof Date) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;
    let text = value.normalize("NFKC").trim();
    if (!text) return null;
    text = text.replace(/^(?:NT\$|TWD|\$)\s*/i, "");
    if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(text)) return null;
    const number = Number(text.replace(/,/g, ""));
    return Number.isFinite(number) ? number : null;
  }

  function recognizeAmountColumn(headers, rows, candidates, threshold) {
    const index = candidateIndex(headers, candidates);
    if (index === null) {
      return {
        index: null,
        name: null,
        amounts: rows.map(() => null),
        status: "未辨識：找不到明確的庫存金額欄位，因此不提供金額加總。"
      };
    }
    const sourceValues = rows.map((row) => row[index]);
    const amounts = sourceValues.map(strictNumber);
    const nonemptyCount = sourceValues.filter(
      (value) => value !== null && value !== undefined && String(value).trim() !== ""
    ).length;
    const numericCount = amounts.filter((value) => value !== null).length;
    const ratio = nonemptyCount ? numericCount / nonemptyCount : 0;
    const name = displayHeader(headers[index]);
    if (!nonemptyCount) {
      return {
        index: null,
        name: null,
        amounts: rows.map(() => null),
        status: `未辨識：欄位「${name}」沒有可加總的數值。`
      };
    }
    if (ratio < threshold) {
      return {
        index: null,
        name: null,
        amounts: rows.map(() => null),
        status: `未辨識：欄位「${name}」只有 ${Math.round(ratio * 100)}% 的非空白內容是數值，為避免誤算而不加總。`
      };
    }
    return {
      index,
      name,
      amounts,
      status: `已辨識：使用「${name}」加總（可辨識數值比例 ${Math.round(ratio * 100)}%）。`
    };
  }

  function countCategories(categories) {
    const counts = { "正常商品": 0, "排除項目": 0, "待人工確認": 0 };
    categories.forEach((category) => { counts[category] += 1; });
    return counts;
  }

  function analyzeWorkbook(workbook, XLSX, rules, sourceName) {
    const safeRules = normalizeRules(rules);
    const location = locateDataSheet(workbook, XLSX, safeRules);
    const rows = trimTrailingEmptyRows(location.allRows.slice(location.headerRelativeRow + 1));
    const exclusionKeywords = safeRules["排除關鍵字"];
    const reviewKeywords = safeRules["待人工確認關鍵字"];
    const whitelistNames = new Set(safeRules["指定品名白名單"].map(normalizeExact));
    const categories = [];
    const reasons = [];
    const matchedKeywords = [];
    const exclusionPrimaryKeywords = [];

    rows.forEach((row) => {
      const productName = row[location.productIndex];
      const normalizedName = normalize(productName);
      const exactName = normalizeExact(productName);
      const exclusionMatches = exclusionKeywords.filter((keyword) => normalizedName.includes(normalize(keyword)));
      const reviewMatches = reviewKeywords.filter((keyword) => normalizedName.includes(normalize(keyword)));
      if (exactName && whitelistNames.has(exactName)) {
        categories.push("正常商品");
        reasons.push(`完整品名命中白名單：${String(productName).trim()}`);
        matchedKeywords.push(`白名單完整品名：${String(productName).trim()}`);
        exclusionPrimaryKeywords.push(null);
      } else if (exclusionMatches.length) {
        categories.push("排除項目");
        reasons.push(`命中排除關鍵字：${exclusionMatches[0]}`);
        matchedKeywords.push(exclusionMatches.join("、"));
        exclusionPrimaryKeywords.push(exclusionMatches[0]);
      } else if (reviewMatches.length) {
        categories.push("待人工確認");
        reasons.push(`命中待確認關鍵字：${reviewMatches[0]}`);
        matchedKeywords.push(reviewMatches.join("、"));
        exclusionPrimaryKeywords.push(null);
      } else {
        categories.push("正常商品");
        reasons.push("未命中排除或待確認關鍵字");
        matchedKeywords.push("");
        exclusionPrimaryKeywords.push(null);
      }
    });

    const columnRules = safeRules["欄位辨識"];
    const quantityIndex = candidateIndex(location.headers, columnRules["庫存數量"] || []);
    const averageCostIndex = candidateIndex(location.headers, columnRules["平均成本"] || []);
    const actualInventoryIndex = candidateIndex(location.headers, PURCHASE_AMOUNT_SOURCE_COLUMNS.inventory);
    const actualInventoryCostIndex = candidateIndex(location.headers, PURCHASE_AMOUNT_SOURCE_COLUMNS.inventoryCost);
    const purchasePriceIndex = candidateIndex(location.headers, PURCHASE_AMOUNT_SOURCE_COLUMNS.purchasePrice);
    const amount = recognizeAmountColumn(
      location.headers,
      rows,
      columnRules["庫存金額"] || [],
      Number(safeRules["金額欄位最低數值比例"] || 0.95)
    );

    return {
      sourceName: sourceName || "來源庫存.xlsx",
      sheetName: location.sheetName,
      headerRow: location.headerRow,
      headers: location.headers,
      rows,
      categories,
      reasons,
      matchedKeywords,
      exclusionPrimaryKeywords,
      counts: countCategories(categories),
      productNameColumn: displayHeader(location.headers[location.productIndex]),
      quantityColumn: quantityIndex === null ? null : displayHeader(location.headers[quantityIndex]),
      averageCostColumn: averageCostIndex === null ? null : displayHeader(location.headers[averageCostIndex]),
      actualInventoryColumnIndex: actualInventoryIndex,
      actualInventoryCostColumnIndex: actualInventoryCostIndex,
      purchasePriceColumnIndex: purchasePriceIndex,
      amountColumn: amount.name,
      amountColumnIndex: amount.index,
      amountStatus: amount.status,
      amounts: amount.amounts,
      totalRows: rows.length
    };
  }

  function analyzeArrayBuffer(arrayBuffer, XLSX, rules, sourceName) {
    let workbook;
    try {
      workbook = XLSX.read(arrayBuffer, {
        type: "array",
        cellDates: true,
        cellFormula: true,
        cellNF: true
      });
    } catch (error) {
      throw new InventoryWebError(`Excel 讀取失敗：${error.message || error}`);
    }
    return analyzeWorkbook(workbook, XLSX, rules, sourceName);
  }

  function sumAmounts(analysis, indexes) {
    if (analysis.amountColumnIndex === null || analysis.amountColumnIndex === undefined) return "未辨識";
    return indexes.reduce((total, index) => total + (analysis.amounts[index] || 0), 0);
  }

  function indexesForCategory(analysis, category) {
    const indexes = [];
    analysis.categories.forEach((value, index) => {
      if (value === category) indexes.push(index);
    });
    return indexes;
  }

  function shiftedIndex(sourceIndex, insertionIndex) {
    if (sourceIndex === null || sourceIndex === undefined) return null;
    return sourceIndex >= insertionIndex ? sourceIndex + 1 : sourceIndex;
  }

  function purchaseAmountLayout(analysis, XLSX) {
    const insertionIndex = analysis.actualInventoryCostColumnIndex === null
      || analysis.actualInventoryCostColumnIndex === undefined
      ? analysis.headers.length
      : analysis.actualInventoryCostColumnIndex + 1;
    const inventoryIndex = shiftedIndex(analysis.actualInventoryColumnIndex, insertionIndex);
    const purchasePriceIndex = shiftedIndex(analysis.purchasePriceColumnIndex, insertionIndex);
    return {
      insertionIndex,
      inventoryIndex,
      purchasePriceIndex,
      inventoryColumn: inventoryIndex === null ? null : XLSX.utils.encode_col(inventoryIndex),
      purchasePriceColumn: purchasePriceIndex === null ? null : XLSX.utils.encode_col(purchasePriceIndex),
      ready: inventoryIndex !== null && purchasePriceIndex !== null
    };
  }

  function purchaseAmountValue(analysis, rowIndex) {
    const inventory = strictNumber(analysis.rows[rowIndex][analysis.actualInventoryColumnIndex]);
    const purchasePrice = strictNumber(analysis.rows[rowIndex][analysis.purchasePriceColumnIndex]);
    return inventory === null || purchasePrice === null ? 0 : inventory * purchasePrice;
  }

  function makeDataSheet(analysis, category, XLSX) {
    const layout = purchaseAmountLayout(analysis, XLSX);
    const outputHeaders = analysis.headers.slice();
    outputHeaders.splice(layout.insertionIndex, 0, PURCHASE_AMOUNT_COLUMN);
    const rows = [outputHeaders.concat(RESULT_COLUMNS)];
    const indexes = indexesForCategory(analysis, category);
    indexes.forEach((index) => {
      const row = analysis.rows[index].slice();
      const outputRowNumber = rows.length + 1;
      const purchaseAmountCell = layout.ready
        ? {
          t: "n",
          f: `IFERROR(${layout.inventoryColumn}${outputRowNumber}*${layout.purchasePriceColumn}${outputRowNumber},0)`,
          v: purchaseAmountValue(analysis, index)
        }
        : null;
      row.splice(layout.insertionIndex, 0, purchaseAmountCell);
      rows.push(row.concat([
        analysis.categories[index],
        analysis.reasons[index],
        analysis.matchedKeywords[index]
      ]));
    });
    const totalRow = Array(rows[0].length).fill("");
    const shiftedAmountIndex = shiftedIndex(analysis.amountColumnIndex, layout.insertionIndex);
    if (shiftedAmountIndex !== 0) totalRow[0] = "合計";
    totalRow[outputHeaders.length] = "合計";
    totalRow[outputHeaders.length + 1] = `資料筆數：${indexes.length}`;
    if (analysis.amountColumnIndex === null || analysis.amountColumnIndex === undefined) {
      totalRow[outputHeaders.length + 2] = "金額欄未安全辨識";
    } else {
      totalRow[shiftedAmountIndex] = sumAmounts(analysis, indexes);
      totalRow[outputHeaders.length + 2] = `金額欄：${analysis.amountColumn}`;
    }
    if (layout.ready) {
      const totalRowNumber = indexes.length + 2;
      const totalValue = indexes.reduce((sum, index) => sum + purchaseAmountValue(analysis, index), 0);
      totalRow[layout.insertionIndex] = indexes.length
        ? {
          t: "n",
          f: `SUM(${XLSX.utils.encode_col(layout.insertionIndex)}2:${XLSX.utils.encode_col(layout.insertionIndex)}${totalRowNumber - 1})`,
          v: totalValue
        }
        : { t: "n", f: "0", v: 0 };
    } else {
      totalRow[layout.insertionIndex] = "未辨識進貨價";
    }
    rows.push(totalRow);
    const worksheet = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
    const lastColumn = Math.max(0, rows[0].length - 1);
    const dataEndRow = indexes.length + 1;
    worksheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(lastColumn)}${dataEndRow}` };
    worksheet["!inventoryTotalRow"] = rows.length;
    for (let rowNumber = 2; rowNumber <= rows.length; rowNumber += 1) {
      const cell = worksheet[`${XLSX.utils.encode_col(layout.insertionIndex)}${rowNumber}`];
      if (cell?.t === "n") cell.z = "#,##0.00";
    }
    worksheet["!cols"] = rows[0].map((header, index) => ({
      wch: index === layout.insertionIndex
        ? 20
        : index >= rows[0].length - 3 ? 28 : Math.min(34, Math.max(11, String(header || "").length + 4))
    }));
    return worksheet;
  }

  function xmlFromEntry(entry) {
    const bytes = new Uint8Array(entry.content).subarray(0, entry.size);
    return new TextDecoder("utf-8").decode(bytes);
  }

  function updateXmlEntry(entry, xml) {
    const bytes = new TextEncoder().encode(xml);
    entry.content = bytes;
    entry.size = bytes.length;
  }

  function appendStyleItem(xml, tag, item) {
    let itemIndex = null;
    const expression = new RegExp(`<${tag} count="(\\d+)">([\\s\\S]*?)<\\/${tag}>`);
    const updated = xml.replace(expression, (match, countText, contents) => {
      itemIndex = Number(countText);
      return `<${tag} count="${itemIndex + 1}">${contents}${item}</${tag}>`;
    });
    if (itemIndex === null) throw new InventoryWebError(`Excel 樣式檔缺少 ${tag}，無法建立合計列。`);
    return { xml: updated, index: itemIndex };
  }

  function addTotalStyle(stylesXml) {
    let result = appendStyleItem(
      stylesXml,
      "fonts",
      '<font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>'
    );
    const fontIndex = result.index;
    result = appendStyleItem(
      result.xml,
      "fills",
      '<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill>'
    );
    const fillIndex = result.index;
    result = appendStyleItem(
      result.xml,
      "borders",
      '<border><left/><right/><top style="medium"><color rgb="FF5B9BD5"/></top><bottom/><diagonal/></border>'
    );
    const borderIndex = result.index;
    result = appendStyleItem(
      result.xml,
      "cellXfs",
      `<xf numFmtId="4" fontId="${fontIndex}" fillId="${fillIndex}" borderId="${borderIndex}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`
    );
    return { xml: result.xml, styleIndex: result.index };
  }

  function styleDetailSheetXml(sheetXml, totalRow, styleIndex) {
    const rowExpression = new RegExp(`<row r="${totalRow}"([^>]*)>`);
    let updated = sheetXml.replace(
      rowExpression,
      `<row r="${totalRow}" ht="28" customHeight="1"$1>`
    );
    const cellExpression = new RegExp(`<c r="([A-Z]+${totalRow})"([^>]*)>`, "g");
    updated = updated.replace(cellExpression, (match, reference, attributes) => {
      const withoutStyle = attributes.replace(/\s+s="\d+"/g, "");
      return `<c r="${reference}" s="${styleIndex}"${withoutStyle}>`;
    });
    updated = updated.replace(
      /<sheetView workbookViewId="0"\s*\/>/,
      '<sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView>'
    );
    return updated;
  }

  function writeOutputWorkbook(workbook, XLSX) {
    const raw = new Uint8Array(XLSX.write(workbook, {
      type: "array",
      bookType: "xlsx",
      compression: true,
      cellDates: true
    }));
    const archive = XLSX.CFB.read(raw, { type: "buffer" });
    const stylesEntry = XLSX.CFB.find(archive, "/xl/styles.xml");
    if (!stylesEntry) throw new InventoryWebError("Excel 樣式檔遺失，無法建立合計列。");
    const totalStyle = addTotalStyle(xmlFromEntry(stylesEntry));
    updateXmlEntry(stylesEntry, totalStyle.xml);

    ["乾淨商品", "排除項目", "待確認項目"].forEach((sheetName, index) => {
      const worksheet = workbook.Sheets[sheetName];
      const sheetEntry = XLSX.CFB.find(archive, `/xl/worksheets/sheet${index + 1}.xml`);
      if (!worksheet || !sheetEntry) throw new InventoryWebError(`找不到「${sheetName}」工作表，無法建立合計列。`);
      const totalRow = worksheet["!inventoryTotalRow"];
      updateXmlEntry(
        sheetEntry,
        styleDetailSheetXml(xmlFromEntry(sheetEntry), totalRow, totalStyle.styleIndex)
      );
    });
    return XLSX.CFB.write(archive, { type: "buffer", fileType: "zip", compression: true });
  }

  function makeStatisticsSheet(analysis, XLSX) {
    const normalIndexes = indexesForCategory(analysis, "正常商品");
    const excludedIndexes = indexesForCategory(analysis, "排除項目");
    const reviewIndexes = indexesForCategory(analysis, "待人工確認");
    const rows = [
      ["庫存分類統計"],
      [],
      ["統計項目", "結果", "說明"],
      ["原始檔名", analysis.sourceName, "來源檔只在瀏覽器記憶體讀取，不會改寫或上傳"],
      ["資料工作表", analysis.sheetName, `表頭位於第 ${analysis.headerRow} 列`],
      ["原始總筆數", analysis.totalRows, "應等於三類筆數總和"],
      ["正常商品筆數", analysis.counts["正常商品"], "輸出至「乾淨商品」"],
      ["排除項目筆數", analysis.counts["排除項目"], "仍完整保留供稽核"],
      ["待人工確認筆數", analysis.counts["待人工確認"], "請人工檢查後再決定"],
      ["品名欄位", analysis.productNameColumn, "自動辨識"],
      ["庫存數量欄位", analysis.quantityColumn || "未辨識", "只辨識，不改寫"],
      ["平均成本欄位", analysis.averageCostColumn || "未辨識", "只辨識，不改寫"],
      ["庫存金額欄位", analysis.amountColumn || "未辨識", analysis.amountStatus],
      ["正常商品金額加總", sumAmounts(analysis, normalIndexes), "依上方庫存金額欄位的辨識結果加總"],
      ["排除項目金額加總", sumAmounts(analysis, excludedIndexes), "依上方庫存金額欄位的辨識結果加總"],
      ["待人工確認金額加總", sumAmounts(analysis, reviewIndexes), "依上方庫存金額欄位的辨識結果加總"],
      [],
      ["各排除原因統計"],
      ["排除原因", "筆數", "金額加總", "說明"]
    ];

    const reasonIndexes = new Map();
    analysis.exclusionPrimaryKeywords.forEach((keyword, index) => {
      if (!keyword) return;
      if (!reasonIndexes.has(keyword)) reasonIndexes.set(keyword, []);
      reasonIndexes.get(keyword).push(index);
    });
    reasonIndexes.forEach((indexes, keyword) => {
      rows.push([
        `命中排除關鍵字：${keyword}`,
        indexes.length,
        sumAmounts(analysis, indexes),
        "每列依內建規則的第一個命中關鍵字歸入一個原因，避免重複計數"
      ]);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
    worksheet["!cols"] = [{ wch: 26 }, { wch: 22 }, { wch: 50 }, { wch: 54 }];
    worksheet["!merges"] = [
      XLSX.utils.decode_range("A1:D1"),
      XLSX.utils.decode_range("A18:D18")
    ];
    return worksheet;
  }

  function buildOutputWorkbook(analysis, XLSX) {
    const workbook = XLSX.utils.book_new();
    ["正常商品", "排除項目", "待人工確認"].forEach((category) => {
      XLSX.utils.book_append_sheet(
        workbook,
        makeDataSheet(analysis, category, XLSX),
        CATEGORY_TO_SHEET[category]
      );
    });
    XLSX.utils.book_append_sheet(workbook, makeStatisticsSheet(analysis, XLSX), "分類統計");
    workbook.Props = {
      Title: "庫存分類結果",
      Subject: "本機瀏覽器庫存分類",
      Author: "翔仔居家庫存清理工具",
      Comments: "所有資料均在本機瀏覽器處理"
    };
    return workbook;
  }

  function safeOutputFilename(sourceName) {
    const base = String(sourceName || "庫存").replace(/\.xlsx$/i, "");
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `${base}_分類結果_${stamp}.xlsx`;
  }

  return {
    InventoryWebError,
    RESULT_COLUMNS,
    RULE_LIST_KEYS,
    normalize,
    normalizeExact,
    normalizeRules,
    cloneRules,
    addRuleItem,
    removeRuleItem,
    parseRulesJson,
    serializeRules,
    candidateIndex,
    strictNumber,
    locateDataSheet,
    recognizeAmountColumn,
    analyzeWorkbook,
    analyzeArrayBuffer,
    buildOutputWorkbook,
    writeOutputWorkbook,
    safeOutputFilename,
    sumAmounts
  };
});
