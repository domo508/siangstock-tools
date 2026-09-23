(function (global) {
  "use strict";

  let accessToken = "";
  let tokenClient = null;
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const SCOPES = [
    "openid", "email",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/gmail.send"
  ].join(" ");

  function initialize(clientId) {
    if (!clientId) throw new Error("正式環境尚未設定 Google OAuth 用戶端。");
    if (!global.google?.accounts?.oauth2) throw new Error("Google 授權程式仍在載入，請稍後再試。");
    tokenClient = global.google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPES, callback: () => {} });
  }

  function authorize() {
    if (!tokenClient) throw new Error("Google OAuth 尚未初始化。");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Google 授權逾時，請重試。")), 120000);
      tokenClient.callback = (response) => {
        clearTimeout(timer);
        if (response.error || !response.access_token) return reject(new Error(response.error_description || response.error || "Google 授權失敗。"));
        accessToken = response.access_token;
        resolve(accessToken);
      };
      tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent", hd: "siangapato.com.tw" });
    });
  }

  async function googleFetch(url, options = {}) {
    if (!accessToken) throw new Error("請先完成公司 Google 授權。");
    const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` } });
    if (response.status === 401) {
      accessToken = "";
      throw new Error("Google 授權已過期，請重新登入。");
    }
    if (!response.ok) {
      let message = `Google API ${response.status}`;
      try { message = (await response.json()).error?.message || message; } catch (_error) { /* no response body */ }
      throw new Error(message);
    }
    return response;
  }

  async function verifyCompanyIdentity() {
    const response = await googleFetch("https://openidconnect.googleapis.com/v1/userinfo");
    const identity = await response.json();
    const email = String(identity.email || "").toLocaleLowerCase("en-US");
    if (!email.endsWith("@siangapato.com.tw")) {
      accessToken = "";
      throw new Error("只允許 @siangapato.com.tw 公司帳號使用。");
    }
    return { email };
  }

  async function downloadDriveFile(fileId, fileName) {
    const response = await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`);
    return new File([await response.blob()], fileName, { type: XLSX_MIME });
  }

  async function listDriveExcelFiles(folderId) {
    const files = [];
    let pageToken = "";
    do {
      const query = `'${String(folderId).replace(/'/g, "\\'")}' in parents and trashed = false`;
      const params = new URLSearchParams({
        q: query,
        fields: "nextPageToken,files(id,name,mimeType,modifiedTime,parents,size,md5Checksum)",
        orderBy: "name",
        pageSize: "100",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true"
      });
      if (pageToken) params.set("pageToken", pageToken);
      const response = await googleFetch(`https://www.googleapis.com/drive/v3/files?${params}`);
      const payload = await response.json();
      files.push(...(payload.files || []).filter((file) => file.mimeType === XLSX_MIME && file.parents?.length === 1 && file.parents[0] === folderId));
      pageToken = payload.nextPageToken || "";
    } while (pageToken);
    return files;
  }

  async function loadLatestApprovedModel(folderId) {
    const candidates = await listDriveExcelFiles(folderId);
    if (!candidates.length) return null;
    candidates.sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime)) || String(b.name).localeCompare(String(a.name), "zh-Hant"));
    const selected = candidates[0];
    const file = await downloadDriveFile(selected.id, selected.name);
    return { file, metadata: { ...selected, importedAt: selected.modifiedTime, source: "Google Drive正式版", approved: true, fetchedAt: new Date().toISOString() } };
  }

  async function uploadDriveExcel(folderId, fileName, data, appProperties = {}) {
    const boundary = `siangstock_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const metadata = { name: fileName, mimeType: XLSX_MIME, parents: [folderId], appProperties };
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: ${XLSX_MIME}\r\n\r\n`,
      data instanceof Blob ? data : new Blob([data], { type: XLSX_MIME }),
      `\r\n--${boundary}--`
    ]);
    const response = await googleFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,modifiedTime,size,md5Checksum,parents,webViewLink", {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body
    });
    return response.json();
  }

  function base64Url(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function sendSeasonalModelSummary(recipient, summary, metadata, driveFile) {
    const subject = `【翔仔居家】季節模型已核准發布 ${String(metadata?.approvedAt || "").slice(0, 10)}`;
    const content = [
      `To: ${recipient}`,
      `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "季節模型回測已由採購核准者正式發布。",
      `核准者：${metadata?.approvedBy || ""}`,
      `核准時間：${metadata?.approvedAt || ""}`,
      `歷史銷售範圍：${summary?.minDate || ""}～${summary?.maxDate || ""}`,
      `來源檔案：${summary?.sourceFileCount || 0}份`,
      `納入交易列：${summary?.acceptedRows || 0}`,
      `跨檔重複列：${summary?.duplicateRows || 0}`,
      `衝突列：${summary?.conflictRows || 0}`,
      `活躍SKU：${summary?.activeSkuCount || 0}`,
      `SKU層級WAPE：${summary?.skuWape == null ? "無法計算" : `${(summary.skuWape * 100).toFixed(2)}%`}`,
      `正式檔案：${driveFile?.webViewLink || driveFile?.name || ""}`
    ].join("\r\n");
    const response = await googleFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw: base64Url(content) })
    });
    return response.json();
  }

  async function sha256(value) {
    const bytes = value instanceof ArrayBuffer ? value : new TextEncoder().encode(String(value));
    const digest = await global.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function loadLatestMaster(folderId) {
    const query = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`;
    const params = new URLSearchParams({ q: query, fields: "files(id,name,mimeType,modifiedTime,parents,size)", orderBy: "modifiedTime desc", pageSize: "100" });
    const response = await googleFetch(`https://www.googleapis.com/drive/v3/files?${params}`);
    const files = (await response.json()).files || [];
    const candidates = files.filter((file) => file.mimeType === XLSX_MIME && file.parents?.length === 1 && file.parents[0] === folderId);
    if (!candidates.length) throw new Error("商品主檔資料夾沒有直屬.xlsx候選檔。");
    const latestTime = candidates[0].modifiedTime;
    const latest = candidates.filter((file) => file.modifiedTime === latestTime);
    if (latest.length !== 1) throw new Error("商品主檔有多份相同修改時間的最新候選，已停止自動選取。");
    const file = await downloadDriveFile(latest[0].id, latest[0].name);
    return { file, metadata: { ...latest[0], sha256: await sha256(await file.arrayBuffer()), fetchedAt: new Date().toISOString() } };
  }

  function cellValue(cell) {
    const value = cell?.effectiveValue || {};
    if (Object.prototype.hasOwnProperty.call(value, "numberValue")) return value.numberValue;
    if (Object.prototype.hasOwnProperty.call(value, "stringValue")) return value.stringValue;
    if (Object.prototype.hasOwnProperty.call(value, "boolValue")) return value.boolValue;
    if (Object.prototype.hasOwnProperty.call(value, "errorValue")) return cell.formattedValue || "";
    return cell?.formattedValue || "";
  }

  function colorToRgb(color) {
    if (!color) return "";
    const channel = (value) => Math.max(0, Math.min(255, Math.round(Number(value || 0) * 255))).toString(16).padStart(2, "0").toUpperCase();
    return `${channel(color.red)}${channel(color.green)}${channel(color.blue)}`;
  }

  function workbookFromSheetsApi(payload, XLSX) {
    const workbook = XLSX.utils.book_new();
    for (const source of payload.sheets || []) {
      const grid = source.data?.[0] || {};
      const rows = (grid.rowData || []).map((row) => (row.values || []).map(cellValue));
      const sheet = XLSX.utils.aoa_to_sheet(rows);
      (grid.rowData || []).forEach((row, rowOffset) => (row.values || []).forEach((cell, columnOffset) => {
        const rgb = colorToRgb(cell.effectiveFormat?.backgroundColor);
        if (!rgb || rgb === "FFFFFF") return;
        const address = XLSX.utils.encode_cell({ r: Number(grid.startRow || 0) + rowOffset, c: Number(grid.startColumn || 0) + columnOffset });
        if (sheet[address]) sheet[address].s = { fill: { fgColor: { rgb: `FF${rgb}` } } };
      }));
      XLSX.utils.book_append_sheet(workbook, sheet, source.properties?.title || `Sheet${workbook.SheetNames.length + 1}`);
    }
    return workbook;
  }

  async function loadSpreadsheet(spreadsheetId, ranges, XLSX) {
    const params = new URLSearchParams({ includeGridData: "true" });
    ranges.forEach((range) => params.append("ranges", range));
    params.set("fields", "sheets(properties(title),data(startRow,startColumn,rowData(values(effectiveValue,formattedValue,effectiveFormat(backgroundColor)))))");
    const response = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?${params}`);
    const payload = await response.json();
    return {
      workbook: workbookFromSheetsApi(payload, XLSX),
      metadata: {
        spreadsheetId,
        sheets: (payload.sheets || []).map((sheet) => sheet.properties?.title || ""),
        sha256: await sha256(JSON.stringify(payload)),
        fetchedAt: new Date().toISOString()
      }
    };
  }

  function selectSpreadsheetSheetTitle(sheetTitles, preferredTitles = []) {
    const titles = (sheetTitles || []).map((title) => String(title || "").trim()).filter(Boolean);
    if (!titles.length) throw new Error("Google 試算表沒有可讀取的頁籤。");
    for (const preferred of preferredTitles || []) {
      const normalizedPreferred = String(preferred || "").trim();
      const matched = titles.find((title) => title === normalizedPreferred);
      if (matched) return matched;
    }
    return titles[0];
  }

  function quoteSheetTitle(title) {
    return `'${String(title || "").replace(/'/g, "''")}'`;
  }

  async function loadPreferredSpreadsheet(spreadsheetId, preferredTitles, XLSX) {
    const params = new URLSearchParams({ fields: "sheets(properties(title,index))" });
    const response = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?${params}`);
    const payload = await response.json();
    const sheets = (payload.sheets || [])
      .map((sheet) => ({ title: sheet.properties?.title || "", index: Number(sheet.properties?.index || 0) }))
      .sort((a, b) => a.index - b.index);
    const selectedSheet = selectSpreadsheetSheetTitle(sheets.map((sheet) => sheet.title), preferredTitles);
    const result = await loadSpreadsheet(spreadsheetId, [quoteSheetTitle(selectedSheet)], XLSX);
    result.metadata.selectedSheet = selectedSheet;
    result.metadata.availableSheets = sheets.map((sheet) => sheet.title);
    return result;
  }

  async function loadAll(config, XLSX, onProgress = () => {}) {
    const source = config.fixedSources;
    const tracked = async (id, task) => {
      onProgress({ id, status: "loading", message: "正在唯讀取得…" });
      try {
        const result = await task();
        onProgress({ id, status: "success", message: "已下載，正在格式檢核" });
        return result;
      } catch (error) {
        onProgress({ id, status: "error", message: error?.message || "取得失敗" });
        throw error;
      }
    };
    const results = await Promise.allSettled([
      tracked("master", () => loadLatestMaster(source.productMasterFolderId)),
      tracked("marketing", async () => {
        const file = await downloadDriveFile(source.marketingDriveFileId, "整體行銷策略.xlsx");
        return { file, metadata: { fileId: source.marketingDriveFileId, sha256: await sha256(await file.arrayBuffer()), fetchedAt: new Date().toISOString() } };
      }),
      tracked("puyouma", () => loadSpreadsheet(source.puyoumaSpreadsheetId, ["'庫存+下單'", "'庫存布'"], XLSX)),
      tracked("lirong", () => loadPreferredSpreadsheet(source.lirongSpreadsheetId, ["下單", ...(source.lirongSheets || []), "工作表1"], XLSX))
    ]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    const [master, marketing, puyouma, lirong] = results.map((result) => result.value);
    return { master, marketingFile: marketing.file, marketingMetadata: marketing.metadata, puyoumaWorkbook: puyouma.workbook, puyoumaMetadata: puyouma.metadata, lirongWorkbook: lirong.workbook, lirongMetadata: lirong.metadata };
  }

  function token() { return accessToken; }

  global.ProcurementGoogleSources = {
    initialize, authorize, verifyCompanyIdentity, loadAll, token,
    downloadDriveFile, listDriveExcelFiles, loadLatestMaster, loadLatestApprovedModel, uploadDriveExcel, sendSeasonalModelSummary,
    selectSpreadsheetSheetTitle
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
