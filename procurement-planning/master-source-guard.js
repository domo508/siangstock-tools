(function (global) {
  "use strict";
  function sameVersion(left, right) {
    return Boolean(left?.id && left?.modifiedTime && right?.id && right?.modifiedTime
      && left.id === right.id && left.modifiedTime === right.modifiedTime
      && (!left.md5Checksum || !right.md5Checksum || left.md5Checksum === right.md5Checksum)
      && (!left.size || !right.size || String(left.size) === String(right.size)));
  }
  async function sha256(file) {
    const digest = await global.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  }
  function changed(loaded, latest) {
    const error = new Error(`商品主檔已更新：目前載入「${loaded?.name || "未記錄檔名"}」，雲端最新為「${latest?.name || "未確認"}」。請按「取得最新主檔」，成功後再按產生採購建議。原草稿與已選檔案保留。`);
    error.code = "MASTER_CHANGED"; error.latest = latest;
    return error;
  }
  async function verify({ file, metadata, latest, download }) {
    if (!file) throw new Error("尚未取得新計算使用的商品主檔。");
    if (!latest?.id || !latest.modifiedTime) throw new Error("無法確認雲端最新商品主檔版本，已停止新計算；請重新確認。原資料保留。");
    const hash = await sha256(file);
    if (metadata) {
      if (!metadata.sha256 || metadata.sha256 !== hash) throw new Error("目前商品主檔與已記錄來源不一致，請重新取得主檔；原資料保留。");
      if (!sameVersion(metadata, latest)) throw changed(metadata, latest);
    } else {
      // A manual backup must match the complete latest file, not merely its name.
      const current = await download(latest);
      if (await sha256(current) !== hash) throw changed({ name: file.name }, latest);
    }
    return { ...latest, sha256: hash, sourceMode: metadata ? "Google自動" : "手動備援（已核對雲端最新版）", fetchedAt: metadata?.fetchedAt || "", checkedAt: new Date().toISOString() };
  }
  function assertUnchanged(proof, latest, sameLoadedFile) {
    if (!sameLoadedFile || !sameVersion(proof, latest)) throw new Error("計算期間商品主檔已變更，結果未採用；原草稿與選檔保留。請確認最新主檔後重新計算。");
  }
  function proofForAnalysis(analysis) {
    if (!analysis) return null;
    if (analysis.meta?.masterSource) return { ...analysis.meta.masterSource };
    const catalog = analysis.manualAdditionCatalog;
    const hash = analysis.meta?.sourceHashes?.master || catalog?.sourceHash || "";
    return { name: "舊批次未保存檔名", sha256: hash, modifiedTime: catalog?.sourceModifiedTime || "", legacy: true };
  }
  function taipei(value) {
    if (!value) return "未記錄";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) + "（台北時間）" : "未記錄";
  }
  function describe(proof) {
    if (!proof) return "尚未載入採購批次。";
    return `目前批次計算主檔：${proof.name || "未記錄檔名"}；來源更新${taipei(proof.modifiedTime)}；計算前核對${taipei(proof.checkedAt)}；SHA-256 ${proof.sha256 || "舊批次未保存，無法追溯確認"}。此為原計算依據，與下次新計算準備來源分開；重新取得主檔不改寫本批次。`;
  }
  global.ProcurementMasterSourceGuard = { sameVersion, sha256, verify, assertUnchanged, proofForAnalysis, describe, taipei };
})(typeof globalThis !== "undefined" ? globalThis : window);
