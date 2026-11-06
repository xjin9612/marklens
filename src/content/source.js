'use strict'
// 渲染結果對應回原文：區塊與章節的行號範圍、檔案位置的文字格式（複製位置、複製原文、用編輯器開啟共用）
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

;(() => {
  const HEADING_RE = /^H[1-6]$/

  /** 把 markdown.js 標在區塊上的行號 class（帶 nonce）改存成 data-ml-line／data-ml-end（0 起算，結尾不含） */
  MarkLens.applyLineRanges = function (article, nonce) {
    const prefix = `ml-line-${nonce}-`
    for (const el of article.querySelectorAll(`[class*="${prefix}"]`)) {
      const cls = [...el.classList].find(c => c.startsWith(prefix))
      if (!cls) continue
      const [start, end] = cls.slice(prefix.length).split('-')
      el.dataset.mlLine = start
      el.dataset.mlEnd = end
      el.classList.remove(cls)
      if (!el.classList.length) el.removeAttribute('class')
    }
  }

  const own = el => (el?.dataset?.mlLine != null ? [+el.dataset.mlLine, +el.dataset.mlEnd] : null)

  /** 元素本身或其中的區塊所涵蓋的範圍；都沒有行號時回傳 null */
  function inner(el) {
    const r = own(el)
    if (r) return r
    let start = Infinity
    let end = -Infinity
    for (const d of el.querySelectorAll?.('[data-ml-line]') || []) {
      start = Math.min(start, +d.dataset.mlLine)
      end = Math.max(end, +d.dataset.mlEnd)
    }
    return start < end ? [start, end] : null
  }

  /** 去掉範圍頭尾的空白行，至少保留一行 */
  function trim(lines, [start, end]) {
    while (start < end - 1 && !lines[start]?.trim()) start++
    while (end > start + 1 && !lines[end - 1]?.trim()) end--
    return [start, end]
  }

  /**
   * 節點所在區塊的原文範圍 [start, end)（0 起算）
   * 自訂渲染的區塊（HTML、數學公式、容器）沒有行號：取前後有行號的區塊之間的行
   * @param {string[]} lines 原文切行（MarkLens.splitLines）
   */
  MarkLens.blockRange = function (article, node, lines) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
    for (let e = el; e && e !== article; e = e.parentElement) {
      const r = own(e)
      if (r) return r
    }
    while (el && el.parentElement !== article) el = el.parentElement
    if (!el) return null
    const r = inner(el)
    if (r) return r
    let start = 0
    let end = lines.length
    for (let p = el.previousElementSibling; p; p = p.previousElementSibling) {
      const pr = inner(p)
      if (pr) {
        start = pr[1]
        break
      }
    }
    for (let n = el.nextElementSibling; n; n = n.nextElementSibling) {
      const nr = inner(n)
      if (nr) {
        end = nr[0]
        break
      }
    }
    return start < end ? trim(lines, [start, end]) : null
  }

  /**
   * 標題那一節的原文範圍：到同一層容器中下一個同級或更高的標題為止
   * 文章最上層的章節延伸到下一個標題或文件結尾（含連結定義、註解等不會渲染的行）；
   * 引用、清單中的標題只到所在容器的結尾
   */
  MarkLens.sectionRange = function (article, heading, lines) {
    const head = own(heading)
    if (!head) return null
    const level = +heading.dataset.mlLevel
    let last = heading
    let boundary = null
    for (let n = heading.nextElementSibling; n; n = n.nextElementSibling) {
      if (HEADING_RE.test(n.tagName) && +n.dataset.mlLevel <= level) {
        boundary = n
        break
      }
      last = n
    }
    let end
    if (boundary && own(boundary)) end = own(boundary)[0]
    else if (!boundary && heading.parentElement === article) end = lines.length
    else if (!boundary) end = inner(heading.parentElement)?.[1] ?? head[1]
    else end = MarkLens.blockRange(article, last, lines)?.[1] ?? head[1]
    return trim(lines, [head[0], Math.max(end, head[1])])
  }

  /** 選取範圍涵蓋的原文行；選取不在文章中時回傳 null */
  MarkLens.selectionRange = function (article, range, lines) {
    if (!article.contains(range.commonAncestorContainer)) return null
    const { startContainer: sc, startOffset: so, endContainer: ec, endOffset: eo } = range
    const startNode = sc.nodeType === Node.ELEMENT_NODE && sc.childNodes[so] ? sc.childNodes[so] : sc
    // 選到下一個區塊的開頭（例如三連擊選取段落）時，那個區塊不算在內
    let endNode = ec
    if (ec.nodeType === Node.ELEMENT_NODE) endNode = eo > 0 ? ec.childNodes[eo - 1] : previousLeaf(ec, article)
    else if (eo === 0 && ec !== sc) endNode = previousLeaf(ec, article)
    const a = MarkLens.blockRange(article, startNode, lines)
    const b = endNode ? MarkLens.blockRange(article, endNode, lines) : null
    if (!a || !b) return a || b
    return [Math.min(a[0], b[0]), Math.max(a[1], b[1])]
  }

  function previousLeaf(node, article) {
    for (let n = node; n && n !== article; n = n.parentNode) {
      if (n.previousSibling) {
        let p = n.previousSibling
        while (p.lastChild) p = p.lastChild
        return p
      }
    }
    return null
  }

  /** 目前文件的位置：本機檔案為作業系統路徑（Windows 用反斜線），網頁為網址（不含 #） */
  MarkLens.sourcePath = function (href = location.href) {
    const url = new URL(href)
    if (url.protocol !== 'file:') return href.split('#')[0]
    let path = url.pathname
    try {
      path = decodeURIComponent(path)
    } catch {
      // 不合法的 % 編碼：沿用原字串
    }
    // 網路共用與 WSL（file://主機/… 或 file:////主機/…）：\\主機\路徑
    if (url.host) return `\\\\${url.host}${path.replace(/\//g, '\\')}`
    if (path.startsWith('//')) return path.replace(/\//g, '\\')
    if (/^\/[a-z]:\//i.test(path)) return path.slice(1).replace(/\//g, '\\')
    return path
  }

  /**
   * 位置文字：本機檔案「路徑:起-迄」，網頁「網址#L起-L迄」（行號 1 起算）；有標題時附在後面
   * @param {[number, number]} [range] 0 起算、結尾不含；省略時只有路徑
   */
  MarkLens.formatLocation = function (range, title, href = location.href) {
    const path = MarkLens.sourcePath(href)
    let text = path
    if (range) {
      const [a, b] = [range[0] + 1, Math.max(range[0] + 1, range[1])]
      if (href.startsWith('file:')) text += a === b ? `:${a}` : `:${a}-${b}`
      else text += a === b ? `#L${a}` : `#L${a}-L${b}`
    }
    return title ? `${text} (${title})` : text
  }
})()
