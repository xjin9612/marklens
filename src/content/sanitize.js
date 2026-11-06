'use strict'
// HTML 白名單過濾：markdown 允許內嵌 HTML，但不允許任何可執行內容
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

;(() => {
  // 連同子節點整個移除
  const DROP = new Set(
    ('SCRIPT STYLE IFRAME FRAME FRAMESET OBJECT EMBED APPLET LINK META BASE HEAD TITLE ' +
      'FORM INPUT TEXTAREA SELECT OPTION BUTTON NOSCRIPT TEMPLATE SVG MATH PORTAL DIALOG SLOT')
      .split(' '),
  )
  // 保留的標籤；不在此表也不在 DROP 的標籤會被「拆包」（保留子內容）
  const ALLOW = new Set(
    ('A ABBR ADDRESS ARTICLE ASIDE AUDIO B BDI BDO BLOCKQUOTE BR CAPTION CENTER CITE CODE COL ' +
      'COLGROUP DATA DD DEL DETAILS DFN DIV DL DT EM FIGCAPTION FIGURE FONT FOOTER H1 H2 H3 H4 H5 H6 ' +
      'HEADER HR I IMG INS KBD LI MAIN MARK NAV OL P PICTURE PRE Q RP RT RUBY S SAMP SECTION SMALL ' +
      'SOURCE SPAN STRIKE STRONG SUB SUMMARY SUP TABLE TBODY TD TFOOT TH THEAD TIME TR TT U UL VAR VIDEO WBR')
      .split(' '),
  )
  const ATTRS = new Set(
    ('id class title lang dir align valign width height colspan rowspan alt name open start reversed ' +
      'type datetime scope abbr span controls loop muted href src cite poster value')
      .split(' '),
  )
  const URL_ATTRS = new Set(['href', 'src', 'cite', 'poster'])
  const SAFE_DATA_IMG = /^data:image\/(png|gif|jpe?g|webp|avif|bmp);base64,[a-z0-9+/=\s]+$/i

  function safeUrl(value, attr, tag) {
    const v = value.trim()
    if (v === '' || v.startsWith('#')) return v
    // 移除控制字元與空白後再判斷 scheme，防止 "java\nscript:" 之類繞過
    const compact = v.replace(/[\u0000- \u007f]+/g, '')
    if (/^data:/i.test(compact)) {
      return attr === 'src' && (tag === 'IMG' || tag === 'SOURCE') && SAFE_DATA_IMG.test(v) ? v : null
    }
    let url
    try {
      url = new URL(compact, document.baseURI)
    } catch {
      return null
    }
    const p = url.protocol
    if (p === 'http:' || p === 'https:') return v
    if (p === 'mailto:' && attr === 'href') return v
    // 只放行與頁面同主機的本機檔案。file://主機/… 與 file:////主機/… 是網路共用路徑（RFC 8089 附錄 E.3）；
    // Linux 版 Chrome 把後者解析成本機路徑，所以另以原字串判斷
    if (p === 'file:' && location.protocol === 'file:') {
      const unc = /^(?:file:)?[\\/]{4,}/i.test(compact) || url.pathname.startsWith('//')
      return url.host === location.host && !unc ? v : null
    }
    return null
  }

  // markdown-it 以 style="text-align:…" 輸出表格對齊，只保留這一種 style
  const ALIGN_STYLE = /^\s*text-align\s*:\s*(left|right|center)\s*;?\s*$/i

  // MarkLens 自己的介面一律使用 ml- 開頭的 class／id；文件內容不得使用，
  // 否則作者可借用介面樣式偽造全螢幕遮罩、假提示或假工具列
  const RESERVED = /^ml-/i

  function cleanClasses(el, allowClass) {
    for (const c of Array.from(el.classList)) {
      if (RESERVED.test(c) && !allowClass(c)) el.classList.remove(c)
    }
    if (!el.classList.length) el.removeAttribute('class')
  }

  function cleanElement(el, allowClass) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name === 'class') {
        cleanClasses(el, allowClass)
        continue
      }
      if (name === 'id' && RESERVED.test(attr.value)) {
        el.removeAttribute(attr.name)
        continue
      }
      // name 只保留給舊式錨點 <a name>；<img name> 等會覆蓋 document 上的同名屬性（DOM clobbering）
      if (name === 'name' && el.tagName !== 'A') {
        el.removeAttribute(attr.name)
        continue
      }
      if (name === 'style') {
        const m = ALIGN_STYLE.exec(attr.value)
        if (m && (el.tagName === 'TD' || el.tagName === 'TH')) el.setAttribute('style', `text-align:${m[1].toLowerCase()}`)
        else el.removeAttribute(attr.name)
        continue
      }
      if (!ATTRS.has(name)) {
        el.removeAttribute(attr.name)
        continue
      }
      if (URL_ATTRS.has(name)) {
        const safe = safeUrl(attr.value, name, el.tagName)
        if (safe == null) el.removeAttribute(attr.name)
      }
    }
    if (el.tagName === 'A' && /^https?:/i.test(el.getAttribute('href') || '')) {
      el.setAttribute('rel', 'noopener noreferrer')
    }
  }

  function walk(parent, allowClass) {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toUpperCase()
        if (DROP.has(tag)) {
          node.remove()
          continue
        }
        walk(node, allowClass)
        if (ALLOW.has(tag)) {
          cleanElement(node, allowClass)
        } else {
          node.replaceWith(...Array.from(node.childNodes))
        }
      } else if (node.nodeType !== Node.TEXT_NODE) {
        // 註解、處理指令等一律移除
        node.remove()
      }
    }
  }

  /**
   * 過濾 HTML 字串，回傳安全的 DocumentFragment
   * template 內容是惰性的：解析時不會載入圖片或執行任何程式
   * @param {string} html
   * @param {string} [nonce] 本次渲染的 nonce；只有帶正確 nonce 的任務 class 會保留（見 markdown.js）
   */
  MarkLens.sanitize = function (html, nonce) {
    const taskClass = nonce ? new RegExp(`^ml-(?:task|line)-${nonce}-\\d+$`) : null
    // 渲染器自己產生的 ml- class：任務清單與標題的行號（帶本次渲染的 nonce）
    const allowClass = c => taskClass != null && taskClass.test(c)
    const tpl = document.createElement('template')
    tpl.innerHTML = html
    walk(tpl.content, allowClass)
    return document.importNode(tpl.content, true)
  }
})()
