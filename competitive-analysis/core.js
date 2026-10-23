(function (root) {
  "use strict";

  const EXAMPLE_COMPETITORS = [
    {
      id: "miniso-sanrio", name: "MINISO Sanrio 方形手持化妝鏡", brand: "MINISO / Sanrio", price: 104,
      category: "手持鏡", materials: ["玻璃", "塑膠"], techniques: ["角色印刷"], size: "便攜", positioning: "平價角色小物",
      sourceUrl: "https://www.shein.tw/Sanrio-Characters-Square-Hand-Held-Makeup-Mirror%2C-Cartoon-Portable-Mirror-p-60532874.html",
      sourceLabel: "SHEIN 台灣", checkedAt: "2026-10-22"
    },
    {
      id: "dinotaeng-plush", name: "DINOTAENG Plush Mirror 毛絨手拿鏡", brand: "DINOTAENG", price: 450, salePrice: 300,
      category: "毛絨手持鏡", materials: ["毛絨", "玻璃"], techniques: ["立體造型", "角色刺繡"], size: "手持", positioning: "韓系角色生活雜貨",
      sourceUrl: "https://www.bringtolight.tw/products/dinotaeng-plush-mirror-2types", sourceLabel: "Bring To Light", checkedAt: "2026-10-22"
    },
    {
      id: "sanrio-double", name: "Sanrio 絨毛造型隨身雙面鏡", brand: "Sanrio", price: 425,
      category: "毛絨隨身鏡", materials: ["聚酯纖維", "玻璃", "毛絨"], techniques: ["立體造型", "角色刺繡"], size: "7.5 × 7.5 × 1.5 cm", positioning: "授權角色精品",
      sourceUrl: "https://www.komonoya.com.tw/product/product%26product_id%3D49354", sourceLabel: "小禮堂", checkedAt: "2026-10-22"
    },
    {
      id: "rilakkuma-plush", name: "San-X 拉拉熊絨毛玩偶隨身鏡", brand: "San-X", price: 415,
      category: "毛絨隨身鏡", materials: ["毛絨", "玻璃"], techniques: ["立體造型", "角色刺繡"], size: "隨身", positioning: "授權角色精品",
      sourceUrl: "https://shopee.tw/%E5%B0%8F%E7%A6%AE%E5%A0%82-San-X-%E6%8B%89%E6%8B%89%E7%86%8A-%E7%B5%A8%E6%AF%9B%E7%8E%A9%E5%81%B6%E9%9A%A8%E8%BA%AB%E9%8F%A1-%28%E5%A4%A7%E8%87%89%E6%AC%BE%29-i.7614772.56007806626",
      sourceLabel: "蝦皮購物 / 小禮堂", checkedAt: "2026-10-22"
    },
    {
      id: "disney-plush", name: "Disney 角色絨毛大頭造型手拿鏡", brand: "Disney", price: 650,
      category: "毛絨手持鏡", materials: ["毛絨", "玻璃"], techniques: ["立體造型", "角色刺繡"], size: "手持", positioning: "高知名度授權精品",
      sourceUrl: "https://www.mineaura.me/en/categories/comb", sourceLabel: "Mineaura", checkedAt: "2026-10-22"
    }
  ];

  const EXAMPLE_PROFILES = {
    lala: {
      name: "拉拉角色立體絨毛手持鏡", category: "毛絨手持鏡", dimensions: "約 23 × 13.7 × 5–6 cm",
      materials: "QQ 毛 1209 黃、水晶絨、玻璃鏡面",
      techniques: "角色五官刺繡、握柄文字刺繡、耳朵內凹、圓弧包邊、天線捲起並以鐵絲增加支撐",
      designHighlights: "正面完整拉拉角色，背面圓鏡；立體頭型、耳朵與天線形成高辨識輪廓", packaging: "工單未標示，需補充", confidence: 92,
      notices: ["鏡面材質與直徑需向工廠確認", "鐵絲端點與縫線需做安全檢查", "包裝、授權標示與洗標尚未提供"]
    }
  };

  const normalized = (value) => String(value || "").trim().toLocaleLowerCase("zh-TW");
  const tokens = (value) => normalized(value).split(/[\s,，、/×x()（）・]+/).filter(Boolean);

  function overlap(left, right) {
    const a = new Set(tokens(Array.isArray(left) ? left.join(" ") : left));
    const b = new Set(tokens(Array.isArray(right) ? right.join(" ") : right));
    if (!a.size || !b.size) return 0;
    let hits = 0;
    a.forEach((item) => { if ([...b].some((candidate) => candidate.includes(item) || item.includes(candidate))) hits += 1; });
    return Math.min(1, hits / Math.max(1, Math.min(a.size, b.size)));
  }

  function similarity(product, competitor) {
    const productCategory = normalized(product.category);
    const competitorCategory = normalized(competitor.category);
    const category = !productCategory || !competitorCategory ? 0.35
      : productCategory === competitorCategory ? 1 : (productCategory.includes("鏡") && competitorCategory.includes("鏡")) ? 0.72 : 0.15;
    const material = overlap(product.materials, competitor.materials);
    const technique = overlap(product.techniques, competitor.techniques);
    const size = overlap(product.dimensions, competitor.size) || (normalized(product.dimensions).includes("23") && /手持|便攜|隨身/.test(competitor.size || "") ? 0.55 : 0.25);
    const positioning = /角色|授權|生活雜貨|精品/.test(competitor.positioning || "") ? 0.82 : 0.45;
    return Math.round(category * 35 + material * 20 + technique * 20 + size * 10 + positioning * 15);
  }

  function rankCompetitors(product, competitors) {
    return competitors.map((item) => ({ ...item, similarity: similarity(product, item) }))
      .sort((a, b) => b.similarity - a.similarity || a.price - b.price);
  }

  function includedCompetitors(competitors) {
    return (competitors || []).filter((item) => item.included !== false);
  }

  function percentile(values, ratio) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const index = (sorted.length - 1) * ratio;
    const lower = Math.floor(index), upper = Math.ceil(index);
    return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  }

  function roundPrice(value) {
    const rounded = Math.ceil(Number(value || 0) / 10) * 10;
    if (rounded <= 0) return 0;
    return rounded - 1;
  }

  function margin(price, unitCost, channelRate, fixedCost) {
    const revenue = Number(price || 0);
    const totalCost = Number(unitCost || 0) + revenue * Number(channelRate || 0) / 100 + Number(fixedCost || 0);
    const grossProfit = revenue - totalCost;
    return { price: revenue, totalCost: Math.round(totalCost), grossProfit: Math.round(grossProfit), grossMargin: revenue > 0 ? Math.round(grossProfit / revenue * 1000) / 10 : 0 };
  }

  function priceScenarios(input) {
    const prices = (input.competitors || []).map((item) => Number(item.salePrice || item.price)).filter((value) => value > 0);
    const median = percentile(prices, 0.5) || 350;
    const upper = percentile(prices, 0.75) || median * 1.15;
    const floorByMargin = (Number(input.unitCost || 0) + Number(input.fixedCost || 0)) / Math.max(0.05, 1 - Number(input.channelRate || 0) / 100 - Number(input.targetMargin || 0) / 100);
    const anchor = Math.max(median, floorByMargin);
    const list = roundPrice(Math.max(anchor * 1.16, upper));
    const regular = roundPrice(Math.max(anchor, list * 0.88));
    const campaign = roundPrice(Math.max(floorByMargin, regular * 0.86));
    return {
      market: { low: prices.length ? Math.min(...prices) : 0, median: Math.round(median), high: prices.length ? Math.max(...prices) : 0 },
      scenarios: [
        { key: "list", label: "建議定價", ...margin(list, input.unitCost, input.channelRate, input.fixedCost) },
        { key: "regular", label: "常態售價", ...margin(regular, input.unitCost, input.channelRate, input.fixedCost) },
        { key: "campaign", label: "活動底價", ...margin(campaign, input.unitCost, input.channelRate, input.fixedCost) }
      ]
    };
  }

  function marketingAdvice(product, pricing) {
    const regular = pricing.scenarios.find((item) => item.key === "regular")?.price || 0;
    const category = product.category || "此商品";
    const evidence = [product.dimensions, product.materials, product.techniques].filter(Boolean).join("、");
    const difference = product.designHighlights || "材質、尺寸、工法與使用情境";
    return [
      `商品定位：以「${category}的使用價值與設計差異」溝通，優先說明${difference}。`,
      `價值證據：主圖、尺寸圖與細節圖應完整呈現${evidence || "實際尺寸、材質與工法"}，讓消費者看見與相似商品的差異。`,
      `價格結構：常態價可先以 NT$${regular.toLocaleString("zh-TW")} 做小量測試，另規劃會員價或組合方案，避免只靠折扣成交。`,
      `上架前補件：確認實際材質、尺寸、包裝、產品安全與授權標示；未確認內容保持「待確認」，不要直接寫入商品頁承諾。`,
      `驗證方式：針對${product.name || "新商品"}做主圖與價格 A/B 測試，分開記錄點擊、加購與實際成交，不把按讚數當成購買意願。`
    ];
  }

  root.CompetitiveAnalysisCore = { EXAMPLE_COMPETITORS, EXAMPLE_PROFILES, similarity, rankCompetitors, includedCompetitors, priceScenarios, marketingAdvice, margin };
})(typeof globalThis !== "undefined" ? globalThis : window);
