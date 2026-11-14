'use strict'
// 匯出 Word（.docx）：把閱讀頁的內容轉成 OOXML；字型、字級與紙張取自設定，寫在樣式裡，收件人改樣式就能一次換掉全文
var Markloupe = globalThis.Markloupe || (globalThis.Markloupe = {})

;(() => {
  const NS = {
    w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
    pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
    m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  }
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const PAPER = { A4: { w: 11906, h: 16838 }, Letter: { w: 12240, h: 15840 } } // twip（1/1440 吋）
  const MARGIN = 1440
  const INDENT = 360 // 每一層縮排（twip）

  /** 依文件語言自動選擇的中日韓字型（Windows 內建） */
  const CJK_AUTO = [
    [/^zh-(tw|hk|mo|hant)/i, 'Microsoft JhengHei'],
    [/^zh/i, 'Microsoft YaHei'],
    [/^ja/i, 'Yu Gothic'],
    [/^ko/i, 'Malgun Gothic'],
  ]
  // Word 的東亞語言代碼；沒有對應時用 zh-TW
  const EAST_ASIA = [
    [/^zh-(tw|hk|mo|hant)/i, 'zh-TW'],
    [/^zh/i, 'zh-CN'],
    [/^ja/i, 'ja-JP'],
    [/^ko/i, 'ko-KR'],
  ]
  const pick = (table, lang, fallback) => table.find(([re]) => re.test(lang))?.[1] ?? fallback

  // XML 1.0 不允許的控制字元一律去掉
  const esc = s =>
    String(s)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
      .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

  const CJK_TEXT = /[\u3000-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/
  const HEADING_SCALE = [1.6, 1.35, 1.2, 1.1, 1, 1]
  const ALERT_COLOR = { note: '0969DA', tip: '1A7F37', important: '8250DF', warning: '9A6700', caution: 'CF222E' }

  /** 每一次匯出的狀態：關聯（連結、圖片）、清單編號、書籤 */
  class Builder {
    constructor(opts) {
      this.opts = opts
      this.rels = [] // { id, type, target, external }
      this.nums = [] // 有序清單：每一個清單一組編號，才會從頭數起；{ id, start, level }
      this.bookmarks = new Map() // 標題 id → 書籤名稱
      this.bookmarkSeq = 0
      this.bookmarkIds = 0 // 書籤的數字 id，每個書籤各一個
      this.media = [] // { name, data }
      this.drawings = 0 // 圖片的 docPr id，文件內不可重複
      this.footnoteRels = []
      this.notes = new Map() // 腳註的 id（fn1）→ 文末清單裡的項目
      this.footnotes = [] // Word 腳註的內容，依引用順序；第 n 個的 id 是 n
      this.inFootnote = false
    }

    /** 關聯寫在目前產生的部分（本文或腳註）各自的 .rels；rId1～9 留給樣式、編號等固定的關聯 */
    rel(type, target, external = false) {
      const list = this.inFootnote ? this.footnoteRels : this.rels
      const id = `rId${list.length + 10}`
      list.push({ id, type, target, external })
      return id
    }

    bookmarkName(id) {
      if (!this.bookmarks.has(id)) this.bookmarks.set(id, `_ml${++this.bookmarkSeq}`)
      return this.bookmarks.get(id)
    }

    /* ---------- 文字 ---------- */

    run(text, f) {
      const props = []
      if (f.style) props.push(`<w:rStyle w:val="${f.style}"/>`)
      // 文件語言不是中日韓時，Word 會把中日韓文字當成西文、改用西文字型缺字的替代字型；標記後才用中文字型
      if (CJK_TEXT.test(text)) props.push('<w:rFonts w:hint="eastAsia"/>')
      if (f.b) props.push('<w:b/><w:bCs/>')
      if (f.i) props.push('<w:i/><w:iCs/>')
      if (f.s) props.push('<w:strike/>')
      if (f.u) props.push('<w:u w:val="single"/>')
      if (f.color) props.push(`<w:color w:val="${f.color}"/>`)
      if (f.mark) props.push('<w:highlight w:val="yellow"/>')
      if (f.va) props.push(`<w:vertAlign w:val="${f.va}"/>`)
      const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''
      // 換行與 Tab 要用專門的元素；空白一律保留
      const body = String(text)
        .split(/(\n|\t)/)
        .map(p => (p === '\n' ? '<w:br/>' : p === '\t' ? '<w:tab/>' : p ? `<w:t xml:space="preserve">${esc(p)}</w:t>` : ''))
        .join('')
      return body ? `<w:r>${rPr}${body}</w:r>` : ''
    }

    /** 行內內容轉成 run；f 是目前累積的格式 */
    inline(node, f = {}) {
      if (node.nodeType === Node.TEXT_NODE) {
        // 原文的軟換行在畫面上是空白；程式碼保留原樣
        const text = f.pre ? node.textContent : node.textContent.replace(/\s*\n\s*/g, ' ')
        return this.run(text, f)
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return ''
      const el = node
      const kids = (g = f) => [...el.childNodes].map(n => this.inline(n, g)).join('')
      if (el.classList.contains('math-inline') || el.classList.contains('math-display')) return this.math(el, f)
      switch (el.tagName) {
        case 'STRONG':
        case 'B':
          return kids({ ...f, b: true })
        case 'EM':
        case 'I':
          return kids({ ...f, i: true })
        case 'DEL':
        case 'S':
          return kids({ ...f, s: true })
        case 'U':
        case 'INS':
          return kids({ ...f, u: true })
        case 'MARK':
          return kids({ ...f, mark: true })
        case 'SUP':
          if (el.classList.contains('footnote-ref')) return this.footnoteRef(el)
          return kids({ ...f, va: 'superscript' })
        case 'SUB':
          return kids({ ...f, va: 'subscript' })
        case 'CODE':
        case 'KBD':
        case 'SAMP':
          return this.run(el.textContent, { ...f, style: 'MLCodeChar', pre: true })
        case 'BR':
          return '<w:r><w:br/></w:r>'
        case 'A':
          return this.link(el, f)
        case 'IMG':
          return this.image(el)
        case 'INPUT':
          return el.type === 'checkbox' ? this.run(el.checked ? '☒ ' : '☐ ', f) : ''
        case 'SVG':
        case 'svg':
          return ''
        default:
          return kids()
      }
    }

    link(a, f) {
      const href = a.getAttribute('href') || ''
      const inner = [...a.childNodes].map(n => this.inline(n, { ...f, style: f.style || 'MLLink' })).join('')
      if (!inner) return ''
      if (href.startsWith('#')) {
        let id = href.slice(1)
        try {
          id = decodeURIComponent(id)
        } catch {
          // 不合法的 % 編碼：沿用原字串
        }
        return `<w:hyperlink w:anchor="${this.bookmarkName(id)}">${inner}</w:hyperlink>`
      }
      if (!/^(https?|mailto|file):/i.test(href)) return [...a.childNodes].map(n => this.inline(n, f)).join('')
      return `<w:hyperlink r:id="${this.rel(`${REL}/hyperlink`, href, true)}">${inner}</w:hyperlink>`
    }

    /* ---------- 腳註 ---------- */

    /** 文末的腳註清單拿出來另外存放；不再出現在本文 */
    takeFootnotes(root) {
      const section = root.querySelector('section.footnotes')
      if (!section) return
      for (const li of section.querySelectorAll('li[id]')) this.notes.set(li.id, li)
      section.previousElementSibling?.matches('hr.footnotes-sep') && section.previousElementSibling.remove()
      section.remove()
    }

    /** 同一個腳註被引用多次時，每次各建一份：Word 的腳註只能被引用一次 */
    footnoteRef(sup) {
      const a = sup.querySelector('a[href^="#"]')
      const li = a && this.notes.get(decodeURIComponent(a.getAttribute('href').slice(1)))
      if (!li || this.inFootnote) return this.run(sup.textContent, { va: 'superscript' })
      this.footnotes.push(li)
      return `<w:r><w:rPr><w:rStyle w:val="MLFootnoteRef"/></w:rPr><w:footnoteReference w:id="${this.footnotes.length}"/></w:r>`
    }

    footnotesXml() {
      this.inFootnote = true
      // 直接用原本的項目（腳註區已從文件拿掉）：複製的話，讀好的圖片對不上複製出來的元素
      for (const li of this.notes.values()) for (const back of li.querySelectorAll('.footnote-backref')) back.remove()
      const notes = this.footnotes.map((li, i) => {
        const paras = this.flow(li, { style: 'MLFootnoteText' })
        const mark = '<w:r><w:rPr><w:rStyle w:val="MLFootnoteRef"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>'
        // 腳註編號放在第一段開頭
        paras[0] = paras[0] ? paras[0].replace(/^(<w:p>(?:<w:pPr>.*?<\/w:pPr>)?)/, `$1${mark}`) : `<w:p><w:pPr><w:pStyle w:val="MLFootnoteText"/></w:pPr>${mark}</w:p>`
        return `<w:footnote w:id="${i + 1}">${paras.join('')}</w:footnote>`
      })
      this.inFootnote = false
      const ns = Object.entries(NS)
        .map(([k, v]) => `xmlns:${k}="${v}"`)
        .join(' ')
      return (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${ns}>` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        `${notes.join('')}</w:footnotes>`
      )
    }

    /* ---------- front matter ---------- */

    /**
     * front matter 的 title 印成標題區、author 與 date 印成副標題；第一個標題與 title 相同時不重複印標題。
     * 回傳要放在本文前面與第一個標題之後的段落
     */
    titleBlock(meta, firstHeading) {
      const sub = [meta.author, meta.date].filter(Boolean).join(' · ')
      const subtitle = sub ? this.para(this.run(sub, {}), { style: 'Subtitle' }) : ''
      if (!meta.title || meta.title === firstHeading) return { before: '', afterHeading: subtitle }
      return { before: this.para(this.run(meta.title, {}), { style: 'Title' }) + subtitle, afterHeading: '' }
    }

    /* ---------- 圖片 ---------- */

    /** 先讀好所有圖片：轉換是同步的，圖片要事先讀取、解碼 */
    async prepareImages(root) {
      this.images = new Map() // 元素 → { rid, w, h }（w、h 是 EMU）
      const maxW = (PAPER[this.opts.paper].w - MARGIN * 2) * 635 // twip → EMU
      const add = (el, png, w, h) => {
        const name = `image${this.media.length + 1}.${png.ext}`
        this.media.push({ name, data: png.bytes })
        const scale = Math.min(1, maxW / (w * 9525))
        this.images.set(el, { name, w: Math.round(w * 9525 * scale), h: Math.round(h * 9525 * scale) })
      }
      for (const img of root.querySelectorAll('img[src]')) {
        const got = await readImage(img.getAttribute('src')).catch(() => null)
        if (!got) continue
        // HTML 有寫寬度時照寫的寬度，否則用圖片本身的尺寸（以 96 dpi 換算）
        const attrW = Number(img.getAttribute('width')) || 0
        const w = attrW || got.w
        add(img, got, w, attrW ? (got.h * attrW) / got.w : got.h)
      }
      for (const svg of root.querySelectorAll('.ml-mermaid .ml-mermaid-view svg')) {
        const got = await Markloupe.mermaidPng(svg).catch(() => null)
        // 以兩倍解析度繪製，顯示原尺寸
        if (got) add(svg, { ext: 'png', bytes: new Uint8Array(await got.blob.arrayBuffer()) }, got.width, got.height)
      }
    }

    image(el) {
      const im = this.images?.get(el)
      if (!im) return el.alt ? this.run(`[${el.alt}]`, {}) : ''
      // 關聯在用到時才建立：圖片在腳註裡時要寫在腳註自己的 .rels
      const rid = this.rel(`${REL}/image`, `media/${im.name}`)
      const n = ++this.drawings
      const alt = esc(el.getAttribute?.('alt') || '')
      return (
        `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${im.w}" cy="${im.h}"/>` +
        `<wp:docPr id="${n}" name="Picture ${n}" descr="${alt}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
        `<pic:nvPicPr><pic:cNvPr id="${n}" name="Picture ${n}"/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${im.w}" cy="${im.h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
      )
    }

    /** 公式轉成 Word 原生公式；有不支援的寫法時輸出 LaTeX 原文 */
    math(el, f) {
      const math = el.querySelector('math')
      const omml = math && Markloupe.mathToOmml(math)
      if (omml) return omml
      const d = el.classList.contains('math-display') ? '$$' : '$'
      return this.run(`${d}${el.dataset.mlTex?.trim() || el.textContent}${d}`, { ...f, style: 'MLCodeChar' })
    }

    /* ---------- 區塊 ---------- */

    para(runs, { style, indent = 0, num, keepNext, border, align } = {}) {
      const p = []
      if (style) p.push(`<w:pStyle w:val="${style}"/>`)
      if (keepNext) p.push('<w:keepNext/>')
      if (num) p.push(`<w:numPr><w:ilvl w:val="${num.level}"/><w:numId w:val="${num.id}"/></w:numPr>`)
      if (border) p.push(`<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="${border}"/></w:pBdr>`)
      if (indent && !num) p.push(`<w:ind w:left="${indent}"/>`)
      if (align) p.push(`<w:jc w:val="${align}"/>`)
      return `<w:p>${p.length ? `<w:pPr>${p.join('')}</w:pPr>` : ''}${runs}</w:p>`
    }

    /** 把子節點中連續的行內內容合成段落，區塊照樣轉換 */
    flow(el, ctx) {
      const out = []
      let pending = []
      const flush = () => {
        const runs = pending.map(n => this.inline(n, ctx.f)).join('')
        if (runs.trim()) out.push(this.para(runs, ctx))
        pending = []
      }
      for (const n of el.childNodes) {
        if (n.nodeType === Node.ELEMENT_NODE && isBlock(n)) {
          flush()
          out.push(...this.block(n, ctx))
        } else if (n.nodeType === Node.TEXT_NODE && !n.textContent.trim() && !pending.length) {
          continue
        } else {
          pending.push(n)
        }
      }
      flush()
      return out
    }

    /**
     * @param {object} ctx 目前的段落設定：style、indent（縮排）、border（左側框線）、level（清單層級）、f（文字格式）
     * @returns {string[]}
     */
    block(el, ctx = {}) {
      const tag = el.tagName
      if (/^H[1-6]$/.test(tag)) {
        const runs = [...el.childNodes].map(n => this.inline(n)).join('')
        const mark = el.id ? this.bookmarkName(el.id) : null
        const n = ++this.bookmarkIds
        const body = mark ? `<w:bookmarkStart w:id="${n}" w:name="${mark}"/>${runs}<w:bookmarkEnd w:id="${n}"/>` : runs
        return [this.para(body, { style: `Heading${tag[1]}` })]
      }
      if (el.classList.contains('math-display')) {
        const m = this.math(el, {})
        return [m.startsWith('<m:oMath>') ? `<w:p>${ctx.indent ? `<w:pPr><w:ind w:left="${ctx.indent}"/></w:pPr>` : ''}<m:oMathPara>${m}</m:oMathPara></w:p>` : this.para(m, { ...ctx, align: 'center' })]
      }
      switch (tag) {
        case 'P': {
          const runs = [...el.childNodes].map(n => this.inline(n, ctx.f)).join('')
          return runs ? [this.para(runs, ctx)] : []
        }
        case 'UL':
        case 'OL':
          return this.list(el, ctx)
        case 'BLOCKQUOTE':
          return this.quote(el, ctx)
        case 'PRE':
          return [this.para(this.run(el.textContent.replace(/\n$/, ''), { pre: true }), { ...ctx, style: 'MLCode' })]
        case 'TABLE':
          return [this.table(el)]
        case 'HR':
          return ['<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D0D7DE"/></w:pBdr></w:pPr></w:p>']
        case 'DL':
          return [...el.children].flatMap(c =>
            c.tagName === 'DT'
              ? [this.para([...c.childNodes].map(n => this.inline(n, { b: true })).join(''), { ...ctx, keepNext: true })]
              : this.flow(c, { ...ctx, indent: (ctx.indent || 0) + INDENT * 2 }),
          )
        case 'DETAILS': {
          if (el.classList.contains('markdown-alert')) return this.quote(el, ctx)
          const summary = el.querySelector(':scope > summary')
          const head = summary ? [this.para([...summary.childNodes].map(n => this.inline(n, { b: true })).join(''), ctx)] : []
          return [...head, ...this.flow(el, ctx)]
        }
        case 'SUMMARY':
          return []
        case 'IMG':
          return [this.para(this.image(el), ctx)]
        case 'SECTION':
        case 'DIV':
        case 'ARTICLE':
        case 'FIGURE':
        case 'CENTER':
          if (el.classList.contains('ml-code')) return this.codeBlock(el, ctx)
          return this.flow(el, ctx)
        default:
          return this.flow(el, ctx)
      }
    }

    codeBlock(wrap, ctx) {
      const svg = wrap.classList.contains('ml-mermaid') && wrap.querySelector('.ml-mermaid-view svg')
      if (svg && this.images?.has(svg)) return [this.para(this.image(svg), { ...ctx, align: 'center' })]
      const pre = wrap.querySelector('pre')
      return pre ? this.block(pre, ctx) : []
    }

    quote(bq, ctx) {
      const kind = (bq.className.match(/markdown-alert-(\w+)/) || [])[1]
      const color = ALERT_COLOR[kind] || 'D0D7DE'
      const inner = { ...ctx, indent: (ctx.indent || 0) + INDENT, border: color }
      const out = []
      for (const c of bq.childNodes) {
        if (c.nodeType === Node.ELEMENT_NODE && c.classList.contains('markdown-alert-title')) {
          out.push(this.para(this.run(c.textContent, { b: true, color }), { ...inner, keepNext: true }))
        } else if (c.nodeType === Node.ELEMENT_NODE) {
          out.push(...(isBlock(c) ? this.block(c, inner) : [this.para(this.inline(c), inner)]))
        } else if (c.textContent.trim()) {
          out.push(this.para(this.inline(c), inner))
        }
      }
      return out
    }

    list(el, ctx) {
      const level = ctx.level ?? 0
      let numId = 1 // 項目符號共用同一組
      if (el.tagName === 'OL') {
        numId = this.nums.length + 2
        this.nums.push({ id: numId, start: Number(el.getAttribute('start')) || 1, level })
      }
      const out = []
      for (const li of el.children) {
        if (li.tagName !== 'LI') continue
        const task = li.classList.contains('task-list-item')
        // 任務清單在畫面上沒有項目符號：只縮排，勾選框以 ☐／☒ 表示
        const first = task ? { ...ctx, indent: INDENT * 2 * (level + 1), level: undefined } : { ...ctx, num: { id: numId, level } }
        const rest = { ...ctx, indent: INDENT * 2 * (level + 1), num: undefined, level: level + 1 }
        let started = false
        let pending = []
        const flush = () => {
          const blank = pending.every(n => n.nodeType === Node.TEXT_NODE && !n.textContent.trim())
          const runs = blank ? '' : pending.map(n => this.inline(n, ctx.f)).join('')
          pending = []
          if (!runs && started) return
          out.push(this.para(runs, started ? rest : first))
          started = true
        }
        for (const n of li.childNodes) {
          // 鬆散清單在區塊之間的換行與空白不是內容
          if (n.nodeType === Node.TEXT_NODE && !n.textContent.trim() && !pending.length) continue
          if (n.nodeType === Node.ELEMENT_NODE && (n.tagName === 'UL' || n.tagName === 'OL')) {
            if (!started || pending.length) flush()
            out.push(...this.list(n, { ...ctx, level: level + 1, num: undefined }))
          } else if (n.nodeType === Node.ELEMENT_NODE && n.tagName === 'P') {
            if (pending.length) flush()
            pending = [...n.childNodes]
            flush()
          } else if (n.nodeType === Node.ELEMENT_NODE && isBlock(n)) {
            if (!started || pending.length) flush()
            out.push(...this.block(n, rest))
          } else {
            pending.push(n)
          }
        }
        if (!started || pending.length) flush()
      }
      return out
    }

    table(table) {
      const rows = [...table.rows]
      const cols = Math.max(1, ...rows.map(r => [...r.cells].reduce((n, c) => n + (c.colSpan || 1), 0)))
      const width = (PAPER[this.opts.paper].w - MARGIN * 2) / cols
      const grid = `<w:tblGrid>${`<w:gridCol w:w="${Math.round(width)}"/>`.repeat(cols)}</w:tblGrid>`
      // 跨列（rowspan）的儲存格往下佔用的欄：欄位 → { 剩餘列數, 欄寬 }。被佔用的位置輸出延續的合併儲存格
      const spans = new Map()
      const merged = span => `<w:tc><w:tcPr>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}<w:vMerge/></w:tcPr><w:p/></w:tc>`
      const body = rows
        .map(r => {
          const head = r.parentElement.tagName === 'THEAD' || [...r.cells].every(c => c.tagName === 'TH')
          const out = []
          let col = 0
          const fill = () => {
            while (spans.has(col)) {
              const s = spans.get(col)
              out.push(merged(s.span))
              if (--s.rows === 0) spans.delete(col)
              col += s.span
            }
          }
          for (const c of r.cells) {
            fill()
            const span = c.colSpan || 1
            const down = c.rowSpan > 1 ? c.rowSpan : 1
            const align = { center: 'center', right: 'right' }[c.style.textAlign] || undefined
            const pr = [
              span > 1 ? `<w:gridSpan w:val="${span}"/>` : '',
              down > 1 ? '<w:vMerge w:val="restart"/>' : '',
              head ? '<w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/>' : '',
            ].join('')
            let paras = this.flow(c, { f: head ? { b: true } : {}, align, style: 'MLTableText' })
            if (!paras.length) paras = ['<w:p><w:pPr><w:pStyle w:val="MLTableText"/></w:pPr></w:p>']
            out.push(`<w:tc><w:tcPr>${pr}</w:tcPr>${paras.join('')}</w:tc>`)
            if (down > 1) spans.set(col, { rows: down - 1, span })
            col += span
          }
          fill()
          return `<w:tr>${head ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${out.join('')}</w:tr>`
        })
        .join('')
      return `<w:tbl><w:tblPr><w:tblStyle w:val="MLTable"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0" w:firstRow="1"/></w:tblPr>${grid}${body}</w:tbl><w:p/>`
    }

    /* ---------- 檔案 ---------- */

    numberingXml() {
      const BULLETS = ['•', '◦', '▪']
      const lvl = (i, fmt, text) =>
        `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/>` +
        `<w:pPr><w:ind w:left="${INDENT * 2 * (i + 1)}" w:hanging="${INDENT}"/></w:pPr></w:lvl>`
      const bullet = Array.from({ length: 9 }, (_, i) => lvl(i, 'bullet', BULLETS[i % 3])).join('')
      const decimal = Array.from({ length: 9 }, (_, i) => lvl(i, 'decimal', `%${i + 1}.`)).join('')
      // 每個有序清單各用一組編號，並指定起始值：同一份抽象編號的清單才不會接續上一個清單往下數
      const nums = this.nums
        .map(
          n =>
            `<w:num w:numId="${n.id}"><w:abstractNumId w:val="1"/>` +
            Array.from({ length: 9 }, (_, i) => `<w:lvlOverride w:ilvl="${i}"><w:startOverride w:val="${i === n.level ? n.start : 1}"/></w:lvlOverride>`).join('') +
            '</w:num>',
        )
        .join('')
      return (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${NS.w}">` +
        `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${bullet}</w:abstractNum>` +
        `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${decimal}</w:abstractNum>` +
        `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${nums}</w:numbering>`
      )
    }

    stylesXml() {
      const { latin, cjk, code, size, lang, eastAsia } = this.opts
      const half = Math.round(size * 2) // w:sz 以半點為單位
      const fonts = (ascii, ea = cjk) => `<w:rFonts w:ascii="${esc(ascii)}" w:hAnsi="${esc(ascii)}" w:cs="${esc(ascii)}" w:eastAsia="${esc(ea)}"/>`
      const heading = i =>
        `<w:style w:type="paragraph" w:styleId="Heading${i}"><w:name w:val="heading ${i}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
        `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${i < 3 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${i - 1}"/></w:pPr>` +
        `<w:rPr><w:b/><w:bCs/><w:sz w:val="${Math.round(half * HEADING_SCALE[i - 1])}"/><w:szCs w:val="${Math.round(half * HEADING_SCALE[i - 1])}"/></w:rPr></w:style>`
      return (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${NS.w}">` +
        `<w:docDefaults><w:rPrDefault><w:rPr>${fonts(latin)}<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>` +
        `<w:lang w:val="${esc(lang)}" w:eastAsia="${eastAsia}"/></w:rPr></w:rPrDefault>` +
        '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
        `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr>${fonts(latin)}</w:rPr></w:style>` +
        [1, 2, 3, 4, 5, 6].map(heading).join('') +
        `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="${half * 2}"/></w:rPr></w:style>` +
        '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="59636E"/></w:rPr></w:style>' +
        `<w:style w:type="paragraph" w:styleId="MLCode"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/>` +
        '<w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/><w:spacing w:after="160" w:line="240" w:lineRule="auto"/></w:pPr>' +
        `<w:rPr>${fonts(code)}<w:sz w:val="${half - 3}"/><w:szCs w:val="${half - 3}"/></w:rPr></w:style>` +
        `<w:style w:type="paragraph" w:styleId="MLTableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>` +
        `<w:style w:type="character" w:styleId="MLCodeChar"><w:name w:val="Code Char"/><w:rPr>${fonts(code)}<w:shd w:val="clear" w:color="auto" w:fill="EFF1F3"/></w:rPr></w:style>` +
        `<w:style w:type="paragraph" w:styleId="MLFootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="${half - 4}"/><w:szCs w:val="${half - 4}"/></w:rPr></w:style>` +
        '<w:style w:type="character" w:styleId="MLFootnoteRef"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>' +
        '<w:style w:type="character" w:styleId="MLLink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0969DA"/><w:u w:val="single"/></w:rPr></w:style>' +
        '<w:style w:type="table" w:styleId="MLTable"><w:name w:val="Markloupe Table"/><w:tblPr><w:tblBorders>' +
        ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/>`).join('') +
        '</w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
        '</w:styles>'
      )
    }

    documentXml(body) {
      const paper = PAPER[this.opts.paper]
      const ns = Object.entries(NS)
        .map(([k, v]) => `xmlns:${k}="${v}"`)
        .join(' ')
      return (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${ns}><w:body>${body.join('')}` +
        `<w:sectPr><w:pgSz w:w="${paper.w}" w:h="${paper.h}"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>` +
        '</w:body></w:document>'
      )
    }

    files(body, meta) {
      const notes = this.footnotes.length ? this.footnotesXml() : null
      const relXml = list => list.map(r => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')
      const rels = [
        `<Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>`,
        `<Relationship Id="rId2" Type="${REL}/numbering" Target="numbering.xml"/>`,
        `<Relationship Id="rId3" Type="${REL}/settings" Target="settings.xml"/>`,
        notes ? `<Relationship Id="rId4" Type="${REL}/footnotes" Target="footnotes.xml"/>` : '',
        relXml(this.rels),
      ]
      const relsPart = list => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list}</Relationships>`
      const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
      return [
        {
          name: '[Content_Types].xml',
          data:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
            '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
            '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
            '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
            '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
            (notes ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' : '') +
            '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
            '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>',
        },
        {
          name: '_rels/.rels',
          data:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>` +
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
            `<Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
        },
        { name: 'word/_rels/document.xml.rels', data: relsPart(rels.join('')) },
        ...(notes ? [{ name: 'word/footnotes.xml', data: notes }, { name: 'word/_rels/footnotes.xml.rels', data: relsPart(relXml(this.footnoteRels)) }] : []),
        {
          name: 'word/settings.xml',
          // 宣告腳註的分隔線（footnotes.xml 的 id -1、0）
          data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${NS.w}">${notes ? '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>' : ''}<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`,
        },
        { name: 'word/document.xml', data: this.documentXml(body) },
        { name: 'word/styles.xml', data: this.stylesXml() },
        { name: 'word/numbering.xml', data: this.numberingXml() },
        {
          name: 'docProps/core.xml',
          data:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
            'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
            `<dc:title>${esc(meta.title || document.title)}</dc:title>${meta.author ? `<dc:creator>${esc(meta.author)}</dc:creator>` : ''}<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
        },
        {
          name: 'docProps/app.xml',
          data:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
            `<Application>Markloupe ${esc(chrome.runtime.getManifest().version)}</Application></Properties>`,
        },
        ...this.media.map(m => ({ name: `word/media/${m.name}`, data: m.data })),
      ]
    }
  }

  const WORD_IMAGE = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif' }

  const decode = (bytes, mime) => createImageBitmap(new Blob([bytes], { type: mime }))
  const fromBase64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0))

  /** 畫到 canvas 後存成 PNG：Word 不支援的圖片格式（WebP、SVG 等） */
  async function toPng(source, w, h) {
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)))
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return { ext: 'png', bytes: new Uint8Array(await blob.arrayBuffer()), w: canvas.width, h: canvas.height }
  }

  /** 讀取圖片：data: 網址直接解析，其他由背景程式讀取（與匯出 HTML 的內嵌圖片相同）；回傳 Word 可用的格式與像素尺寸 */
  async function readImage(src) {
    let bytes
    let mime
    const data = /^data:(image\/[\w+.-]+);base64,(.*)$/i.exec(src)
    if (data) {
      ;[mime, bytes] = [data[1].toLowerCase(), fromBase64(data[2])]
    } else {
      const res = await chrome.runtime.sendMessage({ type: 'read-image', url: new URL(src, location.href).href })
      if (res?.status !== 'ok') return null
      ;[mime, bytes] = [res.mime, fromBase64(res.base64)]
    }
    const bmp = await decode(bytes, mime)
    if (WORD_IMAGE[mime]) return { ext: WORD_IMAGE[mime], bytes, w: bmp.width, h: bmp.height }
    return toPng(bmp, bmp.width, bmp.height)
  }

  const BLOCK_TAGS = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR', 'DL', 'DT', 'DD',
    'DIV', 'SECTION', 'ARTICLE', 'DETAILS', 'SUMMARY', 'FIGURE', 'CENTER', 'HEADER', 'FOOTER', 'ASIDE', 'NAV',
  ])
  function isBlock(el) {
    return BLOCK_TAGS.has(el.tagName) || el.classList.contains('math-display')
  }

  /** 設定中的字型；auto 依文件語言選擇 */
  Markloupe.docxOptions = function (settings, lang) {
    const docLang = lang || navigator.language || 'en'
    const cjk = settings.docxCjkFont === 'auto' ? pick(CJK_AUTO, docLang, 'Microsoft JhengHei') : settings.docxCjkFont
    return {
      latin: settings.docxLatinFont,
      cjk,
      code: settings.docxCodeFont,
      size: settings.docxFontSize,
      paper: PAPER[settings.docxPaper] ? settings.docxPaper : 'A4',
      lang: docLang,
      eastAsia: pick(EAST_ASIA, docLang, 'zh-TW'),
    }
  }

  /**
   * 產生 .docx
   * @returns {Promise<Blob>}
   */
  Markloupe.buildDocx = async function (article, settings) {
    const doc = new DOMParser().parseFromString(`<article>${Markloupe.staticHtml(article.childNodes)}</article>`, 'text/html')
    const root = doc.querySelector('article')
    // front matter 只取 title、author、date（以鍵值清單顯示的才有）
    const fm = root.querySelector(':scope > .ml-frontmatter')
    const meta = {}
    for (const dt of fm?.querySelectorAll('.ml-fm-list > dt') || []) {
      const key = dt.textContent.trim().toLowerCase()
      if (['title', 'author', 'date'].includes(key)) meta[key] = dt.nextElementSibling?.textContent.trim()
    }
    fm?.remove()
    const b = new Builder(Markloupe.docxOptions(settings, article.lang))
    await b.prepareImages(root) // 在拿走腳註區之前：腳註裡的圖片也要讀
    b.takeFootnotes(root)
    const body = b.flow(root, {})
    const heading = root.querySelector('h1, h2, h3, h4, h5, h6')
    const { before, afterHeading } = b.titleBlock(meta, heading?.textContent.trim())
    const first = body.findIndex(p => /<w:pStyle w:val="Heading\d"\/>/.test(p))
    if (afterHeading && first >= 0) body.splice(first + 1, 0, afterHeading)
    else if (afterHeading) body.unshift(afterHeading)
    if (before) body.unshift(before)
    return Markloupe.zip(b.files(body, meta), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  }

  Markloupe.exportDocx = async function (article, settings) {
    const name = `${Markloupe.docBaseName()}.docx`
    Markloupe.downloadBlob(await Markloupe.buildDocx(article, settings), name)
    return { name }
  }
})()
