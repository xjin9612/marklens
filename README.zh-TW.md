# MarkLens

[![Tests](https://github.com/xjin9612/marklens/actions/workflows/ci.yml/badge.svg)](https://github.com/xjin9612/marklens/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/xjin9612/marklens)](https://github.com/xjin9612/marklens/releases/latest)

[English](./README.md) | 繁體中文

在 Chrome / Edge 直接閱讀 `.md` 檔案的擴充功能。功能參考 [md-reader 2.x](https://github.com/md-reader/md-reader)（MIT），程式碼全部重新撰寫，目標是**可稽核、無遠端依賴、無建置流程**。

![淺色主題：側邊目錄、提示框、任務清單與表格](docs/screenshots/light.zh-TW.png)

![深色主題：依欄位排序的表格與表格工具列，下方是 Mermaid 圖表](docs/screenshots/dark.zh-TW.png)

## 安裝

1. 從[最新 Release](https://github.com/xjin9612/marklens/releases/latest) 下載 `marklens-vX.Y.Z.zip` 並解壓縮（或直接 clone 本 repo）。
2. 開啟 `chrome://extensions`（Edge：`edge://extensions`），打開右上角「開發人員模式」。
3. 點「載入未封裝項目」，選擇解壓縮後的 `marklens-vX.Y.Z` 資料夾（含 `manifest.json` 的資料夾）。
4. 要看本機檔案：在擴充功能「詳細資料」開啟 **「允許存取檔案網址」**。安裝後會自動開啟引導頁帶你完成這一步。

升級時以新版資料夾取代舊的，再到擴充功能頁按重新載入圖示。各版變更見 [CHANGELOG.md](./CHANGELOG.md)。

## 功能

| 類別 | 功能 |
|---|---|
| 頁面 | 接管 `http(s)://` 與 `file://` 下的 `.md` `.markdown` `.mkd` `.mdx`；只在瀏覽器以純文字顯示時接管 |
| 工具列 | 頂部固定：目錄、全部摺疊、全部展開、文字寬度、匯出 HTML、主題、原始文字／返回閱讀、回到頂部 |
| 匯出 | 把目前畫面存成單一 HTML 檔（樣式、圖表與公式字型內嵌，段落全部展開，不含 JavaScript），方便分享給沒裝 MarkLens 的人 |
| 版面 | 文字欄寬度：滿版／1600／1200／960／自訂；表格與程式碼可超出文字欄，依內容撐開到版面邊緣；字體大小、行高可調；閱讀進度條 |
| 目錄 | 側邊目錄（頂端 « 收合）、目前章節高亮、標題搜尋、層級過濾、拖拉調整寬度、長標題兩行顯示、標示已摺疊段落、字數與閱讀時間 |
| 摺疊 | 標題左側 ▾ 摺疊段落；全部摺疊會從第一個有兩個以上標題的層級開始；摺疊內容仍可被 Ctrl+F 搜尋，命中自動展開（約 400KB 以上的大檔為了速度改用一般隱藏，需先展開才搜得到） |
| 表格 | **拖拉欄寬**（雙擊把手自動適應）、**點表頭排序**（數字／千分位／容量單位／日期／中文，空值置底，第三次點擊恢復原順序）、篩選列（5 列以上）、複製為 TSV（可直接貼 Excel）、換行切換、全螢幕（表頭固定）；工具列滑過表格才出現 |
| 語法 | CommonMark + GFM、任務清單、腳註、`==螢光==`、Emoji 短碼（`:tada:`）、GitHub Alert（`> [!NOTE]` 等）、front matter 可收合顯示 |
| 程式碼 | highlight.js 語法高亮（常用語言）、語言標籤、複製、單一區塊換行切換 |
| 圖表 | 本機檔案的 [Mermaid](https://mermaid.js.org/) 流程圖、循序圖等。程式庫約 5MB，只在文件有 mermaid 區塊時才載入；圖表跟隨主題、自動更新時不閃爍，可切回原始碼；語法錯誤會顯示訊息與原始碼。`http(s)://` 頁面不繪製（見安全設計） |
| 數學公式 | 本機檔案的 `$…$`、`$$…$$`、`` $`…`$ `` 與 ` ```math ` 區塊以 [KaTeX](https://katex.org/) 繪製，只在有公式時才載入。`$5 與 $10` 這類金額維持原文。與 Pandoc、GitHub 相同，`$HOME/$USER` 會被當成公式，請放進反引號或寫成 `\$` |
| 圖片 | 延遲載入、點擊放大（Esc 關閉） |
| 主題 | 跟隨系統／淺色／深色，可從工具列、`d` 鍵或 popup 切換，所有分頁同步 |
| 勾選寫回 | 本機檔案的任務清單直接點勾選框，`[ ]`／`[x]` 立即存回原檔，不必開編輯器。支援巢狀、有序清單與引用區塊；程式碼區塊內的不會被改到。提示列可復原；檔案已被其他地方修改時拒絕寫入；保留 CRLF 與 BOM。需先授權資料夾一次（見下方） |
| 自動更新 | 本機檔案每秒檢查，內容有變才重新渲染；保留捲動位置、摺疊狀態、表格排序／欄寬／篩選 |
| 語言 | 介面支援英文與繁體中文，依瀏覽器語言自動切換 |
| 其他 | 外部連結在新分頁開啟（可關閉）、記住每個檔案的閱讀位置、列印樣式、相對路徑 `.md` 連結直接以閱讀器開啟 |

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
| `d` | 切換主題：跟隨系統 → 淺色 → 深色（所有分頁） |
| `[` / `]` | 全部摺疊／全部展開 |

瀏覽器層級（可在 `chrome://extensions/shortcuts` 修改）：

| 按鍵 | 動作 |
|---|---|
| `Alt+Shift+B` | 顯示／收合目錄（目前分頁） |
| `Alt+Shift+C` | 切換文字寬度（目前分頁） |
| `Alt+Shift+R` | 原始文字／返回閱讀（目前分頁） |
| `Alt+Shift+D` | 切換主題（所有分頁） |

## 安全設計

- **HTML 白名單過濾**（`src/content/sanitize.js`）：允許 `<details>`、`<kbd>`、表格等常用標籤；移除 `<script>`、`<iframe>`、`<svg>`、所有事件屬性、`style`（表格對齊除外），以及 `javascript:`、`data:`（圖片除外）等連結。
- **數學公式**：KaTeX 以 `trust: false` 繪製（停用 `\href`、`\url`、`\includegraphics` 與 `\html…` 指令），並限制巨集展開次數；與 Mermaid 相同，程式庫只對 `file://` 頁面開放。
- **不能借用介面**：文件中的 HTML 不能使用 MarkLens 自己的 `ml-` class／id（無法在頁面上蓋出假遮罩或假提示），`name` 屬性只保留給 `<a>`，防止 DOM clobbering。
- **匯出的 HTML** 不含任何 JavaScript，並帶有禁止執行腳本的 CSP，分享出去的檔案可以安心開啟。
- **攻擊樣本測試**：`test/fixtures/security.md` 收錄 60 多種攻擊寫法，測試會渲染後逐一點擊所有連結與圖表節點，任何程式碼執行即失敗。
- **最小權限**：只要求 `storage`；content script 只匹配 Markdown 副檔名的網址，不要求「讀取所有網站」。
- **本機檔案讀取**：由 background 代讀，且只允許讀取發出請求的那個頁面本身的網址。
- **寫入**：只在點擊任務勾選框時發生，背景程式確認檔案內容與頁面一致後，只修改那一行。哪些勾選框可寫回由 Markdown 解析器決定，並帶有每次渲染隨機產生的 nonce，文件內嵌的 HTML 無法偽造。
- **Mermaid**：以 `securityLevel: 'strict'` 繪製（標籤經 DOMPurify 過濾、停用點擊事件）。為了能在需要時才載入，程式庫檔案必須設為網頁可存取；存取範圍只開放給 `file://` 頁面，一般網站無法藉由探測這些檔案得知你裝了 MarkLens，這也是只在本機檔案繪製圖表的原因。
- **零遠端資源**：第三方程式庫固定版本放在 `vendor/`，執行時不連網、不自動更新。

## 目錄結構

```
manifest.json
_locales/                介面文字：en（預設）與 zh_TW
src/
  background.js          快捷鍵、代讀本機檔案
  shared/i18n.js         介面文字（內容在 _locales/）
  shared/settings.js     設定預設值與存取（三端共用）
  shared/roots.js        已授權資料夾（僅擴充功能內部使用）
  welcome/               首次安裝引導頁
  grant/                 資料夾授權頁
  content/
    util.js              小工具、讀取原始內容
    fonts.js             程式碼區塊中英字寬對齊
    sanitize.js          HTML 白名單過濾
    markdown.js          markdown-it 設定、==mark==、Alert、front matter
    enhance.js           標題錨點與摺疊、行內內容歸組、任務清單、程式碼區塊、圖片、字數
    mermaid.js           Mermaid 圖表（依需載入）
    math.js              KaTeX 數學公式（依需載入）
    export.js            匯出目前畫面為單一 HTML 檔
    table.js             表格拖拉欄寬、排序、篩選、複製、全螢幕、狀態保存與還原
    toc.js               側邊目錄
    main.js              進入點：版面組裝、工具列、快捷鍵、分頁狀態、自動更新、勾選寫回
    content.css          所有樣式（限定在 html.marklens 底下）
  popup/                 設定面板
vendor/                  第三方程式庫（版本見 VERSIONS.md，授權見 licenses/）
scripts/vendor.mjs       升級 vendor 用的腳本
scripts/release.mjs      發版輔助：版本檢查、取出 Release 說明、打包
scripts/screenshots.mjs  由 docs/demo.md 重新產生 docs/screenshots/（npm run screenshots）
docs/                    README 截圖與截圖用的示範文件
.github/workflows/       自動測試與自動發布
CHANGELOG.md             版本紀錄（GitHub Release 說明的來源）
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
- 安全：script、事件屬性、`javascript:` 連結、style 屬性過濾；以及 `test/fixtures/security.md` 攻擊樣本（危險標籤與網址、編碼繞過、DOM clobbering、偽造介面、檔名、Mermaid）
- 版面：文字欄寬度、寬表格超出文字欄、窄螢幕抽屜目錄
- 表格：排序（數字／容量／日期）、拖拉欄寬、篩選、自動更新後狀態保留
- 摺疊：全部摺疊／展開、Ctrl+F 命中展開、目錄標記
- 分頁：目錄與寬度只影響目前分頁、外觀設定即時同步、新分頁套用預設值
- 勾選寫回：寫入正確的行（含 front matter）、引用區塊與有序清單、復原、衝突偵測、保留 CRLF 與 BOM、未授權、關閉功能。資料夾授權以瀏覽器私有檔案系統（OPFS）模擬，資料夾選擇視窗需手動測試
- Mermaid（`test/fixtures/mermaid.md`）：沒有圖表時不載入、繪製、語法錯誤、標籤注入、切換原始碼、主題切換重繪、自動更新不閃爍、http 不繪製、關閉設定
- 數學公式（`test/fixtures/math.md`）：行內、獨立、` ```math `、表格內，金額與跳脫不轉換、語法錯誤、自動更新、http 不繪製
- 匯出：單一檔案不含程式碼、段落展開、樣式與勾選狀態保留、公式字型內嵌
- 介面語言：兩份語系檔鍵值一致、英文介面冒煙測試
- popup 設定寫入

截圖輸出到 `SHOT_DIR` 環境變數指定的目錄（預設為系統暫存目錄）。

## 發版流程

1. 在 `CHANGELOG.md` 最上方新增 `## [X.Y.Z] - YYYY-MM-DD` 段落（把 *Unreleased* 的項目移進來）。
2. 將 `manifest.json`（`version` 與 `version_name`）和 `package.json` 改成相同版本。
3. 本機檢查：`node scripts/release.mjs check vX.Y.Z`
4. commit 後執行 `git tag vX.Y.Z`、`git push origin main --tags`。

**Release** workflow 會確認標籤、`manifest.json`、`package.json`、`CHANGELOG.md` 版本一致，跑測試，打包只含擴充功能檔案的 `marklens-vX.Y.Z.zip`，並以該版 CHANGELOG 段落為說明發布 GitHub Release。每次 push 與 pull request 都會由 **Tests** workflow 自動跑測試。

## 開發計畫

- 首次安裝引導頁：帶使用者開啟「允許存取檔案網址」
- 介面多語系
- 上架 Chrome 線上應用程式商店／Edge 附加元件

## 授權

MIT。第三方程式庫各自的授權見 `vendor/licenses/`（Mermaid 的打包檔另含 D3、DOMPurify 等相依套件，依其各自授權）。
