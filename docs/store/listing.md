# 商店送審資料（Chrome Web Store／Edge Add-ons）

填寫開發者後台用的文字，依後台頁面順序排列。

---

## 1. 上傳

- 檔案：GitHub Release 的 `marklens-vX.Y.Z-store.zip`（`manifest.json` 位於 zip 根目錄）
- 名稱與簡短說明取自 `manifest.json` 與 `_locales/`，後台不能另外修改：
  - 名稱（en）：`MarkLens – Markdown Reader`
  - 名稱（zh_TW）：`MarkLens – Markdown 閱讀器`
  - 簡短說明（en，128 字元）：Lightweight, auditable Markdown reader: outline, folding, resizable sortable tables, Mermaid, and task check-off in local files.
  - 簡短說明（zh_TW）：輕量、可稽核的 Markdown 閱讀器：目錄、摺疊、可拖拉排序的表格、Mermaid 圖表，並可直接勾選本機檔案的任務。
  - 名稱（zh_CN）：`MarkLens – Markdown 阅读器`
  - 簡短說明（zh_CN）：轻量、可审计的 Markdown 阅读器：目录、折叠、可拖动排序的表格、Mermaid 图表，并可直接勾选本机文件的任务。

---

## 2. 商店資訊（Store listing）

### 類別

**Developer Tools**（[Chrome 的類別清單](https://developer.chrome.com/docs/webstore/best-practices)）

### 語言

English（預設）、中文（繁體）、中文（簡體）。每個語言各自填寫詳細說明。截圖與宣傳圖只有 en、zh-TW 兩組，簡體沿用 zh-TW。

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
• Containers from docs sites (::: tip, ::: details, Docusaurus :::note) and definition lists
• Syntax highlighting with a copy button for code blocks
• KaTeX math and Mermaid diagrams, in local files and on web pages
• Box-drawing tables in code blocks stay aligned with Chinese, Japanese and Korean text
• Export the current view as one self-contained HTML file to share, or print it / save it as a PDF with every section expanded
• Copy content or location: the Markdown source (with formatting for apps that accept rich text), or the file path and line range to point an AI tool at the right lines. Works on the whole document, one section or selected text
• Line numbers in source view; click one to copy that line's location

PRIVATE AND AUDITABLE
• Collects no data. No account, no analytics, no ads, no server
• No access to websites at install: local files only. Turn on .md files on websites yourself if you need them. Optional settings sync goes through your browser account, never to us
• No remote code: every library is packaged inside the extension
• Open source under the MIT license; the test suite includes 60+ attack samples that must not run any code
• Privacy policy: https://github.com/xjin9612/marklens/blob/main/PRIVACY.md

GOOD TO KNOW
• For local files, turn on "Allow access to file URLs" on the extension's Details page. A welcome page walks you through it after installing.
• To read .md files on websites, turn on "Also open .md files on websites" in the popup. The browser then asks for access to all websites, because its permission prompt ignores the part of the address after the site name. MarkLens only runs on addresses that end in .md, .markdown, .mkd or .mdx.

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
• 文件網站的容器區塊（::: tip、::: details、Docusaurus 的 :::note）與定義清單
• 程式碼語法高亮，附複製按鈕
• KaTeX 數學公式與 Mermaid 圖表，本機檔案與網頁上都能繪製
• 程式碼區塊中的框線字元表格，中日韓文字也能對齊
• 把目前畫面匯出成單一 HTML 檔方便分享，或列印／存成 PDF，摺疊的段落會全部展開
• 複製內容或位置：Markdown 原文（貼到支援格式的程式時保留格式），或檔案路徑與行號，方便請 AI 讀取指定段落。可作用於整份文件、單一章節或選取的文字
• 原始文字顯示行號，點行號複製該行位置

注重隱私、可以稽核
• 不收集任何資料。沒有帳號、沒有分析追蹤、沒有廣告、沒有伺服器
• 安裝時不要求網站存取權，只處理本機檔案；需要閱讀網頁上的 .md 時再自行開啟。可選的設定同步透過瀏覽器帳號進行，不經過我們
• 沒有遠端程式碼：所有程式庫都打包在擴充功能內
• 以 MIT 授權開源；測試包含 60 多個攻擊樣本，確保它們都無法執行任何程式碼
• 隱私權政策：https://github.com/xjin9612/marklens/blob/main/PRIVACY.zh-TW.md

使用須知
• 要開啟本機檔案，請在擴充功能的「詳細資料」頁面開啟「允許存取檔案網址」。安裝後的歡迎頁會帶你完成設定。
• 要閱讀網頁上的 .md，請在設定中開啟「也在網頁上的 .md 檔案啟用」。瀏覽器會詢問是否允許存取所有網站，因為它的權限提示忽略網址中網站名稱之後的部分。MarkLens 只在網址以 .md、.markdown、.mkd 或 .mdx 結尾時執行。

原始碼、更新紀錄與問題回報：https://github.com/xjin9612/marklens
```

### 詳細說明（中文簡體）

Edge 要求套件中的每個語言都有詳細說明（[Edge 文件](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#enter-properties-for-a-language)）。由繁中轉換後改用大陸用語；簡中版沒有另外的隱私權政策，連到繁中版。

```text
MarkLens 把你在浏览器中打开的 Markdown 文件变成清晰易读的页面，而且里面的表格是真的能拿来用的。

表格真的能用
• 拖动列边缘调整宽度，双击自动适应内容
• 点表头排序：千分位数字、容量单位（KB、MB）、日期与中文都能正确排序
• 边输入边筛选数据行，任何表格都能全屏查看，表头固定
• 一键复制表格，直接粘贴到 Excel 或 Google 表格

直接勾选文件中的任务
• 本机 .md 文件中点任务的勾选框，[ ]／[x] 立即写回文件，不必开编辑器
• 提示栏可以撤销；文件已在其他地方被修改时会拒绝写入；保留 CRLF 换行与 BOM
• 只需授权文件夹一次，而且只会修改你点的那一行

阅读与导航
• 侧边栏目录：标出当前章节，可搜索标题
• 任何段落都能折叠，也能一次全部折叠或展开
• “文件”标签：浏览同一文件夹中的 Markdown 文件与子文件夹，完全免费
• 本机文件自动更新，保留滚动位置、折叠状态与表格设置
• 以 VS Code 打开文件并跳到当前阅读的段落
• 可调整文本宽度、字体大小与行高；浅色、深色或跟随系统

Markdown 支持
• CommonMark 与 GitHub Flavored Markdown：表格、任务清单、脚注、GitHub 提示框（> [!NOTE]）、Emoji 短码、==高亮标记==
• 文档网站的容器块（::: tip、::: details、Docusaurus 的 :::note）与定义列表
• 代码语法高亮，附复制按钮
• KaTeX 数学公式与 Mermaid 图表，本机文件与网页上都能绘制
• 代码块中的框线字符表格，中日韩文字也能对齐
• 把当前画面导出为单个 HTML 文件方便分享，或打印／存成 PDF，折叠的段落会全部展开
• 复制内容或位置：Markdown 原文（粘贴到支持格式的程序时保留格式），或文件路径与行号，方便请 AI 读取指定段落。可作用于整份文档、单个章节或选中的文字
• 原始文本显示行号，点击行号复制该行位置

注重隐私、可以审计
• 不收集任何数据。没有账号、没有分析追踪、没有广告、没有服务器
• 安装时不要求网站访问权限，只处理本机文件；需要阅读网页上的 .md 时再自行开启。可选的设置同步通过浏览器账号进行，不经过我们
• 没有远程代码：所有程序库都打包在扩展程序内
• 以 MIT 许可证开源；测试包含 60 多个攻击样本，确保它们都无法运行任何代码
• 隐私政策：https://github.com/xjin9612/marklens/blob/main/PRIVACY.zh-TW.md

使用须知
• 要打开本机文件，请在扩展程序的“详情”页面打开“允许访问文件网址”。安装后的欢迎页会带你完成设置。
• 要阅读网页上的 .md，请在设置中开启“也在网页上的 .md 文件启用”。浏览器会询问是否允许访问所有网站，因为它的权限提示忽略网址中网站名称之后的部分。MarkLens 只在网址以 .md、.markdown、.mkd 或 .mdx 结尾时运行。

源代码、更新日志与问题反馈：https://github.com/xjin9612/marklens
```

### 圖片

| 欄位 | 檔案（en／zh-TW 各一組，簡體沿用 zh-TW） |
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
Saves the user's reading settings (theme, font size, text width, language, editor and similar options) and the reading position of recently opened Markdown files, so they apply the next time a document is opened. Data stays in chrome.storage.local. If the user keeps settings sync on, the settings (not reading positions or folder access) are also saved to chrome.storage.sync, which the browser syncs through the user's own account. MarkLens never transmits any data itself.
```

**scripting**

```text
Registers MarkLens's own packaged content scripts for Markdown URLs on websites (paths ending in .md, .markdown, .mkd, .mdx), only after the user turns on "Also open .md files on websites" and grants the optional host permission. The scripts are the same files the manifest already runs on local Markdown files; no code is fetched or generated. They are unregistered when the permission is removed.
```

**主機權限（content_scripts 的 `file:///*.md` 等網址，與 optional_host_permissions 的 `*://*/*`）**

```text
At install, the content scripts match only local Markdown files (file:/// URLs ending in .md, .markdown, .mkd or .mdx), to render the document the user opened. They take effect only after the user turns on "Allow access to file URLs".
The website permission (*://*/*) is optional and not requested at install. The user grants it from the popup or the welcome page to render Markdown files hosted on websites. The registered scripts match only URLs whose path ends in a Markdown extension and never run on other pages. The host part is broad because Markdown files can be hosted on any site, and host permissions cannot be limited by path. When the permission is granted and the user exports a document as a single HTML file, it is also used to download the images in that document so they can be embedded in the file.
```

### 遠端程式碼（Remote code）

選「**No, I am not using remote code**」。

```text
All JavaScript, including third-party libraries (markdown-it and its plugins, highlight.js, Mermaid, KaTeX), is packaged in the extension under vendor/ with pinned versions. Nothing is fetched or evaluated at runtime. vendor/mermaid/mermaid.mjs is the official dist/mermaid.min.js of mermaid 12.2.0 with one change: its last line, which assigns the library to globalThis, is replaced by `export default` so it loads as a module (scripts/vendor.mjs).
```

### 資料使用（Data usage）

**收集的資料類型：全部不勾。**

理由：商店所說的「收集」是指資料離開使用者的裝置。MarkLens 除了閱讀設定之外，存放的資料只有兩種，都只留在本機，不傳送給任何人，且在隱私權政策中逐項列出：
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

---

## 4. 發布範圍（Distribution）

- 價格：免費
- 地區：所有地區
- 公開範圍：公開

---

## 5. Edge Add-ons（另外送審）

使用同一個 `-store.zip`，文字與圖片沿用上面的內容。欄位規定見 [Edge 發布文件](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)，差異如下：
- 隱私權政策網址：必填，用同一個
- 詳細說明：每個語言必填，250～10,000 字元。英文約 3,200 字元、繁中與簡中約 1,400 字元，都符合
- 擴充功能標誌（Extension logo）：每個語言必填，1:1，最小 128×128。用 `icons/icon128.png`，上傳後按 Duplicate 套用到所有語言
- 螢幕截圖：最多 6 張，1280×800 可用；沿用上面 5 張
- 搜尋關鍵字（Search terms，選填，最多 7 個、每個 30 字元、合計 21 個字）：markdown, md, reader, viewer, table, mermaid, preview
- 類別：Developer tools（[Edge Add-ons 的類別頁面](https://microsoftedge.microsoft.com/addons/category/Developer-Tools)）
- 認證備註（Notes for certification，選填）：

```text
No account is needed. To test with local files: open edge://extensions, open MarkLens's Details and turn on "Allow access to file URLs", then drag any .md file into the browser. To test on websites: open the MarkLens popup, turn on "Also open .md files on websites" and allow the permission, then open https://raw.githubusercontent.com/xjin9612/marklens/main/docs/demo.md. Checking a task in a local file asks once for access to the folder that contains it.
```
