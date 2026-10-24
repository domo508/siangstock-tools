import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

function loadCore() {
  const sandbox = { console, Intl };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync("../competitive-analysis/core.js", "utf8"), sandbox);
  return sandbox.CompetitiveAnalysisCore;
}

const core = loadCore();

describe("商控競品分析核心", () => {
  it("正式版只保留一組拉拉填寫範例", () => {
    expect(Object.keys(core.EXAMPLE_PROFILES)).toEqual(["lala"]);
    expect(core.EXAMPLE_PROFILES.lala.name).toContain("拉拉");
    expect(core.EXAMPLE_PROFILES.po).toBeUndefined();
  });

  it("毛絨角色鏡比一般塑膠鏡取得較高相似度", () => {
    const product = core.EXAMPLE_PROFILES.lala;
    const ranked = core.rankCompetitors(product, core.EXAMPLE_COMPETITORS);
    const plush = ranked.find((item) => item.id === "dinotaeng-plush");
    const plastic = ranked.find((item) => item.id === "miniso-sanrio");
    expect(plush.similarity).toBeGreaterThan(plastic.similarity);
    expect(ranked[0].similarity).toBeGreaterThanOrEqual(ranked.at(-1).similarity);
  });

  it("活動底價仍守住指定目標毛利，並保留三種情境", () => {
    const result = core.priceScenarios({ competitors: core.EXAMPLE_COMPETITORS, unitCost: 120, fixedCost: 30, channelRate: 12, targetMargin: 55 });
    expect(result.scenarios.map((item) => item.key)).toEqual(["list", "regular", "campaign"]);
    expect(result.scenarios.find((item) => item.key === "campaign").grossMargin).toBeGreaterThanOrEqual(55);
    expect(result.scenarios[0].price).toBeGreaterThanOrEqual(result.scenarios[1].price);
    expect(result.scenarios[1].price).toBeGreaterThanOrEqual(result.scenarios[2].price);
  });

  it("所有示範競品都保留來源網址、價格與檢查日", () => {
    for (const item of core.EXAMPLE_COMPETITORS) {
      expect(item.sourceUrl).toMatch(/^https:\/\//);
      expect(item.price).toBeGreaterThan(0);
      expect(item.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("AI 候選預設未確認時不會進入定價樣本", () => {
    const candidates = [
      { id: "manual", price: 399, similarity: 75, included: true },
      { id: "ai", price: 199, similarity: 88, included: false },
      { id: "low", price: 99, similarity: 59, included: true }
    ];
    const included = core.includedCompetitors(candidates);
    expect(included.map((item) => item.id)).toEqual(["manual"]);
    expect(core.priceScenarios({ competitors: included, unitCost: 100, fixedCost: 20, channelRate: 10, targetMargin: 50 }).market.median).toBe(399);
  });

  it("搜尋規格卡達 60 分才可搜尋，並列出缺漏欄位", () => {
    const weak = core.searchProfileCompleteness({ name: "除塵刷", category: "除塵刷", materials: "超細纖維", techniques: "車縫" });
    expect(weak.score).toBe(55);
    expect(weak.ready).toBe(false);
    expect(weak.missing).toContain("主要用途");
    const ready = core.searchProfileCompleteness({ ...core.EXAMPLE_PROFILES.lala });
    expect(ready.score).toBe(100);
    expect(ready.ready).toBe(true);
  });

  it("只有最終相似度 60 分以上且人工勾選的來源可進入定價", () => {
    const included = core.includedCompetitors([
      { id: "edge", similarity: 60, included: true },
      { id: "low", similarity: 59, included: true },
      { id: "unchecked", similarity: 90, included: false }
    ]);
    expect(included.map((item) => item.id)).toEqual(["edge"]);
  });

  it("低信心 AI 預填不會自動寫入，60 分以上才可帶入", () => {
    expect(core.shouldAutoApplyPrefill("14 × 10 cm", 0)).toBe(false);
    expect(core.shouldAutoApplyPrefill("PP 袋", 59)).toBe(false);
    expect(core.shouldAutoApplyPrefill("超細纖維", 60)).toBe(true);
    expect(core.shouldAutoApplyPrefill("", 95)).toBe(false);
  });

  it("AI 相似度會與本機結構分數合併，功能替代品最高不超過 55 分", () => {
    const direct = core.similarity(core.EXAMPLE_PROFILES.lala, { ...core.EXAMPLE_COMPETITORS[1], aiSimilarity: 90, comparisonLevel: "direct" });
    const functional = core.similarity(core.EXAMPLE_PROFILES.lala, { ...core.EXAMPLE_COMPETITORS[0], aiSimilarity: 95, comparisonLevel: "functional" });
    expect(direct).toBeGreaterThan(functional);
    expect(functional).toBeLessThanOrEqual(55);
  });

  it("行銷建議依新商品欄位產生，不寫死測試角色", () => {
    const product = { name: "新品收納袋", category: "旅行收納", dimensions: "30 × 20 cm", materials: "再生聚酯纖維", techniques: "防潑水塗層", designHighlights: "可折疊" };
    const pricing = core.priceScenarios({ competitors: core.EXAMPLE_COMPETITORS, unitCost: 100, fixedCost: 20, channelRate: 10, targetMargin: 50 });
    const advice = core.marketingAdvice(product, pricing).join(" ");
    expect(advice).toContain("旅行收納");
    expect(advice).toContain("再生聚酯纖維");
    expect(advice).toContain("新品收納袋");
    expect(advice).not.toContain("小波");
  });
});
