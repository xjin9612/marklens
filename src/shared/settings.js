'use strict'
// 設定的預設值與存取；content script、popup、background 共用
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

MarkLens.SETTINGS_KEY = 'marklens:settings'

MarkLens.DEFAULTS = Object.freeze({
  enabled: true,
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
  taskWrite: true, // 本機檔案的任務清單可直接勾選並存回原檔（需先授權資料夾）
  mermaid: true, // 本機檔案的 mermaid 區塊繪製成圖表
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
  return w ? `${w}` : '滿版'
}
