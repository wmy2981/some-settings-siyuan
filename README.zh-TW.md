[English](README.md) | [简体中文](README.zh-CN.md)

# 一些設定

> 一批**可獨立啟停**的思源增強功能：每個設定項目都能單獨啟用或停用。

歡迎回饋問題、建議新功能，請[建立 Issue](https://github.com/wmy2981/some-settings-siyuan/issues/new/choose)。

## 功能清單

分類依功能作用到的思源原生功能劃分，與設定面板裡的頁籤一一對應。

### 人工智能

* DeepSeek 餘額顯示
* 智能體按 Enter 傳送
* 隱藏智能體新會話的推薦操作
* 智能體思考標題固定在頂部
* 智能體工具呼叫顯示細節
* 智能體思考翻譯

### 編輯器

* 程式碼區塊語言不記憶
* 日記直接建立
* 新建文件到固定位置
* 外部連結跳轉前確認
* 資源檔案選單顯示檔案大小與中繼資料
* 斜線命令新建檔案到 assets
* 用懸浮視窗取代錄音提示
* 標題圖示顯示層級
* 行內程式碼複製按鈕
* 隱藏選取文字工具列
* 「引用導覽路徑」外掛導引

### 文件樹

* 固定首次新增的文件圖示
* 書籤開啟筆記時跳到上次位置
* 文件樹已開啟筆記強調色
* 文件樹標題呈現行內 Markdown
* 頁籤標題呈現行內 Markdown
* 自動收起閒置頁籤
* 大綱顯示層級
* 行動端文件樹標題字型大小還原至 3.8.9

### 外觀

* Modal 遮罩模糊
* 離開應用程式遮罩始終模糊
* 桌面端命令面板精簡
* 行動端懸浮 dock 欄高斯模糊
* 行動端欄體動畫最佳化
* 行動端加大候選浮層高度
* 行動端常駐顯示立即同步
* 行動端下拉選單使用思源原生樣式
* 行動端長按選單補上文字
* 行動端區塊標保持顯示
* 隱藏行動端離開應用程式按鈕
* 離開應用程式前彈出確認視窗
* 桌面端 F12 開關開發人員工具

### 連線

* 斷線面板立即重新連線按鈕
* 斷線後自動重新連線

### 設定

* 阿里雲 OSS 儲存桶使用資料
* 程式碼片段編輯區突顯
* 主控台日誌檢視器

### 市集

* 市集套件自訂圖示
* 依作者封鎖市集套件
* 隱藏市集已下載頁的捐贈按鈕

### 外掛本身

* 詳細日誌輸出
* 顯示不可用的設定
* 設定面板搜尋
* 清除此外掛設定
* 關於此外掛
* 外掛設定匯入匯出

## 安裝

1. **思源市集** —— 開啟 **設定 → 市集**，找到「一些設定」直接安裝；後續更新也走這裡。
2. **發行版下載** —— 從 [Releases](https://github.com/wmy2981/some-settings-siyuan/releases) 下載
   `package.zip`，解壓縮到 `<工作空間>/data/plugins/some-settings-siyuan/`，讓 `plugin.json` 直接放在這個目錄下，
   然後重新啟動思源。
3. **自行編譯** —— 取得儲存庫後 `npm install`，再 `npm run build`（需要 Node 24 以上）；建置產物裡有
   `package.zip` 與扁平的 `dist/`，把其中任一個解壓縮到同一個目錄即可。

然後開啟 **設定 → 市集 → 已下載 → 一些設定 → 設定**，這是唯一的入口 —— 外掛不在頂欄、狀態列、
停靠欄註冊任何按鈕。

## 進階用法

在自己的機器上覆蓋功能宣告與介面文案，參見[使用者層級宣告補丁：`.patch.yml`](docs/patch.zh-TW.md)。

## 市集趨勢圖表

![市集趨勢圖表](https://siyuan-bazaar-stats-graph.sr1.cc.cd/api/chart/wmy2981/some-settings-siyuan?metrics=downloads,rating,ratings&range=all&area=true&lang=zh)

## 開發

需要 Node.js 24 以上，複製倉庫後按需執行：

```bash
npm ci              # 安裝依賴
npm run dev         # 監看原始碼，把 index.js / index.css / i18n 直接寫到倉庫根目錄
npm run build       # 校驗功能宣告後打包出 dist/ 與 package.zip
npm run check       # 只校驗功能宣告與三份語言檔
npm run typecheck   # TypeScript 型別檢查
npm run lint        # ESLint
npm run format      # dprint 格式化（format:check 只檢查不寫入）
npm test            # 單元測試（vitest）
```

## 授權條款

[AGPL-3.0-or-later](./LICENSE)

隨外掛分發的第三方內容與建置期工具見[第三方聲明](./THIRD_PARTY_NOTICES.md)。
