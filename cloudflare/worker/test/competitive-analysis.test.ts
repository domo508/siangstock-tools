import { describe, expect, it } from "vitest";
import {
  buildCompetitiveSearchRequest, sanitizeCompetitivePrefillOutput, sanitizeCompetitiveSearchOutput, validateCompetitivePrefillBody, validateCompetitiveSearchBody
} from "../src/competitive-analysis";

const product = {
  name: "新商品手持鏡",
  category: "毛絨手持鏡",
  dimensions: "20 × 13 cm",
  materials: "毛絨、玻璃",
  techniques: "刺繡、立體車縫",
  designHighlights: "角色立體輪廓",
  packaging: "待確認",
  searchName: "角色立體絨毛手持鏡",
  primaryUse: "手持照鏡",
  secondaryCategories: "角色化妝鏡",
  mustMatch: "毛絨包覆、立體造型、刺繡",
  exclusions: "純塑膠平面鏡"
};

function upstream(candidates: unknown[], sources: string[]): { output: Record<string, unknown>[] } {
  return {
    output: [
      { type: "web_search_call", action: { sources: sources.map((url) => ({ url })) } },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify({ summary: "市場以授權角色商品為主。", searchNotes: ["促銷價需再確認"], candidates }), annotations: [] }] }
    ]
  };
}

function candidate(sourceUrl = "https://shop.example.com/products/mirror") {
  return {
    name: "角色毛絨手持鏡", brand: "Example", priceTwd: 399, originalPriceTwd: 499, category: "毛絨手持鏡",
    materials: ["毛絨", "玻璃"], techniques: ["刺繡"], size: "20 × 13 cm", positioning: "角色生活雜貨",
    sourceUrl, sourceTitle: "Example 官方商店", checkedAt: "2026-10-23", confidence: 88,
    similarityScore: 86, comparisonLevel: "direct",
    similarityReasons: ["品類及材質相近"], differences: ["角色造型不同"], priceEvidence: "商品頁標示售價 NT$399"
  };
}

describe("商控競品 AI 搜尋邊界", () => {
  it("只接受完整文字規格與明確同意，不接受檔案或檔名欄位", () => {
    expect(validateCompetitiveSearchBody({ consent: true, visualConsent: false, product, visualReference: null }).product.name).toBe("新商品手持鏡");
    expect(() => validateCompetitiveSearchBody({ consent: true, visualConsent: false, product, visualReference: null, fileName: "secret.pdf" })).toThrow(/欄位不符/);
    expect(() => validateCompetitiveSearchBody({ consent: false, visualConsent: false, product, visualReference: null })).toThrow(/先確認/);
  });

  it("發布切換期間仍接受舊版純文字請求，但不放寬額外欄位", () => {
    const legacyProduct = Object.fromEntries(Object.entries(product).filter(([key]) => !["searchName", "primaryUse", "secondaryCategories", "mustMatch", "exclusions"].includes(key)));
    const result = validateCompetitiveSearchBody({ consent: true, product: legacyProduct });
    expect(result.visualReference).toBeNull();
    expect(result.product.searchName).toBe("");
    expect(() => validateCompetitiveSearchBody({ consent: true, product: { ...legacyProduct, secret: "x" } })).toThrow(/欄位不符/);
  });

  it("外觀參考圖只能是受限大小的圖片 data URL", () => {
    const jpeg = `data:image/jpeg;base64,${btoa("small image")}`;
    expect(validateCompetitiveSearchBody({ consent: true, visualConsent: true, product, visualReference: jpeg }).visualReference).toBe(jpeg);
    expect(() => validateCompetitiveSearchBody({ consent: true, visualConsent: false, product, visualReference: jpeg })).toThrow(/先同意/);
    expect(() => validateCompetitiveSearchBody({ consent: true, visualConsent: true, product, visualReference: "https://example.com/image.jpg" })).toThrow(/只接受/);
  });

  it("只保留 OpenAI 搜尋來源中可交叉驗證的 HTTPS 商品頁", () => {
    const accepted = candidate();
    const invented = candidate("https://invented.example.net/product/1");
    const result = sanitizeCompetitiveSearchOutput(upstream([accepted, invented], [accepted.sourceUrl]));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].sourceUrl).toBe(accepted.sourceUrl);
    expect(result.candidates[0].priceTwd).toBe(399);
  });

  it("只接受同一商品路徑，移除追蹤參數後再交給前台", () => {
    const result = sanitizeCompetitiveSearchOutput(upstream(
      [candidate("https://shop.example.com/products/mirror?utm_source=openai&gclid=abc")],
      ["https://shop.example.com/products/mirror?utm_source=openai"]
    ));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].sourceUrl).toBe("https://shop.example.com/products/mirror");
  });

  it("同網域不同路徑不能冒充已核對的商品來源", () => {
    expect(() => sanitizeCompetitiveSearchOutput(upstream(
      [candidate("https://shop.example.com/products/mirror")],
      ["https://shop.example.com/search?q=mirror"]
    ))).toThrow(/no_cited_candidates/);
  });

  it("接受 OpenAI 開啟商品頁動作所提供的來源網址", () => {
    const accepted = candidate();
    const response = upstream([accepted], []);
    response.output[0] = { type: "web_search_call", action: { type: "open_page", url: accepted.sourceUrl } };
    expect(sanitizeCompetitiveSearchOutput(response).candidates).toHaveLength(1);
  });

  it("接受 OpenAI 網頁搜尋結果清單所提供的來源網址", () => {
    const accepted = candidate();
    const response = upstream([accepted], []);
    response.output[0] = { type: "web_search_call", results: [{ url: accepted.sourceUrl }] };
    expect(sanitizeCompetitiveSearchOutput(response).candidates).toHaveLength(1);
  });

  it("AI 回傳欄位過長時安全截斷，不讓單一欄位使整批來源失敗", () => {
    const accepted = { ...candidate(), positioning: "角色生活雜貨".repeat(40) };
    const result = sanitizeCompetitiveSearchOutput(upstream([accepted], [accepted.sourceUrl]));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].positioning).toHaveLength(160);
  });

  it("移除摘要網址並去除重複附註與候選", () => {
    const accepted = candidate();
    const response = upstream([accepted, accepted], [accepted.sourceUrl]);
    response.output[1] = {
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify({
        summary: "找到角色商品。([來源](https://shop.example.com/products/mirror?utm_source=openai))",
        searchNotes: ["找到角色商品。", "促銷價需再確認 https://shop.example.com/products/mirror"],
        candidates: [accepted, accepted]
      }) }]
    };
    const result = sanitizeCompetitiveSearchOutput(response);
    expect(result.summary).not.toContain("http");
    expect(result.searchNotes).toEqual(["促銷價需再確認"]);
    expect(result.candidates).toHaveLength(1);
  });

  it("搜尋採中等推理與最多六次工具呼叫", () => {
    const request = buildCompetitiveSearchRequest(product);
    expect(request.reasoning).toEqual({ effort: "medium" });
    expect(request.max_tool_calls).toBe(6);
    expect((request.input as Array<{ content: unknown }>)[1].content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "input_text" })]));
  });

  it("提供外觀參考圖時才加入低細節圖片輸入", () => {
    const request = buildCompetitiveSearchRequest(product, "data:image/jpeg;base64,c21hbGw=");
    expect((request.input as Array<{ content: unknown[] }>)[1].content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "input_image", detail: "low" })]));
  });

  it("拒絕 localhost、私人位址及沒有可驗證來源的結果", () => {
    expect(() => sanitizeCompetitiveSearchOutput(upstream([candidate("https://127.0.0.1/item")], ["https://127.0.0.1/item"]))).toThrow(/no_cited_candidates/);
    expect(() => sanitizeCompetitiveSearchOutput(upstream([candidate()], []))).toThrow(/no_cited_candidates/);
  });
});

describe("商控競品工單預填邊界", () => {
  const fields = Object.fromEntries([
    ["name", "角色絨毛手持鏡"], ["category", "毛絨手持鏡"], ["dimensions", "23 × 13.7 cm"],
    ["materials", "QQ 毛 1209 黃、玻璃鏡面"], ["techniques", "刺繡、立體車縫"],
    ["designHighlights", "角色立體輪廓"], ["packaging", "待確認"]
  ].map(([field, value]) => [field, { value, confidence: field === "packaging" ? 30 : 88, evidence: field === "packaging" ? "未找到明確證據" : "第 1 頁" }]));

  it("只接受明確同意、文字與安全的本機辨識摘要，不接受檔名或檔案內容欄位", () => {
    const extractedText = "=== 第 1 頁 ===\n品名：角色絨毛手持鏡\n材質：QQ 毛 1209 黃、玻璃鏡面\n工法：刺繡、立體車縫";
    expect(validateCompetitivePrefillBody({ consent: true, extractedText, extraction: { method: "pdf-text", pageCount: 1 } }).extraction.method).toBe("pdf-text");
    expect(() => validateCompetitivePrefillBody({ consent: false, extractedText, extraction: { method: "pdf-text", pageCount: 1 } })).toThrow(/先同意/);
    expect(() => validateCompetitivePrefillBody({ consent: true, extractedText, extraction: { method: "cloud-file", pageCount: 1 } })).toThrow(/不支援/);
    expect(() => validateCompetitivePrefillBody({ consent: true, extractedText, extraction: { method: "pdf-text", pageCount: 1 }, fileName: "secret.pdf" })).toThrow(/欄位不符/);
  });

  it("整理 AI 預填欄位、信心與證據，並安全截斷過長內容", () => {
    const response = { output_text: JSON.stringify({ fields: { ...fields, techniques: { value: "刺繡".repeat(700), confidence: 91, evidence: "第 2 頁工法欄" } }, notices: ["包裝資訊仍需確認"] }) };
    const result = sanitizeCompetitivePrefillOutput(response);
    expect(result.profile.name).toBe("角色絨毛手持鏡");
    expect(result.profile.techniques).toHaveLength(1200);
    expect(result.evidence.techniques.confidence).toBe(91);
    expect(result.notices).toEqual(["包裝資訊仍需確認"]);
  });

  it("將 0 到 1 的小數信心換算成百分比", () => {
    const fractionalFields = Object.fromEntries(Object.entries(fields).map(([field, detail]) => [field, { ...detail, confidence: 0.88 }]));
    const result = sanitizeCompetitivePrefillOutput({ output_text: JSON.stringify({ fields: fractionalFields, notices: [] }) });
    expect(result.evidence.name.confidence).toBe(88);
  });
});
