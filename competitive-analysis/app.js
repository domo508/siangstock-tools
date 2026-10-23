(function () {
  "use strict";
  const APP_VERSION = "20261023-competitive-analysis-r3";
  const core = globalThis.CompetitiveAnalysisCore;
  const $ = (id) => document.getElementById(id);
  const state = { competitors: [], profile: null, file: null, previewUrl: "", result: null, aiSummary: "", aiSearchNotes: [], runtimeOutdated: false, latestRuntimeVersion: "" };
  const currency = (value) => new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(Number(value || 0));
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  function product() {
    return {
      name: $("product-name").value.trim(), category: $("product-category").value.trim(), dimensions: $("product-dimensions").value.trim(),
      materials: $("product-materials").value.trim(), techniques: $("product-techniques").value.trim(),
      designHighlights: $("product-highlights").value.trim(), packaging: $("product-packaging").value.trim()
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
    $("confidence-badge").textContent = "填寫範例・請依實際工單覆核";
    $("review-notices").hidden = false;
    $("review-notices").innerHTML = `<strong>仍需確認</strong><ul>${profile.notices.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    $("analysis-status").textContent = `${label}候選規格已帶入；請先覆核內容，再產生分析。`;
    renderCompetitors();
  }

  function resetNewProduct() {
    state.profile = null;
    state.result = null;
    state.competitors = [];
    state.aiSummary = "";
    state.aiSearchNotes = [];
    for (const id of ["product-name", "product-category", "product-dimensions", "product-materials", "product-techniques", "product-highlights", "product-packaging"]) $(id).value = "";
    $("confidence-badge").textContent = "新工單・請人工填寫並覆核";
    $("review-notices").hidden = false;
    $("review-notices").innerHTML = "<strong>填寫原則</strong><p>請依工單填寫規格；不確定的內容保留「待確認」，不要推定成已確認資訊。本工具不會把檔案送往雲端辨識。</p>";
    $("source-date").textContent = "請加入實際競品來源";
    $("ai-search-consent").checked = false;
    $("ai-search-status").textContent = "尚未執行 AI 搜尋；也可直接人工新增來源。";
    $("ai-search-summary").hidden = true;
    $("ai-search-summary").innerHTML = "";
    $("report").hidden = true;
    renderCompetitors();
  }

  function showPlaceholder(text) { $("preview-panel").innerHTML = `<p>${escapeHtml(text)}</p>`; }

  function renderFile(file) {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = URL.createObjectURL(file);
    if (file.type === "application/pdf") $("preview-panel").innerHTML = `<object data="${state.previewUrl}" type="application/pdf" aria-label="工單 PDF 預覽"><p>瀏覽器無法預覽 PDF，但仍可繼續填寫規格。</p></object>`;
    else $("preview-panel").innerHTML = `<img src="${state.previewUrl}" alt="已選工單預覽">`;
  }

  function handleFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) { event.target.value = ""; $("file-status").textContent = "檔案超過 40 MB，請先另存較小的 PDF 或圖片。"; return; }
    if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.type)) { event.target.value = ""; $("file-status").textContent = "檔案格式不支援，請選擇 PDF、PNG、JPG 或 WEBP。"; return; }
    state.file = file;
    renderFile(file);
    resetNewProduct();
    $("file-status").textContent = `已在本機讀取：${file.name}（${(file.size / 1024 / 1024).toFixed(1)} MB）`;
    $("analysis-status").textContent = "新工單已載入；請先填寫規格，再加入實際競品來源。";
  }

  function loadExample(key) {
    const profile = { key, ...core.EXAMPLE_PROFILES[key] };
    state.file = null;
    state.result = null;
    state.aiSummary = "";
    state.aiSearchNotes = [];
    $("ai-search-consent").checked = false;
    $("ai-search-status").textContent = "範例已載入；可直接查看既有來源，或覆核文字後重新執行 AI 搜尋。";
    $("ai-search-summary").hidden = true;
    $("ai-search-summary").innerHTML = "";
    state.competitors = core.EXAMPLE_COMPETITORS.map((item) => ({ ...item, included: true, origin: "example" }));
    fillProfile(profile, "拉拉範例");
    $("file-status").textContent = "已載入拉拉手持鏡填寫範例；這是操作參考，不代表新的工單內容。";
    $("source-date").textContent = "範例來源檢查日 2026-10-22";
    showPlaceholder("填寫範例模式：上傳新工單後，範例資料會清空並改由同仁依工單填寫。");
  }

  function renderCompetitors() {
    const ranked = core.rankCompetitors(product(), state.competitors);
    $("competitor-rows").innerHTML = ranked.length ? ranked.map((item) => {
      const isAi = item.origin === "ai";
      const details = isAi ? `<details class="ai-detail"><summary>查看 AI 比較摘要</summary><p><strong>相似：</strong>${escapeHtml((item.similarityReasons || []).join("；") || "待人工確認")}</p><p><strong>差異：</strong>${escapeHtml((item.differences || []).join("；") || "待人工確認")}</p><p><strong>價格證據：</strong>${escapeHtml(item.priceEvidence || "待人工確認")}・AI 信心 ${escapeHtml(item.aiConfidence)}%</p></details>` : "";
      return `<tr><td><input class="include-check" type="checkbox" data-include-id="${escapeHtml(item.id)}" aria-label="納入 ${escapeHtml(item.name)}" ${item.included !== false ? "checked" : ""}></td><td><span class="score">${item.similarity}%</span></td><td><strong>${escapeHtml(item.name)}</strong><span class="table-note">${escapeHtml(item.brand)}・${escapeHtml(item.positioning)}</span><span class="candidate-badge ${item.included !== false ? "confirmed" : ""}">${isAi && item.included === false ? "AI 候選・待人工確認" : "已納入比較"}</span>${details}</td><td><strong>${currency(item.salePrice || item.price)}</strong>${item.salePrice ? `<span class="table-note">標示原價 ${currency(item.price)}</span>` : ""}</td><td><a class="source-link" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.sourceLabel)} ↗</a><span class="table-note">檢查日 ${escapeHtml(item.checkedAt)}</span></td></tr>`;
    }).join("") : '<tr><td colspan="5"><span class="table-note">尚未加入競品來源。建議至少加入 3 筆規格接近且仍在販售的商品。</span></td></tr>';
    return ranked;
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
    if (!$("ai-search-consent").checked) {
      $("ai-search-status").textContent = "請先勾選確認文字規格已覆核。";
      return;
    }
    const button = $("ai-search-button");
    button.disabled = true;
    $("ai-search-status").textContent = "AI 正在搜尋並核對公開商品來源，通常需要數十秒……";
    try {
      const response = await fetch("/api/competitive-analysis/search", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true, product: item })
      });
      const responseText = await response.text();
      let data = {};
      try { data = JSON.parse(responseText); } catch (_) { data = {}; }
      const plainMessage = responseText.length <= 200 && !/[<>]/.test(responseText) ? responseText : "";
      if (!response.ok) throw new Error(data.error || plainMessage || "AI 搜尋失敗，請稍後再試。");
      state.competitors = state.competitors.filter((candidate) => candidate.origin !== "ai");
      const stamp = Date.now();
      for (const [index, candidate] of (data.candidates || []).entries()) {
        state.competitors.push({
          id: `ai-${stamp}-${index}`, name: candidate.name, brand: candidate.brand || "待確認", price: candidate.originalPriceTwd || candidate.priceTwd,
          salePrice: candidate.originalPriceTwd ? candidate.priceTwd : undefined, category: candidate.category, materials: candidate.materials || [],
          techniques: candidate.techniques || [], size: candidate.size || "待確認", positioning: candidate.positioning || "待確認",
          sourceUrl: candidate.sourceUrl, sourceLabel: candidate.sourceTitle, checkedAt: candidate.checkedAt,
          aiConfidence: candidate.confidence, similarityReasons: candidate.similarityReasons || [], differences: candidate.differences || [],
          priceEvidence: candidate.priceEvidence || "", origin: "ai", included: false
        });
      }
      state.aiSummary = data.summary || "";
      state.aiSearchNotes = Array.isArray(data.searchNotes) ? data.searchNotes : [];
      renderAiSummary();
      renderCompetitors();
      $("source-date").textContent = `AI 搜尋日 ${String(data.generatedAt || "").slice(0, 10)}`;
      $("ai-search-status").textContent = `找到 ${(data.candidates || []).length} 筆有來源的候選；請逐筆開啟來源，確認後勾選納入。`;
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
    const included = core.includedCompetitors(state.competitors);
    if (!included.length) { $("analysis-status").textContent = "請至少勾選納入 1 筆已人工確認的競品來源；建議確認 3 筆以上再做價格判斷。"; return; }
    const competitors = core.rankCompetitors(item, included);
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
  document.querySelectorAll("[data-example]").forEach((button) => button.addEventListener("click", () => loadExample(button.dataset.example)));
  $("product-form").addEventListener("input", () => { state.result = null; renderCompetitors(); });
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
  window.addEventListener("beforeunload", () => { if (state.previewUrl) URL.revokeObjectURL(state.previewUrl); });
  setInterval(checkRuntimeVersion, 5 * 60 * 1000);
  renderCompetitors();
  void checkRuntimeVersion();
})();
