'use strict'
// 表格增強：拖拉欄寬、點表頭排序、篩選列、複製為 TSV、換行切換、全螢幕
var Markloupe = globalThis.Markloupe || (globalThis.Markloupe = {})

;(() => {
  const { h, t } = Markloupe
  const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' })

  /* ---------- 排序值解析 ---------- */
  // 只換算明確的容量單位；單一字母（k、m…）可能是分鐘、公尺，不換算
  const SIZE_UNIT = { b: 1, kb: 1e3, kib: 1024, mb: 1e6, mib: 1024 ** 2, gb: 1e9, gib: 1024 ** 3, tb: 1e12, tib: 1024 ** 4 }
  const NUM_RE = /^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)\s*([^\d\s]{0,4})$/i

  function parseNumber(s) {
    // 去掉千分位、貨幣符號
    const t = s.replace(/[,\s_]/g, '').replace(/^(?:NT\$|US\$|[$€£¥₩])/i, '')
    const m = NUM_RE.exec(t)
    if (!m) return null
    let n = parseFloat(m[1])
    const unit = m[2].toLowerCase()
    if (unit && SIZE_UNIT[unit]) n *= SIZE_UNIT[unit]
    return Number.isFinite(n) ? n : null
  }

  const NEGATIVE_NUMBER = /^-(?:\d[\d,]*(?:\.\d+)?|\.\d+)%?$/

  const DATE_RE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?/
  function parseDate(s) {
    if (!DATE_RE.test(s)) return null
    const t = Date.parse(s.replace(/[/.]/g, '-').replace(' ', 'T'))
    return Number.isNaN(t) ? null : t
  }

  function cellText(row, i) {
    const c = row.cells[i]
    return c ? c.textContent.trim() : ''
  }

  /** 依欄位內容決定比較方式：全為數字 → 數字；全為日期 → 日期；否則文字 */
  function makeComparator(rows, col) {
    const values = rows.map(r => cellText(r, col))
    const nonEmpty = values.filter(v => v !== '')
    let key = v => v
    let cmp = (a, b) => collator.compare(a, b)
    if (nonEmpty.length && nonEmpty.every(v => parseNumber(v) !== null)) {
      key = parseNumber
      cmp = (a, b) => a - b
    } else if (nonEmpty.length && nonEmpty.every(v => parseDate(v) !== null)) {
      key = parseDate
      cmp = (a, b) => a - b
    }
    const keys = new Map(rows.map((r, idx) => [r, values[idx] === '' ? null : key(values[idx])]))
    return dir => (a, b) => {
      const ka = keys.get(a)
      const kb = keys.get(b)
      // 空值一律排最後
      if (ka === null && kb === null) return 0
      if (ka === null) return 1
      if (kb === null) return -1
      return dir * cmp(ka, kb)
    }
  }

  function headerRow(table) {
    if (table.tHead && table.tHead.rows.length) return table.tHead.rows[table.tHead.rows.length - 1]
    const first = table.rows[0]
    return first && first.cells.length && Array.from(first.cells).every(c => c.tagName === 'TH') ? first : null
  }

  function bodyRows(table, head) {
    return Array.from(table.tBodies).flatMap(tb => Array.from(tb.rows)).filter(r => r !== head)
  }

  const FILTER_MIN_ROWS = 5 // 列數達此數量才顯示篩選框

  /**
   * 增強單一表格，回傳控制器 { getState, setState }，供自動更新後還原狀態
   * @param {string[]} [source] 原文的每一行：複製成 Markdown 時沿用原文的列，保留粗體、連結等格式
   */
  Markloupe.enhanceTable = function (table, settings, source) {
    const head = headerRow(table)
    const ths = head ? Array.from(head.cells) : []
    // 有合併儲存格的表頭無法對應欄位，只提供複製與換行等基本功能
    const simple = ths.length > 0 && ths.every(c => c.colSpan === 1) && !table.querySelector('td[colspan], td[rowspan], th[rowspan]')
    const headerKey = ths.map(th => th.textContent.trim()).join('\u0001')

    const scroller = h('div', { class: 'ml-table-scroll' })
    const view = h('div', { class: 'ml-table-view' }, [scroller])
    const wrap = h('div', { class: 'ml-table' })
    if (!settings.tableWrap) wrap.classList.add('ml-nowrap')
    table.replaceWith(wrap)
    scroller.append(table)

    // 每個 tbody 保存原始列順序，用於取消排序
    const original = new Map(Array.from(table.tBodies).map(tb => [tb, Array.from(tb.rows)]))
    const rowCount = bodyRows(table, head).length

    /* ----- 浮動工具列（滑鼠移到表格上才出現，不占版面） ----- */
    const count = h('span', { class: 'ml-table-count' })
    const filter =
      rowCount >= FILTER_MIN_ROWS
        ? h('input', {
            class: 'ml-table-filter',
            type: 'search',
            placeholder: t('tableFilter'),
            on: { input: () => applyFilter() },
          })
        : null
    const btn = (text, title, fn) => h('button', { class: 'ml-btn', text, title, on: { click: fn } })
    const copy = async text => Markloupe.flash(copyBtn, t((await Markloupe.copyText(text)) ? 'copied' : 'failed'))
    const copyBtn = btn(t('copy'), t('tableCopyTitle'), () => {
      if (Markloupe.menuOpenFor(copyBtn)) return Markloupe.closeMenu()
      Markloupe.openMenu({
        anchor: copyBtn,
        label: t('copy'),
        items: [
          { label: t('tableCopyTsv'), fn: () => copy(toTSV()) },
          { label: t('tableCopyMd'), fn: () => copy(toMarkdown()) },
          { label: t('tableDownloadCsv'), fn: downloadCsv },
        ],
      })
    })
    copyBtn.setAttribute('aria-haspopup', 'menu')
    copyBtn.setAttribute('aria-expanded', 'false')
    const fullBtn = btn(t('tableFullscreen'), t('tableFullscreenTitle'), () => toggleFull())
    const title = h('span', { class: 'ml-table-title' })
    const bar = h('div', { class: 'ml-table-bar' }, [
      title,
      filter,
      count,
      simple ? btn(t('tableReset'), t('tableResetTitle'), resetAll) : null,
      btn(t('wrap'), t('tableWrapTitle'), () => wrap.classList.toggle('ml-nowrap')),
      copyBtn,
      fullBtn,
      h('span', { class: 'ml-table-esc', attrs: { 'aria-hidden': 'true' } }), // 文字由 CSS 產生，不算進字數與頁內搜尋
    ])
    // inner 的寬度貼齊表格本身，工具列才會對齊表格右緣（wrap 可能比表格寬）
    const inner = h('div', { class: 'ml-table-inner' }, [bar, view])
    wrap.append(inner)

    // 橫向捲動時，還有內容的一側顯示陰影；欄寬拖拉與視窗縮放都會改變可捲動的範圍
    const edges = Markloupe.rafThrottle(() => {
      const max = scroller.scrollWidth - scroller.clientWidth
      view.classList.toggle('ml-more-left', scroller.scrollLeft > 1)
      view.classList.toggle('ml-more-right', scroller.scrollLeft < max - 1)
      // 工具列比表格寬時改成對齊表格左緣，往右延伸，才不會超出文字欄左側
      inner.classList.toggle('ml-bar-start', bar.offsetWidth > inner.offsetWidth)
    })
    scroller.addEventListener('scroll', edges, { passive: true })
    const ro = new ResizeObserver(edges)
    ro.observe(scroller)
    ro.observe(table)
    ro.observe(bar)

    /** 表格所在章節的標題文字；沒有標題時是文件標題 */
    function sectionTitle() {
      let n = wrap
      while (n.parentElement && !n.parentElement.classList.contains('markdown-body')) n = n.parentElement
      while ((n = n.previousElementSibling) && !/^H[1-6]$/.test(n.tagName));
      return n?.dataset.mlText || document.title
    }

    /** 全螢幕標題：表格所在章節的標題與列數 */
    function fullTitle() {
      return `${sectionTitle()} · ${t('tableRows', String(rowCount))}`
    }

    function applyFilter() {
      const q = filter ? filter.value.trim().toLowerCase() : ''
      const rows = bodyRows(table, head)
      let shown = 0
      for (const r of rows) {
        const hit = !q || r.textContent.toLowerCase().includes(q)
        r.hidden = !hit
        if (hit) shown++
      }
      count.textContent = q ? `${shown} / ${rows.length}` : ''
      wrap.classList.toggle('ml-filtered', !!q)
    }

    /* 複製與下載都套用目前的排序與篩選：只輸出看得到的列，依畫面上的順序 */
    const shownRows = () => bodyRows(table, head).filter(r => !r.hidden)

    function toTSV() {
      const clean = c => c.innerText.replace(/[\t\r\n]+/g, ' ').trim()
      return [head, ...shownRows()]
        .filter(Boolean)
        .map(r => Array.from(r.cells).map(clean).join('\t'))
        .join('\n')
    }

    /**
     * 原文的表頭、分隔列與每一列；對不上時回傳 null（以 HTML 寫的表格、列數與原文行數不同）
     * 表格在引用或清單裡時，去掉每行前面相同的 > 與縮排
     */
    function sourceRows() {
      const start = Number(table.dataset.mlLine)
      const end = Number(table.dataset.mlEnd)
      const rows = [...original.values()].flat().filter(r => r !== head)
      if (!source || !head || table.dataset.mlLine == null || end - start - 2 !== rows.length) return null
      const lines = source.slice(start, end)
      const prefix = /^[ \t>]*/.exec(lines[0])[0]
      if (!lines.every(l => l.startsWith(prefix) && l.includes('|'))) return null
      const strip = l => l.slice(prefix.length).trimEnd()
      return { head: strip(lines[0]), delim: strip(lines[1]), rows: new Map(rows.map((r, i) => [r, strip(lines[i + 2])])) }
    }

    function toMarkdown() {
      const src = sourceRows()
      if (src) return [src.head, src.delim, ...shownRows().map(r => src.rows.get(r))].join('\n')
      // 沒有原文：由畫面上的文字產生，格式只剩純文字
      const cell = c => c.innerText.replace(/\s*\n\s*/g, ' ').trim().replace(/\|/g, '\\|')
      const line = cells => `| ${cells.join(' | ')} |`
      const first = head || shownRows()[0]
      if (!first) return ''
      const align = c => ({ left: ':---', center: ':---:', right: '---:' })[c.style.textAlign] || '---'
      const rows = shownRows().filter(r => r !== first)
      return [line([...first.cells].map(cell)), line([...first.cells].map(align)), ...rows.map(r => line([...r.cells].map(cell)))].join('\n')
    }

    /**
     * CSV：加上 BOM，Excel 才會以 UTF-8 開啟；換行用 CRLF
     * 以 = + - @ 開頭的儲存格前面加 '，Excel 開啟時才不會把文件內容當成公式執行；
     * 只有整格是負數（-5、-1,234.5、-12%）時不加，-2+3 這類算式照樣加
     */
    function toCSV() {
      const field = c => {
        let v = c.innerText.trim()
        if (/^[=+@\t\r]/.test(v) || (v.startsWith('-') && !NEGATIVE_NUMBER.test(v))) v = `'${v}`
        return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
      }
      const lines = [head, ...shownRows()].filter(Boolean).map(r => Array.from(r.cells).map(field).join(','))
      return `\ufeff${lines.join('\r\n')}\r\n`
    }

    function downloadCsv() {
      Markloupe.downloadBlob(new Blob([toCSV()], { type: 'text/csv;charset=utf-8' }), `${sectionTitle() || Markloupe.docBaseName()}.csv`)
    }

    function toggleFull(force) {
      const on = wrap.classList.toggle('ml-table-full', typeof force === 'boolean' ? force : undefined)
      if (on) title.textContent = fullTitle()
      fullBtn.textContent = t(on ? 'tableExitFullscreen' : 'tableFullscreen')
      document.documentElement.classList.toggle('ml-noscroll', on)
    }
    wrap.addEventListener('keydown', e => {
      if (e.key === 'Escape' && wrap.classList.contains('ml-table-full')) toggleFull(false)
    })

    /* ----- 排序 ----- */
    let sortCol = -1
    let sortDir = 0 // 1 升冪、-1 降冪、0 原順序

    function applySort() {
      ths.forEach((th, i) => {
        if (i === sortCol && sortDir) th.setAttribute('aria-sort', sortDir === 1 ? 'ascending' : 'descending')
        else th.removeAttribute('aria-sort')
      })
      for (const [tb, rows] of original) {
        const list = rows.filter(r => r !== head)
        const ordered = sortDir && sortCol >= 0 ? list.slice().sort(makeComparator(list, sortCol)(sortDir)) : list
        tb.append(...ordered)
      }
    }

    function sortBy(col) {
      if (sortCol !== col) {
        sortCol = col
        sortDir = 1
      } else {
        sortDir = sortDir === 1 ? -1 : sortDir === -1 ? 0 : 1
      }
      applySort()
    }

    /* ----- 拖拉欄寬 ----- */
    let cols = null

    // 第一次拖拉時把目前的自動寬度固定下來，改為 fixed layout
    function freeze(widths) {
      if (cols) return
      widths = widths || ths.map(th => th.getBoundingClientRect().width)
      const cg = h('colgroup', { class: 'ml-colgroup' }, widths.map(w => h('col', { style: { width: `${w}px` } })))
      table.prepend(cg)
      cols = Array.from(cg.children)
      table.classList.add('ml-sized')
      syncTableWidth()
    }

    function syncTableWidth() {
      table.style.width = `${cols.reduce((sum, c) => sum + parseFloat(c.style.width), 0)}px`
    }

    function unfreeze() {
      table.querySelector(':scope > colgroup.ml-colgroup')?.remove()
      cols = null
      table.classList.remove('ml-sized')
      table.style.width = ''
    }

    /** 雙擊把該欄寬度調到剛好放下內容（上限 800px） */
    function autoFit(i) {
      const prev = cols ? cols.map(c => c.style.width) : null
      unfreeze()
      table.classList.add('ml-measure')
      const natural = Math.ceil(ths[i].getBoundingClientRect().width)
      table.classList.remove('ml-measure')
      freeze()
      if (prev) prev.forEach((w, j) => j !== i && (cols[j].style.width = w))
      cols[i].style.width = `${Math.min(natural, 800)}px`
      syncTableWidth()
    }

    function resetAll() {
      unfreeze()
      sortCol = -1
      sortDir = 0
      applySort()
      if (filter) filter.value = ''
      applyFilter()
    }

    if (simple) {
      ths.forEach((th, i) => {
        th.classList.add('ml-sortable')
        th.title = t('tableSortTitle')
        // 鍵盤也能排序：Tab 移到表頭，Enter 或空白鍵
        th.tabIndex = 0
        th.addEventListener('click', e => {
          if (e.target.closest('a, .ml-col-resizer')) return
          sortBy(i)
        })
        th.addEventListener('keydown', e => {
          if (e.target !== th || (e.key !== 'Enter' && e.key !== ' ')) return
          e.preventDefault()
          sortBy(i)
        })

        const handle = h('span', { class: 'ml-col-resizer', title: t('tableResizeTitle') })
        th.append(handle)
        handle.addEventListener('click', e => e.stopPropagation())
        handle.addEventListener('dblclick', e => {
          e.stopPropagation()
          autoFit(i)
        })
        handle.addEventListener('pointerdown', e => {
          e.preventDefault()
          e.stopPropagation()
          freeze()
          const startX = e.clientX
          const startW = parseFloat(cols[i].style.width)
          handle.setPointerCapture(e.pointerId)
          wrap.classList.add('ml-resizing')
          const move = ev => {
            cols[i].style.width = `${Math.max(40, startW + ev.clientX - startX)}px`
            syncTableWidth()
          }
          const up = () => {
            handle.removeEventListener('pointermove', move)
            handle.removeEventListener('pointerup', up)
            handle.removeEventListener('pointercancel', up)
            wrap.classList.remove('ml-resizing')
          }
          handle.addEventListener('pointermove', move)
          handle.addEventListener('pointerup', up)
          handle.addEventListener('pointercancel', up)
        })
      })
    }

    /* ----- 狀態存取：自動更新重新渲染後還原 ----- */
    return {
      getState() {
        return {
          headerKey,
          sortCol,
          sortDir,
          widths: cols ? cols.map(c => parseFloat(c.style.width)) : null,
          filter: filter ? filter.value : '',
          nowrap: wrap.classList.contains('ml-nowrap'),
          full: wrap.classList.contains('ml-table-full'),
        }
      },
      /** 表頭內容不同就不套用，避免把狀態套到錯的欄位 */
      setState(st) {
        if (!st || st.headerKey !== headerKey) return false
        wrap.classList.toggle('ml-nowrap', st.nowrap)
        if (simple) {
          if (st.widths && st.widths.length === ths.length) freeze(st.widths)
          if (st.sortDir && st.sortCol >= 0 && st.sortCol < ths.length) {
            sortCol = st.sortCol
            sortDir = st.sortDir
            applySort()
          }
        }
        if (filter && st.filter) {
          filter.value = st.filter
          applyFilter()
        }
        if (st.full) toggleFull(true)
        return true
      },
    }
  }
})()
