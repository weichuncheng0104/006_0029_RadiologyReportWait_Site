# 放射科報告預計等候時間公告表

- 前台：https://weichuncheng0104.github.io/006_0029_RadiologyReportWait_Site/
- 後台：前台右上角「後台」→ 輸入密碼 → 調整週數 → 儲存（約 1 分鐘後前台更新）

## 運作方式

- 週數資料在 `data.json`；後台儲存時經 GitHub API 寫回此檔。
- 寫入用的 GitHub fine-grained token（僅限本 repo、Contents 讀寫）以後台密碼加密後存於 `token.enc.json`（PBKDF2-SHA256 600,000 次 → AES-GCM）。輸入正確密碼才能在瀏覽器中解開；解開的 token 只留在該頁記憶體，重新整理即清除。
- 換 token 或換密碼：由管理端重新產生 `token.enc.json` 後推上本 repo。舊 token 請至 GitHub → Settings → Developer settings → Fine-grained tokens 刪除。

## 其他

- 如需增刪類別，直接編輯 `data.json`（`weeks` 只能是 1–5：1＝一週、2＝兩週、3＝三週、4＝四週、5＝四週以上）。
- 測試：`node --test`（Node 18+）。
