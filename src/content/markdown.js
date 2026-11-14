'use strict'
// markdown-it 設定與自訂語法：==mark==、GitHub Alert 與 Obsidian callout、Obsidian wikilink、容器區塊、定義清單、數學公式、GitHub 式自動連結、任務清單行號、front matter
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

  /* ---------- 提示框：GitHub Alert（> [!NOTE]）與 Obsidian callout（> [!faq]- 標題） ---------- */
  // Obsidian 的類型套用最接近的 GitHub 樣式；不認得的類型照 Obsidian 的做法當成 note
  const CALLOUT_KIND = {
    note: 'note', tip: 'tip', important: 'important', warning: 'warning', caution: 'caution',
    abstract: 'note', summary: 'note', tldr: 'note', info: 'note', todo: 'note', question: 'note', help: 'note', faq: 'note',
    example: 'note', quote: 'note', cite: 'note',
    hint: 'tip', success: 'tip', check: 'tip', done: 'tip',
    attention: 'warning',
    failure: 'caution', fail: 'caution', missing: 'caution', danger: 'caution', error: 'caution', bug: 'caution',
  }
  // 類型後的 + 或 - 表示可摺疊（預設展開或收合），之後到行尾為自訂標題
  const ALERT_RE = /^\[!([\w-]+)\]([+-]?)[ \t]*([^\n]*?)[ \t]*(?:\n|$)/

  /** 預設標題：類型名稱首字大寫（Obsidian 的做法） */
  Markloupe.calloutTitle = type => type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()

  function alertPlugin(md) {
    // 在 inline 解析前處理，只需改 inline token 的 content；插入的標題 inline token 也會在之後解析
    md.core.ruler.after('block', 'markloupe_alert', state => {
      const tokens = state.tokens
      for (let i = 0; i < tokens.length - 2; i++) {
        const open = tokens[i]
        if (open.type !== 'blockquote_open') continue
        const para = tokens[i + 1]
        const inline = tokens[i + 2]
        if (para.type !== 'paragraph_open' || inline.type !== 'inline') continue
        const m = ALERT_RE.exec(inline.content)
        if (!m) continue
        const [, type, fold, title] = m
        const kind = CALLOUT_KIND[type.toLowerCase()] || 'note'
        open.attrJoin('class', `markdown-alert markdown-alert-${kind}`)
        inline.content = inline.content.slice(m[0].length)
        // 標記獨佔一段：移除這個空段落
        if (inline.content.trim() === '') tokens.splice(i + 1, 3)
        const tag = fold ? 'summary' : 'p'
        const head = new state.Token('paragraph_open', tag, 1)
        head.attrSet('class', 'markdown-alert-title')
        head.block = true
        head.map = open.map && [open.map[0], open.map[0] + 1]
        head.level = open.level + 1
        const text = new state.Token('inline', '', 0)
        text.content = title || Markloupe.calloutTitle(type)
        text.children = []
        text.map = head.map
        text.level = head.level + 1
        const close = new state.Token('paragraph_close', tag, -1)
        close.block = true
        close.level = head.level
        tokens.splice(i + 1, 0, head, text, close)
        if (!fold) continue
        // 可摺疊的提示框輸出成 <details>，標題為 <summary>
        open.tag = 'details'
        if (fold === '+') open.attrSet('open', '')
        for (let j = i + 1; j < tokens.length; j++) {
          if (tokens[j].type === 'blockquote_close' && tokens[j].level === open.level) {
            tokens[j].tag = 'details'
            break
          }
        }
      }
    })
  }
  /* ---------- Obsidian 的 [[wikilink]] 與 ![[圖片]] ---------- */
  // 連到目前文件所在資料夾的相對路徑。Markloupe 不讀其他檔案，無法像 Obsidian 在整個資料夾找同名檔案
  const IMAGE_EXT = /\.(?:png|jpe?g|gif|svg|webp|avif|bmp)$/i
  // 有這些副檔名時照原樣連結，其他一律視為筆記補上 .md（筆記名稱可能含有點）
  const FILE_EXT = /\.(?:md|markdown|mdown|mkd|txt|pdf|html?|canvas|png|jpe?g|gif|svg|webp|avif|bmp|mp3|mp4|webm|ogg|wav|m4a)$/i
  const SIZE_RE = /^(\d+)(?:x(\d+))?$/

  function wikilinkPlugin(md) {
    md.inline.ruler.before('link', 'markloupe_wikilink', (state, silent) => {
      const src = state.src
      const embed = src.charCodeAt(state.pos) === 0x21 /* ! */
      const start = state.pos + (embed ? 1 : 0)
      if (!src.startsWith('[[', start)) return false
      const end = src.indexOf(']]', start + 2)
      if (end < 0) return false
      const body = src.slice(start + 2, end)
      if (!body.trim() || /[[\]\n]/.test(body)) return false
      if (silent) {
        state.pos = end + 2
        return true
      }
      const bar = body.indexOf('|')
      // 表格裡要寫成 \| 才不會被當成分欄
      const target = (bar < 0 ? body : body.slice(0, bar)).replace(/\\$/, '').trim()
      const alias = bar < 0 ? '' : body.slice(bar + 1).trim()
      const hash = target.indexOf('#')
      const path = hash < 0 ? target : target.slice(0, hash).trim()
      const heading = hash < 0 ? '' : target.slice(hash + 1).trim()
      let href = path && path.split('/').map(encodeURIComponent).join('/') + (FILE_EXT.test(path) ? '' : '.md')
      // 區塊參照（#^id）沒有對應的錨點，只連到檔案
      if (heading && !heading.startsWith('^')) href += `#${encodeURIComponent(Markloupe.slugify(heading))}`
      const size = SIZE_RE.exec(alias)
      if (embed && IMAGE_EXT.test(path)) {
        const img = state.push('image', 'img', 0)
        img.attrs = [['src', href], ['alt', '']]
        if (size) img.attrs.push(['width', size[1]], ...(size[2] ? [['height', size[2]]] : []))
        const alt = new state.Token('text', '', 0)
        alt.content = size ? path : alias || path
        img.children = [alt]
        img.content = alt.content
      } else {
        state.push('link_open', 'a', 1).attrs = [['href', href || '#']]
        state.push('text', '', 0).content = alias || [path, heading].filter(Boolean).join(' > ')
        state.push('link_close', 'a', -1)
      }
      state.pos = end + 2
      return true
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

  /* ---------- highlight.js、程式碼行號與標示行 ---------- */
  // 語言後的 {1,3-5} 標示指定行（VitePress、Docusaurus 寫法）；showLineNumbers、:line-numbers 強制顯示行號，:no-line-numbers 強制不顯示
  const META_LINES_RE = /\{([\d,\s-]+)\}/
  const MAX_MARKED_LINES = 10000

  /** "1,3-5" → Set{1,3,4,5}（1 起算）；範圍超過 MAX_MARKED_LINES 的部分略過 */
  function lineSet(spec) {
    const out = new Set()
    for (const part of spec.split(',')) {
      const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part)
      if (!m) continue
      const a = +m[1]
      const b = Math.min(m[2] ? +m[2] : a, a + MAX_MARKED_LINES)
      for (let n = a; n <= b; n++) out.add(n)
    }
    return out
  }

  /**
   * 把 highlight.js 的輸出切成每行一個 <span class="code-line">；跨行的 <span> 在行尾關閉、下一行重開。
   * 換行字元留在 span 之間，textContent 與原始碼相同（複製、Mermaid、匯出 Word 都讀 textContent）
   */
  function wrapLines(html, marked) {
    const lines = []
    let cur = ''
    let hasText = false
    const open = []
    for (const [t] of html.matchAll(/<span[^>]*>|<\/span>|\n|[^<\n]+/g)) {
      if (t === '\n') {
        lines.push(cur + '</span>'.repeat(open.length))
        cur = open.join('')
        hasText = false
      } else {
        if (t === '</span>') open.pop()
        else if (t.startsWith('<span')) open.push(t)
        else hasText = true
        cur += t
      }
    }
    const line = (l, i) => `<span class="code-line${marked.has(i + 1) ? ' code-line-hl' : ''}">${l}</span>`
    // 最後一行沒有換行字元（檔案結尾沒有關閉的 ```）時照樣不加
    const tail = hasText ? line(cur, lines.length) : ''
    return lines.map((l, i) => `${line(l, i)}\n`).join('') + tail
  }

  function codeClass(lang, meta, count) {
    const cls = ['hljs']
    if (lang) cls.push(`language-${lang}`)
    if (/(?:^|\s)(?:showLineNumbers|:line-numbers)\b/.test(meta)) cls.push('code-numbers')
    else if (/(?:^|\s):no-line-numbers\b/.test(meta)) cls.push('code-no-numbers')
    // 行號欄寬：預設容納三位數
    const digits = String(count).length
    if (digits > 3) cls.push(`code-digits-${Math.min(digits, 6)}`)
    return cls.join(' ')
  }

  function highlight(md) {
    return (code, name, attrs) => {
      // ```js{1,3} 的語言與大括號之間沒有空白
      const brace = (name || '').indexOf('{')
      const meta = `${brace < 0 ? '' : name.slice(brace)} ${attrs || ''}`
      const lang = (brace < 0 ? name || '' : name.slice(0, brace)).trim().toLowerCase()
      let body = null
      if (lang && globalThis.hljs && hljs.getLanguage(lang)) {
        try {
          body = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
        } catch {
          body = null
        }
      }
      if (body == null) body = md.utils.escapeHtml(code)
      const marked = lineSet(META_LINES_RE.exec(meta)?.[1] || '')
      const count = code.split('\n').length - (code.endsWith('\n') ? 1 : 0)
      const cls = codeClass(md.utils.escapeHtml(lang.replace(/[^\w+#.-]/g, '')), meta, count)
      return `<pre><code class="${cls}">${wrapLines(body, marked)}</code></pre>`
    }
  }

  /** 縮排式程式碼區塊也切成每行一個 span，行號設定才會一致 */
  function codeBlockPlugin(md) {
    md.renderer.rules.code_block = (tokens, i, options, env, self) => {
      const code = tokens[i].content
      const count = code.split('\n').length - (code.endsWith('\n') ? 1 : 0)
      return `<pre${self.renderAttrs(tokens[i])}><code class="${codeClass('', '', count)}">${wrapLines(md.utils.escapeHtml(code), new Set())}</code></pre>\n`
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
    md.use(wikilinkPlugin)
    md.use(codeBlockPlugin)
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
