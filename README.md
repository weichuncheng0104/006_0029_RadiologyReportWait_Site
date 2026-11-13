# 放射科報告預計等候時間公告表

- 前台：https://weichuncheng0104.github.io/006_0029_RadiologyReportWait_Site/
- 後台：前台右上角「後台」→ 輸入密碼 → 調整週數 → 儲存（約 1 分鐘後前台更新）

## 如何取得 GitHub Token（每個瀏覽器只需設定一次）

1. 登入 GitHub → 右上頭像 → **Settings** → 左側最下 **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. Token name：例如 `RadiologyReportWait-admin`；Expiration：建議 1 年
3. Repository access：**Only select repositories** → 選 `006_0029_RadiologyReportWait_Site`
4. Permissions → Repository permissions → **Contents：Read and write**（其他維持預設）
5. 按 **Generate token**，複製 `github_pat_` 開頭的字串，貼到後台的 Token 欄位

Token 只存在你這台電腦的這個瀏覽器（localStorage），不會上傳到網站。

## 撤銷 / 更換 Token

GitHub → Settings → Developer settings → Fine-grained tokens → 找到該 token → **Delete**。之後在後台按「更換 Token」貼上新的即可。

## 說明

- 後台密碼只防一般誤入；真正的寫入權限由上述 Token 控管，沒有 Token 無法修改任何內容。
- 資料檔為 `data.json`；如需增刪類別，直接編輯此檔（`weeks` 只能是 1、2、3、4）。
- 測試：`node --test`（Node 18+）。
