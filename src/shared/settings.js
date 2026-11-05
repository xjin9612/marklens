'use strict'
// 設定的預設值與存取；content script、popup、background 共用
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

MarkLens.SETTINGS_KEY = 'marklens:settings'

MarkLens.DEFAULTS = Object.freeze({
  enabled: true,
  uiLang: 'auto', // 介面語言：auto（跟隨瀏覽器）| en | zh_TW
  // ----- 即時同步到所有分頁 -----
  theme: 'auto', // auto | light | dark
  fontSize: 16,
  lineHeight: 1.7,
  // ----- 新分頁的預設值（已開的分頁不受影響） -----
  textWidth: 1200, // 文字欄最大寬度 px；0 = 滿版
  tableWidth: 'full', // full：表格與程式碼可超出文字欄 | text：跟隨文字欄
  tocHidden: false,
  tocDepth: 3, // 目錄顯示到第幾層標題
  tocWidth: 260,
  tableWrap: true, // 表格儲存格是否換行
  codeWrap: false, // 程式碼是否自動換行
  autoRefresh: 'local', // off | local（僅 file://）| all
  refreshInterval: 1000,
  rememberScroll: true,
  linkNewTab: true, // 外部 http(s) 連結在新分頁開啟
  fileIgnore: '.*, node_modules, target, dist, build', // 側邊欄檔案列表略過的名稱（逗號分隔，* 為萬用字元）
  editor: 'none', // 用編輯器開啟：none | vscode | custom
  editorUrl: '', // editor 為 custom 時的網址範本，{path} 為檔案路徑、{line} 為行號
  taskWrite: true, // 本機檔案的任務清單可直接勾選並存回原檔（需先授權資料夾）
  mermaid: true, // 本機檔案的 mermaid 區塊繪製成圖表
  math: true, // 本機檔案的 $…$ 數學公式以 KaTeX 繪製
})

// 會即時同步到所有已開分頁的設定
MarkLens.LIVE_KEYS = ['theme', 'fontSize', 'lineHeight']

// 文字寬度循環順序（快捷鍵與工具列使用）
MarkLens.WIDTH_PRESETS = [0, 1600, 1200, 960]
MarkLens.THEME_ORDER = ['auto', 'light', 'dark']

MarkLens.loadSettings = async function () {
  const data = await chrome.storage.local.get(MarkLens.SETTINGS_KEY)
  const stored = { ...(data[MarkLens.SETTINGS_KEY] || {}) }
  // 舊版的 width 欄位改名為 textWidth
  if ('width' in stored && !('textWidth' in stored)) stored.textWidth = stored.width
  delete stored.width
  return { ...MarkLens.DEFAULTS, ...stored }
}

MarkLens.saveSettings = async function (patch) {
  const current = await MarkLens.loadSettings()
  const next = { ...current, ...patch }
  await chrome.storage.local.set({ [MarkLens.SETTINGS_KEY]: next })
  return next
}

MarkLens.nextOf = function (list, current) {
  const i = list.indexOf(current)
  return list[(i + 1) % list.length]
}

MarkLens.widthLabel = function (w) {
  return w ? `${w}` : MarkLens.t('widthFull')
}

/* ---------- 用編輯器開啟 ---------- */
// 只有註冊了網址協定的編輯器能從瀏覽器開啟；記事本、Notepad++ 沒有，無法支援
MarkLens.EDITORS = {
  vscode: 'vscode://file/{path}:{line}', // VS Code 官方文件：vscode://file/完整路徑:行:欄
}

/** 目前設定的網址範本；未設定或不合法時回傳空字串 */
MarkLens.editorTemplate = function (settings) {
  const tpl = settings.editor === 'custom' ? String(settings.editorUrl || '').trim() : MarkLens.EDITORS[settings.editor] || ''
  if (!tpl.includes('{path}')) return ''
  // 只允許編輯器自己的協定，不能是網頁、檔案或指令碼網址
  const scheme = (/^([a-z][a-z0-9+.-]*):/i.exec(tpl) || [])[1]?.toLowerCase()
  if (!scheme || ['http', 'https', 'file', 'javascript', 'data', 'blob', 'about', 'chrome', 'chrome-extension'].includes(scheme)) return ''
  return tpl
}

/**
 * 組出開啟檔案的網址
 * @param {string} fileUrl 目前頁面的 file:// 網址
 * @param {number} line 1 起算的行號
 */
MarkLens.editorUrl = function (settings, fileUrl, line = 1) {
  const tpl = MarkLens.editorTemplate(settings)
  if (!tpl) return ''
  let path = new URL(fileUrl).pathname
  try {
    path = decodeURIComponent(path)
  } catch {
    // 不合法的 % 編碼：沿用原字串
  }
  // file:///D:/a.md 的路徑是 /D:/a.md；Windows 拿掉開頭的 /，其他系統保留在範本的 / 之後
  path = path.replace(/^\/+/, '')
  return tpl.replaceAll('{path}', encodeURI(path)).replaceAll('{line}', String(line))
}
