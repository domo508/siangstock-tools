# 翔仔居家公司工具

這是翔仔居家的純靜態公司工具入口。

- `/`：公司工具首頁。
- `/inventory/`：期初期末庫存資料整理。
- `/cost-analysis/`：A、B庫存成本稽核分析；在瀏覽器內整合八類 Excel 來源，比對 A 庫存推算耗用、B 淨銷售／跨體系成本與 C 非銷售調整。
- `/supplier-reconciliation/`：財務供應商對帳比對；在瀏覽器內按月比對 ERP 收貨單與供應商對帳報表，支援次月補收、前期認列扣抵及上林反向跨月追蹤，並輸出含兩種跨月台帳的九頁籤 Excel。跨月台帳會依供應商自動保存於目前瀏覽器的 IndexedDB、同月份重跑覆蓋且最多保留24個月；原始 Excel 不保存，換機仍可用結果 Excel 復原。

## 庫存工具會做什麼

使用者可在頁面選擇 `.xlsx`，依品名分類為正常商品、排除項目與待人工確認，並下載包含四張工作表的新 Excel。

同事版操作手冊原始文件位於 `inventory/操作手冊.md`；前台已依公司工具 CIS 放在主要步驟之後、正式操作區之前，以「重點摘要＋可展開細節」呈現。

三張明細表會在「實際庫存成本額」後新增「實際庫存進貨額」。若來源表同時有「實際庫存」與「進貨價」，每列會用這兩欄相乘並在最後合計；工具會依欄名找到實際位置，因此新增欄位造成欄號位移時仍能引用正確欄位。若來源表缺少「進貨價」，新欄與合計列會明確標示未辨識，不會猜價格。

所有同事都會使用 Cloudflare D1 中的公司集中規則。`/inventory/` 與 `/cost-analysis/` 都會在「開啟頁面」及每次按「開始分析」前，透過同源的 `/api/rules` 再取最新版；若規則服務無法使用，會直接禁止分析，不會偷偷改用舊規則。`/supplier-reconciliation/` 不需呼叫規則 API，商品與金額只在瀏覽器內比對。

- `/inventory/`：一般工具頁，可查看及下載目前規則，不能修改。
- `/inventory/rules-admin/`：規則管理頁；以公司 Google 帳號登入，只允許指定管理者。
- 管理頁可新增、刪除、匯入及匯出 JSON；發布時有版本衝突保護。

來源 Excel 不會被改寫。期初期末庫存資料整理會把排除資料保留在「排除項目」，庫存成本分析則會在「04_來源檢查」列出各報表排除前後的列數、數量、來源金額與逐列排除原因，方便稽核。

## 資料安全

這個儲存庫的 Cloudflare Worker 只保存「分類規則文字、版本、更新時間、管理者」；沒有 Excel 或檔案上傳 API。

Excel 的讀取、分類、統計與輸出全部在使用者目前的瀏覽器分頁內完成，不會傳送到網站伺服器。Content Security Policy 的 `connect-src 'self'` 只允許頁面讀取同網域規則 API，不允許連往其他網域。Worker 不記錄 request body，也不儲存 Excel、檔名、列資料或輸出資料。

請勿將真實庫存 Excel、測試輸出、客戶資料、密碼、API key 或環境設定提交到這個公開儲存庫。

## 本機預覽

在儲存庫根目錄啟動任一靜態檔案伺服器，例如：

```bash
python3 -m http.server 8765
```

純靜態預覽無法取得集中規則，因此會如預期禁止分析。完整本機驗證請先安裝 Node.js 依賴，套用本機 D1 migration，再啟動 Wrangler：

```bash
cd cloudflare
pnpm install
pnpm cf:migrate:local
pnpm cf:dev
```

接著開啟 Wrangler 顯示的網址。正式站仍由 Zeabur 提供靜態檔，只有 `/api/rules*` 由 Cloudflare Worker 處理。

## 測試

```bash
cd cloudflare
pnpm check
pnpm test
```

測試涵蓋嚴格 JSON schema、未設定 Access 時拒絕管理寫入、無上傳 API、規則 API `no-store`、API 失敗禁止使用舊規則，以及既有分類、白名單、成本分析八類來源共用排除規則、四張工作表、三張合計列與「實際庫存 × 進貨價」公式。

## Cloudflare 部署與保護

Cloudflare 相關程式全部放在 `cloudflare/` 子目錄，避免 Zeabur 把網站根目錄誤判為 Node 專案；公司首頁與 `/inventory/` 仍是原本的純靜態站。

1. 建立 D1 `inventory-rules`，把實際 database ID 填入 `cloudflare/wrangler.jsonc`。
2. 執行 `wrangler d1 migrations apply inventory-rules --remote`，建立目前規則與歷史表。
3. 先部署到 `workers.dev` 測試 GET；此時 `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` 留空，管理 PUT 會 fail closed。
4. 在 Cloudflare Zero Trust 建立公司 Google Identity Provider。
5. 建立 Self-hosted Access application，保護 `siangstock.com/inventory/rules-admin/*` 與 `siangstock.com/api/rules/admin*`，規則採預設拒絕，只 Allow：
   - `evan0728@siangapato.com.tw`
   - `siang01@siangapato.com.tw`
6. 把 Access team domain 與 application AUD 填入 Worker 變數。Worker 本身還會驗證 Access JWT 的簽章、issuer、AUD 及 email 白名單；不能只靠前端或 Cookie。
7. 最後只把 Worker route 接到 `siangstock.com/api/rules*`，不攔截首頁或其他路徑。

### 目前部署狀態

- D1 與 Worker 已部署，正式同源 GET/HEAD 可讀取集中規則 v5。
- 正式 route 僅為 `siangstock.com/api/rules*`，不攔截首頁、庫存靜態頁或其他路徑。
- Cloudflare Zero Trust Free 已啟用，方案顯示每月 0 美元、最多 50 位使用者；若超過免費額度，Cloudflare 仍可能向帳戶既有付款方式收費，請由帳戶管理者留意用量。
- Access 使用 Google Workspace IdP，精確保護 `/inventory/rules-admin/*` 與 `/api/rules/admin*`。政策採預設拒絕，只允許上列兩個管理者信箱。
- Worker 會再次驗證 Access JWT 的簽章、issuer、AUD 與 email 白名單；若 Access 設定遺失或驗證失敗，管理 PUT 會拒絕，不會退回公開寫入。

D1 的 `rules_current` 只保留一份現行規則；每次更新會由資料庫 trigger 原子寫入 `rules_history`。更新 API 需帶 `expectedVersion`，若版本已改會回覆 409，避免後存的人覆蓋先存的人。

### 回復方式

- 程式：把 GitHub 功能分支回復到部署前提交，Zeabur 會回到舊靜態頁。
- API：移除 `siangstock.com/api/rules*` Worker route 即可停止攔截；不需修改現有 A 記錄。
- 規則：從 `rules_history` 取出要回復的 payload，再以目前版本透過管理 API 發布，保留完整歷史。

## 部署到 Zeabur

1. 在 Zeabur 新增 GitHub Service，選擇這個儲存庫。
2. 本儲存庫根目錄已是完整靜態網站，不需設定建置指令或 Root Directory。
3. Zeabur 偵測到根目錄的 `index.html` 後，會以靜態網站模式提供服務。
4. 先使用 Zeabur 產生的測試網址驗證 `/` 與 `/inventory/`，確認後再另外處理正式網域。

`_headers` 提供安全標頭。`/inventory/` 與 `/cost-analysis/` 使用同源集中規則服務；`/supplier-reconciliation/` 不建立任何對外連線；Excel 處理仍完全在瀏覽器本機完成。

## 第三方元件

庫存工具使用 SheetJS Community Edition 0.20.3 讀寫 Excel。授權全文位於 `inventory/assets/SHEETJS-LICENSE.txt`。
