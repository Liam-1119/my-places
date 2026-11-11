# 我的地點

貼上 Google Map 連結 → 自動取得座標、名稱，並分到「城市 / 區」，顯示在真正的地圖上。

## 部署（Vercel，免費，約 5 分鐘）

1. 到 github.com 註冊帳號 → 右上角「+」→ New repository，取名 `my-places`。
2. 在新 repository 頁面按「uploading an existing file」，把這個資料夾裡的**所有檔案與 `api` 資料夾**拖進去 → Commit changes。
3. 到 vercel.com 用 GitHub 登入 → Add New → Project → 選 `my-places` → Deploy（不用改任何設定）。
4. 部署完成會給你一個網址，用手機打開即可。

## 加到手機主畫面

- Android（Chrome）：選單 →「安裝應用程式」。安裝後，在 Google Map 按「分享」，清單裡會出現「我的地點」，一點就自動加入。
- iPhone（Safari）：分享 →「加入主畫面」。在 Google Map 複製連結後，打開 App 按「貼上」。

## 注意

- 資料存在手機瀏覽器本機；換手機請用「資料庫 → 複製備份 / 匯入備份」。
- 區的判斷來自 OpenStreetMap，偶爾和你習慣的分法不同，可以按「改分類」修正。
- 少數連結 Google 不給座標，會顯示解析失敗，換用「分享 → 複製連結」再貼一次。
