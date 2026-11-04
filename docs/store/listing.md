# 商店送審資料（Chrome Web Store／Edge Add-ons）

填寫開發者後台用的文字，依後台頁面順序排列。標示「待確認」的地方是後台實際欄位或規定可能與此不同，填寫時以後台為準。

> **維護注意**：Mermaid 與數學公式目前只在本機檔案繪製，下方說明據此寫明。若日後網頁上也能繪製，要同時修改這裡、商店截圖的說明（`scripts/screenshots.mjs` 的 `4-dark-mermaid`）與 README。

---

## 1. 上傳

- 檔案：GitHub Release 的 `marklens-vX.Y.Z-store.zip`（`manifest.json` 位於 zip 根目錄）
- 名稱與簡短說明取自 `manifest.json` 與 `_locales/`，後台不能另外修改：
  - 名稱（en）：`MarkLens – Markdown Reader`
  - 名稱（zh_TW）：`MarkLens – Markdown 閱讀器`
  - 簡短說明（en，128 字元）：Lightweight, auditable Markdown reader: outline, folding, resizable sortable tables, Mermaid, and task check-off in local files.
  - 簡短說明（zh_TW）：輕量、可稽核的 Markdown 閱讀器：目錄、摺疊、可拖拉排序的表格、Mermaid 圖表，並可直接勾選本機檔案的任務。

---

## 2. 商店資訊（Store listing）

### 類別

Productivity → **Developer Tools**（待確認：後台下拉選單的實際名稱）

### 語言

English（預設）、中文（繁體）。每個語言各自填寫詳細說明並上傳截圖與宣傳圖。

### 詳細說明（English）

```text
MarkLens turns any Markdown file you open in the browser into a clean, readable page, and makes the tables in it something you can actually work with.

TABLES YOU CAN WORK WITH
• Drag column edges to resize; double-click to fit the content
• Click a header to sort: numbers with thousands separators, sizes (KB, MB), dates and Chinese text sort correctly
• Filter rows as you type, view any table fullscreen with a sticky header
• Copy a table and paste it straight into Excel or Google Sheets

CHECK OFF TASKS IN YOUR FILES
• In local .md files, click a task checkbox and [ ] / [x] is saved straight back to the file, no editor needed
• Undo from the notification; MarkLens refuses to write if the file was changed elsewhere, and keeps CRLF line endings and BOM
• You authorize a folder once; only the line you clicked is changed

READ AND NAVIGATE
• Sidebar outline with the current section highlighted and heading search
• Fold any section; fold or unfold everything at once
• Files tab: browse the Markdown files and subfolders next to the document, free
• Live reload for local files that keeps your scroll position, folds and table state
• Open the file in VS Code at the section you're reading
• Text width, font size and line height; light, dark or follow the system

MARKDOWN SUPPORT
• CommonMark and GitHub Flavored Markdown: tables, task lists, footnotes, GitHub alerts (> [!NOTE]), emoji shortcodes, ==highlight==
• Syntax highlighting with a copy button for code blocks
• Mermaid diagrams and KaTeX math in local files
• Box-drawing tables in code blocks stay aligned with Chinese, Japanese and Korean text
• Export the current view as one self-contained HTML file to share, or print it / save it as a PDF with every section expanded

PRIVATE AND AUDITABLE
• Collects no data. No account, no analytics, no ads, no server
• Only one permission: storage, for your settings
• No remote code: every library is packaged inside the extension
• Open source under the MIT license; the test suite includes 60+ attack samples that must not run any code
• Privacy policy: https://github.com/xjin9612/marklens/blob/main/PRIVACY.md

GOOD TO KNOW
• For local files, turn on "Allow access to file URLs" on the extension's Details page. A welcome page walks you through it after installing.
• Mermaid diagrams and math are drawn in local files only, not on web pages.
• When you install it, Chrome warns that MarkLens can read and change your data on all websites, because its permission prompt ignores the part of the address after the site name. MarkLens only runs on addresses that end in .md, .markdown, .mkd or .mdx. You can limit it further under Site access on the extension's Details page.

Source code, changelog and issues: https://github.com/xjin9612/marklens
```

### 詳細說明（中文繁體）

```text
MarkLens 把你在瀏覽器中開啟的 Markdown 檔案變成清楚好讀的頁面，而且裡面的表格是真的能拿來用的。

表格真的能用
• 拖拉欄位邊緣調整寬度，雙擊自動配合內容
• 點表頭排序：千分位數字、容量單位（KB、MB）、日期與中文都能正確排序
• 邊打字邊篩選資料列，任何表格都能全螢幕檢視，表頭固定
• 一鍵複製表格，直接貼到 Excel 或 Google 試算表

直接勾選檔案中的任務
• 本機 .md 檔案中點任務的勾選框，[ ]／[x] 立即存回檔案，不必開編輯器
• 提示列可以復原；檔案已在其他地方被修改時會拒絕寫入；保留 CRLF 換行與 BOM
• 只需授權資料夾一次，而且只會修改你點的那一行

閱讀與導覽
• 側邊欄目錄：標示目前章節，可搜尋標題
• 任何段落都能摺疊，也能一次全部摺疊或展開
• 檔案分頁：瀏覽同一資料夾中的 Markdown 檔案與子資料夾，完全免費
• 本機檔案自動更新，保留捲動位置、摺疊狀態與表格設定
• 以 VS Code 開啟檔案並跳到目前閱讀的段落
• 可調整文字寬度、字體大小與行高；淺色、深色或跟隨系統

Markdown 支援
• CommonMark 與 GitHub Flavored Markdown：表格、任務清單、腳註、GitHub 提示框（> [!NOTE]）、Emoji 短碼、==螢光標記==
• 程式碼語法高亮，附複製按鈕
• 本機檔案支援 Mermaid 圖表與 KaTeX 數學公式
• 程式碼區塊中的框線字元表格，中日韓文字也能對齊
• 把目前畫面匯出成單一 HTML 檔方便分享，或列印／存成 PDF，摺疊的段落會全部展開

注重隱私、可以稽核
• 不收集任何資料。沒有帳號、沒有分析追蹤、沒有廣告、沒有伺服器
• 只要求一項權限：storage，用來保存你的設定
• 沒有遠端程式碼：所有程式庫都打包在擴充功能內
• 以 MIT 授權開源；測試包含 60 多個攻擊樣本，確保它們都無法執行任何程式碼
• 隱私權政策：https://github.com/xjin9612/marklens/blob/main/PRIVACY.zh-TW.md

使用須知
• 要開啟本機檔案，請在擴充功能的「詳細資料」頁面開啟「允許存取檔案網址」。安裝後的歡迎頁會帶你完成設定。
• Mermaid 圖表與數學公式只在本機檔案中繪製，網頁上不繪製。
• 安裝時 Chrome 會警告 MarkLens 可以讀取及變更所有網站上的資料，因為它的權限提示忽略網址中網站名稱之後的部分。MarkLens 只在網址以 .md、.markdown、.mkd 或 .mdx 結尾時執行；你也可以在擴充功能「詳細資料」頁面的「網站存取權」進一步限制。

原始碼、更新紀錄與問題回報：https://github.com/xjin9612/marklens
```

### 圖片

| 欄位 | 檔案（en／zh-TW 各一組） |
|---|---|
| 商店圖示 128×128 | `icons/icon128.png` |
| 螢幕截圖 1280×800（最多 5 張，依序上傳） | `docs/store/<語系>/1-tables.png` … `5-table-fullscreen.png` |
| 小型宣傳圖 440×280 | `docs/store/<語系>/promo-440x280.png` |
| 大型宣傳圖 1400×560（選填） | `docs/store/<語系>/marquee-1400x560.png` |

### 其他欄位

- 官方網址：不填（需要在 Google Search Console 驗證網域）
- 首頁網址：https://github.com/xjin9612/marklens
- 支援網址：https://github.com/xjin9612/marklens/issues

---

## 3. 隱私權（Privacy practices）

### 單一用途說明（Single purpose）

```text
Display Markdown files (.md, .markdown, .mkd, .mdx) opened in the browser as formatted, navigable pages, and let the user check off task-list items in local Markdown files.
```

### 權限理由

**storage**

```text
Saves the user's reading settings (theme, font size, text width, language, editor and similar options) and the reading position of recently opened Markdown files, so they apply the next time a document is opened. Data stays in chrome.storage.local and is never transmitted.
```

**主機權限（content scripts 的比對網址）**

```text
The content scripts match only URLs whose path ends in a Markdown extension (.md, .markdown, .mkd, .mdx, in http, https and file URLs), so that MarkLens can render the Markdown file the user opened. They never run on other pages. The broad host part (*://*/) is needed because Markdown files can be hosted on any site; Chrome's warning ignores the path restriction.
```

> 待確認：manifest 沒有 `host_permissions`，但 content scripts 的比對網址仍可能讓後台要求填寫主機權限理由。若後台沒有這個欄位就略過。

### 遠端程式碼（Remote code）

選「**No, I am not using remote code**」。

```text
All JavaScript, including third-party libraries (markdown-it, highlight.js, Mermaid, KaTeX), is packaged in the extension under vendor/ with pinned versions. Nothing is fetched or evaluated at runtime.
```

### 資料使用（Data usage）

**收集的資料類型：全部不勾。**

理由：商店所說的「收集」是指資料離開使用者的裝置。MarkLens 存放的資料只有兩種，都只留在本機，不傳送給任何人，且在隱私權政策中逐項列出：
- 閱讀位置：最近 300 個檔案的網址與捲動位置，用於回到上次閱讀處
- 已授權資料夾的存取權

**三項合規聲明全部勾選**：
- 不出售或轉移使用者資料給第三方（核准的用途除外）
- 不將使用者資料用於與單一用途無關的目的
- 不將使用者資料用於判斷信用或放貸

### 隱私權政策網址

```text
https://github.com/xjin9612/marklens/blob/main/PRIVACY.md
```

（需要先 push，網址才有內容）

---

## 4. 發布範圍（Distribution）

- 價格：免費
- 地區：所有地區
- 公開範圍：公開

---

## 5. Edge Add-ons（另外送審）

使用同一個 `-store.zip`，文字與圖片沿用上面的內容。差異與待確認事項：
- 隱私權政策網址：必填，用同一個
- 詳細說明：Edge 有最少字數規定（待確認），上面的說明遠超過一般下限
- 搜尋關鍵字（待確認是否仍有此欄位）：markdown, md, reader, viewer, table, mermaid, preview
- 類別：Developer tools（待確認名稱）
