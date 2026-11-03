# MarkLens 開發文件

給參與開發的人：環境、目錄結構、安全設計、測試、截圖與發版。使用說明見 [README](../README.md)。

擴充功能本身不需要建置，`src/` 與 `vendor/` 就是瀏覽器載入的檔案；`package.json` 只供開發工具（測試、截圖、更新 vendor）使用。

## 開發環境

### Linux／WSL

```bash
sh scripts/setup-linux.sh
```

安裝 `npm ci`、Playwright Chromium 與系統套件、`fonts-noto-cjk`（與 CI 相同）、`poppler-utils`（檢查列印輸出），重複執行無妨。Playwright 可能提示放寬 Chromium 沙箱的系統設定（Ubuntu 23.10 起的 AppArmor 限制），不需要照做：Playwright 在 Linux 預設不使用 Chromium 沙箱，測試只開啟 repo 內的檔案與本機伺服器。

### Windows

```bash
npm ci
npx playwright install chromium
```

Windows 上的 `npm test` 有一項必定失敗：「檔名中的 HTML 不會被執行」要建立檔名含 `<`、`>` 的檔案，Windows 不允許。CI 在 Linux 上執行，不受影響。

### 載入擴充功能

`chrome://extensions` → 開啟「開發人員模式」→「載入未封裝項目」選 repo 根目錄。改了程式後在同一頁按重新載入圖示，**再重新整理已開的 `.md` 分頁**。

## 目錄結構

```
manifest.json
_locales/                介面文字：en（預設）與 zh_TW
src/
  background.js          快捷鍵、代讀本機檔案、資料夾清單、勾選寫回
  shared/settings.js     設定預設值與存取（三端共用）
  shared/i18n.js         介面文字（內容在 _locales/）
  shared/roots.js        已授權資料夾（僅擴充功能內部使用）
  shared/tokens.css      閱讀頁與擴充功能頁面共用的設計變數（色彩、字型、動態）
  shared/theme.js        讓 popup、引導頁、授權頁套用主題設定
  grant/                 資料夾授權頁
  welcome/               首次安裝引導頁
  content/
    early.js             最早執行：換檔時保留舊畫面到新頁排好版、載入中的背景色
    util.js              小工具、讀取原始內容
    icons.js             介面線條圖示（SVG）
    menu.js              下拉選單（工具列寬度／主題／字級、檔案分頁資料夾選單）與鍵盤操作
    fonts.js             程式碼區塊中英字寬對齊
    sanitize.js          HTML 白名單過濾
    markdown.js          markdown-it 設定、==mark==、Alert、front matter、數學公式標記
    enhance.js           標題錨點與摺疊、行內內容歸組、任務清單、程式碼區塊、圖片、字數
    mermaid.js           Mermaid 圖表（依需載入）
    math.js              KaTeX 數學公式（依需載入）
    export.js            匯出目前畫面為單一 HTML 檔
    table.js             表格拖拉欄寬、排序、篩選、複製、全螢幕、狀態保存與還原
    toc.js               側邊欄：目錄／檔案分頁、搜尋、目前章節高亮
    files.js             檔案分頁：資料夾清單、子資料夾依需讀取
    main.js              進入點：版面組裝、工具列、快捷鍵、分頁狀態、自動更新、勾選寫回、列印
    content.css          所有樣式（限定在 html.marklens 底下）
  popup/                 設定面板
vendor/                  第三方程式庫（版本見 VERSIONS.md，授權見 licenses/）
scripts/
  setup-linux.sh         Linux／WSL 開發環境安裝
  vendor.mjs             升級 vendor
  release.mjs            發版輔助：版本與商店欄位長度檢查、取出 Release 說明、打包
  screenshots.mjs        README 與商店截圖（npm run screenshots）
  layout-audit.mjs       版面檢查（npm run audit:layout）
  manual-bigfile.mjs     產生手動測試用的大檔（npm run manual:bigfile）
docs/
  DEVELOPMENT.md         本文件
  demo.md、demo.zh-TW.md 截圖用的示範文件
  screenshots/<語系>/    README 用的截圖
  store/                 商店截圖、宣傳圖、示範表格與送審資料（listing.md）
.github/workflows/       自動測試（ci.yml）與自動發布（release.yml）
test/
  e2e.mjs                端對端測試
  visual.mjs             視覺回歸測試
  fixtures/              測試文件（含 security.md 攻擊樣本）
  visual/<平台>/          視覺回歸的基準圖，依作業系統分開
  manual/                手動測試清單
CHANGELOG.md             版本紀錄（英文，GitHub Release 說明的來源）
PRIVACY.md、PRIVACY.zh-TW.md  隱私權政策（商店送審使用）
```

## 安全設計

MarkLens 不收集任何資料，唯一主動的網路請求是重新載入使用者開啟的文件（[隱私權政策](../PRIVACY.zh-TW.md)）。實作上的防護：

- **HTML 白名單過濾**（`src/content/sanitize.js`）：允許 `<details>`、`<kbd>`、表格等常用標籤；移除 `<script>`、`<iframe>`、`<svg>`、所有事件屬性、`style`（表格對齊除外），以及 `javascript:`、`data:`（圖片除外）等連結。
- **不能借用介面**：文件中的 HTML 不能使用 MarkLens 自己的 `ml-` class／id（無法在頁面上蓋出假遮罩或假提示），`name` 屬性只保留給 `<a>`，防止 DOM clobbering。
- **數學公式**：KaTeX 以 `trust: false` 繪製（停用 `\href`、`\url`、`\includegraphics` 與 `\html…` 指令），並限制巨集展開次數。
- **Mermaid**：以 `securityLevel: 'strict'` 繪製（標籤經 DOMPurify 過濾、停用點擊事件）。
- **Mermaid 與 KaTeX 只對 `file://` 開放**：程式庫需在用到時才載入，必須設為 web accessible resources；存取範圍只開放給 `file://` 頁面，一般網站無法藉由探測這些檔案得知使用者裝了 MarkLens。這也是網頁上不繪製圖表與公式的原因（網頁上會在原文上方說明）。
- **匯出的 HTML** 不含任何 JavaScript，並帶有禁止執行腳本的 CSP；文件中的遠端圖片在開啟時仍會載入。
- **最小權限**：只要求 `storage`；content script 只在 Markdown 副檔名結尾的網址上執行。Chrome 計算權限時不看網址路徑，因此仍會顯示為可存取所有網站。
- **本機檔案讀取**：由 background 代讀，只允許讀取發出請求的那個頁面本身的網址。
- **資料夾清單**（檔案分頁）同樣由 background 讀取：只接受 `file://` 本機資料夾（不含網路共用、不能有 `.`／`..`），只回傳 Markdown 檔名與子資料夾名稱，不讀檔案內容。
- **寫入**：只在點擊任務勾選框時發生，背景程式確認檔案內容與頁面一致後，只修改那一行。哪些勾選框可寫回由 Markdown 解析器決定，並帶有每次渲染隨機產生的 nonce，文件內嵌的 HTML 無法偽造。資料夾授權保存在擴充功能自己的 IndexedDB（擴充功能的 origin），一般網頁與本機 HTML 檔都取不到。
- **列印**：以 `@page` 頁邊方塊取代 Chrome 預設的頁首頁尾，PDF 不會帶著本機檔案路徑。
- **零遠端程式碼**：第三方程式庫固定版本放在 `vendor/`，執行時不下載、不自動更新。
- **攻擊樣本測試**：`test/fixtures/security.md` 收錄 60 多種攻擊寫法，測試會渲染後逐一點擊所有連結與圖表節點，任何程式碼執行即失敗。

## 程式碼區塊中的罫線對齊

`┌─┬─┐` 這類文字圖表，要在中文剛好是英數兩倍寬時才會對齊。系統等寬字型（Consolas、Menlo…）沒有中文字，瀏覽器會改用寬度不同的中文字型，於是錯位。`fonts.js` 會量測實際字寬，只針對中日韓字元把系統中文字型等比例縮放（`@font-face` 的 `size-adjust`），不必安裝字型就能對齊；代價是程式碼中的中文看起來略大。偵測到更紗黑體（Sarasa Mono TC）時直接使用它（安裝方式見 README 的常見問題）。

## 升級第三方程式庫

修改 `scripts/vendor.mjs` 裡的版本表，然後執行 `npm run vendor`。版本記錄在 `vendor/VERSIONS.md`，授權檔在 `vendor/licenses/`。

## 測試

### 端對端測試

```bash
npm test
```

以 Chromium 載入擴充功能，開啟本機與 http 的測試文件。每次 push 到 `main` 與每個 pull request 都會由 CI 執行。截圖輸出到 `SHOT_DIR` 環境變數指定的目錄（預設為系統暫存目錄）。涵蓋：

- 渲染：GFM、任務清單（緊湊／鬆散清單）、腳註、Alert、front matter、程式碼高亮、Emoji 短碼、比照 GitHub 的自動連結
- 載入：換檔時保留舊畫面到新頁排好版、載入中背景沿用上次的主題、停用 MarkLens 時原文照常顯示、非 Markdown 網址不接管
- 安全：script、事件屬性、`javascript:` 連結、style 屬性過濾；`test/fixtures/security.md` 攻擊樣本（危險標籤與網址、編碼繞過、DOM clobbering、偽造介面、檔名、Mermaid）
- 版面：文字欄寬度、寬表格超出文字欄、小表格在各種寬度下不出現捲軸、窄螢幕抽屜側邊欄、寬視窗下數學公式與 Mermaid 錯誤訊息對齊文字欄、回到頂部按鈕出現時其他按鈕不位移
- 表格：排序（數字／容量／日期）、拖拉欄寬、篩選、全螢幕與 Esc、自動更新後狀態保留
- 摺疊：全部摺疊／展開、Ctrl+F 命中展開、目錄標記、從目錄或 `#錨點` 網址跳到被摺疊的段落
- 側邊欄：選單鈕位置、`/` 搜尋、目錄高亮（含頁尾的短章節）、檔案分頁（自然排序、略過資料夾、子資料夾依需讀取、切換檔案後起點不變、上一層按鈕、資料夾清單的限制）
- 分頁：側邊欄與寬度只影響目前分頁、外觀設定即時同步、新分頁套用預設值、`Alt+Shift` 快捷鍵、記住閱讀位置
- 連結：外部連結開新分頁（含關閉設定）、編輯器按鈕與網址範本的限制
- 無障礙：每個按鈕都有可念的名稱、鍵盤焦點外框、點擊範圍至少 24×24、用鍵盤排序表格與放大圖片
- 勾選寫回：寫入正確的行（含 front matter）、引用區塊與有序清單、復原、衝突偵測、保留 CRLF 與 BOM、未授權、關閉功能、非 UTF-8 檔案（含手動測試的真實 Big5 文件）。資料夾授權以瀏覽器私有檔案系統（OPFS）模擬，資料夾選擇視窗需手動測試
- Mermaid（`test/fixtures/mermaid.md`）：沒有圖表時不載入、繪製、語法錯誤、標籤注入與點擊事件、切換原始碼、主題切換重繪、自動更新不閃爍、http 不繪製並說明原因、關閉設定
- 數學公式（`test/fixtures/math.md`）：行內、獨立、` ```math `、表格內，金額與跳脫不轉換、語法錯誤、自動更新、http 不繪製並說明原因、關閉設定
- 匯出與列印：單一檔案不含程式碼、段落展開、樣式與勾選狀態保留、公式字型內嵌；列印樣式展開摺疊、深色主題改用淺色、圖表以淺色重繪後還原
- 介面語言：兩份語系檔鍵值一致、指定介面語言、英文介面冒煙測試
- 安裝後的引導頁、popup 設定、擴充功能重新載入後舊分頁的提示

### 視覺回歸測試

```bash
npm run test:visual                  # 與基準圖比對
npm run test:visual -- --update      # 以目前畫面作為新的基準圖
```

把幾個固定畫面（閱讀頁淺色／深色／窄螢幕、檔案分頁、深色 Mermaid、popup、引導頁）截圖，與 `test/visual/<平台>/` 的基準圖逐像素比對。各作業系統字型不同，基準圖依平台分開存放：`linux` 以 `scripts/setup-linux.sh` 的環境建立，`win32` 在 Windows 上建立。不同的像素超過 0.1% 才算失敗（以 `VISUAL_TOLERANCE` 調整），差異圖（不同的像素標紅）輸出到 `SHOT_DIR` 下的 `ml-visual/`。介面有預期中的改動時，先看過差異圖，確認只有預期的地方變了，再加 `--update` 更新基準圖並提交（兩個平台都要更新）。不在 CI 中執行。

### 版面檢查

```bash
npm run audit:layout
```

以 1920／1280／900／420 四種寬度與中英介面，開啟 repo 內所有 Markdown 文件，檢查整頁橫向溢出、一般內容沒對齊文字欄、工具列換行或溢出、內容溢出容器；表格與程式碼照設計可以超出文字欄，只列出供參考。約 3–4 分鐘，改了版面（`content.css`、工具列、側邊欄）後執行，有問題時結束碼為 1。不在 CI 中執行。

### 列印

螢幕上模擬列印媒體（`emulateMedia({ media: 'print' })`）重現不了部分列印問題（例如表格框線）。要確認列印結果時，用 Playwright 的 `page.pdf()` 輸出 PDF（`displayHeaderFooter: true` 可模擬列印對話框的頁首頁尾），再以 `pdftoppm` 轉成圖片或 `pdftotext` 取出文字檢查。

### 手動測試

有些項目無法自動化：資料夾選擇視窗、Chrome 重新啟動後的權限確認、開啟 VS Code、列印對話框，以及字型與圖表的實際顯示效果。`test/manual/` 是發版前在自己的 Chrome 上逐項確認的清單：

1. 第一次先執行 `npm run manual:bigfile`，產生約 1MB 的效能測試檔（不進版控）。
2. 在 `chrome://extensions` 重新載入 MarkLens，開啟 `test/manual/00-說明.md` 依序檢查；用側邊欄的「檔案」分頁切換檔案。
3. 勾選會直接寫回這些檔案，測完執行 `git restore test/manual` 還原。

## 截圖

```bash
npm run screenshots
```

以 `docs/demo.md`（英文）與 `docs/demo.zh-TW.md`（繁中）產生：

- `docs/screenshots/<語系>/`：README 用的截圖
- `docs/store/<語系>/`：商店截圖（上方加說明色帶）、440×280 小型宣傳圖、1400×560 大型宣傳圖

請在 Windows 上執行：字型取決於作業系統，Windows 的 Segoe UI 與微軟正黑體才是多數使用者看到的樣子。截圖的說明文字與宣傳圖標語在 `scripts/screenshots.mjs` 的 `LANGS`。介面有改動時重新產生。

## 發版流程

1. 在 `CHANGELOG.md` 最上方新增 `## [X.Y.Z] - YYYY-MM-DD` 段落（把 *Unreleased* 的項目移進來）。CHANGELOG 以英文撰寫，寫給使用者看。
2. 將 `manifest.json`（`version` 與 `version_name`）和 `package.json` 改成相同版本。
3. 本機檢查：`node scripts/release.mjs check vX.Y.Z`
4. commit 後執行 `git tag vX.Y.Z`、`git push origin main --tags`。

**Release** workflow 會確認標籤、`manifest.json`、`package.json`、`CHANGELOG.md` 版本一致，以及名稱與說明符合商店的長度上限，跑測試，打包只含擴充功能的檔案，並以該版 CHANGELOG 段落為說明發布 GitHub Release。Release 附兩個 zip：

- `marklens-vX.Y.Z.zip`：內含一層 `marklens-vX.Y.Z/` 資料夾，供「載入未封裝項目」使用
- `marklens-vX.Y.Z-store.zip`：`manifest.json` 位於根目錄，上傳 Chrome Web Store 與 Edge Add-ons 用

商店後台要填的文字與圖片對照見 [docs/store/listing.md](store/listing.md)。
