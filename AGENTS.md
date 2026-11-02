# 翔仔居家公司工具：專案工作指引

## 工作區與文件

- 以目前專案 checkout 為工作區。開始工作時確認 repository、branch、dirty status 與正式部署來源；保留其他工作中的變更。
- 開始此專案工作時，讀取 `.local-context/skills/siangstock-company-tools/SKILL.md` 及其 `references/project.md`；涉及 UI、視覺或導覽，再讀 `references/cis.md`。這些是本專案集中維護的規範，不能假設全域安裝的 skill 已同步更新。
- 若本機集中區不存在，先讀全域 `siangstock-company-tools` 技能並告知本機文件缺漏，不憑空重建歷史。
- 共用現況更新根目錄 `README.md`；採購需求、決策及待辦更新 `procurement-planning/NEXT_PHASE.md`；其他工具文件放在各自工具目錄。共用技能規範更新本專案 `.local-context/skills/siangstock-company-tools/`。
- 舊交接與舊版文件集中在 `.local-context/history/`，僅供歷史查證。具體需求仍須按需回讀原對話、附件及最新程式／測試；不要以歷史副本取代現況。
- `.local-context/` 不納入 Git，不放進網站資產或部署封裝。不得提交真實 Excel、輸出、公司敏感資料、憑證或 token。

## 保護與驗收

- 維持繁體中文、現行 CIS、原始 Excel 在瀏覽器本機處理且不改原檔。
- 不放寬 Cloudflare Access、JWT、CSP、fail-closed、集中規則或版本衝突保護。
- 功能變更執行完整型別檢查與全套測試；同步執行版本、版本資訊、HTML 資產 query 與各入口。版本不一致時停止關鍵操作，顯示「重新載入最新版」。
- 品號、列數、件數、金額、狀態與 Excel 輸出須守恆；涵蓋未改量、人工異動、明確歸零、舊資料相容及真實格式往返。依影響核對前台、覆核、核准摘要、Excel／ERP、歷史台帳及其他工具串接。
- 修改、commit、push、Cloudflare、Zeabur、DNS 與正式部署各自依使用者當次授權，不因文件集中而取得發布授權。

## 即時操作指引（核心原則）

- 所有公司工具互動主頁、管理／覆核及訪客頁須有依真實狀態與角色更新的「目前狀態、下一步、前往位置」。錯誤與進度就地顯示，不能只集中登入區；無需操作時不催促重做。
- 前往只導航與聚焦，不代按分析、儲存、核准、下載、授權或付費AI，不改業務資料／輸出／權限，不自動重送、不清未保存資料。
- 手機與桌面均可達，不遮欄位、支援鍵盤與動態訊息；版本與fail-closed保護優先。新增或修改工具須依集中SKILL.md規範驗收。
