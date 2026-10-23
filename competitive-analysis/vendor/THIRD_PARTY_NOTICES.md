# 第三方本機辨識元件

這些檔案只由商控競品分析工具在瀏覽器本機載入，不會連接第三方 CDN。

- Mozilla PDF.js `6.4.299`，Apache License 2.0；完整授權見 `pdfjs-6.4.299/LICENSE`。
- Tesseract.js `7.0.0` 與 Tesseract.js Core `7.0.0`，Apache License 2.0；完整授權見 `tesseract-7.0.0/LICENSE.md` 與 `tesseract-7.0.0/core/LICENSE`。
- `@tesseract.js-data/chi_tra` `1.0.0`，提供繁體中文辨識資料；套件說明見 `tesseract-7.0.0/lang/README.md`。

來源套件與版本同時固定於 `cloudflare/package.json` 及 `cloudflare/pnpm-lock.yaml`，更新時必須同步更換版本化目錄。
