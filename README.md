# MarkLens

English | [繁體中文](./README.zh-TW.md)

A lightweight, auditable Markdown reader for Chrome and Edge. Open any `.md` file — local or online — and read it with a sidebar outline, foldable sections, and tables you can actually work with: resize columns, sort, filter, and copy to a spreadsheet.

Inspired by [md-reader 2.x](https://github.com/md-reader/md-reader) (MIT); rewritten from scratch with three goals: **easy to audit, no remote code, no build step**.

## Install

1. Open `chrome://extensions` (Edge: `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
3. For local files: open the extension's **Details** and enable **Allow access to file URLs**.
4. After editing the source, click the reload icon on the extensions page.

## Features

| Area | What you get |
|---|---|
| Pages | Renders `.md` `.markdown` `.mkd` `.mdx` over `http(s)://` and `file://`; only takes over when the browser shows the file as plain text |
| Toolbar | Sticky top bar: outline, fold all, unfold all, text width, raw source / back to reading, back to top |
| Layout | Text column width: full / 1600 / 1200 / 960 / custom. Tables and code blocks can grow past the text column up to the page edge. Adjustable font size and line height; reading progress bar |
| Outline | Sidebar TOC (collapse with «), active-section highlight, heading search, depth filter, resizable width, two-line titles, folded-section markers, word count and reading time |
| Folding | Fold any section from the ▾ next to its heading. "Fold all" starts from the first heading level that has two or more headings. Folded content stays searchable with Ctrl+F and unfolds on match |
| Tables | **Drag to resize columns** (double-click the handle to auto-fit), **click headers to sort** (numbers with thousands separators, byte units, dates, CJK text; empty cells last; third click restores the original order), row filter (5+ rows), copy as TSV (paste straight into Excel), wrap toggle, fullscreen with sticky header. The table toolbar only appears on hover |
| Syntax | CommonMark + GFM, task lists, footnotes, `==highlight==`, GitHub alerts (`> [!NOTE]` etc.), collapsible front matter |
| Code | highlight.js syntax highlighting (common languages), language label, copy button, per-block wrap toggle |
| Images | Lazy loading, click to zoom (Esc to close) |
| Theme | System / light / dark |
| Live reload | Local files are checked every second and re-rendered only when changed — scroll position, folds, and table sort / widths / filters are preserved |
| Misc | Remembers reading position per file, print stylesheet, relative `.md` links open in the reader |

### Per-tab vs. global settings

- **Current tab only**: outline visibility, outline width, text width, raw view, folds. Kept across reloads, cleared when the tab closes — handy for comparing documents side by side.
- **Synced live to every tab**: theme, font size, line height.
- **Everything else in the popup** is the default for new tabs; open tabs pick it up after a reload. Dragging the outline width also saves it as the new default.

### Keyboard shortcuts

On a reading page (ignored while typing in an input):

| Key | Action |
|---|---|
| `t` | Toggle outline |
| `r` | Raw source / back to reading |
| `w` | Cycle text width |
| `[` / `]` | Fold all / unfold all |

Browser-level (change them at `chrome://extensions/shortcuts`):

| Key | Action |
|---|---|
| `Alt+Shift+B` | Toggle outline (current tab) |
| `Alt+Shift+C` | Cycle text width (current tab) |
| `Alt+Shift+R` | Raw source / back to reading (current tab) |
| `Alt+Shift+T` | Cycle theme (all tabs) |

## Security

- **Allow-list HTML sanitizer** (`src/content/sanitize.js`): keeps common tags such as `<details>`, `<kbd>` and tables; drops `<script>`, `<iframe>`, `<svg>`, every event-handler attribute, `style` (except table alignment), and `javascript:` / non-image `data:` URLs.
- **Minimal permissions**: only `storage`. Content scripts match Markdown file extensions only — no "read all sites" permission.
- **Local file reads** go through the background worker, which only reads the URL of the page that asked.
- **No remote code**: third-party libraries are pinned in `vendor/`; nothing is fetched or auto-updated at runtime.

## Project layout

```
manifest.json
src/
  background.js          shortcuts, local file reads
  shared/settings.js     settings defaults and storage (shared by all contexts)
  content/
    util.js              helpers, reading the page source
    sanitize.js          allow-list HTML sanitizer
    markdown.js          markdown-it setup, ==mark==, alerts, front matter
    enhance.js           heading anchors & folding, inline grouping, task lists, code blocks, images, stats
    table.js             column resize, sorting, filter, copy, fullscreen, state save/restore
    toc.js               sidebar outline
    main.js              entry point: layout, toolbar, shortcuts, per-tab state, live reload
    content.css          all styles (scoped under html.marklens)
  popup/                 settings popup
vendor/                  third-party libraries (versions in VERSIONS.md, licenses in licenses/)
scripts/vendor.mjs       script for upgrading vendor/
test/                    end-to-end tests and fixtures
package.json             dev tooling only (tests, vendor updates); the extension itself needs no build
```

## Upgrading third-party libraries

Edit the version table in `scripts/vendor.mjs`, then run:

```bash
npm run vendor
```

## Tests

```bash
npm install                          # installs playwright only (dev)
npx playwright install chromium      # first time only
npm test
```

The suite loads the extension into Chromium and opens local and http fixtures (`test/fixtures/sample.md`), covering:

- Rendering: GFM, task lists (tight and loose), footnotes, alerts, front matter, code highlighting
- Security: scripts, event handlers, `javascript:` links, style attributes
- Layout: text column width, wide tables beyond the text column, narrow-screen drawer outline
- Tables: sorting (numbers / bytes / dates), column resize, filter, state kept across live reload
- Folding: fold / unfold all, Ctrl+F reveal, outline markers
- Tabs: outline and width stay per tab, appearance syncs live, new tabs use updated defaults
- Popup settings

Screenshots go to the directory in the `SHOT_DIR` environment variable (system temp by default).

## Roadmap

- **Check off tasks in place**: toggle task-list checkboxes on the reading page and save back to the file (validated: folder access is held by the extension itself, out of reach of local web pages)
- **Mermaid**, loaded only when a document contains a mermaid block
- **Large files**: defer off-screen rendering and highlight code lazily for documents over 1 MB

## License

MIT. Third-party licenses are in `vendor/licenses/`.
