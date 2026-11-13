'use strict'
// 設定的預設值與存取；content script、popup、background 共用
var Markloupe = globalThis.Markloupe || (globalThis.Markloupe = {})

Markloupe.SETTINGS_KEY = 'markloupe:settings'

Markloupe.DEFAULTS = Object.freeze({
  enabled: true,
  uiLang: 'auto', // 介面語言：auto（跟隨瀏覽器）| en | zh_TW | zh_CN
  // ----- 即時同步到所有分頁 -----
  theme: 'auto', // auto | light | dark
  palette: 'github', // 配色：github | sepia | contrast | green | graphite | custom
  // 自訂配色的三色（#rrggbb），其餘顏色由 shared/palette.js 推算；預設與 GitHub 配色相同
  customColors: Object.freeze({
    light: Object.freeze({ bg: '#ffffff', fg: '#1f2328', accent: '#0969da' }),
    dark: Object.freeze({ bg: '#0d1117', fg: '#e6edf3', accent: '#4493f8' }),
  }),
  customCss: '', // 使用者自訂的 CSS，套用在閱讀頁
  fontSize: 16,
  lineHeight: 1.7,
  // ----- 新分頁的預設值（已開的分頁不受影響） -----
  textWidth: 1200, // 文字欄最大寬度 px；0 = 滿版
  tableWidth: 'text', // text：跟隨文字欄，太寬時橫向捲動 | full：可往右超出文字欄
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
  mermaid: true, // mermaid 區塊繪製成圖表
  math: true, // $…$ 數學公式以 KaTeX 繪製
  // ----- 匯出 Word（字型名稱照 Word 的寫法；收件人沒有這個字型時，Word 改用同語系的替代字型） -----
  docxCjkFont: 'auto', // auto：依文件語言（繁中 Microsoft JhengHei、簡中 Microsoft YaHei、日文 Yu Gothic、韓文 Malgun Gothic）
  docxLatinFont: 'Calibri',
  docxCodeFont: 'Consolas',
  docxFontSize: 12, // pt
  docxPaper: 'A4', // A4 | Letter
})

// 會即時同步到所有已開分頁的設定
Markloupe.LIVE_KEYS = ['theme', 'palette', 'customColors', 'customCss', 'fontSize', 'lineHeight']

// 文字寬度循環順序（快捷鍵與工具列使用）
Markloupe.WIDTH_PRESETS = [0, 1600, 1200, 960]
Markloupe.THEME_ORDER = ['auto', 'light', 'dark']

// 字體大小（px）：整篇文章（內文、標題、程式碼、表格、公式、圖表）依此等比縮放，DEFAULTS.fontSize 為 100%
Markloupe.FONT_MIN = 10
Markloupe.FONT_MAX = 32
Markloupe.FONT_PRESETS = [12, 14, 16, 18, 20, 24, 28]

/** 放大／縮小一級：跳到下一個預設尺寸；自訂尺寸先跳到最接近的預設值 */
Markloupe.stepFontSize = function (current, dir) {
  const list = Markloupe.FONT_PRESETS
  const next = dir > 0 ? list.find(v => v > current) : [...list].reverse().find(v => v < current)
  return next ?? Math.min(Markloupe.FONT_MAX, Math.max(Markloupe.FONT_MIN, current))
}

Markloupe.fontPercent = function (px) {
  return `${Math.round((px / Markloupe.DEFAULTS.fontSize) * 100)}%`
}

Markloupe.PALETTES = ['github', 'sepia', 'contrast', 'green', 'graphite', 'custom']

/*
 * 跨裝置同步：開啟時（預設），SYNC_KEYS 另存一份到 chrome.storage.sync，由瀏覽器帳號同步到其他電腦。
 * 本機的 storage.local 仍是唯一的讀取來源；其他裝置的變更由 background 收到後寫回 storage.local。
 * 不同步的：授權資料夾、閱讀位置、自訂編輯器網址（含本機路徑）、側邊欄寬度與啟用狀態（各台電腦不同）
 */
Markloupe.SYNC_FLAG_KEY = 'markloupe:sync'
Markloupe.SYNC_KEYS = [
  'uiLang', 'theme', 'palette', 'customColors', 'fontSize', 'lineHeight', 'textWidth', 'tableWidth', 'tocHidden', 'tocDepth',
  'tableWrap', 'codeWrap', 'autoRefresh', 'refreshInterval', 'rememberScroll', 'linkNewTab', 'fileIgnore',
  'editor', 'taskWrite', 'mermaid', 'math', 'docxCjkFont', 'docxLatinFont', 'docxCodeFont', 'docxFontSize', 'docxPaper',
]
// storage.sync 單一項目上限 8192 bytes（含鍵名），自訂 CSS 另存一項
Markloupe.SYNC_CSS_KEY = 'markloupe:customCss'
Markloupe.CUSTOM_CSS_MAX_BYTES = 8000
Markloupe.cssBytes = css => new TextEncoder().encode(JSON.stringify(css)).length

Markloupe.isSyncEnabled = async function () {
  return (await chrome.storage.local.get(Markloupe.SYNC_FLAG_KEY))[Markloupe.SYNC_FLAG_KEY] !== false
}

;(() => {
  /**
   * 這台電腦的隨機代號，隨同步資料寫入 _from。storage.sync 的變更通知也包含自己的寫入，
   * 若照單全收，連續快速修改時較晚到的舊通知會把較新的本機設定蓋回去；因此只套用其他電腦的變更
   */
  const DEVICE_KEY = 'markloupe:device'
  async function deviceId() {
    const have = (await chrome.storage.local.get(DEVICE_KEY))[DEVICE_KEY]
    if (have) return have
    const id = crypto.randomUUID()
    await chrome.storage.local.set({ [DEVICE_KEY]: id })
    return id
  }

  function syncPayload(s, from) {
    const out = { [Markloupe.SETTINGS_KEY]: { ...Object.fromEntries(Markloupe.SYNC_KEYS.map(k => [k, s[k]])), _from: from } }
    if (Markloupe.cssBytes(s.customCss) <= Markloupe.CUSTOM_CSS_MAX_BYTES) out[Markloupe.SYNC_CSS_KEY] = s.customCss
    return out
  }

  /** 把本機設定寫到 storage.sync；內容相同時不寫，避免用掉寫入次數上限 */
  Markloupe.pushSync = async function (s) {
    const want = syncPayload(s, await deviceId())
    const have = await chrome.storage.sync.get(Object.keys(want))
    const diff = Object.fromEntries(Object.entries(want).filter(([k, v]) => JSON.stringify(have[k]) !== JSON.stringify(v)))
    // 自訂 CSS 另存一項，也要標示來源：設定那一項沒變時一併寫入，讓 pullSync 判斷得出是誰改的
    if (Markloupe.SYNC_CSS_KEY in diff && !(Markloupe.SETTINGS_KEY in diff)) diff[Markloupe.SETTINGS_KEY] = want[Markloupe.SETTINGS_KEY]
    if (Object.keys(diff).length) await chrome.storage.sync.set(diff)
  }

  /** 把其他電腦寫入 storage.sync 的設定合併進本機設定；回傳是否有變更 */
  Markloupe.pullSync = async function () {
    const remote = await chrome.storage.sync.get([Markloupe.SETTINGS_KEY, Markloupe.SYNC_CSS_KEY])
    if (!remote[Markloupe.SETTINGS_KEY] && remote[Markloupe.SYNC_CSS_KEY] === undefined) return false
    if (remote[Markloupe.SETTINGS_KEY]?._from === (await deviceId())) return false
    const current = await Markloupe.loadSettings()
    const patch = {}
    for (const k of Markloupe.SYNC_KEYS) {
      const v = remote[Markloupe.SETTINGS_KEY]?.[k]
      if (v !== undefined && JSON.stringify(v) !== JSON.stringify(current[k])) patch[k] = v
    }
    const css = remote[Markloupe.SYNC_CSS_KEY]
    if (typeof css === 'string' && css !== current.customCss) patch.customCss = css
    if (!Object.keys(patch).length) return false
    await chrome.storage.local.set({ [Markloupe.SETTINGS_KEY]: { ...current, ...patch } })
    return true
  }

  /** 開啟同步時：雲端已有設定就套用到這台電腦，沒有就上傳這台的設定 */
  Markloupe.setSyncEnabled = async function (on) {
    await chrome.storage.local.set({ [Markloupe.SYNC_FLAG_KEY]: on })
    if (!on) return
    // 雲端是其他電腦寫的就套用；沒有資料或是這台自己寫的（關閉期間本機可能又改過），上傳這台的設定
    const remote = (await chrome.storage.sync.get(Markloupe.SETTINGS_KEY))[Markloupe.SETTINGS_KEY]
    if (remote && remote._from !== (await deviceId())) await Markloupe.pullSync()
    else await Markloupe.pushSync(await Markloupe.loadSettings())
  }
})()

Markloupe.loadSettings = async function () {
  const data = await chrome.storage.local.get(Markloupe.SETTINGS_KEY)
  const stored = { ...(data[Markloupe.SETTINGS_KEY] || {}) }
  // 舊版的 width 欄位改名為 textWidth
  if ('width' in stored && !('textWidth' in stored)) stored.textWidth = stored.width
  delete stored.width
  return { ...Markloupe.DEFAULTS, ...stored }
}

/** 舊名稱 MarkLens 的儲存鍵（marklens:）搬到目前的鍵；目前的鍵已有值時保留，舊鍵一律移除 */
Markloupe.migrateLegacyStorage = async function () {
  const OLD = 'marklens:'
  const NEW = 'markloupe:'
  for (const area of [chrome.storage.local, chrome.storage.sync]) {
    const all = await area.get(null)
    const old = Object.keys(all).filter(k => k.startsWith(OLD))
    if (!old.length) continue
    const moved = {}
    for (const k of old) {
      const key = NEW + k.slice(OLD.length)
      if (!(key in all)) moved[key] = all[k]
    }
    if (Object.keys(moved).length) await area.set(moved)
    await area.remove(old)
  }
}

;(() => {
  // 同一個執行環境內依序寫入：讀改寫並行時，後寫入的整份設定會蓋掉先寫入的其他鍵
  let queue = Promise.resolve()
  Markloupe.saveSettings = function (patch) {
    const run = queue.then(async () => {
      const current = await Markloupe.loadSettings()
      const next = { ...current, ...patch }
      await chrome.storage.local.set({ [Markloupe.SETTINGS_KEY]: next })
      if (await Markloupe.isSyncEnabled()) await Markloupe.pushSync(next).catch(() => {}) // 同步失敗（例如超過寫入次數）不影響本機
      return next
    })
    queue = run.catch(() => {})
    return run
  }
})()

Markloupe.nextOf = function (list, current) {
  const i = list.indexOf(current)
  return list[(i + 1) % list.length]
}

Markloupe.widthLabel = function (w) {
  return w ? `${w}` : Markloupe.t('widthFull')
}

/* ---------- 用編輯器開啟 ---------- */
// 只有註冊了網址協定的編輯器能從瀏覽器開啟；記事本、Notepad++ 沒有，無法支援
Markloupe.EDITORS = {
  vscode: 'vscode://file/{path}:{line}', // VS Code 官方文件：vscode://file/完整路徑:行:欄
}

/** 目前設定的網址範本；未設定或不合法時回傳空字串 */
Markloupe.editorTemplate = function (settings) {
  const tpl = settings.editor === 'custom' ? String(settings.editorUrl || '').trim() : Markloupe.EDITORS[settings.editor] || ''
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
Markloupe.editorUrl = function (settings, fileUrl, line = 1) {
  const tpl = Markloupe.editorTemplate(settings)
  if (!tpl) return ''
  let path = new URL(fileUrl).pathname
  try {
    path = decodeURIComponent(path)
  } catch {
    // 不合法的 % 編碼：沿用原字串
  }
  // file:///D:/a.md 的路徑是 /D:/a.md；Windows 拿掉開頭的 /，其他系統保留在範本的 / 之後
  // 逐段編碼：檔名中的 # ? & 不能被當成網址的片段或參數；磁碟代號的冒號保留
  const encoded = path
    .replace(/^\/+/, '')
    .split('/')
    .map((seg, i) => (i === 0 && /^[a-z]:$/i.test(seg) ? seg : encodeURIComponent(seg)))
    .join('/')
  return tpl.replaceAll('{path}', encoded).replaceAll('{line}', String(line))
}
