'use strict'
// 渲染後的 DOM 增強：標題錨點與摺疊、行內內容歸組、任務清單、程式碼區塊、圖片檢視、Alert 標題、字數統計
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

;(() => {
  const { h } = MarkLens

  /* ---------- 標題 id（GitHub 風格 slug，保留中日韓文字） ---------- */
  function slugify(text) {
    return (
      text
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
        .replace(/\s/g, '-') || 'section'
    )
  }

  MarkLens.processHeadings = function (article) {
    const used = new Map()
    const headings = Array.from(article.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    for (const el of headings) {
      const text = el.textContent.trim()
      // 原文已自帶 id（如 HTML 寫的）就沿用
      let id = el.id || slugify(text)
      if (used.has(id)) {
        let n = used.get(id)
        while (used.has(`${id}-${n}`)) n++
        used.set(id, n + 1)
        id = `${id}-${n}`
      }
      used.set(id, 1)
      el.id = id
      el.dataset.mlLevel = el.tagName[1]
      el.dataset.mlText = text
      el.append(h('a', { class: 'ml-anchor', href: `#${encodeURIComponent(id)}`, text: '#', title: MarkLens.t('headingAnchor') }))
      // 只有文章直接子元素的標題才能摺疊（摺疊範圍以兄弟節點計算）
      if (el.parentElement === article) {
        el.prepend(
          h('button', {
            class: 'ml-fold',
            title: MarkLens.t('foldSection'),
            attrs: { 'aria-expanded': 'true' },
            on: { click: e => (e.preventDefault(), MarkLens.toggleFold(el)) },
          }),
        )
      }
    }
    return headings
  }

  /* ---------- 頂層行內內容歸組 ---------- */
  // 原文寫在獨立行的 <img>、<a> 等 HTML 會成為文章的直接子節點（行內元素），
  // 無法套用文字欄置中，也無法被段落摺疊；把連續的行內節點包成一個區塊
  const BLOCK_TAGS = new Set(
    'ADDRESS ARTICLE ASIDE BLOCKQUOTE CENTER DETAILS DIV DL FIGURE FOOTER H1 H2 H3 H4 H5 H6 HEADER HR MAIN NAV OL P PRE SECTION TABLE UL'.split(' '),
  )
  MarkLens.groupInline = function (article) {
    let group = null
    for (const node of Array.from(article.childNodes)) {
      const isBlock = node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(node.tagName)
      const isBlank = node.nodeType === Node.TEXT_NODE && !node.textContent.trim()
      if (isBlock) {
        group = null
        continue
      }
      if (isBlank && !group) {
        node.remove()
        continue
      }
      if (!group) {
        group = h('div', { class: 'ml-inline-group' })
        node.before(group)
      }
      group.append(node)
    }
  }

  /* ---------- 段落摺疊 ---------- */
  // 被摺疊的節點以 hidden="until-found" 隱藏：瀏覽器 Ctrl+F 仍搜尋得到，命中時觸發 beforematch
  // 以計數器 data-ml-fold 支援巢狀摺疊（同一節點可能同時被多個標題摺疊）
  const HEADING_RE = /^H[1-6]$/

  function sectionNodes(heading) {
    const level = +heading.dataset.mlLevel
    const nodes = []
    for (let n = heading.nextElementSibling; n; n = n.nextElementSibling) {
      if (HEADING_RE.test(n.tagName) && +n.dataset.mlLevel <= level) break
      nodes.push(n)
    }
    return nodes
  }

  /**
   * 摺疊模式（每次渲染依文件大小決定，見 MarkLens.setFoldMode）
   * - find：hidden="until-found"，Ctrl+F 搜得到摺疊內容並自動展開；但瀏覽器內部以 content-visibility 實作，
   *   大量元素同時切換時樣式計算很慢（1MB 文件全部摺疊約 2.5 秒）
   * - fast：以 CSS display:none 隱藏，快十倍以上，但 Ctrl+F 搜不到摺疊內容
   */
  const FAST_FOLD_BLOCKS = 3000 // 頂層區塊超過此數量改用 fast 模式（約 400KB 的文件）

  MarkLens.setFoldMode = function (article) {
    article.dataset.mlFoldMode = article.children.length > FAST_FOLD_BLOCKS ? 'fast' : 'find'
  }

  function setFoldCount(node, delta) {
    const c = (+node.dataset.mlFold || 0) + delta
    const findable = node.parentElement?.dataset.mlFoldMode !== 'fast'
    if (c > 0) {
      node.dataset.mlFold = c
      if (findable) node.setAttribute('hidden', 'until-found')
    } else {
      delete node.dataset.mlFold
      node.removeAttribute('hidden')
    }
  }

  function notify(article) {
    article.dispatchEvent(new CustomEvent('marklens:fold'))
  }

  function fold(heading, want) {
    if (heading.classList.contains('ml-folded') === want) return false
    heading.classList.toggle('ml-folded', want)
    heading.querySelector('.ml-fold')?.setAttribute('aria-expanded', String(!want))
    for (const n of sectionNodes(heading)) setFoldCount(n, want ? 1 : -1)
    return true
  }

  MarkLens.toggleFold = function (heading, force) {
    const want = force === undefined ? !heading.classList.contains('ml-folded') : force
    if (fold(heading, want)) notify(heading.parentElement)
  }

  /** 可摺疊的標題（文章直接子元素） */
  function foldableHeadings(article) {
    return Array.from(article.children).filter(el => HEADING_RE.test(el.tagName))
  }

  /**
   * 全部摺疊：從第一個「有兩個以上標題」的層級開始摺疊
   * 例如整份文件只有一個 H1 時，改摺 H2，避免整份文件只剩標題
   */
  MarkLens.foldAll = function (article) {
    const heads = foldableHeadings(article)
    if (!heads.length) return
    const count = [0, 0, 0, 0, 0, 0, 0]
    for (const el of heads) count[+el.dataset.mlLevel]++
    let level = count.findIndex(c => c >= 2)
    if (level < 0) level = Math.min(...heads.map(el => +el.dataset.mlLevel))
    for (const el of heads) if (+el.dataset.mlLevel === level) fold(el, true)
    notify(article)
  }

  MarkLens.unfoldAll = function (article) {
    for (const el of foldableHeadings(article)) fold(el, false)
    notify(article)
  }

  /** 讓某元素可見：展開所有遮住它的摺疊 */
  MarkLens.revealElement = function (article, el) {
    let target = el
    while (target && target.parentElement !== article) target = target.parentElement
    if (!target || !target.dataset.mlFold) return
    let changed = false
    for (const hd of article.querySelectorAll(':scope > .ml-folded')) {
      if (sectionNodes(hd).includes(target)) changed = fold(hd, false) || changed
    }
    if (changed) notify(article)
  }

  /** Ctrl+F 命中被摺疊的內容時，瀏覽器會先移除 hidden 再觸發 beforematch，這裡同步摺疊狀態 */
  MarkLens.bindFoldSearch = function (article) {
    article.addEventListener('beforematch', e => MarkLens.revealElement(article, e.target), true)
  }

  /* ---------- 任務清單 [ ] / [x] ---------- */
  const TASK_RE = /^\[([ xX])\][ \u00a0]/

  /** 第一個非空白子節點；markdown-it 的鬆散清單會輸出 <li>\n<p>…，開頭有換行文字節點 */
  function firstMeaningful(el) {
    let n = el.firstChild
    while (n && n.nodeType === Node.TEXT_NODE && !n.textContent.trim()) n = n.nextSibling
    return n
  }

  /**
   * @param {string} nonce markdown-it 建立時產生的 nonce；帶有對應 class 的項目才知道原文行號，才可能寫回
   */
  MarkLens.processTaskLists = function (article, nonce) {
    const lineRe = nonce ? new RegExp(`(?:^|\\s)ml-task-${nonce}-(\\d+)(?:\\s|$)`) : null
    for (const li of article.querySelectorAll('li')) {
      // 標記可能直接在 li 開頭（緊湊清單），或在 li > p 開頭（鬆散清單）
      let first = firstMeaningful(li)
      if (first?.nodeType === Node.ELEMENT_NODE && first.tagName === 'P') first = firstMeaningful(first)
      if (!first || first.nodeType !== Node.TEXT_NODE) continue
      const m = TASK_RE.exec(first.textContent.replace(/^\s+/, ''))
      if (!m) continue
      first.textContent = first.textContent.replace(/^\s+/, '').slice(m[0].length)
      const box = h('input', { type: 'checkbox', class: 'ml-task-box', disabled: true, checked: m[1] !== ' ' })
      const lm = lineRe && lineRe.exec(li.className)
      if (lm) {
        box.dataset.mlLine = lm[1]
        box.dataset.mlState = m[1] === ' ' ? ' ' : 'x'
      }
      first.before(box, ' ')
      li.classList.add('task-list-item')
      li.parentElement.classList.add('contains-task-list')
    }
    // 行號只需記在勾選框上，移除清單項目上的暫用 class
    if (nonce) {
      for (const li of article.querySelectorAll(`li[class*="ml-task-${nonce}-"]`)) {
        li.className = li.className.replace(new RegExp(`\\s*ml-task-${nonce}-\\d+`), '').trim()
        if (!li.className) li.removeAttribute('class')
      }
    }
  }

  /* ---------- 程式碼區塊：語言標籤、複製、換行切換 ---------- */
  MarkLens.processCodeBlocks = function (article) {
    for (const pre of article.querySelectorAll('pre')) {
      if (pre.closest('.ml-frontmatter')) continue
      const code = pre.querySelector('code') || pre
      const lang = (code.className.match(/language-(\S+)/) || [])[1] || ''
      const wrap = h('div', { class: 'ml-code' })
      pre.replaceWith(wrap)
      const copyBtn = h('button', {
        class: 'ml-btn',
        text: MarkLens.t('copy'),
        on: {
          click: async () =>
            MarkLens.flash(copyBtn, MarkLens.t((await MarkLens.copyText(code.textContent)) ? 'copied' : 'failed')),
        },
      })
      const wrapBtn = h('button', {
        class: 'ml-btn ml-code-wrap-btn',
        text: MarkLens.t('wrap'),
        title: MarkLens.t('codeWrapTitle'),
        on: { click: () => wrap.classList.toggle('ml-code-wrap-toggled') },
      })
      const bar = h('div', { class: 'ml-code-bar' }, [
        lang ? h('span', { class: 'ml-code-lang', text: lang }) : null,
        wrapBtn,
        copyBtn,
      ])
      wrap.append(bar, pre)
    }
  }

  /* ---------- 圖片：延遲載入、點擊放大 ---------- */
  let viewer = null
  function openViewer(src, alt) {
    if (!viewer) {
      viewer = h('div', { class: 'ml-viewer', on: { click: () => viewer.classList.remove('open') } }, [h('img')])
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') viewer.classList.remove('open')
      })
      document.body.append(viewer)
    }
    const img = viewer.firstChild
    img.src = src
    img.alt = alt || ''
    viewer.classList.add('open')
  }

  /* ---------- 外部連結：開新分頁，不離開目前文件 ---------- */
  // 只處理不同來源的 http(s) 連結；錨點、相對路徑的 .md、同站連結維持原本行為
  MarkLens.processLinks = function (article, newTab) {
    if (!newTab) return
    for (const a of article.querySelectorAll('a[href]')) {
      let url
      try {
        url = new URL(a.getAttribute('href'), location.href)
      } catch {
        continue
      }
      if (!/^https?:$/.test(url.protocol) || url.origin === location.origin) continue
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
    }
  }

  MarkLens.processImages = function (article) {
    for (const img of article.querySelectorAll('img')) {
      img.loading = 'lazy'
      if (img.closest('a')) continue // 外層是連結就讓連結生效
      img.classList.add('ml-zoomable')
      img.addEventListener('click', () => openViewer(img.currentSrc || img.src, img.alt))
    }
  }

  /* ---------- Alert 標題 ---------- */
  const ALERT_TITLE = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' }
  MarkLens.processAlerts = function (article) {
    for (const bq of article.querySelectorAll('blockquote.markdown-alert')) {
      const kind = (bq.className.match(/markdown-alert-(\w+)/) || [])[1]
      if (!kind || !ALERT_TITLE[kind]) continue
      bq.prepend(h('p', { class: 'markdown-alert-title', text: ALERT_TITLE[kind] }))
    }
  }

  /* ---------- 字數與閱讀時間 ---------- */
  MarkLens.readingStats = function (article) {
    const text = article.textContent
    const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g) || []).length
    const words = (text.replace(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g, ' ').match(/[A-Za-z0-9_'-]+/g) || []).length
    // 中文約 400 字／分、英文約 200 字／分
    const minutes = Math.max(1, Math.round(cjk / 400 + words / 200))
    return { chars: cjk + words, minutes }
  }
})()
