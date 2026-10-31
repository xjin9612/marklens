'use strict'
// 表格增強：拖拉欄寬、點表頭排序、篩選列、複製為 TSV、換行切換、全螢幕
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

;(() => {
  const { h } = MarkLens
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
   */
  MarkLens.enhanceTable = function (table, settings) {
    const head = headerRow(table)
    const ths = head ? Array.from(head.cells) : []
    // 有合併儲存格的表頭無法對應欄位，只提供複製與換行等基本功能
    const simple = ths.length > 0 && ths.every(c => c.colSpan === 1) && !table.querySelector('td[colspan], td[rowspan], th[rowspan]')
    const headerKey = ths.map(th => th.textContent.trim()).join('\u0001')

    const scroller = h('div', { class: 'ml-table-scroll' })
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
            placeholder: '篩選列…',
            on: { input: () => applyFilter() },
          })
        : null
    const btn = (text, title, fn) => h('button', { class: 'ml-btn', text, title, on: { click: fn } })
    const copyBtn = btn('複製', '複製為 TSV（可直接貼到 Excel），套用目前排序與篩選', async () => {
      MarkLens.flash(copyBtn, (await MarkLens.copyText(toTSV())) ? '已複製' : '失敗')
    })
    const fullBtn = btn('全螢幕', '全螢幕檢視（Esc 離開）', () => toggleFull())
    const bar = h('div', { class: 'ml-table-bar' }, [
      filter,
      count,
      simple ? btn('重設', '重設欄寬、排序與篩選', resetAll) : null,
      btn('換行', '切換儲存格換行', () => wrap.classList.toggle('ml-nowrap')),
      copyBtn,
      fullBtn,
    ])
    // inner 的寬度貼齊表格本身，工具列才會對齊表格右緣（wrap 可能比表格寬）
    wrap.append(h('div', { class: 'ml-table-inner' }, [bar, scroller]))

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

    function toTSV() {
      const clean = c => c.innerText.replace(/[\t\r\n]+/g, ' ').trim()
      const lines = []
      if (head) lines.push(Array.from(head.cells).map(clean).join('\t'))
      for (const r of bodyRows(table, head)) {
        if (!r.hidden) lines.push(Array.from(r.cells).map(clean).join('\t'))
      }
      return lines.join('\n')
    }

    function toggleFull(force) {
      const on = wrap.classList.toggle('ml-table-full', typeof force === 'boolean' ? force : undefined)
      fullBtn.textContent = on ? '離開全螢幕' : '全螢幕'
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
        th.title = '點擊排序（升冪 → 降冪 → 原順序）'
        th.addEventListener('click', e => {
          if (e.target.closest('a, .ml-col-resizer')) return
          sortBy(i)
        })

        const handle = h('span', { class: 'ml-col-resizer', title: '拖拉調整欄寬，雙擊自動適應' })
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
