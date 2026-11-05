# Changelog

All notable changes to MarkLens are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Files tab** in the sidebar for local files: the Markdown files and subfolders next to the current document, folders first, sorted by name the way people expect (`2-…` before `10-…`). Only one folder is read up front; a subfolder is read when you open it, so large trees stay fast. Opening a file from the tree keeps the tree where it was (it expands to the new file), and ↑ moves the tree up a folder. Open folders and the selected tab are kept per tab. Hidden and dependency folders (`.*, node_modules, target, dist, build`) are skipped — edit the list in the popup → **File list**
- External `http(s)` links open in a new tab, so the document stays open; anchors, footnotes and same-site links are unchanged. Can be turned off in the popup
- Welcome page on first install: walks through turning on **Allow access to file URLs** (the status updates live), how to open a file, keyboard shortcuts and the main features. Reopen it any time from the popup → **Help**
- **Export HTML** (toolbar ⤓): saves what you see as one self-contained HTML file to share with people who don't have MarkLens. Styles, Mermaid diagrams and math fonts are embedded, folded sections are expanded, relative links and images become absolute, checkbox states are kept, and the file contains no JavaScript (a Content-Security-Policy blocks scripts)
- **Math** in local files with KaTeX 0.19.1: `$…$`, `$$…$$`, GitHub's `` $`…`$ `` and ` ```math ` blocks. KaTeX (~900 KB with fonts) loads only when a document contains math. Prices such as `$5 and $10`, escaped `\$` and code are left alone; a syntax error shows in red without affecting the rest. Can be turned off in the popup
- Interface in English and Traditional Chinese: toolbar, outline, tables, popup, folder access page, welcome page and shortcut names. Follows the browser language by default (other languages get English); pick a language in the popup → **Language** without changing Chrome's language (the extension's name and shortcut names on `chrome://extensions` still follow Chrome)
- Emoji shortcodes from GitHub's list (`:tada:` → 🎉). Code spans and code blocks are left alone, and text emoticons such as `:)` are not converted

### Changed
- Sidebar header is now `☰ | Outline  Files | 🔍`: the ☰ sits in the same spot whether the sidebar is open or closed, the « button is gone, and search opens from the magnifier or the `/` key (Esc closes). Search filters headings on the Outline tab and file names on the Files tab

### Fixed
- Read-only task checkboxes (file not UTF-8, saving turned off, or a page on the web) no longer look broken: clicking or hovering explains why the checkbox can't be saved
- Small tables that fit exactly no longer show a horizontal scrollbar (the last column's resize handle stuck out by a few pixels)
- Popup fields line up, and the language option no longer gets cut off
- File names such as `README.md` and bare domains such as `example.com` are no longer turned into links (`.md` is a country domain). Autolinks now follow GitHub: `http(s)://`, `www.` and email addresses only

### Security
- HTML in a document can no longer use MarkLens's own `ml-` class and id names, so it cannot fake a full-screen overlay, a toast or a toolbar on top of the page
- The `name` attribute is kept only on `<a>`, so elements such as `<img name="querySelector">` cannot overwrite methods on `document` (DOM clobbering)
- New end-to-end attack suite (`test/fixtures/security.md`, adapted in part from local-markdown-viewer, MIT): scripts, event handlers, `javascript:` / `vbscript:` / `data:` URLs with case, entity and whitespace tricks, iframes, objects, SVG, MathML, forms, `<meta>` / `<base>`, styles, headings, file names and Mermaid diagrams of several types. Every link, node and summary is clicked and nothing may run

## [1.2.0] - 2026-10-31

### Added
- **Mermaid diagrams** in local files: flowcharts, sequence diagrams and the rest of Mermaid 12.2.0. The library (~5 MB) is loaded only when a document contains a mermaid block. Diagrams follow the light/dark theme, stay in place during live reload, can be toggled back to source, and show the error message next to the source when the syntax is wrong. Can be turned off in the popup. Not drawn on `http(s)://` pages, so websites cannot detect MarkLens through its library files
- Theme button in the toolbar and a `d` key on reading pages: system → light → dark, applied to every open tab
- GitHub Actions: end-to-end tests on every push and pull request; tagging `vX.Y.Z` runs the tests, packages the extension and publishes a release with notes taken from this file

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

[Unreleased]: https://github.com/xjin9612/marklens/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/xjin9612/marklens/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/xjin9612/marklens/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/xjin9612/marklens/releases/tag/v1.0.0
