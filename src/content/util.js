'use strict'
// 共用小工具
var Markloupe = globalThis.Markloupe || (globalThis.Markloupe = {})

/**
 * 建立元素
 * @param {string} tag
 * @param {object} [props] class / text / title / attrs / on / style
 * @param {Array<Node|string>} [children]
 */
Markloupe.h = function (tag, props = {}, children = []) {
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
Markloupe.alive = function () {
  try {
    return !!chrome.runtime?.id
  } catch {
    return false
  }
}

/** 以 requestAnimationFrame 節流 */
Markloupe.rafThrottle = function (fn) {
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

Markloupe.debounce = function (fn, ms) {
  let t
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

/**
 * 讓延遲載入的圖片立刻載入，等全部載完（或失敗）再繼續；列印前用，否則還沒捲到的圖片印出來是空白
 * 最多等 ms 毫秒，避免一張很慢的遠端圖片卡住列印
 */
Markloupe.loadImages = function (root, ms = 5000) {
  const waits = []
  for (const img of root.querySelectorAll('img')) {
    if (img.loading === 'lazy') img.loading = 'eager'
    if (img.complete) continue
    waits.push(
      new Promise(done => {
        img.addEventListener('load', done, { once: true })
        img.addEventListener('error', done, { once: true })
      }),
    )
  }
  return Promise.race([Promise.all(waits), new Promise(r => setTimeout(r, ms))])
}

/** 下載產生的檔案（匯出 HTML、表格 CSV） */
Markloupe.downloadBlob = function (blob, name) {
  const url = URL.createObjectURL(blob)
  const a = Markloupe.h('a', { href: url, download: name })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

// Markdown 副檔名：匯出的檔名與匯出檔裡改寫的 .md 連結共用，兩者才對得上
Markloupe.MD_EXT = /\.(md|markdown|mkd|mdx)$/i

/** 文件的檔名，不含 Markdown 副檔名（匯出與下載的預設檔名） */
Markloupe.docBaseName = function () {
  let base = location.pathname.split('/').pop() || 'document'
  try {
    base = decodeURIComponent(base)
  } catch {
    // 不合法的 % 編碼：沿用原字串
  }
  return base.replace(Markloupe.MD_EXT, '')
}

/** 元素所在章節的標題文字（往前找文章最上層的標題）；沒有標題時是文件標題 */
Markloupe.sectionTitle = function (el) {
  let n = el
  while (n.parentElement && !n.parentElement.classList.contains('markdown-body')) n = n.parentElement
  while ((n = n.previousElementSibling) && !/^H[1-6]$/.test(n.tagName));
  return n?.dataset.mlText || document.title
}

/** 複製文字；非安全環境（一般 http）退回 execCommand */
Markloupe.copyText = async function (text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = Markloupe.h('textarea', { value: text, style: { position: 'fixed', top: '-1000px' } })
    document.body.append(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

/**
 * 複製純文字並附上 HTML：支援格式的程式貼上時取 HTML，純文字輸入框取純文字
 * 一般 http 網頁沒有 Clipboard API，改在 copy 事件裡寫入兩種格式
 */
Markloupe.copyRich = async function (text, html) {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ])
    return true
  } catch {
    const onCopy = e => {
      e.clipboardData.setData('text/plain', text)
      e.clipboardData.setData('text/html', html)
      e.preventDefault()
    }
    document.addEventListener('copy', onCopy, true)
    try {
      return document.execCommand('copy')
    } finally {
      document.removeEventListener('copy', onCopy, true)
    }
  }
}

/** 按鈕短暫顯示回饋文字 */
Markloupe.flash = function (btn, text, ms = 1000) {
  const old = btn.textContent
  btn.textContent = text
  btn.disabled = true
  setTimeout(() => {
    btn.textContent = old
    btn.disabled = false
  }, ms)
}

Markloupe.UNCHANGED = Symbol('unchanged')

/**
 * WSL（file://wsl.localhost/…）與網路共用（file://主機/…）上的檔案：Chrome 不讓擴充功能讀取帶主機名稱的 file:// 網址，
 * 只能顯示頁面上已有的內容；檔案清單、自動更新與勾選寫回都無法使用
 */
Markloupe.networkFile = location.protocol === 'file:' && (location.host !== '' || location.pathname.startsWith('//'))

/**
 * 讀取目前頁面的原始內容；失敗回傳 null
 * - file://：content script 無法直接讀（CORS），交給 background 讀 bytes 並以 UTF-8 嚴格解碼，
 *   同時修正 Chrome 對無 BOM 檔案猜錯編碼造成的中文亂碼
 * - http(s)：fetch（同源，不需額外權限）
 * @param {{ifChanged?: boolean}} [opts] ifChanged：本機檔案若與上次讀取時相同，回傳 Markloupe.UNCHANGED，
 *   不必把整份內容傳回頁面（自動更新每秒檢查一次，大檔時可省下大量傳輸與比對）
 */
Markloupe.fetchSource = async function (opts = {}) {
  if (location.protocol === 'file:') {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'read-self', ifChanged: !!opts.ifChanged })
      if (res?.unchanged) return Markloupe.UNCHANGED
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

/**
 * 頁面底部的短暫提示，可附操作按鈕；同時只顯示一則
 * @param {string} text
 * @param {Array<{label:string, fn:Function}>} [actions]
 * @param {number} [ms]
 */
Markloupe.toast = function (text, actions = [], ms = 5000) {
  const toast = Markloupe.toast
  let el = document.querySelector('.ml-toast')
  if (!el) {
    el = Markloupe.h('div', { class: 'ml-toast', attrs: { role: 'status' } })
    // 滑鼠停在提示上或焦點在提示的按鈕上時暫停倒數，離開後重新計時，才來得及按「復原」
    const pause = () => clearTimeout(toast.timer)
    const resume = () => {
      clearTimeout(toast.timer)
      toast.timer = setTimeout(() => el.classList.remove('show'), toast.ms)
    }
    el.addEventListener('mouseenter', pause)
    el.addEventListener('focusin', pause)
    el.addEventListener('mouseleave', () => el.contains(document.activeElement) || resume())
    el.addEventListener('focusout', e => el.contains(e.relatedTarget) || el.matches(':hover') || resume())
    document.body.append(el)
  }
  toast.ms = ms
  el.textContent = ''
  el.append(Markloupe.h('span', { text }))
  for (const a of actions) {
    el.append(
      Markloupe.h('button', {
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
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => el.classList.remove('show'), ms)
}
