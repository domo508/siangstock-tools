import { describe, expect, it } from "vitest";
import { validateRules, validateUpdateBody } from "../src/schema";

const rules = {
  表頭搜尋列數: 20,
  金額欄位最低數值比例: 0.95,
  排除關鍵字: ["運費"],
  待人工確認關鍵字: ["贈品"],
  指定品名白名單: ["展示品－原木托盤"],
  欄位辨識: { 品名: ["品名"], 庫存數量: ["庫存數量"], 平均成本: ["平均成本"], 庫存金額: ["庫存金額"] }
};

describe("集中規則 JSON schema", () => {
  it("接受完整且合法的三類規則", () => {
    expect(validateRules(rules).指定品名白名單).toEqual(["展示品-原木托盤"]);
  });

  it("拒絕未知欄位、重複規則與過長文字", () => {
    expect(() => validateRules({ ...rules, 未知: true })).toThrow(/多出/);
    expect(() => validateRules({ ...rules, 排除關鍵字: ["運費", "運費"] })).toThrow(/重複/);
    expect(() => validateRules({ ...rules, 待人工確認關鍵字: ["長".repeat(121)] })).toThrow(/120/);
  });

  it("要求樂觀鎖版本且拒絕多餘更新欄位", () => {
    expect(validateUpdateBody({ expectedVersion: 3, rules }).expectedVersion).toBe(3);
    expect(() => validateUpdateBody({ expectedVersion: 3, rules, overwrite: true })).toThrow(/多出/);
  });
});
