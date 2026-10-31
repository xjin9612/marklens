'use strict'
// markdown-it 設定與自訂語法：==mark==、GitHub Alert、front matter
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

;(() => {
  /* ---------- ==螢光標記== （仿 strikethrough 的分隔符號處理） ---------- */
  const EQ = 0x3d // '='

  function markTokenize(state, silent) {
    const start = state.pos
    if (silent || state.src.charCodeAt(start) !== EQ) return false
    const scanned = state.scanDelims(start, true)
    let len = scanned.length
    if (len < 2) return false
    let token
    if (len % 2) {
      token = state.push('text', '', 0)
      token.content = '='
      len--
    }
    for (let i = 0; i < len; i += 2) {
      token = state.push('text', '', 0)
      token.content = '=='
      state.delimiters.push({
        marker: EQ,
        length: 0,
        token: state.tokens.length - 1,
        end: -1,
        open: scanned.can_open,
        close: scanned.can_close,
      })
    }
    state.pos += scanned.length
    return true
  }

  function markPostProcessList(state, delimiters) {
    const lone = []
    for (const startDelim of delimiters) {
      if (startDelim.marker !== EQ || startDelim.end === -1) continue
      const endDelim = delimiters[startDelim.end]
      Object.assign(state.tokens[startDelim.token], {
        type: 'mark_open', tag: 'mark', nesting: 1, markup: '==', content: '',
      })
      Object.assign(state.tokens[endDelim.token], {
        type: 'mark_close', tag: 'mark', nesting: -1, markup: '==', content: '',
      })
      const prev = state.tokens[endDelim.token - 1]
      if (prev.type === 'text' && prev.content === '=') lone.push(endDelim.token - 1)
    }
    // 奇數個 '=' 時，把多出的單一 '=' 移到 mark_close 之後
    while (lone.length) {
      const i = lone.pop()
      let j = i + 1
      while (j < state.tokens.length && state.tokens[j].type === 'mark_close') j++
      j--
      if (i !== j) [state.tokens[i], state.tokens[j]] = [state.tokens[j], state.tokens[i]]
    }
  }

  function markPostProcess(state) {
    markPostProcessList(state, state.delimiters)
    for (const meta of state.tokens_meta) {
      if (meta && meta.delimiters) markPostProcessList(state, meta.delimiters)
    }
  }

  function markPlugin(md) {
    md.inline.ruler.before('emphasis', 'mark', markTokenize)
    md.inline.ruler2.before('emphasis', 'mark', markPostProcess)
  }

  /* ---------- GitHub Alert：> [!NOTE] ---------- */
  const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i

  function alertPlugin(md) {
    // 在 inline 解析前處理，只需改 inline token 的 content
    md.core.ruler.after('block', 'marklens_alert', state => {
      const tokens = state.tokens
      for (let i = 0; i < tokens.length - 2; i++) {
        if (tokens[i].type !== 'blockquote_open') continue
        const para = tokens[i + 1]
        const inline = tokens[i + 2]
        if (para.type !== 'paragraph_open' || inline.type !== 'inline') continue
        const m = ALERT_RE.exec(inline.content)
        if (!m) continue
        const kind = m[1].toLowerCase()
        tokens[i].attrJoin('class', `markdown-alert markdown-alert-${kind}`)
        inline.content = inline.content.slice(m[0].length)
        if (inline.content.trim() === '') {
          // 標記獨佔一段：移除這個空段落
          tokens.splice(i + 1, 3)
        }
      }
    })
  }

  /* ---------- highlight.js ---------- */
  function highlight(md) {
    return (code, info) => {
      const lang = (info || '').trim().split(/\s+/)[0].toLowerCase()
      let body = null
      if (lang && globalThis.hljs && hljs.getLanguage(lang)) {
        try {
          body = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
        } catch {
          body = null
        }
      }
      if (body == null) body = md.utils.escapeHtml(code)
      const cls = lang ? ` language-${md.utils.escapeHtml(lang.replace(/[^\w+#.-]/g, ''))}` : ''
      return `<pre class="ml-pre"><code class="hljs${cls}">${body}</code></pre>`
    }
  }

  /* ---------- 自動連結：比照 GitHub，只連結 http(s)://、www. 與 email ---------- */
  // linkify 的模糊比對會把 README.md 當成摩爾多瓦（.md）網域的網址，example.com 也會被連結；GitHub 兩者都不連結
  const GFM_AUTOLINK = /^(?:[a-z][a-z0-9+.-]*:|www\.)/i

  function gfmAutolinkPlugin(md) {
    md.core.ruler.after('linkify', 'marklens_gfm_autolink', state => {
      for (const block of state.tokens) {
        if (block.type !== 'inline' || !block.children) continue
        const out = []
        const kids = block.children
        for (let i = 0; i < kids.length; i++) {
          const t = kids[i]
          const close = kids[i + 2]
          if (t.type === 'link_open' && t.markup === 'linkify' && close?.type === 'link_close') {
            const text = kids[i + 1].content
            const isEmail = (t.attrGet('href') || '').startsWith('mailto:') && !text.startsWith('mailto:')
            if (!GFM_AUTOLINK.test(text) && !isEmail) {
              out.push(kids[i + 1]) // 只留文字
              i += 2
              continue
            }
          }
          out.push(t)
        }
        block.children = out
      }
    })
  }

  /* ---------- 任務清單行號（供勾選寫回） ---------- */
  // 在清單項目上標記「原文第幾行」：class 帶入每次建立時隨機產生的 nonce，
  // 文件作者寫的 HTML 無法猜到 nonce，因此無法偽造可寫回的勾選框
  const TASK_MARK_RE = /^\[([ xX])\][ \u00a0]/

  function taskLinePlugin(md, nonce) {
    md.core.ruler.after('block', 'marklens_task_lines', state => {
      const offset = state.env?.lineOffset || 0
      const tokens = state.tokens
      for (let i = 0; i < tokens.length - 2; i++) {
        const t = tokens[i]
        if (t.type !== 'list_item_open' || !t.map) continue
        if (tokens[i + 1].type !== 'paragraph_open' || tokens[i + 2].type !== 'inline') continue
        if (!TASK_MARK_RE.test(tokens[i + 2].content)) continue
        t.attrJoin('class', `ml-task-${nonce}-${t.map[0] + offset}`)
      }
    })
  }

  MarkLens.createMarkdown = function () {
    const md = globalThis.markdownit({
      html: true, // 允許內嵌 HTML，輸出一律經過 MarkLens.sanitize
      linkify: true,
      typographer: false, // 技術文件不轉換引號、破折號
      breaks: false,
    })
    md.set({ highlight: highlight(md) })
    if (globalThis.markdownitFootnote) md.use(globalThis.markdownitFootnote)
    md.use(markPlugin)
    md.use(alertPlugin)
    md.use(gfmAutolinkPlugin)
    md.marklensNonce = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('')
    md.use(taskLinePlugin, md.marklensNonce)
    return md
  }

  /* ---------- front matter ---------- */
  const FM_RE = /^\ufeff?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/

  /** 拆出 front matter；回傳 { frontMatter, body } */
  MarkLens.splitFrontMatter = function (src) {
    const m = FM_RE.exec(src)
    if (!m) return { frontMatter: null, body: src.replace(/^\ufeff/, '') }
    return { frontMatter: m[1], body: src.slice(m[0].length) }
  }
})()
