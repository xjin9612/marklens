'use strict'
// 自動更新時標出改動：逐行比對原文，把改動的行對應到渲染後的區塊
var Markloupe = globalThis.Markloupe || (globalThis.Markloupe = {})

;(() => {
  // 新增加刪除超過這個行數就不比對，視為整份檔案被換掉
  const MAX_EDITS = 500

  Markloupe.CHANGE_CLASSES = ['ml-changed', 'ml-changed-del', 'ml-changed-del-end']

  Markloupe.noChanges = () => ({ lines: new Set(), dels: new Set() })

  /**
   * 逐行比對（Myers），回傳舊行號 → 新行號的對照，舊行被刪除時為 -1。
   * 新增加刪除超過 MAX_EDITS 行時回傳 null
   * @param {string[]} a 舊版各行
   * @param {string[]} b 新版各行
   */
  Markloupe.diffLines = function (a, b) {
    let s = 0
    while (s < a.length && s < b.length && a[s] === b[s]) s++
    let ea = a.length
    let eb = b.length
    while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
      ea--
      eb--
    }
    const pairs = myers(a.slice(s, ea), b.slice(s, eb))
    if (!pairs) return null
    const map = new Int32Array(a.length).fill(-1)
    for (let i = 0; i < s; i++) map[i] = i
    for (const [i, j] of pairs) map[s + i] = s + j
    for (let i = ea; i < a.length; i++) map[i] = i - ea + eb
    return map
  }

  /** 最短編輯路徑上相同的行，回傳 [舊索引, 新索引] 的陣列 */
  function myers(a, b) {
    const n = a.length
    const m = b.length
    const max = Math.min(n + m, MAX_EDITS)
    const off = max + 1
    const v = new Int32Array(2 * off + 1)
    const trace = []
    for (let d = 0; d <= max; d++) {
      trace.push(v.slice(off - d - 1, off + d + 2))
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
        let y = x - k
        while (x < n && y < m && a[x] === b[y]) {
          x++
          y++
        }
        v[off + k] = x
        if (x >= n && y >= m) return backtrack(trace, n, m)
      }
    }
    return null
  }

  function backtrack(trace, n, m) {
    const pairs = []
    let x = n
    let y = m
    for (let d = trace.length - 1; d >= 0; d--) {
      // trace[d] 存的是 v[-d-1 … d+1]
      const at = k => trace[d][k + d + 1]
      const k = x - y
      const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
      const prevX = at(prevK)
      const prevY = prevX - prevK
      while (x > prevX && y > prevY) {
        x--
        y--
        pairs.push([x, y])
      }
      x = prevX
      y = prevY
    }
    return pairs
  }

  const stripEol = line => line.replace(/\r?\n$|\r$/, '')

  /** 比對兩版原文（不計換行字元）；改動超過一半時視為整份換掉，回傳 null */
  function compare(oldRaw, newRaw) {
    const a = Markloupe.splitLines(oldRaw).map(stripEol)
    const b = Markloupe.splitLines(newRaw).map(stripEol)
    const map = Markloupe.diffLines(a, b)
    if (!map) return null
    const kept = new Uint8Array(b.length)
    let same = 0
    for (const j of map) if (j >= 0) (kept[j] = 1), same++
    const edits = a.length + b.length - 2 * same
    if (edits > 20 && edits > (a.length + b.length) / 2) return null
    // next[i]：舊版第 i 行起第一個保留下來的行在新版的行號
    const next = new Int32Array(a.length + 1)
    next[a.length] = b.length
    for (let i = a.length - 1; i >= 0; i--) next[i] = map[i] >= 0 ? map[i] : next[i + 1]
    return { a, b, map, kept, next }
  }

  /** 新版中新增或修改的非空白行（lines），與只刪除不新增的位置（dels，刪除處下一行的行號） */
  function changesOf({ a, b, map, kept, next }) {
    const blank = j => !b[j]?.trim()
    const lines = new Set()
    for (let j = 0; j < b.length; j++) if (!kept[j] && !blank(j)) lines.add(j)
    const dels = new Set()
    for (let i = 0; i < a.length; i++) {
      if (map[i] >= 0 || (i > 0 && map[i - 1] < 0)) continue
      let e = i
      let text = false
      for (; e < a.length && map[e] < 0; e++) text ||= !!a[e].trim()
      if (!text) continue
      // 刪除處緊鄰改動的行，視為一起修改，只標那一行
      const p = next[e]
      let q = p - 1
      while (q >= 0 && blank(q)) q--
      let r = p
      while (r < b.length && blank(r)) r++
      if (!lines.has(q) && !lines.has(r)) dels.add(p)
    }
    return { lines, dels }
  }

  /**
   * 還沒看過的改動（新版的行號）：比對基準版與新版，扣掉已看過的；改回原樣的行就不再算改動。
   * state.base 為開始累積改動時的原文，state.seen 為已看過的改動（prevRaw 的行號），兩者都會更新。
   * 基準版或新版為空、改動太多時，以新版為新的基準，不標示
   */
  Markloupe.trackChanges = function (state, prevRaw, newRaw) {
    const restart = () => {
      state.base = newRaw
      state.seen = Markloupe.noChanges()
      return Markloupe.noChanges()
    }
    if (!state.base.trim() || !newRaw.trim()) return restart()
    const fromBase = compare(state.base, newRaw)
    if (!fromBase) return restart()
    const changes = changesOf(fromBase)
    const { lines, dels } = state.seen
    if (!lines.size && !dels.size) return changes
    // 已看過的行要沒再被改過才繼續算看過
    const fromPrev = prevRaw === state.base ? fromBase : compare(prevRaw, newRaw)
    state.seen = Markloupe.noChanges()
    if (!fromPrev) return changes
    for (const i of lines) if (fromPrev.map[i] >= 0) state.seen.lines.add(fromPrev.map[i])
    for (const d of dels) state.seen.dels.add(fromPrev.next[Math.min(d, fromPrev.a.length)])
    for (const l of state.seen.lines) changes.lines.delete(l)
    for (const d of state.seen.dels) changes.dels.delete(d)
    return changes
  }

  /** 表格第 l 行對應的列：表頭與分隔線算表頭列，之後依序為表身各列 */
  function tableRow(table, start, l) {
    const i = l - start
    if (i <= 1) return table.tHead?.rows[0] || null
    return table.tBodies[0]?.rows[i - 2] || null
  }

  /**
   * 在渲染結果標出改動，回傳 Map：元素 → 它代表的改動 { lines, dels }。
   * 行號落在最內層有行號的區塊；表格標到列。
   * 沒有行號的最上層區塊（HTML、數學公式、front matter）以前後區塊之間的行判斷；
   * 連結定義等不會渲染的行沒有對應的元素，不標示
   * @param {string[]} lines 原文切行（Markloupe.splitLines）
   */
  Markloupe.markChanges = function (article, changes, lines) {
    const marks = new Map()
    const add = (el, cls, key, v) => {
      el.classList.add(cls)
      if (!marks.has(el)) marks.set(el, { lines: [], dels: [] })
      marks.get(el)[key].push(v)
    }
    if (!changes.lines.size && !changes.dels.size) return marks

    const RANGED = '[data-ml-line][data-ml-end]'
    // 文件順序的區塊：有行號的元素，以及裡外都沒有行號的最上層元素（範圍為前後區塊之間）
    const blocks = []
    for (const el of article.querySelectorAll(`${RANGED}, :scope > *`)) {
      if (el.matches(RANGED)) blocks.push({ el, start: +el.dataset.mlLine, end: +el.dataset.mlEnd, ranged: true })
      else if (!el.querySelector(RANGED)) {
        const r = Markloupe.blockRange(article, el, lines)
        if (r) blocks.push({ el, start: r[0], end: r[1], ranged: false })
      }
    }
    const deepest = (l, inside = b => b.start <= l) => {
      let hit = null
      for (const b of blocks) if (b.ranged && inside(b) && l < b.end) hit = b
      return hit
    }

    for (const l of changes.lines) {
      const hit = deepest(l)
      let el = hit && (hit.el.tagName === 'TABLE' ? tableRow(hit.el, hit.start, l) || hit.el : hit.el)
      el ||= blocks.find(b => !b.ranged && b.start <= l && l < b.end)?.el
      if (el) add(el, 'ml-changed', 'lines', l)
    }

    for (const p of changes.dels) {
      const inside = deepest(p, b => b.start < p)
      if (inside?.el.tagName === 'TABLE') {
        const row = tableRow(inside.el, inside.start, p)
        if (row) add(row, 'ml-changed-del', 'dels', p)
        else add(inside.el.rows[inside.el.rows.length - 1] || inside.el, 'ml-changed-del-end', 'dels', p)
        continue
      }
      const after = blocks.find(b => b.start >= p && (!inside || inside.el.contains(b.el)))
      if (after) add(after.el, 'ml-changed-del', 'dels', p)
      else if (inside) add(inside.el, 'ml-changed', 'dels', p)
      else if (blocks.length) add(blocks[blocks.length - 1].el, 'ml-changed-del-end', 'dels', p)
    }
    return marks
  }
})()
