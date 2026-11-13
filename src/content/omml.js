'use strict'
// KaTeX 輸出的 MathML 轉成 Word 原生公式（OMML）；遇到不支援的元素丟出錯誤，由呼叫端改用 LaTeX 原文
var Markloupe = globalThis.Markloupe || (globalThis.Markloupe = {})

;(() => {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

  // 求和、積分等大型運算子：上下限放在符號上下（積分放右側）
  const NARY = new Set([...'∑∏∐⋀⋁⋂⋃⨀⨁⨂⨄⨆∫∬∭∮∯∰'])
  const INTEGRAL = new Set([...'∫∬∭∮∯∰'])
  // 重音：KaTeX 的字元 → OMML 用的組合字元
  const ACCENT = { '^': '\u0302', 'ˆ': '\u0302', '~': '\u0303', '˜': '\u0303', '\u20d7': '\u20d7', '→': '\u20d7', 'ˉ': '\u0305', '¯': '\u0305', '˙': '\u0307', '¨': '\u0308', 'ˇ': '\u030c', '˘': '\u0306', '´': '\u0301', '`': '\u0300' }
  const OVERLINE = new Set(['‾', '¯', '_', '―'])
  const STYLE = { bold: 'b', 'bold-italic': 'bi', italic: 'i', normal: 'p' }
  const SCRIPT = { 'double-struck': 'double-struck', fraktur: 'fraktur', script: 'script', 'sans-serif': 'sans-serif', monospace: 'monospace' }

  class Unsupported extends Error {}

  const kids = el => [...el.children].filter(c => c.localName !== 'annotation' && c.localName !== 'annotation-xml')
  const wrap = (tag, inner) => `<m:${tag}>${inner}</m:${tag}>`

  function run(text, el, plain = false) {
    if (!text) return ''
    const props = []
    const variant = el?.getAttribute('mathvariant')
    if (plain) props.push('<m:nor/>')
    if (SCRIPT[variant]) props.push(`<m:scr m:val="${SCRIPT[variant]}"/>`)
    // 多字母的識別字（sin、lim）與 \mathrm 用正體
    const sty = STYLE[variant] || (el?.localName === 'mi' && [...text].length > 1 ? 'p' : '')
    if (sty) props.push(`<m:sty m:val="${sty}"/>`)
    return `<m:r>${props.length ? `<m:rPr>${props.join('')}</m:rPr>` : ''}<m:t xml:space="preserve">${esc(text)}</m:t></m:r>`
  }

  const opText = el => (el?.localName === 'mo' ? el.textContent.trim() : '')
  const FUNC_APPLY = /^[\u2061]$/

  /** 大型運算子本身（∑、∫），或以它為底的上下標、上下限 */
  const naryBase = el => {
    if (NARY.has(opText(el))) return el
    if (/^(msub|msup|msubsup|munder|mover|munderover)$/.test(el?.localName) && NARY.has(opText(kids(el)[0]))) return el
    return null
  }
  /** 函數名稱：多字母的 mi 後面接 U+2061，或底是這種寫法的上下限（\lim_{x\to 0}） */
  const funcName = (el, next) => {
    if (el.localName === 'mi' && [...el.textContent].length > 1 && FUNC_APPLY.test(opText(next))) return true
    if (/^(munder|mover|munderover)$/.test(el.localName)) {
      const base = kids(el)[0]
      return base?.localName === 'mrow' && FUNC_APPLY.test(opText(kids(base).at(-1)))
    }
    return false
  }

  /**
   * 依序轉換一串元素：運算子（∑、∫）把後面一項當成運算對象，函數名稱把後面一項當成參數，
   * Word 才會照它的公式排版留間距，而不是在運算子後面留一個空位
   */
  function seq(list) {
    const out = []
    for (let i = 0; i < list.length; i++) {
      const el = list[i]
      let next = list[i + 1]
      if (naryBase(el)) {
        // 後面接的是運算子（−、=、+）時看不出運算對象到哪裡結束，不吃進來
        const arg = next && !naryBase(next) && next.localName !== 'mo' ? conv(next) : ''
        if (arg) i++
        const op = el.localName === 'mo' ? nary(el, null, null) : conv(el)
        out.push(op.replace('<m:e/></m:nary>', `${wrap('e', arg)}</m:nary>`))
      } else if (funcName(el, next)) {
        if (el.localName === 'mi') {
          i++ // U+2061
          next = list[i + 1]
          // 上下限的底（\lim）只有名稱，參數在外層
          if (!next) {
            out.push(conv(el))
            continue
          }
        }
        const arg = next ? conv(next) : ''
        if (next) i++
        out.push(`<m:func>${wrap('fName', conv(el))}${wrap('e', arg)}</m:func>`)
      } else {
        out.push(conv(el))
      }
    }
    return out.join('')
  }
  const all = el => seq(kids(el))

  /** 上下標、上下限的底若是大型運算子：轉成 m:nary（內容留空，運算的對象接在後面） */
  function nary(op, sub, sup) {
    const chr = opText(op)
    const pr = [`<m:chr m:val="${esc(chr)}"/>`, `<m:limLoc m:val="${INTEGRAL.has(chr) ? 'subSup' : 'undOvr'}"/>`]
    if (!sub) pr.push('<m:subHide m:val="1"/>')
    if (!sup) pr.push('<m:supHide m:val="1"/>')
    return `<m:nary><m:naryPr>${pr.join('')}</m:naryPr>${wrap('sub', sub ? conv(sub) : '')}${wrap('sup', sup ? conv(sup) : '')}<m:e/></m:nary>`
  }

  function conv(el) {
    const c = kids(el)
    switch (el.localName) {
      case 'math':
      case 'semantics':
      case 'mstyle':
      case 'mpadded':
      case 'menclose':
        return all(el)
      case 'mrow': {
        // \left( … \right)：前後是 fence 的 mo 時轉成可伸縮的括號
        const [first, last] = [c[0], c.at(-1)]
        if (c.length >= 2 && first.getAttribute('fence') === 'true' && last.getAttribute('fence') === 'true') {
          const chr = s => (s === '.' ? '' : s)
          return (
            `<m:d><m:dPr><m:begChr m:val="${esc(chr(opText(first)))}"/><m:endChr m:val="${esc(chr(opText(last)))}"/></m:dPr>` +
            `${wrap('e', seq(c.slice(1, -1)))}</m:d>`
          )
        }
        return all(el)
      }
      case 'mi':
      case 'mn':
      case 'mo':
        // U+2061 等不可見的運算子在 Word 中不需要
        return run(el.textContent.replace(/[\u2061-\u2064]/g, ''), el)
      case 'mtext':
        return run(el.textContent, el, true)
      case 'ms':
        return run(`"${el.textContent}"`, el, true)
      case 'mspace':
        return run(' ', null, true)
      case 'mphantom':
        return ''
      case 'msup':
        if (NARY.has(opText(c[0]))) return nary(c[0], null, c[1])
        return `<m:sSup>${wrap('e', conv(c[0]))}${wrap('sup', conv(c[1]))}</m:sSup>`
      case 'msub':
        if (NARY.has(opText(c[0]))) return nary(c[0], c[1], null)
        return `<m:sSub>${wrap('e', conv(c[0]))}${wrap('sub', conv(c[1]))}</m:sSub>`
      case 'msubsup':
        if (NARY.has(opText(c[0]))) return nary(c[0], c[1], c[2])
        return `<m:sSubSup>${wrap('e', conv(c[0]))}${wrap('sub', conv(c[1]))}${wrap('sup', conv(c[2]))}</m:sSubSup>`
      case 'mfrac': {
        const noBar = /^0(\.0*)?([a-z]+)?$/.test(el.getAttribute('linethickness') || '')
        return `<m:f>${noBar ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : ''}${wrap('num', conv(c[0]))}${wrap('den', conv(c[1]))}</m:f>`
      }
      case 'msqrt':
        return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${wrap('e', all(el))}</m:rad>`
      case 'mroot':
        return `<m:rad>${wrap('deg', conv(c[1]))}${wrap('e', conv(c[0]))}</m:rad>`
      case 'munder':
        if (NARY.has(opText(c[0]))) return nary(c[0], c[1], null)
        if (OVERLINE.has(opText(c[1]))) return `<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr>${wrap('e', conv(c[0]))}</m:bar>`
        return `<m:limLow>${wrap('e', conv(c[0]))}${wrap('lim', conv(c[1]))}</m:limLow>`
      case 'mover': {
        if (NARY.has(opText(c[0]))) return nary(c[0], null, c[1])
        const mark = opText(c[1])
        if (OVERLINE.has(mark) && c[1].getAttribute('stretchy') === 'true') {
          return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr>${wrap('e', conv(c[0]))}</m:bar>`
        }
        if (el.getAttribute('accent') === 'true' && ACCENT[mark]) {
          return `<m:acc><m:accPr><m:chr m:val="${ACCENT[mark]}"/></m:accPr>${wrap('e', conv(c[0]))}</m:acc>`
        }
        return `<m:limUpp>${wrap('e', conv(c[0]))}${wrap('lim', conv(c[1]))}</m:limUpp>`
      }
      case 'munderover':
        if (NARY.has(opText(c[0]))) return nary(c[0], c[1], c[2])
        return `<m:limUpp>${wrap('e', `<m:limLow>${wrap('e', conv(c[0]))}${wrap('lim', conv(c[1]))}</m:limLow>`)}${wrap('lim', conv(c[2]))}</m:limUpp>`
      case 'mtable': {
        const rows = c.filter(r => r.localName === 'mtr' || r.localName === 'mlabeledtr')
        // aligned、align：欄位右、左交錯，轉成方程式陣列，每一對欄位的交界是對齊點（通常是等號）
        if (/^right left( right left)*$/.test(el.getAttribute('columnalign') || '')) {
          const line = r =>
            kids(r)
              .map((cell, i) => (i % 2 ? all(cell).replace(/^<m:r>(<m:rPr>)?/, (_, pr) => (pr ? '<m:r><m:rPr><m:aln/>' : '<m:r><m:rPr><m:aln/></m:rPr>')) : all(cell)))
              .join('')
          return `<m:eqArr>${rows.map(r => wrap('e', line(r))).join('')}</m:eqArr>`
        }
        const cols = Math.max(1, ...rows.map(r => kids(r).length))
        // 每一欄的對齊（aligned 環境是右、左交錯）
        const align = (el.getAttribute('columnalign') || 'center').split(/\s+/)
        const mcs = Array.from({ length: cols }, (_, i) => {
          const jc = align[Math.min(i, align.length - 1)]
          return `<m:mc><m:mcPr><m:count m:val="1"/><m:mcJc m:val="${jc === 'left' || jc === 'right' ? jc : 'center'}"/></m:mcPr></m:mc>`
        }).join('')
        const body = rows
          .map(r => {
            const cells = kids(r).map(cell => wrap('e', all(cell)))
            while (cells.length < cols) cells.push('<m:e/>')
            return wrap('mr', cells.join(''))
          })
          .join('')
        return `<m:m><m:mPr><m:mcs>${mcs}</m:mcs></m:mPr>${body}</m:m>`
      }
      case 'mtr':
      case 'mtd':
        return all(el)
      default:
        throw new Unsupported(el.localName)
    }
  }

  /**
   * @param {Element} math KaTeX 輸出的 <math> 元素
   * @returns {string | null} m:oMath；有不支援的元素時回傳 null
   */
  Markloupe.mathToOmml = function (math) {
    try {
      return `<m:oMath>${conv(math)}</m:oMath>`
    } catch (err) {
      if (err instanceof Unsupported) return null
      throw err
    }
  }
})()
