# MarkLens

[English](./README.md) | 繁體中文

在 Chrome / Edge 直接閱讀 `.md` 檔案的擴充功能。功能參考 [md-reader 2.x](https://github.com/md-reader/md-reader)（MIT），程式碼全部重新撰寫，目標是**可稽核、無遠端依賴、無建置流程**。

## 安裝

1. 開啟 `chrome://extensions`（Edge：`edge://extensions`），打開右上角「開發人員模式」。
2. 點「載入未封裝項目」，選擇本目錄（含 `manifest.json` 的資料夾）。
3. 要看本機檔案：在擴充功能「詳細資料」開啟 **「允許存取檔案網址」**。
4. 修改程式碼後，在擴充功能頁按重新載入圖示即可生效。

## 功能

| 類別 | 功能 |
|---|---|
| 頁面 | 接管 `http(s)://` 與 `file://` 下的 `.md` `.markdown` `.mkd` `.mdx`；只在瀏覽器以純文字顯示時接管 |
| 工具列 | 頂部固定：目錄、全部摺疊、全部展開、文字寬度、原始文字／返回閱讀、回到頂部 |
| 版面 | 文字欄寬度：滿版／1600／1200／960／自訂；表格與程式碼可超出文字欄，依內容撐開到版面邊緣；字體大小、行高可調；閱讀進度條 |
| 目錄 | 側邊目錄（頂端 « 收合）、目前章節高亮、標題搜尋、層級過濾、拖拉調整寬度、長標題兩行顯示、標示已摺疊段落、字數與閱讀時間 |
| 摺疊 | 標題左側 ▾ 摺疊段落；全部摺疊會從第一個有兩個以上標題的層級開始；摺疊內容仍可被 Ctrl+F 搜尋，命中自動展開 |
| 表格 | **拖拉欄寬**（雙擊把手自動適應）、**點表頭排序**（數字／千分位／容量單位／日期／中文，空值置底，第三次點擊恢復原順序）、篩選列（5 列以上）、複製為 TSV（可直接貼 Excel）、換行切換、全螢幕（表頭固定）；工具列滑過表格才出現 |
| 語法 | CommonMark + GFM、任務清單、腳註、`==螢光==`、GitHub Alert（`> [!NOTE]` 等）、front matter 可收合顯示 |
| 程式碼 | highlight.js 語法高亮（常用語言）、語言標籤、複製、單一區塊換行切換 |
| 圖片 | 延遲載入、點擊放大（Esc 關閉） |
| 主題 | 跟隨系統／淺色／深色 |
| 勾選寫回 | 本機檔案的任務清單直接點勾選框，`[ ]`／`[x]` 立即存回原檔，不必開編輯器。支援巢狀、有序清單與引用區塊；程式碼區塊內的不會被改到。提示列可復原；檔案已被其他地方修改時拒絕寫入；保留 CRLF 與 BOM。需先授權資料夾一次（見下方） |
| 自動更新 | 本機檔案每秒檢查，內容有變才重新渲染；保留捲動位置、摺疊狀態、表格排序／欄寬／篩選 |
| 其他 | 記住每個檔案的閱讀位置、列印樣式、相對路徑 `.md` 連結直接以閱讀器開啟 |

### 勾選寫回

1. 在本機 `.md` 點任一勾選框。第一次會請你授權資料夾：選較上層的資料夾（例如 `D:\Projects`），底下所有 `.md` 都能寫回。
2. 之後點擊即存檔，提示列上按「復原」可還原。
3. Chrome 重新啟動後可能需要再確認一次權限；在 Chrome 的詢問中選「每次造訪時允許」即可免除。

資料夾授權保存在擴充功能自己的空間，一般網頁（包括本機 HTML 檔）無法取得。可從 popup →「管理授權資料夾」查看或移除。

### 分頁獨立與全域設定

- **只影響目前分頁**：目錄開關、目錄寬度、文字寬度、原始文字、摺疊。重新整理後保留，關閉分頁即清除；方便多開分頁對照。
- **即時同步所有分頁**：主題、字體大小、行高。
- **popup 其餘設定**：是新分頁的預設值，已開的分頁重新整理後才套用。拖拉目錄寬度也會順便記成預設值。

### 快捷鍵

閱讀頁內單鍵（輸入框有焦點時不觸發）：

| 按鍵 | 動作 |
|---|---|
| `t` | 顯示／收合目錄 |
| `r` | 原始文字／返回閱讀 |
| `w` | 切換文字寬度 |
| `[` / `]` | 全部摺疊／全部展開 |

瀏覽器層級（可在 `chrome://extensions/shortcuts` 修改）：

| 按鍵 | 動作 |
|---|---|
| `Alt+Shift+B` | 顯示／收合目錄（目前分頁） |
| `Alt+Shift+C` | 切換文字寬度（目前分頁） |
| `Alt+Shift+R` | 原始文字／返回閱讀（目前分頁） |
| `Alt+Shift+T` | 切換主題（所有分頁） |

## 安全設計

- **HTML 白名單過濾**（`src/content/sanitize.js`）：允許 `<details>`、`<kbd>`、表格等常用標籤；移除 `<script>`、`<iframe>`、`<svg>`、所有事件屬性、`style`（表格對齊除外），以及 `javascript:`、`data:`（圖片除外）等連結。
- **最小權限**：只要求 `storage`；content script 只匹配 Markdown 副檔名的網址，不要求「讀取所有網站」。
- **本機檔案讀取**：由 background 代讀，且只允許讀取發出請求的那個頁面本身的網址。
- **寫入**：只在點擊任務勾選框時發生，背景程式確認檔案內容與頁面一致後，只修改那一行。哪些勾選框可寫回由 Markdown 解析器決定，並帶有每次渲染隨機產生的 nonce，文件內嵌的 HTML 無法偽造。
- **零遠端資源**：第三方程式庫固定版本放在 `vendor/`，執行時不連網、不自動更新。

## 目錄結構

```
manifest.json
src/
  background.js          快捷鍵、代讀本機檔案
  shared/settings.js     設定預設值與存取（三端共用）
  shared/roots.js        已授權資料夾（僅擴充功能內部使用）
  grant/                 資料夾授權頁
  content/
    util.js              小工具、讀取原始內容
    fonts.js             程式碼區塊中英字寬對齊
    sanitize.js          HTML 白名單過濾
    markdown.js          markdown-it 設定、==mark==、Alert、front matter
    enhance.js           標題錨點與摺疊、行內內容歸組、任務清單、程式碼區塊、圖片、字數
    table.js             表格拖拉欄寬、排序、篩選、複製、全螢幕、狀態保存與還原
    toc.js               側邊目錄
    main.js              進入點：版面組裝、工具列、快捷鍵、分頁狀態、自動更新、勾選寫回
    content.css          所有樣式（限定在 html.marklens 底下）
  popup/                 設定面板
vendor/                  第三方程式庫（版本見 VERSIONS.md，授權見 licenses/）
scripts/vendor.mjs       升級 vendor 用的腳本
test/                    端對端測試與測試文件
package.json             僅供開發工具使用（測試、更新 vendor），擴充功能本身不需建置
```

### 程式碼區塊中的罫線表格

`┌─┬─┐` 這類文字圖表，要在中文剛好是英數兩倍寬時才會對齊。系統等寬字型（Consolas、Menlo…）沒有中文字，瀏覽器會改用寬度不同的中文字型，於是錯位。MarkLens 會量測實際字寬，只針對中文字元把系統中文字型等比例縮放（`@font-face` 的 `size-adjust`），不必安裝任何字型就能對齊；代價是程式碼中的中文看起來略大。想要最好看的效果，可安裝[更紗黑體（Sarasa Gothic）](https://github.com/be5invis/Sarasa-Gothic)，MarkLens 偵測到 **Sarasa Mono TC** 會自動使用。

完整下載有數百 MB，但只需要其中幾個檔案：

1. 到 [Releases 頁面](https://github.com/be5invis/Sarasa-Gothic/releases)，下載 **Single Family TTF Package → Mono → zip**（選 *Download*；*Unhinted* 適合高解析度螢幕與 macOS）。
2. 解壓縮後只安裝 TC（繁體中文）的檔案：

   | 檔案 | 用途 |
   |---|---|
   | `SarasaMonoTC-Regular.ttf` | 一般文字（必裝） |
   | `SarasaMonoTC-Bold.ttf` | 粗體（必裝） |
   | `SarasaMonoTC-Italic.ttf` | 程式碼註解以斜體顯示；未安裝時瀏覽器會把正體字直接斜推 |
   | `SarasaMonoTC-BoldItalic.ttf` | 可不裝，很少用到 |

3. 選取檔案 → 右鍵 →「為所有使用者安裝」，再完全重啟 Chrome。Chrome 關閉視窗後仍會在背景執行，請在網址列開啟 `chrome://restart`，而不是只關掉視窗。

## 升級第三方程式庫

修改 `scripts/vendor.mjs` 裡的版本表，然後執行：

```bash
npm run vendor
```

## 測試

```bash
npm install                          # 只安裝 playwright（開發用）
npx playwright install chromium      # 第一次需要下載瀏覽器
npm test
```

測試以 Chromium 載入擴充功能，開啟本機與 http 的測試文件（`test/fixtures/sample.md`），涵蓋：

- 渲染：GFM、任務清單（緊湊／鬆散清單）、腳註、Alert、front matter、程式碼高亮
- 安全：script、事件屬性、`javascript:` 連結、style 屬性過濾
- 版面：文字欄寬度、寬表格超出文字欄、窄螢幕抽屜目錄
- 表格：排序（數字／容量／日期）、拖拉欄寬、篩選、自動更新後狀態保留
- 摺疊：全部摺疊／展開、Ctrl+F 命中展開、目錄標記
- 分頁：目錄與寬度只影響目前分頁、外觀設定即時同步、新分頁套用預設值
- 勾選寫回：寫入正確的行（含 front matter）、引用區塊與有序清單、復原、衝突偵測、保留 CRLF 與 BOM、未授權、關閉功能。資料夾授權以瀏覽器私有檔案系統（OPFS）模擬，資料夾選擇視窗需手動測試
- popup 設定寫入

截圖輸出到 `SHOT_DIR` 環境變數指定的目錄（預設為系統暫存目錄）。

## 開發計畫

- **Mermaid**：文件中有 mermaid 區塊時才載入
- **大檔效能**：1MB 以上的文件延後渲染畫面外內容、程式碼高亮改為捲到才處理

## 授權

MIT。第三方程式庫各自的授權見 `vendor/licenses/`。
