'use strict'
// Service worker：快捷鍵、代讀本機檔案、任務勾選寫回
importScripts('/src/shared/settings.js', '/src/shared/i18n.js', '/src/shared/roots.js')

// 首次安裝：開啟引導頁（說明如何開啟「允許存取檔案網址」）；更新時不打擾
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome/welcome.html') })
})

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'cycle-theme') {
    // 主題是全域設定，所有分頁同步
    const s = await MarkLens.loadSettings()
    await MarkLens.saveSettings({ theme: MarkLens.nextOf(MarkLens.THEME_ORDER, s.theme) })
    return
  }
  // 其餘指令只作用於目前分頁
  if (tab?.id != null) chrome.tabs.sendMessage(tab.id, { type: 'command', name: command }).catch(() => {})
})

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
    if (!url.startsWith('file:')) return { text: null }
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
   * root：樹的起點（本機資料夾網址，預設為頁面所在資料夾）；只有 MarkLens 自己的程式能發出這個請求，文件內容無法觸發
   * path：從起點往下的資料夾名稱陣列，不接受 .. 等跳脫
   */
  async 'list-dir'(msg, sender) {
    const url = (sender.url || '').split(/[?#]/)[0]
    if (!url.startsWith('file:')) return { status: 'unsupported' }
    const pageDir = url.slice(0, url.lastIndexOf('/') + 1)
    const root = msg.root ?? pageDir
    if (typeof root !== 'string' || !root.startsWith('file:///') || !root.endsWith('/') || /\/\.\.?\//.test(root)) {
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
    const ignore = ignorePatterns((await MarkLens.loadSettings()).fileIgnore)
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

  /** 介面語言設定為指定語言時，content script 透過這裡取得語系檔（content script 無權直接讀取） */
  async 'read-messages'(msg) {
    if (!MarkLens.UI_LANGS.includes(msg.lang)) return { status: 'error', error: 'unknown language' }
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
    const bytes = new Uint8Array(await res.arrayBuffer())
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return { status: 'ok', base64: btoa(bin) }
  },
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

const ASSET_RE = /^(?:src\/content\/content\.css|vendor\/katex\/katex\.min\.css|vendor\/katex\/fonts\/KaTeX_[A-Za-z0-9-]+\.woff2)$/

/* ---------- 任務勾選寫回 ---------- */

// 任務清單行：可有引用前綴（>）、縮排，無序（- * +）或有序（1. 1)）清單，後接 [ ] / [x]
const TASK_LINE_RE = /^((?:[ \t]*>[ \t]?)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])(\])/

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 切換原文第 line 行（0 起算）的勾選狀態
 * @param {{line:number, from:' '|'x', to:' '|'x', hash:string}} msg
 *   from：頁面認為目前的狀態；hash：頁面持有的原文 SHA-256，用來偵測檔案是否已被其他地方修改
 * @returns {{status:'ok'|'no-root'|'permission'|'conflict'|'not-utf8'|'unsupported'|'error', text?:string, root?:string}}
 */
async function toggleTask(msg, sender) {
  const url = (sender.url || '').split('#')[0]
  if (!url.startsWith('file:')) return { status: 'unsupported' }

  const found = await MarkLens.Roots.locate(url)
  if (!found) return { status: 'no-root' }
  const perm = await found.root.handle.queryPermission({ mode: 'readwrite' })
  if (perm !== 'granted') return { status: 'permission', root: found.root.handle.name }

  const bytes = new Uint8Array(await (await found.file.getFile()).arrayBuffer())
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) // 預設會去掉 BOM，與頁面讀到的一致
  } catch {
    return { status: 'not-utf8' }
  }

  // 檔案已被其他地方修改（例如編輯器剛存檔）：不寫入，回傳最新內容讓頁面更新
  if ((await sha256(text)) !== msg.hash) return { status: 'conflict', text }

  // 保留每行原本的換行字元（LF / CRLF）
  const lines = text.split(/(?<=\n)/)
  const line = lines[msg.line]
  const m = line != null && TASK_LINE_RE.exec(line)
  if (!m || m[2].toLowerCase() !== msg.from) return { status: 'conflict', text }

  lines[msg.line] = m[1] + msg.to + m[3] + line.slice(m[0].length)
  const updated = lines.join('')
  const writable = await found.file.createWritable()
  await writable.write((hasBom ? '﻿' : '') + updated)
  await writable.close()
  return { status: 'ok', text: updated, path: found.path }
}
