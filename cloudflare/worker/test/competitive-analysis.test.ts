import { describe, expect, it } from "vitest";
import { sanitizeCompetitiveSearchOutput, validateCompetitiveSearchBody } from "../src/competitive-analysis";

const product = {
  name: "新商品手持鏡",
  category: "毛絨手持鏡",
  dimensions: "20 × 13 cm",
  materials: "毛絨、玻璃",
  techniques: "刺繡、立體車縫",
  designHighlights: "角色立體輪廓",
  packaging: "待確認"
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
    similarityReasons: ["品類及材質相近"], differences: ["角色造型不同"], priceEvidence: "商品頁標示售價 NT$399"
  };
}

describe("商控競品 AI 搜尋邊界", () => {
  it("只接受完整文字規格與明確同意，不接受檔案或檔名欄位", () => {
    expect(validateCompetitiveSearchBody({ consent: true, product }).product.name).toBe("新商品手持鏡");
    expect(() => validateCompetitiveSearchBody({ consent: true, product, fileName: "secret.pdf" })).toThrow(/欄位不符/);
    expect(() => validateCompetitiveSearchBody({ consent: false, product })).toThrow(/先確認/);
  });

  it("只保留 OpenAI 搜尋來源中可交叉驗證的 HTTPS 商品頁", () => {
    const accepted = candidate();
    const invented = candidate("https://invented.example.net/product/1");
    const result = sanitizeCompetitiveSearchOutput(upstream([accepted, invented], [accepted.sourceUrl]));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].sourceUrl).toBe(accepted.sourceUrl);
    expect(result.candidates[0].priceTwd).toBe(399);
  });

  it("來源有轉址或追蹤路徑差異時，允許同一 HTTPS 商店網域進入人工確認", () => {
    const result = sanitizeCompetitiveSearchOutput(upstream(
      [candidate("https://shop.example.com/products/mirror")],
      ["https://shop.example.com/search?q=mirror&utm_source=openai"]
    ));
    expect(result.candidates).toHaveLength(1);
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

  it("拒絕 localhost、私人位址及沒有可驗證來源的結果", () => {
    expect(() => sanitizeCompetitiveSearchOutput(upstream([candidate("https://127.0.0.1/item")], ["https://127.0.0.1/item"]))).toThrow(/no_cited_candidates/);
    expect(() => sanitizeCompetitiveSearchOutput(upstream([candidate()], []))).toThrow(/no_cited_candidates/);
  });
});
