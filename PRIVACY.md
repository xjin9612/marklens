# MarkLens Privacy Policy

English | [繁體中文](PRIVACY.zh-TW.md)

*Last updated: 2026-11-04*

MarkLens is a browser extension that displays Markdown files. **It does not collect, sell or send your data to anyone.** It has no account, no analytics, no ads and no server of its own. Everything described below stays in your browser on your computer.

## What MarkLens stores, and where

| Data | Where it is kept | Why |
|---|---|---|
| Your settings (theme, font size, text width, language, editor, and the other options in the popup) | The extension's own storage (`chrome.storage.local`) | So your choices apply every time you open a document |
| Reading position: the address of the last 300 Markdown files you opened and how far you had scrolled | The extension's own storage (`chrome.storage.local`) | To return you to the same place when you reopen a file. Older entries are removed automatically |
| Folders you allowed for task check-off | The extension's own database (IndexedDB), as folder access handles from Chrome | So checking a box can write back to the file without asking again. Remove them from the popup → **Manage folders** |
| Small interface states: which popup sections are open, the sidebar and folder tree of the current tab, the theme of the loading screen | The browser's storage for the popup or for local `file://` pages only (`localStorage`, `sessionStorage`). MarkLens does not read or write the storage of websites | So the interface looks the same as you left it |

This data is not synced to your other devices. Uninstalling MarkLens deletes all of it.

## Network access

MarkLens never sends your data anywhere. The only network request it makes on its own is reloading the document you opened:

- **Auto refresh** of a Markdown file opened from a website reloads that same address from that same website, the way pressing Reload would. No other site is contacted.
- **Images and links** inside a document are loaded from wherever the document points, as with any web page. MarkLens does not add requests of its own.
- **Mermaid diagrams and math** are drawn with libraries packaged inside the extension. No code or data is downloaded from elsewhere.

## Your files

- MarkLens reads a local file only when you open it in the browser, and only that file. The **Files** tab lists the names of Markdown files and folders next to it; it does not read their contents until you open one.
- MarkLens changes a file only when you check or uncheck a task box in a folder you allowed, and then only that one line. You can turn task check-off off in the popup.
- **Export HTML** and **Copy** only happen when you click them; the file goes where you choose to save it, and copied text goes to your clipboard.
- **Open in your editor** passes the file's path and line number to the editor installed on your computer.

## Permissions

MarkLens asks for one permission, `storage`, to keep the settings above. Its content scripts run only on addresses that end in a Markdown extension (`.md`, `.markdown`, `.mkd`, `.mdx`). Chrome describes this as access to all websites because its prompt ignores the part of the address after the site name; you can limit it on the extension's **Details** page under **Site access**.

## Changes

Changes to this policy are recorded in this file's history on GitHub. If MarkLens ever needs to handle data in a new way, this page will be updated before that version is released.

## Contact

Questions or concerns: open an issue at <https://github.com/xjin9612/marklens/issues>.
