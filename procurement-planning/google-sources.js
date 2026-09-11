(function (global) {
  "use strict";

  let accessToken = "";
  let tokenClient = null;
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const SCOPES = [
    "openid", "email",
    "https://www.googleapis.com/auth/drive.readonly",
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
    const response = await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
    return new File([await response.blob()], fileName, { type: XLSX_MIME });
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

  async function loadAll(config, XLSX) {
    const source = config.fixedSources;
    const [master, marketingFile, puyouma, lirong] = await Promise.all([
      loadLatestMaster(source.productMasterFolderId),
      downloadDriveFile(source.marketingDriveFileId, "整體行銷策略.xlsx"),
      loadSpreadsheet(source.puyoumaSpreadsheetId, ["'庫存+下單'", "'庫存布'"], XLSX),
      loadSpreadsheet(source.lirongSpreadsheetId, ["'工作表1'"], XLSX)
    ]);
    const marketingMetadata = { fileId: source.marketingDriveFileId, sha256: await sha256(await marketingFile.arrayBuffer()), fetchedAt: new Date().toISOString() };
    return { master, marketingFile, marketingMetadata, puyoumaWorkbook: puyouma.workbook, puyoumaMetadata: puyouma.metadata, lirongWorkbook: lirong.workbook, lirongMetadata: lirong.metadata };
  }

  function token() { return accessToken; }

  global.ProcurementGoogleSources = { initialize, authorize, verifyCompanyIdentity, loadAll, token };
})(typeof globalThis !== "undefined" ? globalThis : window);
