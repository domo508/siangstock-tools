(function () {
  "use strict";

  const state = { config: null, version: 0, rules: null, dirty: false };
  const get = (selector) => document.querySelector(selector);
  const elements = {
    account: get("#account-badge"), pageStatus: get("#page-status"), suppliers: get("#supplier-rows"), units: get("#unit-rows"), stores: get("#store-rows"),
    addSupplier: get("#add-supplier"), featuredSupplierSelect: get("#featured-supplier-select"), addFeaturedSupplier: get("#add-featured-supplier"), featuredSupplierList: get("#featured-supplier-list"),
    addUnit: get("#add-unit"), addStore: get("#add-store-rule"), blacklist: get("#blacklist-input"), holidays: get("#workday-holidays"),
    accessPanel: get("#access-panel"), approvers: get("#approver-emails"), storeTransferHq: get("#store-transfer-hq-emails"), recipient: get("#notification-recipient"), retention: get("#retention-months"),
    saveAccess: get("#save-access"), accessStatus: get("#access-status"), reason: get("#change-reason"), save: get("#save-rules"), saveStatus: get("#save-status"),
    springFestivalEnabled: get("#spring-festival-enabled"), springFestivalStart: get("#spring-festival-start"), springFestivalRecovery: get("#spring-festival-recovery"), springFestivalExtraDays: get("#spring-festival-extra-days"),
    puyoumaPull: get("#puyouma-pull"), puyoumaProduction: get("#puyouma-production"), puyoumaHot: get("#puyouma-hot"), puyoumaStable: get("#puyouma-stable"), puyoumaLow: get("#puyouma-low"),
    lirongPull: get("#lirong-pull"), lirongProduction: get("#lirong-production"), lirongDelivery: get("#lirong-delivery"), lirongHot: get("#lirong-hot"), lirongStable: get("#lirong-stable"), lirongLow: get("#lirong-low"),
    arrivals: Object.fromEntries(["R00", "R01", "R03", "R10", "R07", "R06"].map((code) => [code, get(`#arrival-${code}`)]))
  };

  function configureReturnPath() {
    if (new URLSearchParams(location.search).get("from") !== "store-transfer") return;
    const target = "../../store-transfer/";
    const source = get("#source-tool-link"); const back = get("#source-back-link"); const brand = get("#tool-brand-link");
    source.href = target; source.textContent = "門市週補貨與調撥";
    back.href = target; back.textContent = "← 返回週調撥工具";
    brand.href = target;
  }

  async function request(url, options = {}) {
    const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) }, ...options });
    const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
  }
  function markDirty() { state.dirty = true; elements.save.disabled = false; elements.saveStatus.textContent = "有尚未儲存的規則變更。"; }
  function cell(control) { const td = document.createElement("td"); td.appendChild(control); return td; }
  function input(type, value, onChange, attributes = {}) {
    const control = document.createElement("input"); control.type = type; if (type === "checkbox") control.checked = Boolean(value); else control.value = value ?? "";
    Object.entries(attributes).forEach(([key, item]) => control.setAttribute(key, String(item)));
    control.addEventListener(type === "checkbox" ? "change" : "input", () => { onChange(type === "checkbox" ? control.checked : control.value); markDirty(); }); return control;
  }
  function select(value, choices, onChange) {
    const control = document.createElement("select"); choices.forEach((choice) => { const option = document.createElement("option"); option.value = choice; option.textContent = choice; control.appendChild(option); }); control.value = value;
    control.addEventListener("change", () => { onChange(control.value); markDirty(); }); return control;
  }
  function removeButton(callback) { const button = document.createElement("button"); button.type = "button"; button.className = "table-action"; button.textContent = "刪除"; button.addEventListener("click", () => { callback(); markDirty(); render(); }); return button; }
  function ensureFeaturedSuppliers() {
    if (!Array.isArray(state.rules.featuredSuppliers)) {
      const defaults = ["普優瑪寢具有限公司", "力榮", "上林", "潤泰羽絨", "泰能脊康"];
      const supplierNames = new Set(state.rules.suppliers.map((item) => String(item.name || "").trim()));
      state.rules.featuredSuppliers = defaults.filter((name) => supplierNames.has(name));
    }
    return state.rules.featuredSuppliers;
  }
  function ensureSpringFestivalRule() {
    if (!state.rules.springFestival || typeof state.rules.springFestival !== "object") {
      state.rules.springFestival = { enabled: true, closureStart: "2027-01-16", recoveryDate: "2027-02-28", extraDays: 53 };
    }
    return state.rules.springFestival;
  }
  function renameSupplier(item, value) {
    const previousName = String(item.name || "").trim();
    item.name = value;
    const featured = ensureFeaturedSuppliers();
    const featuredIndex = featured.indexOf(previousName);
    if (featuredIndex >= 0) featured[featuredIndex] = value;
  }
  function removeSupplier(index) {
    const removedName = String(state.rules.suppliers[index]?.name || "").trim();
    state.rules.suppliers.splice(index, 1);
    state.rules.featuredSuppliers = ensureFeaturedSuppliers().filter((name) => name !== removedName);
  }
  function renderFeaturedSuppliers() {
    const supplierNames = state.rules.suppliers.map((item) => String(item.name || "").trim()).filter(Boolean);
    const validNames = new Set(supplierNames);
    const featured = [...new Set(ensureFeaturedSuppliers().map((name) => String(name || "").trim()).filter((name) => validNames.has(name)))];
    state.rules.featuredSuppliers = featured;
    const available = supplierNames.filter((name) => !featured.includes(name));
    const options = document.createDocumentFragment();
    available.forEach((name) => { const option = document.createElement("option"); option.value = name; option.textContent = name; options.appendChild(option); });
    elements.featuredSupplierSelect.replaceChildren(options);
    elements.featuredSupplierSelect.disabled = !available.length;
    elements.addFeaturedSupplier.disabled = !available.length;
    const list = document.createDocumentFragment();
    featured.forEach((name) => {
      const item = document.createElement("span"); item.className = "featured-supplier-item";
      const label = document.createElement("strong"); label.textContent = name;
      const button = document.createElement("button"); button.type = "button"; button.className = "featured-supplier-remove"; button.textContent = "移至其它"; button.setAttribute("aria-label", `將${name}移至其它供應商`);
      button.addEventListener("click", () => { state.rules.featuredSuppliers = featured.filter((supplier) => supplier !== name); markDirty(); renderFeaturedSuppliers(); });
      item.append(label, button); list.appendChild(item);
    });
    if (!featured.length) { const empty = document.createElement("p"); empty.className = "featured-supplier-empty"; empty.textContent = "目前沒有主要供應商，所有廠商都會歸入其它。"; list.appendChild(empty); }
    elements.featuredSupplierList.replaceChildren(list);
  }

  function renderSuppliers() {
    const fragment = document.createDocumentFragment();
    state.rules.suppliers.forEach((item, index) => {
      const row = document.createElement("tr");
      row.append(cell(input("text", item.name, (value) => renameSupplier(item, value))), cell(input("text", (item.aliases || []).join("、"), (value) => item.aliases = value.split(/[、,，]/).map((part) => part.trim()).filter(Boolean))),
        cell(select(item.country, ["國內", "國外"], (value) => item.country = value)), cell(input("number", item.leadDays, (value) => item.leadDays = Number(value), { min: 0, max: 365 })),
        cell(input("text", item.reviewDays ?? "", (value) => item.reviewDays = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : value, { placeholder: "0、28或90-120" })),
        cell(input("checkbox", item.automaticPurchase !== false, (value) => item.automaticPurchase = value)), cell(input("text", item.exclusionReason || "", (value) => item.exclusionReason = value)), cell(removeButton(() => removeSupplier(index))));
      fragment.appendChild(row);
    }); elements.suppliers.replaceChildren(fragment);
  }
  function renderUnits() {
    const fragment = document.createDocumentFragment();
    state.rules.purchaseUnits.forEach((item, index) => {
      const row = document.createElement("tr");
      row.append(cell(input("checkbox", item.enabled !== false, (value) => item.enabled = value)), cell(input("text", item.supplier, (value) => item.supplier = value)),
        cell(input("text", item.ruleName, (value) => item.ruleName = value)), cell(input("text", item.matchText || "", (value) => item.matchText = value, { placeholder: "可留白表示全品項" })),
        cell(input("number", item.quantity ?? "", (value) => item.quantity = value === "" ? null : Number(value), { min: 1, step: 1, placeholder: "尚未確認可留白" })), cell(removeButton(() => state.rules.purchaseUnits.splice(index, 1))));
      fragment.appendChild(row);
    }); elements.units.replaceChildren(fragment);
  }
  function renderStores() {
    const fragment = document.createDocumentFragment(); const rules = state.rules.storeInventory.rules || [];
    rules.forEach((item, index) => {
      const legacy = `${item.name || ""}${item.matchText || ""}`;
      const inferredCategory = item.productCategory || (/配件/.test(legacy) ? "配件" : "全部");
      const inferredSize = item.sizeAttribute || (/無尺寸/.test(legacy) ? "無尺寸" : /有尺寸/.test(legacy) ? "有尺寸" : "全部");
      const setCondition = (key, value) => { item.conditionMode = "structured"; item[key] = value; };
      const row = document.createElement("tr");
      row.append(cell(input("checkbox", item.enabled !== false, (value) => item.enabled = value)), cell(input("text", item.name, (value) => item.name = value)),
        cell(input("text", item.scope || "", (value) => item.scope = value)), cell(input("text", item.exactSkus || "", (value) => setCondition("exactSkus", value), { placeholder: "N00126,N00127" })), cell(input("text", inferredCategory, (value) => setCondition("productCategory", value), { placeholder: "全部或主檔值" })),
        cell(select(inferredSize, ["全部", "有尺寸", "無尺寸"], (value) => setCondition("sizeAttribute", value))),
        cell(input("text", item.itemTypeKeywords || "", (value) => setCondition("itemTypeKeywords", value), { placeholder: "留白或枕頭｜枕芯" })),
        cell(select(item.inventoryRole, ["不可售展示", "可售最低庫存", "可售特殊備貨", "排除規則"], (value) => item.inventoryRole = value)),
        cell(input("number", item.quantity, (value) => item.quantity = Number(value), { min: 0, step: 1 })), cell(input("number", item.priority, (value) => item.priority = Number(value), { min: 0, step: 1 })),
        cell(removeButton(() => rules.splice(index, 1)))); fragment.appendChild(row);
    }); elements.stores.replaceChildren(fragment);
  }
  function setConsignmentFields() {
    const p = state.rules.consignment.puyouma; const l = state.rules.consignment.lirong;
    const values = [[elements.puyoumaPull, p, "pullLeadDays"], [elements.puyoumaProduction, p, "productionDays"], [elements.puyoumaHot, p.targetDays, "熱銷"], [elements.puyoumaStable, p.targetDays, "穩定"], [elements.puyoumaLow, p.targetDays, "低銷"],
      [elements.lirongPull, l, "pullLeadDays"], [elements.lirongProduction, l, "productionDays"], [elements.lirongDelivery, l, "deliveryAfterProductionDays"], [elements.lirongHot, l.targetDays, "熱銷"], [elements.lirongStable, l.targetDays, "穩定"], [elements.lirongLow, l.targetDays, "低銷"]];
    values.forEach(([control, object, key]) => { control.value = String(object[key]); control.oninput = () => { object[key] = Number(control.value || 0); markDirty(); }; });
  }
  function setSpringFestivalFields() {
    const rule = ensureSpringFestivalRule();
    elements.springFestivalEnabled.checked = rule.enabled !== false;
    elements.springFestivalStart.value = rule.closureStart || "";
    elements.springFestivalRecovery.value = rule.recoveryDate || "";
    elements.springFestivalExtraDays.value = String(rule.extraDays ?? 53);
  }
  function render() {
    renderSuppliers(); renderFeaturedSuppliers(); renderUnits(); renderStores(); setConsignmentFields(); setSpringFestivalFields();
    elements.blacklist.value = (state.rules.blacklist || []).join("\n"); elements.holidays.value = (state.rules.storeInventory.workdayHolidays || []).join("\n");
    const defaults = { R00: 3, R01: 4, R03: 4, R10: 3, R07: 3, R06: 4 };
    state.rules.storeInventory.arrivalWeekdayByStore ||= {};
    Object.entries(elements.arrivals).forEach(([code, control]) => { control.value = String(state.rules.storeInventory.arrivalWeekdayByStore[code] ?? defaults[code]); });
  }

  async function loadAccessSettings() {
    const settings = await request("/api/procurement/access-settings");
    elements.approvers.value = settings.approverEmails.join("\n"); elements.storeTransferHq.value = settings.storeTransferHqEmails.join("\n"); elements.recipient.value = settings.notificationRecipient; elements.retention.value = String(settings.retentionMonths);
  }
  async function saveAccessSettings() {
    elements.saveAccess.disabled = true; elements.accessStatus.textContent = "正在儲存…";
    try {
      await request("/api/procurement/access-settings", { method: "PUT", body: JSON.stringify({ approverEmails: elements.approvers.value.split(/\n/).map((item) => item.trim()).filter(Boolean), storeTransferHqEmails: elements.storeTransferHq.value.split(/\n/).map((item) => item.trim()).filter(Boolean), notificationRecipient: elements.recipient.value.trim(), retentionMonths: Number(elements.retention.value), notificationEvents: ["approved", "revoked", "corrected"] }) });
      elements.accessStatus.textContent = "權限與通知已儲存。";
    } catch (error) { elements.accessStatus.textContent = `儲存失敗：${error.message}`; } finally { elements.saveAccess.disabled = false; }
  }
  async function saveRules() {
    const reason = elements.reason.value.trim(); if (!reason) { elements.saveStatus.textContent = "請填寫本次修改原因。"; elements.reason.focus(); return; }
    state.rules.blacklist = elements.blacklist.value.split(/\n/).map((item) => item.trim()).filter(Boolean);
    state.rules.storeInventory.workdayHolidays = elements.holidays.value.split(/\n/).map((item) => item.trim()).filter(Boolean);
    state.rules.storeInventory.arrivalWeekdayByStore = Object.fromEntries(Object.entries(elements.arrivals).map(([code, control]) => [code, Number(control.value)]));
    state.rules.storeInventory.rules.sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0) || String(left.name || "").localeCompare(String(right.name || ""), "zh-Hant"));
    elements.save.disabled = true; elements.saveStatus.textContent = "正在儲存新版本…";
    try {
      const result = await request("/api/procurement/rules", { method: "PUT", body: JSON.stringify({ expectedVersion: state.version, changeReason: reason, rules: state.rules }) });
      state.version = result.version; state.rules = result.rules; state.dirty = false; elements.reason.value = ""; render();
      elements.pageStatus.textContent = `公司共用採購規則v${result.version}・更新者${result.updatedBy}`; elements.saveStatus.textContent = "全部採購規則已儲存。";
    } catch (error) { elements.save.disabled = false; elements.saveStatus.textContent = `儲存失敗：${error.message}`; }
  }
  async function init() {
    try {
      const [config, payload] = await Promise.all([request("/api/procurement/config"), request("/api/procurement/rules")]); state.config = config; state.version = payload.version; state.rules = payload.rules;
      const roleLabel = { admin: "最高權限", approver: "採購核准者", operator: "採購操作" }[config.role]; elements.account.textContent = `${config.email}・${roleLabel}`;
      if (!config.permissions?.canManageRules) throw new Error("此帳號只有採購操作權，不能管理規則。");
      elements.pageStatus.textContent = `公司共用採購規則v${payload.version}・更新${String(payload.updatedAt).replace("T", " ").slice(0, 19)}・${payload.updatedBy}`; render();
      if (config.permissions.canManageAccess) { elements.accessPanel.hidden = false; await loadAccessSettings(); }
    } catch (error) { elements.pageStatus.textContent = `無法載入：${error.message}`; elements.pageStatus.classList.add("error"); }
  }

  elements.addSupplier.addEventListener("click", () => { state.rules.suppliers.push({ name: "新供應商", aliases: [], country: "國內", leadDays: 14, reviewDays: 14, automaticPurchase: true, exclusionReason: "" }); markDirty(); render(); });
  elements.addFeaturedSupplier.addEventListener("click", () => { const name = elements.featuredSupplierSelect.value; if (!name) return; ensureFeaturedSuppliers().push(name); markDirty(); renderFeaturedSuppliers(); });
  elements.addUnit.addEventListener("click", () => { state.rules.purchaseUnits.push({ supplier: "普優瑪寢具有限公司", ruleName: "其它品項", matchText: "", quantity: null, enabled: true }); markDirty(); render(); });
  elements.addStore.addEventListener("click", () => { state.rules.storeInventory.rules.push({ name: "新門市規則", enabled: false, scope: "R00、R06", conditionMode: "structured", exactSkus: "", productCategory: "全部", sizeAttribute: "全部", itemTypeKeywords: "", matchText: "", inventoryRole: "可售最低庫存", quantity: 1, priority: 50 }); markDirty(); render(); });
  elements.springFestivalEnabled.addEventListener("change", () => { ensureSpringFestivalRule().enabled = elements.springFestivalEnabled.checked; markDirty(); });
  elements.springFestivalStart.addEventListener("input", () => { ensureSpringFestivalRule().closureStart = elements.springFestivalStart.value; markDirty(); });
  elements.springFestivalRecovery.addEventListener("input", () => { ensureSpringFestivalRule().recoveryDate = elements.springFestivalRecovery.value; markDirty(); });
  elements.springFestivalExtraDays.addEventListener("input", () => { ensureSpringFestivalRule().extraDays = Number(elements.springFestivalExtraDays.value || 0); markDirty(); });
  configureReturnPath();
  elements.blacklist.addEventListener("input", markDirty); elements.holidays.addEventListener("input", markDirty); elements.save.addEventListener("click", saveRules); elements.saveAccess.addEventListener("click", saveAccessSettings); init();
  Object.values(elements.arrivals).forEach((control) => control.addEventListener("change", markDirty));
})();
