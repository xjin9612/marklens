'use strict'
// markdown-it 設定與自訂語法：==mark==、GitHub Alert、容器區塊、定義清單、數學公式、GitHub 式自動連結、任務清單行號、front matter
var Markloupe = globalThis.Markloupe || (globalThis.Markloupe = {})

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
    md.core.ruler.after('block', 'markloupe_alert', state => {
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

  /* ---------- 容器區塊：::: tip 標題（VitePress、VuePress），:::note 或 :::tip[標題]（Docusaurus） ---------- */
  // 提示類容器沿用 GitHub Alert 的樣式；::: details 轉成可摺疊的 <details>
  const CONTAINER_KIND = { note: 'note', info: 'note', tip: 'tip', important: 'important', warning: 'warning', caution: 'caution', danger: 'caution' }
  const CONTAINER_RE = /^([a-z]+)(?:\[([^\]]*)\])?(?:\s+(.*))?$/i

  function parseContainer(info) {
    const m = CONTAINER_RE.exec(info.trim())
    return m && { name: m[1].toLowerCase(), title: (m[2] ?? m[3] ?? '').trim() }
  }

  function containerPlugin(md) {
    if (!globalThis.markdownitContainer) return
    const esc = md.utils.escapeHtml
    for (const name of [...Object.keys(CONTAINER_KIND), 'details']) {
      md.use(globalThis.markdownitContainer, name, {
        validate: info => parseContainer(info)?.name === name,
        render(tokens, i) {
          const close = name === 'details' ? '</details>\n' : '</blockquote>\n'
          if (tokens[i].nesting === -1) return close
          const { title } = parseContainer(tokens[i].info)
          if (name === 'details') return `<details><summary>${esc(title || 'Details')}</summary>\n`
          const head = title ? `<p class="markdown-alert-title">${esc(title)}</p>\n` : ''
          return `<blockquote class="markdown-alert markdown-alert-${CONTAINER_KIND[name]}">\n${head}`
        },
      })
    }
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
      return `<pre><code class="hljs${cls}">${body}</code></pre>`
    }
  }

  /* ---------- 自動連結：比照 GitHub，只連結 http(s)://、www. 與 email ---------- */
  // linkify 的模糊比對會把 README.md 當成摩爾多瓦（.md）網域的網址，example.com 也會被連結；GitHub 兩者都不連結
  const GFM_AUTOLINK = /^(?:[a-z][a-z0-9+.-]*:|www\.)/i

  function gfmAutolinkPlugin(md) {
    md.core.ruler.after('linkify', 'markloupe_gfm_autolink', state => {
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

  /* ---------- 數學公式：$…$、$$…$$、$`…`$、```math ---------- */
  // 只負責標出公式並保留 TeX 原文（輸出為 .math-inline／.math-display），實際繪製在 math.js 依需載入 KaTeX。
  // 為避免把金額當成公式：開頭 $ 後不可為空白，結尾 $ 前不可為空白、後不可接數字（與 GitHub、Pandoc 相同）
  function mathPlugin(md) {
    const DOLLAR = 0x24

    function mathInline(state, silent) {
      const src = state.src
      const start = state.pos
      if (src.charCodeAt(start) !== DOLLAR) return false

      // GitHub 的 $`…`$ 寫法
      if (src[start + 1] === '`') {
        const end = src.indexOf('`$', start + 2)
        if (end < 0) return false
        if (!silent) push(state, 'math_inline', src.slice(start + 2, end))
        state.pos = end + 2
        return true
      }

      // 行內的 $$…$$ 視為獨立公式
      const display = src.charCodeAt(start + 1) === DOLLAR
      const open = display ? 2 : 1
      const first = src[start + open]
      if (first === undefined || /\s/.test(first)) return false
      if (!display && start > 0 && src.charCodeAt(start - 1) === DOLLAR) return false

      // 開頭之後第一個未跳脫的 $ 必須能當結尾，否則整段不是公式：
      // 「價格 $5 與 $10」不會一路吃到後面句子的 $
      let pos = start + open
      for (;;) {
        pos = src.indexOf(display ? '$$' : '$', pos)
        if (pos < 0) return false
        let bs = 0
        for (let i = pos - 1; src[i] === '\\'; i--) bs++
        if (bs % 2 === 0) break // 未跳脫
        pos += 1
      }
      const prev = src[pos - 1]
      const next = src[pos + open]
      if (/\s/.test(prev) || (next >= '0' && next <= '9')) return false
      const tex = src.slice(start + open, pos)
      // 公式不會含反引號；含反引號代表跨進了程式碼，例如 $10 … `$x$`
      if (!tex.trim() || tex.includes('`')) return false
      if (!silent) push(state, display ? 'math_display' : 'math_inline', tex)
      state.pos = pos + open
      return true
    }

    function push(state, type, tex) {
      const token = state.push(type, 'math', 0)
      token.content = tex
      token.markup = '$'
    }

    // 獨立成段的 $$ … $$（可跨多行）
    function mathBlock(state, startLine, endLine, silent) {
      let pos = state.bMarks[startLine] + state.tShift[startLine]
      let max = state.eMarks[startLine]
      if (state.sCount[startLine] - state.blkIndent >= 4) return false
      if (state.src.slice(pos, pos + 2) !== '$$') return false
      let first = state.src.slice(pos + 2, max)
      let line = startLine
      let body
      if (first.trim().endsWith('$$') && first.trim().length > 2) {
        body = first.trim().slice(0, -2)
      } else {
        const lines = [first]
        let found = false
        while (++line < endLine) {
          pos = state.bMarks[line] + state.tShift[line]
          max = state.eMarks[line]
          if (pos < max && state.sCount[line] < state.blkIndent) break
          const text = state.src.slice(pos, max)
          if (text.trim().endsWith('$$')) {
            lines.push(text.trim().slice(0, -2))
            found = true
            break
          }
          lines.push(state.src.slice(state.bMarks[line], max))
        }
        if (!found) return false
        body = lines.join('\n')
      }
      if (silent) return true
      const token = state.push('math_block', 'math', 0)
      token.block = true
      token.content = body.trim()
      token.markup = '$$'
      token.map = [startLine, line + 1]
      state.line = line + 1
      return true
    }

    md.inline.ruler.after('escape', 'math_inline', mathInline)
    md.block.ruler.before('fence', 'math_block', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })

    const esc = md.utils.escapeHtml
    md.renderer.rules.math_inline = (tokens, i) => `<span class="math-inline">${esc(tokens[i].content)}</span>`
    md.renderer.rules.math_display = (tokens, i) => `<span class="math-display">${esc(tokens[i].content)}</span>`
    md.renderer.rules.math_block = (tokens, i) => `<div class="math-display">${esc(tokens[i].content)}</div>\n`
    // ```math 區塊
    const fence = md.renderer.rules.fence
    md.renderer.rules.fence = (tokens, i, options, env, self) => {
      const t = tokens[i]
      if (t.info.trim().toLowerCase() === 'math') return `<div class="math-display">${esc(t.content.trim())}</div>\n`
      return fence(tokens, i, options, env, self)
    }
  }

  /* ---------- 原文行號：任務清單（供勾選寫回）與區塊範圍 ---------- */
  // 在清單項目上標記「原文第幾行」：class 帶入每次建立時隨機產生的 nonce，
  // 文件作者寫的 HTML 無法猜到 nonce，因此無法偽造可寫回的勾選框
  const TASK_MARK_RE = /^\[([ xX])\][ \u00a0]/

  function taskLinePlugin(md, nonce) {
    md.core.ruler.after('block', 'markloupe_task_lines', state => {
      const offset = state.env?.lineOffset || 0
      const tokens = state.tokens
      for (let i = 0; i < tokens.length - 2; i++) {
        const t = tokens[i]
        if (t.type !== 'list_item_open' || !t.map) continue
        if (tokens[i + 1].type !== 'paragraph_open' || tokens[i + 2].type !== 'inline') continue
        if (!TASK_MARK_RE.test(tokens[i + 2].content)) continue
        t.attrJoin('class', `ml-task-${nonce}-${t.map[0] + offset}`)
      }
      // 區塊的原文行號範圍（0 起算，結尾不含）：複製章節、複製位置、用編輯器開啟時對應回原文
      for (const t of tokens) {
        if (t.map && t.nesting >= 0 && t.block && LINE_TOKENS.has(t.type)) {
          t.attrJoin('class', `ml-line-${nonce}-${t.map[0] + offset}-${t.map[1] + offset}`)
        }
      }
    })
    // fence 的 highlight 回傳完整的 <pre>，markdown-it 不會套用 token 的屬性：自行補上行號 class
    const fence = md.renderer.rules.fence
    md.renderer.rules.fence = (tokens, i, options, env, self) => {
      const html = fence(tokens, i, options, env, self)
      const cls = (tokens[i].attrGet('class') || '').split(' ').find(c => c.startsWith(`ml-line-${nonce}-`))
      return cls && html.startsWith('<pre>') ? `<pre class="${cls}">${html.slice(5)}` : html
    }
  }

  // 會帶行號的區塊；自訂渲染、不輸出 token 屬性的區塊（容器、數學公式、HTML 區塊）不在其中，以前後區塊的行號推算
  const LINE_TOKENS = new Set([
    'heading_open', 'paragraph_open', 'blockquote_open', 'bullet_list_open', 'ordered_list_open', 'list_item_open',
    'table_open', 'fence', 'code_block', 'hr', 'dl_open',
  ])

  Markloupe.createMarkdown = function () {
    const md = globalThis.markdownit({
      html: true, // 允許內嵌 HTML，輸出一律經過 Markloupe.sanitize
      linkify: true,
      typographer: false, // 技術文件不轉換引號、破折號
      breaks: false,
    })
    md.set({ highlight: highlight(md) })
    if (globalThis.markdownitFootnote) md.use(globalThis.markdownitFootnote)
    // GitHub 短碼（:tada: → 🎉）；關閉 :) 之類的表情符號自動轉換，技術文件常有冒號與括號連用
    if (globalThis.markdownitEmoji) md.use(globalThis.markdownitEmoji, { shortcuts: {} })
    if (globalThis.markdownitDeflist) md.use(globalThis.markdownitDeflist)
    md.use(containerPlugin)
    md.use(markPlugin)
    md.use(alertPlugin)
    md.use(gfmAutolinkPlugin)
    md.use(mathPlugin)
    md.markloupeNonce = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('')
    md.use(taskLinePlugin, md.markloupeNonce)
    return md
  }

  /* ---------- front matter ---------- */
  const FM_RE = /^\ufeff?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/

  /** 拆出 front matter；回傳 { frontMatter, body } */
  Markloupe.splitFrontMatter = function (src) {
    const m = FM_RE.exec(src)
    if (!m) return { frontMatter: null, body: src.replace(/^\ufeff/, '') }
    return { frontMatter: m[1], body: src.slice(m[0].length) }
  }

  /** YAML 純量：去掉行尾註解與成對的引號 */
  const scalar = v => {
    const s = v.replace(/(^|[ \t])#.*$/, '').trim()
    return /^(["'])(.*)\1$/.exec(s)?.[2] ?? s
  }

  /**
   * 只有單層 key: value 的 front matter 拆成 [鍵, 值]；行內清單 [a, b] 的值是 "a, b"
   * 有巢狀、多行值（| 或 >）或其他寫法時回傳 null，照原文顯示
   */
  Markloupe.frontMatterEntries = function (frontMatter) {
    const entries = []
    for (const line of (frontMatter || '').split(/\r?\n/)) {
      if (!line.trim() || /^#/.test(line)) continue
      const m = /^([\w][\w.-]*)[ \t]*:(?:[ \t]+(.*))?$/.exec(line)
      if (!m) return null
      const raw = (m[2] || '').trim()
      if (/^[|>]/.test(raw)) return null
      const list = /^\[(.*)\]$/.exec(scalar(raw))
      entries.push([m[1], list ? list[1].split(',').map(scalar).filter(Boolean).join(', ') : scalar(raw)])
    }
    return entries.length ? entries : null
  }

  /** front matter 最上層的 lang 欄位，去掉引號與行尾註解；沒有或不是語言代碼時回傳空字串 */
  Markloupe.frontMatterLang = function (frontMatter) {
    const m = /^lang[ \t]*:[ \t]*(.*)$/m.exec(frontMatter || '')
    if (!m) return ''
    const value = m[1].replace(/(^|[ \t])#.*$/, '').trim()
    const lang = /^(["'])(.*)\1$/.exec(value)?.[2] ?? value
    return /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i.test(lang) ? lang : ''
  }
})()
