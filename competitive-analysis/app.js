(function () {
  "use strict";
  const APP_VERSION = "20261024-competitive-analysis-r7";
  const core = globalThis.CompetitiveAnalysisCore;
  const $ = (id) => document.getElementById(id);
  const state = { competitors: [], excludedCompetitors: [], profile: null, file: null, previewUrl: "", visualFile: null, visualPreviewUrl: "", result: null, aiSummary: "", aiSearchNotes: [], dirtyFields: new Set(), runtimeOutdated: false, latestRuntimeVersion: "" };
  const profileFields = {
    name: ["product-name", "商品名稱"], category: ["product-category", "商品品類"], dimensions: ["product-dimensions", "外觀尺寸"],
    materials: ["product-materials", "材質"], techniques: ["product-techniques", "工法"],
    designHighlights: ["product-highlights", "設計價值與差異"], packaging: ["product-packaging", "包裝資訊"]
  };
  const currency = (value) => new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(Number(value || 0));
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  function product() {
    return {
      name: $("product-name").value.trim(), category: $("product-category").value.trim(), dimensions: $("product-dimensions").value.trim(),
      materials: $("product-materials").value.trim(), techniques: $("product-techniques").value.trim(),
      designHighlights: $("product-highlights").value.trim(), packaging: $("product-packaging").value.trim(),
      searchName: $("product-search-name").value.trim(), primaryUse: $("product-primary-use").value.trim(),
      secondaryCategories: $("product-secondary-categories").value.trim(), mustMatch: $("product-must-match").value.trim(),
      exclusions: $("product-exclusions").value.trim()
    };
  }

  function showRuntimeWarning() {
    const warning = $("version-warning");
    if (warning instanceof HTMLDialogElement && typeof warning.showModal === "function") { if (!warning.open) warning.showModal(); }
    else warning.setAttribute("open", "");
    document.body.classList.add("runtime-outdated");
  }

  async function checkRuntimeVersion() {
    if (state.runtimeOutdated) return false;
    try {
      const response = await fetch(`version.json?check=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) return true;
      const latest = String((await response.json())?.version || "").trim();
      if (!latest || latest === APP_VERSION) return true;
      state.runtimeOutdated = true;
      state.latestRuntimeVersion = latest;
      showRuntimeWarning();
      return false;
    } catch (_) { return true; }
  }

  function fillProfile(profile, label) {
    state.profile = profile;
    $("product-name").value = profile.name;
    $("product-category").value = profile.category;
    $("product-dimensions").value = profile.dimensions;
    $("product-materials").value = profile.materials;
    $("product-techniques").value = profile.techniques;
    $("product-highlights").value = profile.designHighlights;
    $("product-packaging").value = profile.packaging;
    $("product-search-name").value = profile.searchName || profile.name;
    $("product-primary-use").value = profile.primaryUse || "";
    $("product-secondary-categories").value = profile.secondaryCategories || "";
    $("product-must-match").value = profile.mustMatch || "";
    $("product-exclusions").value = profile.exclusions || "";
    $("confidence-badge").textContent = "填寫範例・請依實際工單覆核";
    $("review-notices").hidden = false;
    $("review-notices").innerHTML = `<strong>仍需確認</strong><ul>${profile.notices.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    $("analysis-status").textContent = `${label}候選規格已帶入；請先覆核內容，再產生分析。`;
    renderSearchCompleteness();
    renderCompetitors();
  }

  function resetNewProduct() {
    state.profile = null;
    state.result = null;
    state.competitors = [];
    state.excludedCompetitors = [];
    state.aiSummary = "";
    state.aiSearchNotes = [];
    state.dirtyFields.clear();
    for (const id of ["product-name", "product-category", "product-dimensions", "product-materials", "product-techniques", "product-highlights", "product-packaging", "product-search-name", "product-primary-use", "product-secondary-categories", "product-must-match", "product-exclusions"]) $(id).value = "";
    $("confidence-badge").textContent = "新工單・請人工填寫並覆核";
    $("review-notices").hidden = false;
    $("review-notices").innerHTML = "<strong>填寫原則</strong><p>請依工單填寫規格；不確定的內容保留「待確認」，不要推定成已確認資訊。本工具不會把檔案送往雲端辨識。</p>";
    $("source-date").textContent = "請加入實際競品來源";
    $("ai-search-consent").checked = false;
    clearVisualReference();
    $("ai-search-status").textContent = "尚未執行 AI 搜尋；也可直接人工新增來源。";
    $("ai-search-summary").hidden = true;
    $("ai-search-summary").innerHTML = "";
    $("report").hidden = true;
    $("prefill-consent").checked = false;
    $("prefill-status").textContent = "請勾選同意後辨識；原始檔案與檔名不會送出。";
    renderCompetitors();
    renderSearchCompleteness();
  }

  function showPlaceholder(text) { $("preview-panel").innerHTML = `<p>${escapeHtml(text)}</p>`; }

  function renderFile(file) {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = URL.createObjectURL(file);
    if (file.type === "application/pdf") $("preview-panel").innerHTML = `<object data="${state.previewUrl}" type="application/pdf" aria-label="工單 PDF 預覽"><p>瀏覽器無法預覽 PDF，但仍可繼續填寫規格。</p></object>`;
    else $("preview-panel").innerHTML = `<img src="${state.previewUrl}" alt="已選工單預覽">`;
  }

  function renderSearchCompleteness() {
    const completeness = core.searchProfileCompleteness(product());
    $("search-completeness-score").textContent = `搜尋資料完整度 ${completeness.score}%`;
    $("search-completeness-bar").style.width = `${completeness.score}%`;
    $("search-completeness-bar").classList.toggle("ready", completeness.score >= 80);
    $("search-completeness-help").textContent = completeness.score >= 80
      ? "資料充足，可開始搜尋；仍請確認必要相似條件與排除項目。"
      : completeness.ready ? `可以搜尋，但建議補充：${completeness.missing.join("、")}。` : `至少需達 ${core.SEARCH_PROFILE_MIN_SCORE}%；尚缺：${completeness.missing.join("、")}。`;
    return completeness;
  }

  function clearVisualReference() {
    if (state.visualPreviewUrl) URL.revokeObjectURL(state.visualPreviewUrl);
    state.visualPreviewUrl = "";
    state.visualFile = null;
    const input = $("visual-reference");
    if (input) input.value = "";
    const preview = $("visual-reference-preview");
    if (preview) { preview.hidden = true; preview.innerHTML = ""; }
    if ($("visual-consent")) $("visual-consent").checked = false;
  }

  function handleVisualReference(event) {
    const file = event.target.files[0];
    if (!file) { clearVisualReference(); return; }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 8 * 1024 * 1024) {
      clearVisualReference();
      $("ai-search-status").textContent = "外觀參考圖須為 JPG、PNG 或 WEBP，且不得超過 8 MB。";
      return;
    }
    state.visualFile = file;
    state.visualPreviewUrl = URL.createObjectURL(file);
    $("visual-reference-preview").hidden = false;
    $("visual-reference-preview").innerHTML = `<img src="${state.visualPreviewUrl}" alt="外觀參考圖預覽"><span>已選擇外觀圖；搜尋前仍須另外勾選圖片同意。</span>`;
  }

  function imageElement(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("無法讀取外觀參考圖，請改用其他圖片。")); };
      image.src = url;
    });
  }

  async function visualReferenceDataUrl() {
    if (!state.visualFile) return null;
    if (!$("visual-consent").checked) throw new Error("已選擇外觀參考圖，請先勾選圖片傳送同意，或移除圖片。" );
    const image = await imageElement(state.visualFile);
    const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    if (dataUrl.length > 1.8 * 1024 * 1024) throw new Error("外觀參考圖壓縮後仍過大，請先裁切商品主體再重試。" );
    return dataUrl;
  }

  function handleFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) { event.target.value = ""; $("file-status").textContent = "檔案超過 40 MB，請先另存較小的 PDF 或圖片。"; return; }
    if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.type)) { event.target.value = ""; $("file-status").textContent = "檔案格式不支援，請選擇 PDF、PNG、JPG 或 WEBP。"; return; }
    state.file = file;
    renderFile(file);
    resetNewProduct();
    $("prefill-button").disabled = false;
    $("file-status").textContent = `已在本機讀取：${file.name}（${(file.size / 1024 / 1024).toFixed(1)} MB）`;
    $("analysis-status").textContent = "新工單已載入；請先填寫規格，再加入實際競品來源。";
  }

  function loadExample(key) {
    const profile = { key, ...core.EXAMPLE_PROFILES[key] };
    state.file = null;
    state.result = null;
    state.aiSummary = "";
    state.aiSearchNotes = [];
    state.excludedCompetitors = [];
    state.dirtyFields.clear();
    $("prefill-consent").checked = false;
    $("prefill-button").disabled = true;
    $("prefill-status").textContent = "填寫範例不需要再次辨識。";
    $("ai-search-consent").checked = false;
    clearVisualReference();
    $("ai-search-status").textContent = "範例已載入；可直接查看既有來源，或覆核文字後重新執行 AI 搜尋。";
    $("ai-search-summary").hidden = true;
    $("ai-search-summary").innerHTML = "";
    state.competitors = core.EXAMPLE_COMPETITORS.map((item) => ({ ...item, included: true, origin: "example" }));
    fillProfile(profile, "拉拉範例");
    $("file-status").textContent = "已載入拉拉手持鏡填寫範例；這是操作參考，不代表新的工單內容。";
    $("source-date").textContent = "範例來源檢查日 2026-10-22";
    showPlaceholder("填寫範例模式：上傳新工單後，範例資料會清空並改由同仁依工單填寫。");
  }

  function prefillProgress(update) {
    if (update.stage === "pdf-text") $("prefill-status").textContent = `正在本機讀取 PDF 第 ${update.page}/${update.pageCount} 頁……`;
    else if (update.stage === "ocr-page") $("prefill-status").textContent = `正在本機準備第 ${update.page}/${update.pageCount} 頁 OCR……`;
    else if (update.stage === "ocr") $("prefill-status").textContent = `正在本機辨識文字……${update.progress}%`;
    else $("prefill-status").textContent = "正在本機準備工單辨識……";
  }

  function applyPrefill(data, extraction) {
    const applied = [];
    const skipped = [];
    const evidenceItems = [];
    const confidenceValues = [];
    for (const [field, [id, label]] of Object.entries(profileFields)) {
      const input = $(id);
      const value = String(data.profile?.[field] || "").trim();
      const detail = data.evidence?.[field] || {};
      const confidence = Math.max(0, Math.min(100, Math.round(Number(detail.confidence) || 0)));
      confidenceValues.push(confidence);
      if (!state.dirtyFields.has(id) && core.shouldAutoApplyPrefill(value, confidence)) { input.value = value; applied.push(label); }
      else if (!state.dirtyFields.has(id) && value) skipped.push(`${label}（信心 ${confidence}%）`);
      else if (state.dirtyFields.has(id)) skipped.push(label);
      evidenceItems.push(`<li><strong>${escapeHtml(label)} ${confidence}%：</strong>${escapeHtml(detail.evidence || "未找到明確證據")}</li>`);
    }
    const average = confidenceValues.length ? Math.round(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length) : 0;
    $("confidence-badge").textContent = `AI 預填信心 ${average}%・待人工覆核`;
    const notices = Array.isArray(data.notices) ? data.notices.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "";
    const truncated = extraction.truncatedPages ? `<p><strong>注意：</strong>檔案共 ${extraction.totalPages} 頁，本次只辨識前 ${extraction.pageCount} 頁。</p>` : "";
    $("review-notices").hidden = false;
    $("review-notices").innerHTML = `<strong>AI 預填・仍需逐欄覆核</strong><ul class="prefill-evidence">${evidenceItems.join("")}${notices}</ul>${skipped.length ? `<p>未自動帶入低於 ${core.PREFILL_AUTO_APPLY_CONFIDENCE}% 信心或已人工修改的欄位：${escapeHtml(skipped.join("、"))}。請直接查看工單後填寫。</p>` : ""}${truncated}`;
    $("analysis-status").textContent = `已預填 ${applied.length} 個欄位；請依工單逐欄覆核，不確定內容保留「待確認」。`;
    $("ai-search-consent").checked = false;
    renderCompetitors();
  }

  async function prefillFromFile() {
    if (!(await checkRuntimeVersion())) return;
    if (!state.file) { $("prefill-status").textContent = "請先選擇 PDF 或圖片工單。"; return; }
    if (!$("prefill-consent").checked) { $("prefill-status").textContent = "請先勾選同意傳送本機擷取文字。"; return; }
    const button = $("prefill-button");
    button.disabled = true;
    try {
      const { extractTextLocally } = await import("./document-reader.mjs?v=20261024-competitive-analysis-r7");
      const extraction = await extractTextLocally(state.file, prefillProgress);
      $("prefill-status").textContent = "文字已在本機擷取，正在交由 AI 整理欄位……";
      const response = await fetch("/api/competitive-analysis/prefill", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true, extractedText: extraction.text, extraction: { method: extraction.method, pageCount: extraction.pageCount } })
      });
      const responseText = await response.text();
      let data = {};
      try { data = JSON.parse(responseText); } catch (_) { data = {}; }
      const plainMessage = responseText.length <= 200 && !/[<>]/.test(responseText) ? responseText : "";
      if (!response.ok) throw new Error(data.error || plainMessage || "AI 工單整理失敗，請稍後再試。");
      applyPrefill(data, extraction);
      renderSearchCompleteness();
      $("prefill-status").textContent = `預填完成；使用${extraction.method === "pdf-text" ? " PDF 文字" : "本機 OCR"}辨識 ${extraction.pageCount} 頁，請逐欄覆核。`;
    } catch (error) {
      $("prefill-status").textContent = error instanceof Error ? error.message : "工單辨識失敗，請改用更清晰的檔案或人工填寫。";
    } finally { button.disabled = false; }
  }

  function renderCompetitors() {
    const ranked = core.rankCompetitors(product(), state.competitors);
    for (const rankedItem of ranked) {
      const original = state.competitors.find((item) => item.id === rankedItem.id);
      if (original) { original.similarity = rankedItem.similarity; if (rankedItem.similarity < core.COMPETITOR_MIN_SIMILARITY) original.included = false; }
    }
    $("competitor-rows").innerHTML = ranked.length ? ranked.map((item) => {
      const isAi = item.origin === "ai";
      const eligible = item.similarity >= core.COMPETITOR_MIN_SIMILARITY;
      const comparisonLabel = ({ direct: "直接競品", similar: "相似商品", functional: "功能替代" })[item.comparisonLevel] || "待分類";
      const details = isAi ? `<details class="ai-detail"><summary>查看此商品差異</summary><p><strong>相似：</strong>${escapeHtml((item.similarityReasons || []).join("；") || "待人工確認")}</p><p><strong>差異：</strong>${escapeHtml((item.differences || []).join("；") || "待人工確認")}</p><p><strong>價格證據：</strong>${escapeHtml(item.priceEvidence || "待人工確認")}・來源信心 ${escapeHtml(item.aiConfidence)}%</p></details>` : "";
      const badge = !eligible ? `低於 ${core.COMPETITOR_MIN_SIMILARITY}%・不納入定價` : (isAi && item.included === false ? `AI ${comparisonLabel}・待人工確認` : item.included !== false ? "已納入比較" : "待人工確認");
      return `<tr class="${eligible ? "" : "low-similarity"}"><td><input class="include-check" type="checkbox" data-include-id="${escapeHtml(item.id)}" aria-label="納入 ${escapeHtml(item.name)}" ${item.included !== false && eligible ? "checked" : ""} ${eligible ? "" : "disabled"}></td><td><span class="score">${item.similarity}%</span></td><td><strong>${escapeHtml(item.name)}</strong><span class="table-note">${escapeHtml(item.brand)}・${escapeHtml(item.positioning)}</span><span class="candidate-badge ${item.included !== false && eligible ? "confirmed" : ""}">${badge}</span>${details}</td><td><strong>${currency(item.salePrice || item.price)}</strong>${item.salePrice ? `<span class="table-note">標示原價 ${currency(item.price)}</span>` : ""}</td><td><a class="source-link" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.sourceLabel)} ↗</a><span class="table-note">檢查日 ${escapeHtml(item.checkedAt)}</span></td></tr>`;
    }).join("") : '<tr><td colspan="5"><span class="table-note">尚未加入競品來源。建議至少加入 3 筆規格接近且仍在販售的商品。</span></td></tr>';
    renderExcludedCompetitors();
    return ranked;
  }

  function renderExcludedCompetitors() {
    const panel = $("excluded-candidates");
    panel.hidden = !state.excludedCompetitors.length;
    $("excluded-candidates-title").textContent = `查看 ${state.excludedCompetitors.length} 筆未達 ${core.COMPETITOR_MIN_SIMILARITY}% 的搜尋參考`;
    $("excluded-candidates-list").innerHTML = state.excludedCompetitors.map((item) => `<article><div><strong>${escapeHtml(item.name)}</strong><span>${item.similarity}%・${escapeHtml(item.category)}</span></div><p>${escapeHtml((item.differences || []).join("；") || "與目標商品的材質、工法、尺寸或定位差異較大。")}</p><a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看來源 ↗</a></article>`).join("");
  }

  function renderAiSummary() {
    const panel = $("ai-search-summary");
    panel.hidden = !state.aiSummary;
    panel.innerHTML = state.aiSummary ? `<strong>AI 搜尋摘要</strong><p>${escapeHtml(state.aiSummary)}</p>${state.aiSearchNotes.length ? `<ul>${state.aiSearchNotes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}` : "";
  }

  async function searchWithAi() {
    if (!(await checkRuntimeVersion())) return;
    const item = product();
    if (!item.name || !item.category || !item.materials || !item.techniques) {
      $("ai-search-status").textContent = "請先完成並覆核商品名稱、品類、材質與工法。";
      return;
    }
    const completeness = renderSearchCompleteness();
    if (!completeness.ready) {
      $("ai-search-status").textContent = `搜尋資料完整度需達 ${core.SEARCH_PROFILE_MIN_SCORE}%；請補充：${completeness.missing.join("、")}。`;
      return;
    }
    if (!$("ai-search-consent").checked) {
      $("ai-search-status").textContent = "請先勾選確認文字規格已覆核。";
      return;
    }
    const button = $("ai-search-button");
    button.disabled = true;
    $("ai-search-status").textContent = "AI 正在搜尋並核對公開商品來源，通常需要數十秒……";
    try {
      const visualReference = await visualReferenceDataUrl();
      const response = await fetch("/api/competitive-analysis/search", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true, visualConsent: Boolean(visualReference), product: item, visualReference })
      });
      const responseText = await response.text();
      let data = {};
      try { data = JSON.parse(responseText); } catch (_) { data = {}; }
      const plainMessage = responseText.length <= 200 && !/[<>]/.test(responseText) ? responseText : "";
      if (!response.ok) throw new Error(data.error || plainMessage || "AI 搜尋失敗，請稍後再試。");
      state.competitors = state.competitors.filter((candidate) => candidate.origin !== "ai");
      const stamp = Date.now();
      const aiItems = (data.candidates || []).map((candidate, index) => ({
          id: `ai-${stamp}-${index}`, name: candidate.name, brand: candidate.brand || "待確認", price: candidate.originalPriceTwd || candidate.priceTwd,
          salePrice: candidate.originalPriceTwd ? candidate.priceTwd : undefined, category: candidate.category, materials: candidate.materials || [],
          techniques: candidate.techniques || [], size: candidate.size || "待確認", positioning: candidate.positioning || "待確認",
          sourceUrl: candidate.sourceUrl, sourceLabel: candidate.sourceTitle, checkedAt: candidate.checkedAt,
          aiConfidence: candidate.confidence, aiSimilarity: candidate.similarityScore, comparisonLevel: candidate.comparisonLevel,
          similarityReasons: candidate.similarityReasons || [], differences: candidate.differences || [],
          priceEvidence: candidate.priceEvidence || "", origin: "ai", included: false
        }));
      const rankedAi = core.rankCompetitors(item, aiItems);
      const eligibleAi = rankedAi.filter((candidate) => candidate.similarity >= core.COMPETITOR_MIN_SIMILARITY);
      state.excludedCompetitors = rankedAi.filter((candidate) => candidate.similarity < core.COMPETITOR_MIN_SIMILARITY);
      state.competitors.push(...eligibleAi);
      state.aiSummary = data.summary || "";
      state.aiSearchNotes = Array.isArray(data.searchNotes) ? data.searchNotes : [];
      renderAiSummary();
      renderCompetitors();
      $("source-date").textContent = `AI 搜尋日 ${String(data.generatedAt || "").slice(0, 10)}`;
      $("ai-search-status").textContent = eligibleAi.length
        ? `找到 ${rankedAi.length} 筆有來源商品，其中 ${eligibleAi.length} 筆達 ${core.COMPETITOR_MIN_SIMILARITY}% 進入待選；請開啟來源確認後勾選納入。`
        : `找到 ${rankedAi.length} 筆有來源商品，但沒有結果達 ${core.COMPETITOR_MIN_SIMILARITY}%；低分結果只列為搜尋參考，不納入定價。`;
    } catch (error) {
      $("ai-search-status").textContent = error instanceof Error ? error.message : "AI 搜尋失敗，請稍後再試。";
    } finally { button.disabled = false; }
  }

  function addSource(event) {
    event.preventDefault();
    state.competitors.push({
      id: `manual-${Date.now()}`, name: $("source-name").value.trim(), brand: "人工新增", price: Number($("source-price").value),
      category: $("source-category").value.trim(), materials: $("source-materials").value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
      techniques: $("source-techniques").value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean), size: $("source-size").value.trim() || "待確認",
      positioning: $("source-positioning").value.trim() || "待確認", sourceUrl: $("source-url").value, sourceLabel: "人工確認來源", checkedAt: new Date().toISOString().slice(0, 10),
      origin: "manual", included: true
    });
    event.currentTarget.reset();
    state.result = null;
    $("source-date").textContent = `最近加入來源 ${new Date().toISOString().slice(0, 10)}`;
    renderCompetitors();
  }

  function reportTable(competitors) {
    return `<table><thead><tr><th>相似度</th><th>競品</th><th>參考價</th><th>來源</th></tr></thead><tbody>${competitors.map((item) => `<tr><td>${item.similarity}%</td><td><strong>${escapeHtml(item.name)}</strong><span class="table-note">${escapeHtml(item.positioning)}</span></td><td>${currency(item.salePrice || item.price)}</td><td><a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.sourceLabel)}</a></td></tr>`).join("")}</tbody></table>`;
  }

  async function analyze() {
    if (!(await checkRuntimeVersion())) return;
    const item = product();
    if (!item.name || !item.category || !item.materials || !item.techniques) { $("analysis-status").textContent = "請先完成商品名稱、品類、材質與工法。"; return; }
    const ranked = core.rankCompetitors(item, state.competitors);
    const included = core.includedCompetitors(ranked);
    if (!included.length) { $("analysis-status").textContent = "請至少勾選納入 1 筆已人工確認的競品來源；建議確認 3 筆以上再做價格判斷。"; return; }
    const competitors = included;
    const pricing = core.priceScenarios({
      competitors, unitCost: Number($("unit-cost").value), fixedCost: Number($("fixed-cost").value),
      channelRate: Number($("channel-rate").value), targetMargin: Number($("target-margin").value)
    });
    const marketing = core.marketingAdvice(item, pricing);
    state.result = { version: APP_VERSION, generatedAt: new Date().toISOString(), product: item, fileName: state.file?.name || "拉拉手持鏡填寫範例", competitors, aiSummary: state.aiSummary, aiSearchNotes: state.aiSearchNotes, pricing, marketing, assumptions: { unitCost: Number($("unit-cost").value), fixedCost: Number($("fixed-cost").value), channelRate: Number($("channel-rate").value), targetMargin: Number($("target-margin").value) } };
    const best = competitors[0];
    $("report-meta").textContent = `${item.name}・產生時間 ${new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(new Date())}`;
    $("summary-cards").innerHTML = `<div class="summary-item"><span>市售價格中位數</span><strong>${currency(pricing.market.median)}</strong></div><div class="summary-item"><span>最高相似競品</span><strong>${best.similarity}%</strong><small>${escapeHtml(best.name)}</small></div><div class="summary-item"><span>來源筆數</span><strong>${competitors.length} 筆</strong><small>每筆保留網址與檢查日</small></div>`;
    $("report-ai-section").hidden = !state.aiSummary;
    $("report-ai-summary").innerHTML = state.aiSummary ? `<p>${escapeHtml(state.aiSummary)}</p>${state.aiSearchNotes.length ? `<ul>${state.aiSearchNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : ""}<p><strong>注意：</strong>摘要涵蓋本次搜尋候選；定價試算只使用上方已由同仁勾選納入的來源。</p>` : "";
    $("pricing-cards").innerHTML = pricing.scenarios.map((scenario) => `<article class="pricing-item ${scenario.key === "regular" ? "featured" : ""}"><span>${scenario.label}</span><strong>${currency(scenario.price)}</strong><small>單件毛利 ${currency(scenario.grossProfit)}・毛利率 ${scenario.grossMargin}%<br>含成本與費用 ${currency(scenario.totalCost)}</small></article>`).join("");
    $("report-competitors").innerHTML = reportTable(competitors.slice(0, 5));
    $("marketing-list").innerHTML = marketing.map((itemText) => `<li>${escapeHtml(itemText)}</li>`).join("");
    $("report").hidden = false;
    $("analysis-status").textContent = "分析已完成；請先開啟來源覆核，再匯出報告。";
    $("report").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function downloadJson() {
    if (!state.result || !(await checkRuntimeVersion())) return;
    const blob = new Blob([JSON.stringify(state.result, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `${state.result.product.name.replace(/[\\/:*?"<>|]/g, "-")}_競品分析.json`; link.click();
    URL.revokeObjectURL(url);
  }

  async function printReport() { if (state.result && await checkRuntimeVersion()) window.print(); }

  $("work-order").addEventListener("change", handleFile);
  $("visual-reference").addEventListener("change", handleVisualReference);
  $("prefill-button").addEventListener("click", prefillFromFile);
  document.querySelectorAll("[data-example]").forEach((button) => button.addEventListener("click", () => loadExample(button.dataset.example)));
  $("product-form").addEventListener("input", (event) => { if (event.target?.id) state.dirtyFields.add(event.target.id); state.result = null; renderSearchCompleteness(); renderCompetitors(); });
  $("source-form").addEventListener("submit", addSource);
  $("ai-search-button").addEventListener("click", searchWithAi);
  $("competitor-rows").addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-include-id]");
    if (!checkbox) return;
    const item = state.competitors.find((candidate) => candidate.id === checkbox.dataset.includeId);
    if (item) { item.included = checkbox.checked; state.result = null; renderCompetitors(); }
  });
  $("analyze-button").addEventListener("click", analyze);
  $("download-json").addEventListener("click", downloadJson);
  $("print-report").addEventListener("click", printReport);
  $("reload-version").addEventListener("click", () => { const url = new URL(location.href); url.searchParams.set("deploy", state.latestRuntimeVersion || Date.now()); location.replace(url); });
  window.addEventListener("focus", checkRuntimeVersion);
  window.addEventListener("beforeunload", () => { if (state.previewUrl) URL.revokeObjectURL(state.previewUrl); if (state.visualPreviewUrl) URL.revokeObjectURL(state.visualPreviewUrl); });
  setInterval(checkRuntimeVersion, 5 * 60 * 1000);
  renderCompetitors();
  renderSearchCompleteness();
  void checkRuntimeVersion();
})();
