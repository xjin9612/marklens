'use strict'
// Service worker：content script 無權或不該自己做的事（讀本機檔案與資料夾、寫回任務、讀擴充功能內的檔案），以及快捷鍵與設定同步
importScripts('/src/shared/settings.js', '/src/shared/i18n.js', '/src/shared/roots.js', '/src/shared/hash.js', '/src/shared/lines.js', '/src/shared/web-access.js')

// 首次安裝：開啟引導頁（說明如何開啟「允許存取檔案網址」）；更新時不打擾
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome/welcome.html') })
  if (reason === 'update') migrateLegacy()
  syncWebScripts()
})

/** 舊名稱 MarkLens 的設定與授權資料夾搬到目前的名稱；具名函式方便測試直接呼叫 */
function migrateLegacy() {
  return Promise.all([Markloupe.migrateLegacyStorage(), Markloupe.Roots.migrateLegacy()])
}

/*
 * ---------- 網頁上的 .md ----------
 * manifest 的 content script 只處理本機檔案，安裝時不必要求「所有網站」的權限。
 * 使用者授予網站權限後，以 manifest 中同樣的兩組腳本動態註冊到網頁網址；撤銷權限時移除。
 * 擴充功能更新後腳本清單可能改變，所以 onInstalled 也重新註冊。
 */
let webSync = Promise.resolve()
/** 依目前的網站權限註冊或移除網頁用的 content script；依序執行，避免同時註冊同一個 id */
function syncWebScripts() {
  const run = async () => {
    const granted = await chrome.permissions.contains({ origins: Markloupe.WEB_ORIGINS })
    const groups = chrome.runtime.getManifest().content_scripts
    const ids = groups.map((_, i) => `web-${i}`)
    const existing = (await chrome.scripting.getRegisteredContentScripts({ ids })).map(s => s.id)
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing })
    if (!granted) return
    await chrome.scripting.registerContentScripts(
      groups.map((g, i) => ({
        id: ids[i],
        matches: g.matches.map(m => m.replace(/^file:\/\/\//, '*://*/')),
        js: g.js,
        css: g.css,
        runAt: g.run_at,
      })),
    )
  }
  webSync = webSync.then(run, run)
  return webSync
}
chrome.permissions.onAdded.addListener(syncWebScripts)
chrome.permissions.onRemoved.addListener(syncWebScripts)

// 跨裝置同步：其他電腦改了設定，寫回這台的 storage.local，已開的分頁照常由 storage.onChanged 套用
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync' || !(Markloupe.SETTINGS_KEY in changes || Markloupe.SYNC_CSS_KEY in changes)) return
  if (await Markloupe.isSyncEnabled()) await Markloupe.pullSync()
})
chrome.runtime.onStartup.addListener(async () => {
  if (await Markloupe.isSyncEnabled()) await Markloupe.pullSync()
})

/** 瀏覽器快捷鍵（manifest 的 commands）；具名函式方便測試直接呼叫 */
async function onCommand(command, tab) {
  if (command === 'cycle-theme') {
    // 主題是全域設定，所有分頁同步
    const s = await Markloupe.loadSettings()
    await Markloupe.saveSettings({ theme: Markloupe.nextOf(Markloupe.THEME_ORDER, s.theme) })
    return
  }
  if (tab?.id != null) await chrome.tabs.sendMessage(tab.id, { type: 'command', name: command }).catch(() => {})
}
chrome.commands.onCommand.addListener(onCommand)

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return
  const handler = HANDLERS[msg?.type]
  if (!handler) return
  handler(msg, sender).then(reply, err => reply({ status: 'error', error: `${err.name}: ${err.message}` }))
  return true // 非同步回覆
})

/* ---------- 上次讀取的檔案內容（自動更新比對用） ---------- */
// service worker 閒置時會被終止，快取隨之清空，下一次讀取就完整回傳一次，不影響正確性
const lastRead = new Map()
const LAST_READ_LIMIT = 20

function rememberRead(key, bytes) {
  lastRead.delete(key)
  lastRead.set(key, bytes)
  if (lastRead.size > LAST_READ_LIMIT) lastRead.delete(lastRead.keys().next().value)
}

function sameBytes(a, b) {
  if (!a || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const HANDLERS = {
  /**
   * 代 content script 讀取「它自己所在頁面」的本機檔案
   * 只接受 sender.url，不接受任意路徑，避免被用來讀取其他檔案
   */
  async 'read-self'(msg, sender) {
    const url = (sender.url || '').split('#')[0]
    if (!url.startsWith('file:') || !isLocalFile(url)) return { text: null }
    // 快取以分頁區分：同一個檔案開在兩個分頁時，各自都要拿到變更
    const cacheKey = `${sender.tab?.id}:${sender.frameId}:${url}`
    let bytes
    try {
      bytes = new Uint8Array(await (await fetch(url, { cache: 'no-store' })).arrayBuffer())
    } catch {
      return { text: null }
    }
    // 自動更新：內容與上次相同就不回傳，省下大檔的傳輸與頁面端比對
    const same = sameBytes(lastRead.get(cacheKey), bytes)
    rememberRead(cacheKey, bytes)
    if (msg.ifChanged && same) return { unchanged: true }
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    } catch {
      // 不是合法 UTF-8：交給瀏覽器原本的解碼結果
      return { text: null }
    }
  },

  /** 開啟授權頁；完成後可切回原分頁 */
  async 'open-grant'(_msg, sender) {
    const back = sender.tab?.id != null ? `?back=${sender.tab.id}` : ''
    await chrome.tabs.create({ url: chrome.runtime.getURL(`src/grant/grant.html${back}`) })
    return { status: 'ok' }
  },

  'toggle-task': toggleTask,

  /**
   * 側邊欄「檔案」分頁：列出資料夾的 Markdown 與子資料夾（讀取 Chrome 對 file:// 資料夾產生的清單頁）
   * root：樹的起點（本機資料夾網址，預設為頁面所在資料夾），由檔案分頁保存在分頁的 sessionStorage。
   *   同一分頁中的其他 file:// 頁面理論上能改寫它，所以這裡只接受本機路徑：不接受網路位置（UNC，
   *   file://主機/… 或 file:////主機/…），避免被誘導去連線其他電腦
   * path：從起點往下的資料夾名稱陣列，不接受 .. 等跳脫
   */
  async 'list-dir'(msg, sender) {
    const url = (sender.url || '').split(/[?#]/)[0]
    if (!url.startsWith('file:')) return { status: 'unsupported' }
    const pageDir = url.slice(0, url.lastIndexOf('/') + 1)
    const root = msg.root ?? pageDir
    if (!isLocalFolder(root)) {
      return { status: 'error', error: 'invalid root' }
    }
    const segs = Array.isArray(msg.path) ? msg.path : []
    if (segs.length > 32 || !segs.every(s => typeof s === 'string' && s && s !== '.' && s !== '..' && !/[\\/]/.test(s))) {
      return { status: 'error', error: 'invalid path' }
    }
    const dir = root + segs.map(s => `${encodeURIComponent(s)}/`).join('')
    let html
    try {
      html = await (await fetch(dir)).text()
    } catch {
      return { status: 'error' }
    }
    const ignore = ignorePatterns((await Markloupe.loadSettings()).fileIgnore)
    const decode = s => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    }
    // addRow("顯示名稱", "編碼後的網址", 是否為資料夾, …)；非 ASCII 檔名的顯示名稱可能是空字串，所以用網址欄位
    const dirs = []
    const files = []
    for (const m of html.matchAll(/addRow\("(?:[^"\\]|\\.)*","((?:[^"\\]|\\.)*)",([01]),/g)) {
      let href
      try {
        href = JSON.parse(`"${m[1]}"`)
      } catch {
        continue
      }
      const name = decode(href.replace(/\/$/, ''))
      if (!name || name === '..' || ignore.some(re => re.test(name))) continue
      if (m[2] === '1') dirs.push(name)
      else if (MD_FILE_RE.test(name)) files.push({ name, url: dir + href })
    }
    dirs.sort(NATURAL.compare)
    files.sort((a, b) => NATURAL.compare(a.name, b.name))
    return { status: 'ok', dirs, files }
  },

  /** content script 透過這裡取得整份語系檔（content script 無權直接讀取擴充功能內的檔案） */
  async 'read-messages'(msg) {
    if (!Markloupe.UI_LANGS.includes(msg.lang)) return { status: 'error', error: 'unknown language' }
    const res = await fetch(chrome.runtime.getURL(`_locales/${msg.lang}/messages.json`))
    return { status: 'ok', messages: await res.json() }
  },

  /**
   * 匯出 HTML 用：讀取擴充功能內的樣式與字型
   * 只允許固定的幾個檔案，不能被拿來讀取擴充功能的其他內容
   */
  async 'read-asset'(msg) {
    const path = String(msg.path || '')
    if (!ASSET_RE.test(path)) return { status: 'error', error: 'not allowed' }
    const res = await fetch(chrome.runtime.getURL(path))
    if (!res.ok) return { status: 'error', error: `HTTP ${res.status}` }
    if (path.endsWith('.css')) return { status: 'ok', text: await res.text() }
    return { status: 'ok', base64: toBase64(new Uint8Array(await res.arrayBuffer())) }
  },

  /**
   * 匯出時內嵌圖片：回傳圖片的 MIME 類型與 base64。失敗時 reason 為
   * not-allowed、no-permission（讀取失敗且沒有網站權限，原因不一定是權限）、unreachable、too-large、not-image 之一。
   * 匯出檔可能被分享出去：網路上的文件不能內嵌 file:// 圖片，也不能內嵌內網或本機服務的圖片（與文件同源的除外）
   */
  async 'read-image'(msg, sender) {
    let url
    try {
      url = new URL(String(msg.url))
    } catch {
      return { status: 'error', reason: 'not-allowed' }
    }
    const local = url.protocol === 'file:'
    let from
    try {
      from = new URL(sender.url)
    } catch {
      return { status: 'error', reason: 'not-allowed' }
    }
    const fromFile = from.protocol === 'file:'
    // 網路上的文件：內網圖片只接受與文件同源的
    const webAllowed = target => /^https?:$/.test(target.protocol) && (fromFile || !privateHost(target.hostname) || from.origin === target.origin)
    if (local ? !fromFile || !isLocalFile(url.href) : !webAllowed(url)) return { status: 'error', reason: 'not-allowed' }
    let res
    try {
      // 不帶 cookie：允許任何網站跨站讀取（Access-Control-Allow-Origin: *）的圖床不接受帶 cookie 的請求
      res = await fetch(url.href, { credentials: 'omit' })
    } catch {
      // 沒有網站權限時，跨站讀取被擋與連不上無法區分
      const denied = !local && !(await chrome.permissions.contains({ origins: Markloupe.WEB_ORIGINS }))
      return { status: 'error', reason: denied ? 'no-permission' : 'unreachable' }
    }
    // 重新導向後的網址也要符合規則。導向的目的地在檢查前已收到請求；瀏覽器顯示這張圖片時同樣會請求它
    if (!local && !webAllowed(new URL(res.url))) return { status: 'error', reason: 'not-allowed' }
    if (!res.ok) return { status: 'error', reason: 'unreachable' }
    const bytes = await readLimited(res, IMAGE_MAX)
    if (!bytes) return { status: 'error', reason: 'too-large' }
    const mime = imageType(bytes)
    if (!mime) return { status: 'error', reason: 'not-image' }
    return { status: 'ok', mime, base64: toBase64(bytes) }
  },
}

const IMAGE_MAX = 10 * 1024 * 1024

/** 讀完回應本文；超過 max 位元組就中斷並回傳 null。沒有本文（例如 204）時回傳空陣列 */
async function readLimited(res, max) {
  if (Number(res.headers.get('content-length')) > max) return null
  if (!res.body) return new Uint8Array(0)
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) {
      reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) {
    bytes.set(c, offset)
    offset += c.length
  }
  return bytes
}

/** 內網或本機服務的主機：localhost、.local、沒有點號的名稱、私有與保留的 IP。以網域名稱指向內網的情況判斷不到 */
function privateHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || !/[.:]/.test(h)) return true
  const v4 = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/)
  if (v4) {
    const [a, b] = [+v4[1], +v4[2]]
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  return h.includes(':') && (h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:'))
}

function toBase64(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** 依檔頭判斷圖片格式；不是瀏覽器能顯示的圖片時回傳 null */
function imageType(b) {
  const ascii = (from, to) => String.fromCharCode(...b.subarray(from, to))
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (ascii(0, 4) === 'GIF8') return 'image/gif'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  if (ascii(4, 8) === 'ftyp' && /^avi[fs]$/.test(ascii(8, 12))) return 'image/avif'
  if (ascii(0, 2) === 'BM') return 'image/bmp'
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon'
  const head = new TextDecoder().decode(b.subarray(0, 1024)).replace(/^\uFEFF/, '').trimStart()
  if (head.startsWith('<') && /<svg[\s>]/i.test(head)) return 'image/svg+xml'
  return null
}

/** 沒有主機名稱的 file:// 網址。WSL（file://wsl.localhost/…）與網路共用的網址 Chrome 一律拒絕讀取，不必發出請求 */
function isLocalFile(url) {
  try {
    const u = new URL(url)
    return u.host === '' && !u.pathname.startsWith('//')
  } catch {
    return false
  }
}

/** 本機資料夾網址：file:///X/…/，沒有主機名稱、不是 //主機 開頭的網路路徑、不含 . 或 .. 段落 */
function isLocalFolder(root) {
  if (typeof root !== 'string' || !root.startsWith('file:///') || !root.endsWith('/')) return false
  let u
  try {
    u = new URL(root)
  } catch {
    return false
  }
  if (u.host !== '' || u.pathname.startsWith('//')) return false
  // URL 會把 . 與 .. 正規化掉，所以檢查原始字串（含 %2e 這類編碼寫法）
  let path
  try {
    path = decodeURIComponent(root.slice('file://'.length))
  } catch {
    return false
  }
  return !path.split('/').some(s => s === '.' || s === '..') && !path.includes('\\')
}

const MD_FILE_RE = /\.(md|markdown|mkd|mdx)$/i

/** 「檔案列表略過」設定：逗號或換行分隔，* 為萬用字元，不分大小寫（.* 代表以 . 開頭的名稱） */
function ignorePatterns(text) {
  return String(text || '')
    .split(/[,\n]/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(p => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i'))
}
const NATURAL = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

const ASSET_RE = /^(?:src\/shared\/tokens\.css|src\/content\/content\.css|vendor\/katex\/katex\.min\.css|vendor\/katex\/fonts\/KaTeX_[A-Za-z0-9-]+\.woff2)$/

/* ---------- 任務勾選寫回 ---------- */

// 任務清單行：可有引用前綴（>）、縮排，無序（- * +）或有序（1. 1)）清單，後接 [ ] / [x]
// > 之後的空白只由下一段的 [ \t]* 比對：同一段空白有兩種切法時，對不上的長行會指數回溯（ReDoS）
const TASK_LINE_RE = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])(\])/

/**
 * 切換原文第 line 行（0 起算）的勾選狀態
 * @param {{line:number, from:' '|'x', to:' '|'x', hash:string}} msg
 *   from：頁面認為目前的狀態；hash：頁面持有的原文 SHA-256，用來偵測檔案是否已被其他地方修改
 * @returns {{status:'ok'|'no-root'|'permission'|'ambiguous'|'conflict'|'not-utf8'|'unsupported'|'error', text?:string, root?:string, path?:string}}
 *   no-root：授權資料夾中沒有這個路徑，或同路徑的檔案內容與頁面不同（是別處的同名檔案）
 *   ambiguous：多個授權資料夾都有內容相同的這個檔案，無法判斷是哪一份；path：寫入的檔案（授權資料夾名稱起算）
 */
async function toggleTask(msg, sender) {
  const url = (sender.url || '').split('#')[0]
  if (!url.startsWith('file:')) return { status: 'unsupported' }
  // to 會原樣寫進檔案：只接受勾選框的兩種狀態與非負整數行號
  const STATES = [' ', 'x']
  if (!Number.isInteger(msg.line) || msg.line < 0 || !STATES.includes(msg.from) || !STATES.includes(msg.to) || typeof msg.hash !== 'string') {
    return { status: 'error', error: 'invalid message' }
  }

  const candidates = await Markloupe.Roots.locate(url)
  if (!candidates.length) return { status: 'no-root' }
  const granted = []
  for (const c of candidates) {
    if ((await c.root.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') continue
    // 巢狀的授權資料夾（例如 D:\A 與 D:\A\sub）會找到同一個實體檔案，只留一個
    let dup = false
    for (const g of granted) if (await g.file.isSameEntry(c.file)) dup = true
    if (!dup) granted.push(c)
  }
  if (!granted.length) return { status: 'permission', root: candidates[0].root.handle.name }

  // 授權資料夾只以名稱對應到網址路徑，可能對到別處的同名檔案（例如授權 D:\notes，開的是 E:\backup\notes\todo.md）：
  // 與頁面實際所在的檔案內容一致的才是同一個檔案
  const read = async c => new Uint8Array(await (await c.file.getFile()).arrayBuffer())
  let pageBytes
  try {
    pageBytes = new Uint8Array(await (await fetch(url, { cache: 'no-store' })).arrayBuffer())
  } catch (err) {
    return { status: 'error', error: `${err.name}: ${err.message}` }
  }
  const same = []
  for (const c of granted) {
    const b = await read(c)
    if (sameBytes(b, pageBytes)) same.push([c, b])
  }
  if (!same.length) return { status: 'no-root' }
  // 兩份內容完全相同的副本：無法確定是哪一個檔案，不寫入
  if (same.length > 1) return { status: 'ambiguous' }
  const [found, bytes] = same[0]
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) // 預設會去掉 BOM，與頁面讀到的一致
  } catch {
    return { status: 'not-utf8' }
  }

  // 檔案已被其他地方修改（例如編輯器剛存檔）：不寫入，回傳最新內容讓頁面更新
  if ((await Markloupe.sha256(text)) !== msg.hash) return { status: 'conflict', text }

  // 保留每行原本的換行字元（LF / CRLF / CR）
  const lines = Markloupe.splitLines(text)
  const line = lines[msg.line]
  const m = line != null && TASK_LINE_RE.exec(line)
  if (!m || m[2].toLowerCase() !== msg.from) return { status: 'conflict', text }

  lines[msg.line] = m[1] + msg.to + m[3] + line.slice(m[0].length)
  const updated = lines.join('')
  const writable = await found.file.createWritable()
  await writable.write((hasBom ? '\uFEFF' : '') + updated)
  await writable.close()
  return { status: 'ok', text: updated, path: found.path }
}
