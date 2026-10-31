# Changelog

All notable changes to MarkLens are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- GitHub Actions: end-to-end tests on every push and pull request; tagging `vX.Y.Z` runs the tests, packages the extension and publishes a release with notes taken from this file

### Changed
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

[Unreleased]: https://github.com/xjin9612/marklens/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/xjin9612/marklens/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/xjin9612/marklens/releases/tag/v1.0.0
