# 翔仔居家公司工具

這是翔仔居家的純靜態公司工具入口。

- `/`：公司工具首頁。
- `/inventory/`：Excel 庫存清理工具。
- `/orders`、`/reports`：預留給未來工具，目前尚未啟用。

## 庫存工具會做什麼

使用者可在頁面選擇 `.xlsx`，依品名分類為正常商品、排除項目與待人工確認，並下載包含四張工作表的新 Excel。頁面也可管理排除關鍵字、待確認關鍵字與完整品名白名單，並匯出或載入規則 JSON。

來源 Excel 不會被改寫。排除資料也會完整保留在輸出檔，方便稽核。

## 資料安全

這個儲存庫只有 HTML、CSS、JavaScript 與隨附的離線 Excel 元件，沒有後端、資料庫或 Excel 上傳 API。

Excel 的讀取、分類、統計與輸出全部在使用者目前的瀏覽器分頁內完成，不會傳送到網站伺服器。`_headers` 與頁面本身的 Content Security Policy 均設定 `connect-src 'none'`，禁止頁面載入後建立對外資料連線。

請勿將真實庫存 Excel、測試輸出、客戶資料、密碼、API key 或環境設定提交到這個公開儲存庫。

## 本機預覽

在儲存庫根目錄啟動任一靜態檔案伺服器，例如：

```bash
python3 -m http.server 8765
```

然後開啟 `http://127.0.0.1:8765/`。

## 部署到 Zeabur

1. 在 Zeabur 新增 GitHub Service，選擇這個儲存庫。
2. 本儲存庫根目錄已是完整靜態網站，不需設定建置指令或 Root Directory。
3. Zeabur 偵測到根目錄的 `index.html` 後，會以靜態網站模式提供服務。
4. 先使用 Zeabur 產生的測試網址驗證 `/` 與 `/inventory/`，確認後再另外處理正式網域。

`_headers` 提供安全標頭；`_redirects` 會把 `/inventory` 導向 `/inventory/`，確保相對資源正常載入。

## 第三方元件

庫存工具使用 SheetJS Community Edition 0.20.3 讀寫 Excel。授權全文位於 `inventory/assets/SHEETJS-LICENSE.txt`。
