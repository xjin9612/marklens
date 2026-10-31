'use strict'
// Service worker：快捷鍵、代讀本機檔案、任務勾選寫回
importScripts('/src/shared/settings.js', '/src/shared/roots.js')

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

function rememberRead(url, bytes) {
  lastRead.delete(url)
  lastRead.set(url, bytes)
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
    let bytes
    try {
      bytes = new Uint8Array(await (await fetch(url, { cache: 'no-store' })).arrayBuffer())
    } catch {
      return { text: null }
    }
    // 自動更新：內容與上次相同就不回傳，省下大檔的傳輸與頁面端比對
    const same = sameBytes(lastRead.get(url), bytes)
    rememberRead(url, bytes)
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
}

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
