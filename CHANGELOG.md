# Changelog

All notable changes to MarkLens are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Export HTML** is now a menu. **Single file** embeds the document's images, so the exported file works on its own when you share it. **Link to images** keeps links to the images, as before. Images on websites are embedded when the site allows it or **Also open .md files on websites** is on; images that can't be read keep their address, and MarkLens tells you how many
- In a **Single file** export, links to local files keep their relative paths and links to `.md` files point to `.html`, so documents exported into the same folder link to each other. The file doesn't reveal your local folders
- `lang` in the front matter sets the document language of the reader and the exported HTML

## [1.7.1] - 2026-11-10

### Fixed
- On macOS, Chinese, Japanese and Korean characters in code blocks were slightly wider than two columns, so text diagrams didn't line up. Alignment is now also recalculated when you change the font size
- Pressing `d`, `-` or `+` several times quickly could skip a theme or font size step, or show the wrong value for a moment
- Changing the theme and the font size in quick succession could lose one of the changes
- When an editor saved a file by emptying it first, auto-reload could briefly show a blank document and lose table sorting, filters and column widths

## [1.7.0] - 2026-11-09

### Added
- **Copy** menus in the toolbar and next to each heading, with two modes. **Copy content** copies the Markdown source and also puts formatted HTML on the clipboard, so apps that accept formatted text keep the formatting. **Copy location** copies the file path and line range, such as `D:\notes\report.md:142-168 (Causes)`, to point an AI tool at the exact lines; on websites it copies the address with `#L142-L168`
- Select text in a document to copy its Markdown source or its location
- Line numbers in **Source** view; click one to copy that line's location

### Changed
- MarkLens no longer asks for access to all websites when installed; it works on local files out of the box. To read `.md` files on websites, turn on **Also open .md files on websites** in the popup or on the welcome page. After updating, turn it on if you read Markdown on websites
- The toolbar's **Copy Markdown** button is now **Copy** and opens the copy menu

### Fixed
- Checking a task could save it to a different file with the same path inside an authorized folder, for example `D:\notes\todo.md` while you were reading `E:\backup\notes\todo.md`. MarkLens now saves only to a file whose content matches the page you're reading
- Checking a task saved it to the wrong line in files that use a lone carriage return (CR) as the line break
- Images and links in local documents that point to a share on another computer (`file://server/…` or `file:////server/…`) are removed, so they are not loaded
- Export HTML no longer fails when the document contains an address the browser can't parse
- The **Open in editor** link was cut off at a `#` or `?` in the file name
- Copying a section no longer stops at a heading inside a quote or list; copying a heading inside a quote copies only to the end of the quote, and a section keeps link definitions written at its end
- The welcome page said diagrams and math are drawn only in local files; they are drawn on websites too

## [1.6.0] - 2026-11-05

### Added
- Math and Mermaid diagrams are drawn on web pages too (for example a README opened on GitHub), not only in local files. Sites still can't detect MarkLens: the libraries are served from an address that changes every browser session
- **Colors**: sepia and high-contrast palettes besides the GitHub look, for both light and dark themes (popup → **Colors**)
- **Custom CSS** (popup → **Custom CSS**): your own styles on reading pages, applied live and kept in exported HTML
- **Settings sync**: settings follow you to your other computers through your browser account; turn it off in the popup. Folder access, reading positions, the editor URL and the sidebar width stay on each computer
- **Fullscreen** button on Mermaid diagrams: scroll to zoom around the pointer, drag to move, double-click or **Reset** to go back; **+** / **−** buttons for the keyboard; Esc to exit
- Containers used by documentation sites: `::: tip`, `::: warning`, `::: danger` and the rest look like GitHub alerts (with an optional title), `::: details Title` folds, and Docusaurus `:::note` / `:::tip[Title]` work too. Definition lists (a term followed by `: description`) are supported
- **Copy Markdown** in the toolbar copies the document's source, ready to paste into an AI chat; the copy button that appears next to a heading copies just that section, up to the next heading of the same or higher level
- Toolbar buttons switch to icons only, least-used first, when their labels don't fit the window
- Simplified Chinese interface. It follows the browser language, or pick **简体中文** in the popup → **Language**
- **Print / PDF** button in the toolbar: prints the whole document, or saves it as a PDF from the print dialog. Folded sections and filtered table rows are printed, a fullscreen table goes back into the page, images that haven't loaded yet are loaded first, a dark theme switches to light colors for paper (Mermaid diagrams are redrawn in light colors before the dialog opens), and pages carry only a page number instead of Chrome's date, title and full local file path. Ctrl+P also prints folded sections and uses light colors, but diagrams keep their dark colors there — use the button for the best result

### Changed
- Tables and code blocks now stay within the text width you set, and wide ones scroll sideways, with a shadow on the side that has more. The **Table / code width** option in the popup still lets them grow past the text column; they now line up with the text on the left and grow to the right instead of being centered
- Fullscreen tables have a full-width bar with the section title and row count on the left, the filter and buttons on the right and an Esc hint; a table narrower than the window is centered
- The extension is named **MarkLens – Markdown Reader** (Traditional Chinese: **MarkLens – Markdown 閱讀器**) so it can be found by searching for "Markdown"; the short name stays MarkLens
- Shorter English extension description, to fit the Chrome Web Store's 132-character limit
- Each GitHub release also includes `marklens-vX.Y.Z-store.zip`, with `manifest.json` at the root of the zip as the Chrome Web Store and Edge Add-ons require
- Release zips carry a build provenance attestation, so you can check that a zip was built by this repository's workflow from its tag: `gh attestation verify marklens-vX.Y.Z-store.zip --repo xjin9612/marklens`
- Box-drawing text in code blocks also uses Sarasa Mono SC (Simplified Chinese) when it is installed, not only Sarasa Mono TC

### Fixed
- After MarkLens is updated or reloaded, pages that were already open showed message names such as `tableExitFullscreen` instead of text for buttons used for the first time; the whole language file now loads when a page opens
- Files on WSL or a network share (`file://wsl.localhost/…`, `file://server/…`): the Files tab explains that folder lists, auto-reload and saving checked tasks aren't available there, instead of "Can't read this folder", and task checkboxes say why they can't be saved
- On wide windows, display math blocks were laid out across the whole page instead of the text column, and a long Mermaid error message stretched its block past the text column; both now line up with the text
- The toolbar buttons no longer jump sideways when **Top** appears: it keeps its place and only fades in after scrolling. It is also hidden when a document opens at the top, instead of showing until the first scroll
- The outline highlighted an earlier section when the last, short sections couldn't scroll to the top of the window: after jumping to a heading from the outline or a `#link`, that heading stays highlighted, and at the end of the document the last heading on screen is highlighted

### Security
- Mermaid labels are drawn as SVG text, so diagrams contain no HTML at all
- Saving a checked task accepts only a valid line number and the two checkbox states
- `SECURITY.md` explains how to report a vulnerability privately

## [1.5.0] - 2026-11-02

### Added
- **Font size** button in the toolbar: Larger, Smaller, Reset, or pick a size (12–28 px, shown with its percentage). The `+` (or `=`), `-` and `0` keys do the same. Like the theme, the size applies to every open tab

### Changed
- Font size now scales the whole document proportionally: code blocks, front matter and Mermaid diagrams grow and shrink with the text instead of staying at a fixed size. The popup accepts 10–32 px (was 12–24)

## [1.4.0] - 2026-11-01

### Added
- Keyboard support: sort a table by focusing its header and pressing Enter or Space; enlarge an image with Enter, close it with Esc (focus returns to the image); open the folder menu in the Files tab with the context-menu key or Shift+F10
- Enlarged images have a visible close button
- **Text width** and **Theme** buttons open a menu listing every option with the current one checked, instead of stepping to the next option on each click. The `w` and `d` keys still step through them and briefly show which one was picked
- Popup: the File list, Editor, Task check-off and Auto refresh sections can be collapsed (collapsed by default; remembered on this computer)

### Changed
- Toolbar, sidebar and file-tree icons are now one set of line icons instead of text symbols and emoji, so they look the same on every system. On narrow windows the toolbar shows icons only and no longer scrolls sideways
- Popup, welcome page and folder access page follow MarkLens's theme setting (Auto / Light / Dark) like the reader, and share its colors and fonts
- Mermaid diagrams use the reader's colors: nodes are cards with thin borders, multi-color charts use the alert colors, and the glow around nodes in dark mode is gone
- Table toolbar sits on the table like a tab and no longer cuts through the heading's underline
- Shorter placeholders: "Filter", "Search headings", "Search files"

### Fixed
- Accessibility: consistent keyboard focus outline; every icon button has a spoken name; controls are at least 24×24 px; the fold toggle has 3:1 contrast and outline items inside folded sections stay readable (4.5:1); the Files tab no longer claims to be a tree it can't be navigated as; notifications pause while hovered or focused; animations are off when the system asks for reduced motion
- Switching files in the same tab could keep the old page on screen for 1.5 s when the new page was ready very quickly

## [1.3.0] - 2026-10-31

### Added
- **Files tab** in the sidebar for local files: the Markdown files and subfolders next to the current document, folders first, sorted by name the way people expect (`2-…` before `10-…`). Only one folder is read up front; a subfolder is read when you open it, so large trees stay fast. Opening a file from the tree keeps the tree where it was (it expands to the new file), ↑ moves the tree up a folder, and right-click a folder → **Make this the top folder** to jump back down. Open folders and the selected tab are kept per tab. Hidden and dependency folders (`.*, node_modules, target, dist, build`) are skipped — edit the list in the popup → **File list**
- External `http(s)` links open in a new tab, so the document stays open; anchors, footnotes and same-site links are unchanged. Can be turned off in the popup
- Welcome page on first install: walks through turning on **Allow access to file URLs** (the status updates live), how to open a file, keyboard shortcuts and the main features. Reopen it any time from the popup → **Help**
- **Export HTML** (toolbar ⤓): saves what you see as one self-contained HTML file to share with people who don't have MarkLens. Styles, Mermaid diagrams and math fonts are embedded, folded sections are expanded, relative links and images become absolute, checkbox states are kept, and the file contains no JavaScript (a Content-Security-Policy blocks scripts)
- **Math** in local files with KaTeX 0.19.1: `$…$`, `$$…$$`, GitHub's `` $`…`$ `` and ` ```math ` blocks. KaTeX (~900 KB with fonts) loads only when a document contains math. Prices such as `$5 and $10`, escaped `\$` and code are left alone; a syntax error shows in red without affecting the rest. Can be turned off in the popup
- **Open in your editor** (toolbar ✎, local files): opens the file in VS Code at the section you're reading, or in any editor with its own URL scheme through a custom template (`{path}`, `{line}`). Off by default; choose it in the popup → **Editor**. Notepad and Notepad++ have no URL scheme, so browsers can't open them
- Interface in English and Traditional Chinese: toolbar, outline, tables, popup, folder access page, welcome page and shortcut names. Follows the browser language by default (other languages get English); pick a language in the popup → **Language** without changing Chrome's language (the extension's name and shortcut names on `chrome://extensions` still follow Chrome)
- Emoji shortcodes from GitHub's list (`:tada:` → 🎉). Code spans and code blocks are left alone, and text emoticons such as `:)` are not converted

### Changed
- Sidebar header is now `☰ | Outline  Files | 🔍`: the ☰ sits in the same spot whether the sidebar is open or closed, the « button is gone, and search opens from the magnifier or the `/` key (Esc closes). Search filters headings on the Outline tab and file names on the Files tab
- The toolbar's sidebar button is now just ☰ (no "Outline" text), and the sidebar, its shortcut and the `t` key are named "sidebar" instead of "outline"

### Fixed
- Read-only task checkboxes (file not UTF-8, saving turned off, or a page on the web) no longer look broken: clicking or hovering explains why the checkbox can't be saved
- Small tables that fit exactly no longer show a horizontal scrollbar (the last column's resize handle stuck out by a few pixels)
- Popup fields line up
- Switching files in the same tab no longer flashes: the previous page stays on screen until the new one is rendered (a cross-document view transition, Chrome 126+), and the Files tab shows the folder it already knows instead of "Loading…". Before, the whole page went blank for 60–400 ms and the raw Markdown could show through. In a new tab, the background while loading matches your last theme, so a dark MarkLens theme on a light system no longer flashes white. If MarkLens is turned off, or doesn't render within 1.5 s, the raw text is shown as usual
- With the same file open in two tabs, live reload no longer misses changes in one of them
- Checking off a task no longer writes to the wrong file when two authorized folders with the same name both contain the page's path (for example `C:\work\docs` and `D:\backup\docs`). MarkLens compares the files with the page; if it still can't tell which one is open (two identical copies), it refuses to write and says so instead of guessing
- Reopening a page that was turned off and then quickly turned back on no longer stays on the raw text
- File names such as `README.md` and bare domains such as `example.com` are no longer turned into links (`.md` is a country domain). Autolinks now follow GitHub: `http(s)://`, `www.` and email addresses only

### Security
- HTML in a document can no longer use MarkLens's own `ml-` class and id names, so it cannot fake a full-screen overlay, a toast or a toolbar on top of the page
- The `name` attribute is kept only on `<a>`, so elements such as `<img name="querySelector">` cannot overwrite methods on `document` (DOM clobbering)
- On web pages, per-tab layout (sidebar, width) is no longer saved in the site's own `sessionStorage`, where later pages of the same site in that tab could read it and detect MarkLens. It now lives in memory and resets on reload; local files are unchanged
- Folder listings for the Files tab are read only from local `file://` folders (no network shares or `.` / `..` segments) and return only Markdown file names and subfolder names
- New end-to-end attack suite (`test/fixtures/security.md`, partly adapted from local-markdown-viewer, MIT) with 60+ samples; every link, diagram node and summary is clicked and nothing may run

## [1.2.0] - 2026-10-31

### Added
- **Mermaid diagrams** in local files: flowcharts, sequence diagrams and the rest of Mermaid 12.2.0. The library (~5 MB) is loaded only when a document contains a mermaid block. Diagrams follow the light/dark theme, stay in place during live reload, can be toggled back to source, and show the error message next to the source when the syntax is wrong. Can be turned off in the popup. Not drawn on `http(s)://` pages, so websites cannot detect MarkLens through its library files
- Theme button in the toolbar and a `d` key on reading pages: system → light → dark, applied to every open tab
- GitHub Actions: end-to-end tests on every push to `main` and every pull request; tagging `vX.Y.Z` runs the tests, packages the extension and publishes a release with notes taken from this file

### Changed
- The browser shortcut for cycling the theme is now `Alt+Shift+D`: `Alt+Shift+T` is taken by Chrome on Windows (focus toolbar), so it never reached MarkLens. Only new installs get the new default; existing installs can set it at `chrome://extensions/shortcuts`
- New icon: a bold "M" inside focus brackets, designed to stay legible at 16 px; the SVG source is kept in `icons/icon.svg`
- Large documents: "Fold all" is 10–20× faster (1 MB: 2.3 s → 0.2 s; 3 MB: 24 s → 1.1 s). Documents with more than ~3,000 top-level blocks (roughly 400 KB) now hide folded sections with plain CSS, so Ctrl+F no longer finds text inside folded sections there — unfold first. Smaller documents keep Ctrl+F reveal
- Live reload no longer transfers the whole file every second when nothing changed (idle CPU on a 3 MB file: ~190 ms/s → ~1 ms/s)
- Outline highlighting uses a binary search instead of measuring every heading on scroll

## [1.1.0] - 2026-10-31

### Added
- **Check off tasks in local files**: click a task-list checkbox in a local `.md` file and `[ ]` / `[x]` is saved straight back to the file — no editor needed
  - Works in nested lists, ordered lists and blockquotes; checkboxes inside code blocks are never touched
  - **Undo** from the toast
  - Refuses to write if the file was changed elsewhere (e.g. just saved in your editor), then reloads the latest content
  - Keeps line endings (CRLF / LF) and BOM; only the clicked line changes
  - Authorize a folder once (e.g. `D:\Projects`). After a Chrome restart you may be asked to confirm again — choose **Allow on every visit** to skip it
  - Folder access is held by the extension itself; ordinary web pages, including local HTML files, cannot reach it
  - Manage folders or turn the feature off from the popup
- **Aligned box-drawing tables in code blocks**: text diagrams such as `┌─┬─┐` now line up when mixing CJK and ASCII, with no font installation required. MarkLens measures the actual glyph widths and scales the system CJK font for code blocks so each CJK character is exactly two columns wide. [Sarasa Gothic](https://github.com/be5invis/Sarasa-Gothic) is used automatically when installed (see README)

## [1.0.0] - 2026-10-31

First public release.

### Added
- Tables you can work with: drag to resize columns, click headers to sort (numbers, byte units, dates, CJK), filter rows, copy as TSV, fullscreen
- Sidebar outline with search, depth filter and resizable width
- Fold any section; folded content stays searchable with Ctrl+F
- Live reload for local files, keeping scroll position, folds and table state
- Per-tab layout (outline, text width) for side-by-side reading
- Light / dark / system theme, GitHub alerts, footnotes, task lists, front matter

### Security
- Allow-list HTML sanitizer, minimal permissions (`storage` only), no remote code

[Unreleased]: https://github.com/xjin9612/marklens/compare/v1.7.1...HEAD
[1.7.1]: https://github.com/xjin9612/marklens/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/xjin9612/marklens/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/xjin9612/marklens/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/xjin9612/marklens/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/xjin9612/marklens/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/xjin9612/marklens/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/xjin9612/marklens/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/xjin9612/marklens/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/xjin9612/marklens/releases/tag/v1.0.0
