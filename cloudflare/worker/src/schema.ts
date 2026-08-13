export const RULE_LIST_KEYS = ["排除關鍵字", "待人工確認關鍵字", "指定品名白名單"] as const;
const COLUMN_KEYS = ["品名", "庫存數量", "平均成本", "庫存金額"] as const;
const ROOT_KEYS = ["表頭搜尋列數", "金額欄位最低數值比例", ...RULE_LIST_KEYS, "欄位辨識"] as const;

export type Rules = {
  表頭搜尋列數: number;
  金額欄位最低數值比例: number;
  排除關鍵字: string[];
  待人工確認關鍵字: string[];
  指定品名白名單: string[];
  欄位辨識: Record<(typeof COLUMN_KEYS)[number], string[]>;
};

export class RequestValidationError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const actual = Object.keys(value);
  const extras = actual.filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !actual.includes(key));
  if (extras.length || missing.length) {
    throw new RequestValidationError(`${label}欄位不符；缺少：${missing.join("、") || "無"}；多出：${extras.join("、") || "無"}。`);
  }
}

function normalizeList(value: unknown, label: string, maximum = 500): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new RequestValidationError(`「${label}」必須是 ${maximum} 項以內的文字清單。`);
  }
  const seen = new Set<string>();
  return value.map((item) => {
    if (typeof item !== "string") throw new RequestValidationError(`「${label}」只能包含文字。`);
    const normalized = item.normalize("NFKC").trim();
    if (!normalized || normalized.length > 120) throw new RequestValidationError(`「${label}」每項需為 1 到 120 個字。`);
    const identity = normalized.toLocaleLowerCase("zh-Hant");
    if (seen.has(identity)) throw new RequestValidationError(`「${label}」有重複項目：${normalized}`);
    seen.add(identity);
    return normalized;
  });
}

export function validateRules(value: unknown): Rules {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestValidationError("rules 必須是物件。");
  const object = value as Record<string, unknown>;
  assertExactKeys(object, ROOT_KEYS, "rules ");
  if (!Number.isInteger(object["表頭搜尋列數"]) || Number(object["表頭搜尋列數"]) < 1 || Number(object["表頭搜尋列數"]) > 100) {
    throw new RequestValidationError("「表頭搜尋列數」必須是 1 到 100 的整數。");
  }
  if (typeof object["金額欄位最低數值比例"] !== "number" || Number(object["金額欄位最低數值比例"]) < 0.5 || Number(object["金額欄位最低數值比例"]) > 1) {
    throw new RequestValidationError("「金額欄位最低數值比例」必須是 0.5 到 1 的數字。");
  }
  const columnsValue = object["欄位辨識"];
  if (!columnsValue || typeof columnsValue !== "object" || Array.isArray(columnsValue)) throw new RequestValidationError("「欄位辨識」必須是物件。");
  const columns = columnsValue as Record<string, unknown>;
  assertExactKeys(columns, COLUMN_KEYS, "欄位辨識 ");
  const productNames = normalizeList(columns["品名"], "欄位辨識／品名", 30);
  if (!productNames.length) throw new RequestValidationError("「欄位辨識／品名」至少要有一項。");
  return {
    表頭搜尋列數: Number(object["表頭搜尋列數"]),
    金額欄位最低數值比例: Number(object["金額欄位最低數值比例"]),
    排除關鍵字: normalizeList(object["排除關鍵字"], "排除關鍵字"),
    待人工確認關鍵字: normalizeList(object["待人工確認關鍵字"], "待人工確認關鍵字"),
    指定品名白名單: normalizeList(object["指定品名白名單"], "指定品名白名單"),
    欄位辨識: {
      品名: productNames,
      庫存數量: normalizeList(columns["庫存數量"], "欄位辨識／庫存數量", 30),
      平均成本: normalizeList(columns["平均成本"], "欄位辨識／平均成本", 30),
      庫存金額: normalizeList(columns["庫存金額"], "欄位辨識／庫存金額", 30)
    }
  };
}

export function validateUpdateBody(value: unknown): { expectedVersion: number; rules: Rules } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestValidationError("JSON 內容必須是物件。");
  const object = value as Record<string, unknown>;
  assertExactKeys(object, ["expectedVersion", "rules"], "更新內容 ");
  if (!Number.isInteger(object.expectedVersion) || Number(object.expectedVersion) < 1) {
    throw new RequestValidationError("expectedVersion 必須是正整數。");
  }
  return { expectedVersion: Number(object.expectedVersion), rules: validateRules(object.rules) };
}
