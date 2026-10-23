(function () {
  "use strict";
  const APP_VERSION = "20261023-competitive-analysis-r2";
  const core = globalThis.CompetitiveAnalysisCore;
  const $ = (id) => document.getElementById(id);
  const state = { competitors: [], profile: null, file: null, previewUrl: "", result: null, runtimeOutdated: false, latestRuntimeVersion: "" };
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
    for (const id of ["product-name", "product-category", "product-dimensions", "product-materials", "product-techniques", "product-highlights", "product-packaging"]) $(id).value = "";
    $("confidence-badge").textContent = "新工單・請人工填寫並覆核";
    $("review-notices").hidden = false;
    $("review-notices").innerHTML = "<strong>填寫原則</strong><p>請依工單填寫規格；不確定的內容保留「待確認」，不要推定成已確認資訊。本工具不會把檔案送往雲端辨識。</p>";
    $("source-date").textContent = "請加入實際競品來源";
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
    state.competitors = core.EXAMPLE_COMPETITORS.map((item) => ({ ...item }));
    fillProfile(profile, "拉拉範例");
    $("file-status").textContent = "已載入拉拉手持鏡填寫範例；這是操作參考，不代表新的工單內容。";
    $("source-date").textContent = "範例來源檢查日 2026-10-22";
    showPlaceholder("填寫範例模式：上傳新工單後，範例資料會清空並改由同仁依工單填寫。");
  }

  function renderCompetitors() {
    const ranked = core.rankCompetitors(product(), state.competitors);
    $("competitor-rows").innerHTML = ranked.length ? ranked.map((item) => `<tr><td><span class="score">${item.similarity}%</span></td><td><strong>${escapeHtml(item.name)}</strong><span class="table-note">${escapeHtml(item.brand)}・${escapeHtml(item.positioning)}</span></td><td><strong>${currency(item.salePrice || item.price)}</strong>${item.salePrice ? `<span class="table-note">標示原價 ${currency(item.price)}</span>` : ""}</td><td><a class="source-link" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.sourceLabel)} ↗</a><span class="table-note">檢查日 ${escapeHtml(item.checkedAt)}</span></td></tr>`).join("") : '<tr><td colspan="4"><span class="table-note">尚未加入競品來源。建議至少加入 3 筆規格接近且仍在販售的商品。</span></td></tr>';
    return ranked;
  }

  function addSource(event) {
    event.preventDefault();
    state.competitors.push({
      id: `manual-${Date.now()}`, name: $("source-name").value.trim(), brand: "人工新增", price: Number($("source-price").value),
      category: $("source-category").value.trim(), materials: $("source-materials").value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
      techniques: $("source-techniques").value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean), size: $("source-size").value.trim() || "待確認",
      positioning: $("source-positioning").value.trim() || "待確認", sourceUrl: $("source-url").value, sourceLabel: "人工確認來源", checkedAt: new Date().toISOString().slice(0, 10)
    });
    event.currentTarget.reset();
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
    if (!state.competitors.length) { $("analysis-status").textContent = "請至少加入 1 筆已確認的競品來源；建議 3 筆以上再做價格判斷。"; return; }
    const competitors = core.rankCompetitors(item, state.competitors);
    const pricing = core.priceScenarios({
      competitors, unitCost: Number($("unit-cost").value), fixedCost: Number($("fixed-cost").value),
      channelRate: Number($("channel-rate").value), targetMargin: Number($("target-margin").value)
    });
    const marketing = core.marketingAdvice(item, pricing);
    state.result = { version: APP_VERSION, generatedAt: new Date().toISOString(), product: item, fileName: state.file?.name || "拉拉手持鏡填寫範例", competitors, pricing, marketing, assumptions: { unitCost: Number($("unit-cost").value), fixedCost: Number($("fixed-cost").value), channelRate: Number($("channel-rate").value), targetMargin: Number($("target-margin").value) } };
    const best = competitors[0];
    $("report-meta").textContent = `${item.name}・產生時間 ${new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(new Date())}`;
    $("summary-cards").innerHTML = `<div class="summary-item"><span>市售價格中位數</span><strong>${currency(pricing.market.median)}</strong></div><div class="summary-item"><span>最高相似競品</span><strong>${best.similarity}%</strong><small>${escapeHtml(best.name)}</small></div><div class="summary-item"><span>來源筆數</span><strong>${competitors.length} 筆</strong><small>每筆保留網址與檢查日</small></div>`;
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
  $("product-form").addEventListener("input", renderCompetitors);
  $("source-form").addEventListener("submit", addSource);
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
