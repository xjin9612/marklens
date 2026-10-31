'use strict'
// 共用小工具
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

/**
 * 建立元素
 * @param {string} tag
 * @param {object} [props] class / text / title / attrs / on / style
 * @param {Array<Node|string>} [children]
 */
MarkLens.h = function (tag, props = {}, children = []) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue
    if (k === 'class') el.className = v
    else if (k === 'text') el.textContent = v
    else if (k === 'attrs') for (const [ak, av] of Object.entries(v)) el.setAttribute(ak, av)
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn)
    else if (k === 'style') Object.assign(el.style, v)
    else el[k] = v
  }
  for (const c of [].concat(children)) {
    if (c == null) continue
    el.append(c)
  }
  return el
}

/**
 * 擴充功能是否仍可用
 * 擴充功能被重新載入或更新後，已開分頁裡的舊 content script 會失去連線（chrome.runtime.id 變成 undefined），
 * 之後任何 chrome.* 呼叫都會拋出 "Extension context invalidated"
 */
MarkLens.alive = function () {
  try {
    return !!chrome.runtime?.id
  } catch {
    return false
  }
}

/** 以 requestAnimationFrame 節流 */
MarkLens.rafThrottle = function (fn) {
  let pending = false
  return (...args) => {
    if (pending) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      fn(...args)
    })
  }
}

MarkLens.debounce = function (fn, ms) {
  let t
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

/** 複製文字；非安全環境（一般 http）退回 execCommand */
MarkLens.copyText = async function (text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = MarkLens.h('textarea', { value: text, style: { position: 'fixed', top: '-1000px' } })
    document.body.append(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

/** 按鈕短暫顯示回饋文字 */
MarkLens.flash = function (btn, text, ms = 1000) {
  const old = btn.textContent
  btn.textContent = text
  btn.disabled = true
  setTimeout(() => {
    btn.textContent = old
    btn.disabled = false
  }, ms)
}

/**
 * 讀取目前頁面的原始內容
 * - file://：content script 無法直接讀（CORS），交給 background 讀 bytes 並以 UTF-8 嚴格解碼，
 *   同時修正 Chrome 對無 BOM 檔案猜錯編碼造成的中文亂碼
 * - http(s)：fetch（同源，不需額外權限）
 * 失敗回傳 null
 */
MarkLens.UNCHANGED = Symbol('unchanged')

/**
 * @param {{ifChanged?: boolean}} [opts] ifChanged：本機檔案若與上次讀取時相同，回傳 MarkLens.UNCHANGED，
 *   不必把整份內容傳回頁面（自動更新每秒檢查一次，大檔時可省下大量傳輸與比對）
 */
MarkLens.fetchSource = async function (opts = {}) {
  if (location.protocol === 'file:') {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'read-self', ifChanged: !!opts.ifChanged })
      if (res?.unchanged) return MarkLens.UNCHANGED
      return typeof res?.text === 'string' ? res.text : null
    } catch {
      return null
    }
  }
  const url = location.href.split('#')[0]
  return fetch(url, { cache: 'no-store', credentials: 'include' })
    .then(r => (r.ok ? r.text() : null))
    .catch(() => null)
}

/** 文字的 SHA-256（十六進位），用來與背景程式比對原文是否一致 */
MarkLens.sha256 = async function (text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 頁面底部的短暫提示，可附操作按鈕；同時只顯示一則
 * @param {string} text
 * @param {Array<{label:string, fn:Function}>} [actions]
 * @param {number} [ms]
 */
MarkLens.toast = function (text, actions = [], ms = 5000) {
  let el = document.querySelector('.ml-toast')
  if (!el) {
    el = MarkLens.h('div', { class: 'ml-toast', attrs: { role: 'status' } })
    document.body.append(el)
  }
  el.textContent = ''
  el.append(MarkLens.h('span', { text }))
  for (const a of actions) {
    el.append(
      MarkLens.h('button', {
        class: 'ml-toast-btn',
        text: a.label,
        on: {
          click: () => {
            el.classList.remove('show')
            a.fn()
          },
        },
      }),
    )
  }
  el.classList.add('show')
  clearTimeout(MarkLens.toast.timer)
  MarkLens.toast.timer = setTimeout(() => el.classList.remove('show'), ms)
}
