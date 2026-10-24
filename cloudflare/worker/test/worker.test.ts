import { describe, expect, it } from "vitest";
import worker from "../src/index";

const payload = JSON.stringify({
  表頭搜尋列數: 20,
  金額欄位最低數值比例: 0.95,
  排除關鍵字: ["運費"],
  待人工確認關鍵字: ["贈品"],
  指定品名白名單: [],
  欄位辨識: { 品名: ["品名"], 庫存數量: [], 平均成本: [], 庫存金額: ["庫存金額"] }
});

function env() {
  return {
    DB: {
      prepare(sql: string) {
        return {
          bind() { return this; },
          async first() {
            if (sql.startsWith("SELECT")) return { version: 2, payload, updated_at: "2026-08-13T00:00:00.000Z" };
            return null;
          }
        };
      }
    },
    ALLOWED_ORIGINS: "https://siangstock.com",
    ADMIN_EMAILS: "evan0728@siangapato.com.tw,siang01@siangapato.com.tw",
    ACCESS_TEAM_DOMAIN: "",
    ACCESS_AUD: ""
  } as unknown as Parameters<typeof worker.fetch>[1];
}

describe("規則 Worker 路由與 fail closed", () => {
  it("公開 GET/HEAD 回傳 no-store 最新版本", async () => {
    const get = await worker.fetch(new Request("https://siangstock.com/api/rules"), env());
    expect(get.status).toBe(200);
    expect(get.headers.get("cache-control")).toContain("no-store");
    expect((await get.json() as { version: number }).version).toBe(2);
    const head = await worker.fetch(new Request("https://siangstock.com/api/rules", { method: "HEAD" }), env());
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("Access 尚未設定時管理 PUT 必定拒絕", async () => {
    const response = await worker.fetch(new Request("https://siangstock.com/api/rules/admin", {
      method: "PUT",
      headers: { Origin: "https://siangstock.com", "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: 2, rules: JSON.parse(payload) })
    }), env());
    expect(response.status).toBe(503);
  });

  it("沒有 Excel 或檔案上傳 API", async () => {
    const response = await worker.fetch(new Request("https://siangstock.com/api/upload", { method: "POST", body: "secret" }), env());
    expect(response.status).toBe(404);
  });

  it("競品 AI 搜尋在 Access 尚未設定時 fail closed", async () => {
    const response = await worker.fetch(new Request("https://siangstock.com/api/competitive-analysis/search", {
      method: "POST",
      headers: { Origin: "https://siangstock.com", "Content-Type": "application/json" },
      body: JSON.stringify({ consent: true, visualConsent: false, visualReference: null, product: { name: "商品", category: "手持鏡", dimensions: "", materials: "玻璃", techniques: "印刷", designHighlights: "", packaging: "", searchName: "商品手持鏡", primaryUse: "照鏡", secondaryCategories: "", mustMatch: "手持、鏡面", exclusions: "" } })
    }), env());
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("公司登入尚未啟用");
  });

  it("D1 免費額度用罄時回傳可操作的繁中提示", async () => {
    const quotaEnv = {
      ...env(),
      DB: {
        prepare() {
          return {
            bind() { return this; },
            async first() {
              throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row write limit.");
            }
          };
        }
      }
    } as unknown as Parameters<typeof worker.fetch>[1];
    const response = await worker.fetch(new Request("https://siangstock.com/api/rules"), quotaEnv);
    const body = await response.json() as { error: string };
    expect(response.status).toBe(503);
    expect(body.error).toContain("資料庫寫入額度已滿");
    expect(body.error).toContain("台灣時間上午 8 點");
  });
});
