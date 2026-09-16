# 翔仔居家公司工具

這是翔仔居家的純靜態公司工具入口。

- `/`：公司工具首頁。
- `/inventory/`：期初期末庫存資料整理。
- `/cost-analysis/`：A、B庫存成本稽核分析；在瀏覽器內整合八類 Excel 來源，比對 A 庫存推算耗用、B 淨銷售／跨體系成本與 C 非銷售調整。
- `/supplier-reconciliation/`：財務供應商對帳比對；在瀏覽器內按月比對 ERP 收貨單與供應商對帳報表，支援次月補收、前期認列扣抵及上林反向跨月追蹤，並輸出含兩種跨月台帳的九頁籤 Excel。跨月台帳會依供應商自動保存於目前瀏覽器的 IndexedDB、同月份重跑覆蓋且最多保留24個月；原始 Excel 不保存，換機仍可用結果 Excel 復原。
- `/procurement-planning/`：庫存採購規劃正式流程；原始 Excel 留在瀏覽器，固定 Google 來源唯讀取得，產生分供應商採購／寄庫建議、人工回匯二次覆核、付款月份、集中額度台帳、核准摘要郵件與 ERP 採購檔。
- `/store-transfer/`：門市週補貨與調撥；沿用主採購工具的公司Google OAuth、商品主檔、整體行銷策略及版本化門市庫存規則，庫存、銷售及期間調撥仍在瀏覽器本機運算。星期五／星期一遇公司不作業日會自動提前／順延；B3只認列來源單號＋ERP品號配對成功且去重的總倉代出，例外會明列待人工確認。結果分為一般必要補貨、單人被套前2名花色建議備貨、活動／贈品、提袋耗材及獨立缺貨未配；門市確認量與總部核准量會即時換算調撥後可售至，改量必填原因。門市在鎖定前可撤回重填；總部可看六店狀態、逐店產生ERP並依`等待門市→總部覆核→已核准→ERP皆完成→本週完成`關閉批次。S品總倉5件內先依14／42／84天周轉保留，提袋累積至少4個可信週次後才以100個整箱建議。門市展示與最低庫存規則可依商品主檔的商品大類、尺寸屬性及品項關鍵字由管理前台直接新增；高優先序專屬規則先於通用規則套用，商品主檔分類為主且既有明確品項名稱只作備援。週調撥輸入沿用主採購工具的SheetJS 0.20.3讀取器，ERP輸出則保留樣式元件，避免舊版讀取器對ERP大型工作表產生`Invalid array length`。近12週銷售仍建議按月拆分、每月一份，工具採逐份輕量讀取；匯入前會檢查`.xlsx`內工作表的實際展開大小，超過瀏覽器安全範圍時會先提示應拆成幾份，使用者可多選後由系統合併計算。從週調撥工具進入規則管理時，麵包屑與返回按鈕會回到週調撥工具。

## 庫存工具會做什麼

使用者可在頁面選擇 `.xlsx`，依品名分類為正常商品、排除項目與待人工確認，並下載包含四張工作表的新 Excel。

同事版操作手冊原始文件位於 `inventory/操作手冊.md`；前台已依公司工具 CIS 放在主要步驟之後、正式操作區之前，以「重點摘要＋可展開細節」呈現。

三張明細表會在「實際庫存成本額」後新增「實際庫存進貨額」。若來源表同時有「實際庫存」與「進貨價」，每列會用這兩欄相乘並在最後合計；工具會依欄名找到實際位置，因此新增欄位造成欄號位移時仍能引用正確欄位。若來源表缺少「進貨價」，新欄與合計列會明確標示未辨識，不會猜價格。

所有同事都會使用 Cloudflare D1 中的公司集中規則。`/inventory/` 與 `/cost-analysis/` 都會在「開啟頁面」及每次按「開始分析」前，透過同源的 `/api/rules` 再取最新版；若規則服務無法使用，會直接禁止分析，不會偷偷改用舊規則。`/supplier-reconciliation/` 不需呼叫規則 API，商品與金額只在瀏覽器內比對。

`/procurement-planning/` 依「先確認營收與額度、再匯入資料計算、最後回匯核准」排列；第一區固定顯示關鍵金額，通路與計算欄位可展開。銷售需求採「銷貨＋訂貨＋退貨＋退訂、取貨只用於辨識總倉代出」；SKU近期6／12週模型為主，類別模型只做季節需求池校正。季節模型正式版由Google Drive自動取得；每6個月到期時，前台才逐份讀取近三年歷史銷售、交易層級去重並建立草稿，由採購核准者發布正式版及寄送摘要，本機快取與手動選檔作備援。採購需求分成總部與逐店需求，各店先扣自己的現有庫存，再從加總需求扣總部可用庫存及未到貨；通路營收預估會調整各通路需求。月初依熱銷70%、穩定50%、低銷0%分批釋放，月中與月底依最新缺口重算；寬沐營收45%只另列管理目標與差額，不自動灌入SKU建議。上林固定28天檢視並獨立分頁；力榮逐品號採0或10的倍數；凱信達、歐必斯、一次性代工與總部贈品排除一般自動採購。國外供應商只有在正常到貨／下次補貨範圍跨入年度春節停工區間時，才另加45～60天備貨（預設53天）；前台與Excel會分開顯示受影響SKU、額外數量及金額，而最後建議金額已包含該額外額度。計算完成後可逐家勾選供應商，預設主要名單為普優瑪寢具有限公司、力榮、上林、潤泰羽絨、泰能脊康；名單可在規則管理增減，未列入或臨時辨識到的廠商自動歸入其它。貨品狀態空白不再等同停產，工具會保留試算建議量並標示待人工確認；第一次回匯必須明確填量與原因，完成二次確認後才能核准。明確標示下架、停產或品名結尾`(S)`者仍維持硬性阻擋。前台即時重算所選範圍的採購金額、付款與額度，Excel只輸出所選供應商並保留稽核與核心規則頁；採購明細只保留03A～03D供應商頁籤，不再重複輸出02明細頁。採購報表只保留總部、門市系統需求與加總公式，不另設人工需求欄，並以「系統建議採購後可售至」及「人工確認後可售至」區分兩種數量情境。匯出Excel不啟用工作表密碼保護，所有欄位可直接編輯，但回匯時仍會重新檢查人工量、調整原因、採購單位與核准規則；第一次回匯有阻擋時只在前台列出錯誤，不產生二次覆核報表。`04A_普優瑪寄庫建議`維持單一頁籤，依天絲／長絨棉／無尺寸、花色或同品項、床包／被套／枕套三級排列，並顯示中類及大類小計。供應商、主要顯示名單、國外春節停工備貨、寄庫、採購單位、門市庫存與黑名單集中在 `/procurement-planning/rules-admin/`，由採購核准者維護；一般備貨公式維持程式內建。中性情境同時顯示寬承認列營收與寬承＋寬沐終端通路預估，成本率只使用寬承認列營收；整月額度與目前已釋放額度分開顯示。固定 Google 來源按鈕會顯示載入中、四項來源各自結果及重新取得狀態；前台把自動來源與本次必要人工匯入分成兩組，五個自動來源卡片都可另開原始Google來源，普優瑪及力榮寄庫表皆為線上自動取得並可手動備援。第一次回匯只在下載本批報表後開放，會重算可售至、AI判斷、規則阻擋、付款月份與額度；舊版二次覆核檔會明確拒絕。第二次回匯須逐列明確確認，通過後才可送待核准。只有正式核准後才寫入採購承諾、建立可重送的電子郵件通知並開放ERP檔案；ERP輸出固定為單一`通用貨品數量`頁籤及八欄原始匯入格式，不套採購報表CIS。完成ERP開單後只轉換互斥狀態，不重複占額。完整規格與尚待逐步擴充的門市展示、B3及耗材流程見 [`procurement-planning/NEXT_PHASE.md`](procurement-planning/NEXT_PHASE.md)。

- `/inventory/`：一般工具頁，可查看及下載目前規則，不能修改。
- `/inventory/rules-admin/`：規則管理頁；以公司 Google 帳號登入，只允許指定管理者。
- 管理頁可新增、刪除、匯入及匯出 JSON；發布時有版本衝突保護。

來源 Excel 不會被改寫。期初期末庫存資料整理會把排除資料保留在「排除項目」，庫存成本分析則會在「04_來源檢查」列出各報表排除前後的列數、數量、來源金額與逐列排除原因，方便稽核。

## 資料安全

Cloudflare Worker 保存集中分類規則，以及採購流程必要的批次編號、供應商摘要、金額、互斥狀態、付款月份、核准事件與通知稽核；沒有 Excel 或檔案上傳 API，也不保存檔名或逐列商品內容。通知紀錄預設12個月後由每日排程刪除。

Excel 的讀取、分類、統計與輸出全部在使用者目前的瀏覽器分頁或同源背景Worker完成，不會傳送到網站伺服器；只有季節模型草稿與正式輸出會另存到指定公司Google Drive資料夾。採購頁的 CSP 只額外允許 Google Identity、Drive、Sheets、Gmail、同源背景Worker與同源 API；OAuth access token 只留在分頁記憶體，不進 D1、localStorage 或伺服器日誌。採購工具另使用本機保存的 `xlsx-js-style` 產生帶有CIS底色、欄位提示與頁面間距的Excel，授權全文位於 `procurement-planning/assets/XLSX-JS-STYLE-LICENSE.txt`，不會從外部CDN載入。

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

`_headers` 提供安全標頭。`/inventory/` 與 `/cost-analysis/` 使用同源集中規則服務；`/procurement-planning/` 只連接同源流程 API 與白名單 Google API；`/supplier-reconciliation/` 不建立對外連線。Excel 處理仍完全在瀏覽器本機完成。

## 第三方元件

庫存工具使用 SheetJS Community Edition 0.20.3 讀寫 Excel。授權全文位於 `inventory/assets/SHEETJS-LICENSE.txt`。
