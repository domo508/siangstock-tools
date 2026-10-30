# 本機處理元件

所有元件皆由本站提供；不在執行時下載外部OCR字庫或解碼器。下載檔案的 SHA-256 見 `SHA256.json`。只保留本工具使用的瀏覽器發行檔與授權檔，沒有安裝腳本或客戶資料。

| 元件 | 固定版本／來源 | 用途 |
|---|---|---|
| Tesseract.js | 6.0.1，https://github.com/naptha/tesseract.js | 本機OCR及worker |
| Tesseract.js-core | 6.0.0，https://github.com/naptha/tesseract.js-core | LSTM WebAssembly核心 |
| tessdata_fast | https://github.com/tesseract-ocr/tessdata_fast | `chi_tra`及`eng`本機字庫，內容雜湊固定 |
| PDF.js / pdfjs-dist | 4.10.38，https://github.com/mozilla/pdf.js | 本機多頁PDF預覽；包含CMaps與標準字型授權 |
| heic-to | 1.5.2，https://github.com/hoppergee/heic-to | 不需JavaScript unsafe-eval的CSP版HEIC解碼 |

首次瀏覽器驗收發現 heic2any 0.0.4 需 unsafe-eval，已移除並改用 heic-to 的 `dist/csp` 版本。沒有為此允許 JavaScript eval；OCR僅在本工具路徑允許 WebAssembly 執行，既有工具政策不變。
