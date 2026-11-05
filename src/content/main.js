'use strict'
// 進入點：偵測 Markdown 頁面、組裝版面、套用設定、自動更新
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

;(() => {
  const { h, t } = MarkLens
  const CONTENT_TYPES = ['text/plain', 'text/markdown', 'text/x-markdown']
  const POS_KEY = 'marklens:scroll'
  const POS_LIMIT = 300
  const VIEW_KEY = 'marklens:view' // 分頁狀態，存在 sessionStorage
  const NARROW = 900
  const THEME_LABELS = { auto: ['auto', 'themeAuto'], light: ['sun', 'themeLight'], dark: ['moon', 'themeDark'] }

  /**
   * 工具列按鈕的內容：圖示＋文字（窄螢幕或放不下時文字只在畫面上隱藏，螢幕閱讀器仍念得到）
   * 會展開選單的按鈕（aria-haspopup）在最後加一個向下的小箭頭
   */
  function setTool(btn, icon, label) {
    btn.replaceChildren(
      MarkLens.icon(icon),
      label ? h('span', { class: 'ml-tool-label', text: label }) : '',
      btn.hasAttribute('aria-haspopup') ? h('span', { class: 'ml-tool-caret' }, [MarkLens.icon('chevron-down')]) : '',
    )
  }

  /** 瀏覽器把純文字顯示成 <body><pre>…</pre></body>，只接管這種頁面 */
  function sourcePre() {
    if (!CONTENT_TYPES.includes(document.contentType)) return null
    return (document.body && document.querySelector('body > pre')) || null
  }

  /** 沒有 H1 時以檔名當標題；路徑含不合法的 % 編碼時退回原字串 */
  function fileName() {
    const name = location.pathname.split('/').pop()
    try {
      return decodeURIComponent(name)
    } catch {
      return name
    }
  }

  /*
   * ---------- 分頁狀態：只影響目前分頁，重新整理後保留，關閉分頁即清除 ----------
   * 只有本機檔案存進 sessionStorage。網頁上的 sessionStorage 屬於該網站，同分頁之後開啟的同站頁面讀得到，
   * 網站可藉此得知裝了 MarkLens；所以網頁上的分頁狀態只留在記憶體，重新整理後回到預設值。
   */
  const PERSIST_VIEW = location.protocol === 'file:'
  function readView() {
    if (!PERSIST_VIEW) return {}
    try {
      return JSON.parse(sessionStorage.getItem(VIEW_KEY)) || {}
    } catch {
      return {}
    }
  }
  function writeView(view) {
    if (!PERSIST_VIEW) return
    try {
      sessionStorage.setItem(VIEW_KEY, JSON.stringify(view))
    } catch {
      // 無法寫入（例如隱私設定）時只在記憶體中生效
    }
  }

  class App {
    /**
     * @param {boolean} exact raw 是否為以 UTF-8 精確讀到的原文（只有這種情況才允許勾選寫回）
     */
    constructor(settings, pre, raw, exact) {
      this.settings = settings
      this.pre = pre
      this.raw = raw
      this.rawExact = exact
      this.taskBusy = false
      this.md = MarkLens.createMarkdown()
      this.tables = []
      this.refreshTimer = null
      this.darkQuery = matchMedia('(prefers-color-scheme: dark)')
      // 分頁狀態：以全域預設值為底，套上本分頁先前的調整
      const saved = readView()
      this.view = {
        tocHidden: saved.tocHidden ?? settings.tocHidden,
        tocWidth: saved.tocWidth ?? settings.tocWidth,
        textWidth: saved.textWidth ?? settings.textWidth,
        sideTab: saved.sideTab ?? 'toc', // 側邊欄分頁：toc | files
        filesRoot: saved.filesRoot ?? null, // 檔案分頁的起點資料夾（同一分頁內切換檔案時沿用）
        filesOpen: saved.filesOpen ?? [], // 檔案分頁已展開的子資料夾（相對起點）
      }
    }

    mount() {
      const root = document.documentElement
      // 擴充功能更新後才會用到的提示，先取一次存進快取（屆時 chrome.i18n 已無法使用）
      for (const k of ['orphanBefore', 'orphanReload', 'orphanAfter']) t(k)
      root.classList.add('marklens')

      this.article = h('article', { class: 'ml-body markdown-body' })
      this.toc = new MarkLens.Toc(this)
      this.progress = h('div', { class: 'ml-progress' })
      this.toolbar = this.buildToolbar()
      // 原始文字的 <pre> 移進主區塊，切換時工具列仍在，隨時可以回來
      this.pre.classList.add('ml-source')
      this.main = h('main', { class: 'ml-main' }, [this.toolbar, this.article, this.pre])
      this.backdrop = h('div', { class: 'ml-backdrop', on: { click: () => this.setTocOpen(false) } })
      this.appRoot = h('div', { id: 'ml-root' }, [this.progress, this.toc.el, this.backdrop, this.main])
      document.body.append(this.appRoot)

      MarkLens.bindFoldSearch(this.article)
      this.bindTaskClicks()
      this.article.addEventListener('marklens:fold', () => {
        this.toc.syncFold()
        this.onScroll()
      })

      // 程式碼區塊中英對齊（非同步，字型加入後瀏覽器會自動重排）
      MarkLens.alignCodeFont().then(info => {
        if (info) root.dataset.mlCodeFont = JSON.stringify(info)
      })
      this.render(this.raw)
      this.applyLive()
      this.applyView()
      this.startRefresh()

      // 工具列寬度與按鈕文字（語系、寬度與字級的數值）都會變：放不下時只顯示圖示
      const fit = MarkLens.rafThrottle(() => this.fitToolbar())
      new ResizeObserver(fit).observe(this.toolbar)
      new MutationObserver(fit).observe(this.toolbar, { childList: true, subtree: true, characterData: true })
      this.fitToolbar()

      this.saveScroll = MarkLens.debounce(() => this.persistScroll(), 400)
      addEventListener('scroll', MarkLens.rafThrottle(() => this.onScroll()), { passive: true })
      addEventListener('resize', MarkLens.rafThrottle(() => this.onScroll()))
      addEventListener('hashchange', () => this.scrollToHash())
      addEventListener('keydown', e => this.onKey(e))
      this.darkQuery.addEventListener('change', () => this.applyLive())
      // Ctrl+P 也改用淺色列印；圖表來不及重繪，列印按鈕才會等圖表重繪完
      addEventListener('beforeprint', () => this.setPrinting(true))
      addEventListener('afterprint', () => this.setPrinting(false))

      // 只有外觀設定即時同步；其餘設定是新分頁的預設值
      chrome.storage.onChanged.addListener((changes, area) => {
        const c = area === 'local' && changes[MarkLens.SETTINGS_KEY]
        if (!c) return
        const next = { ...MarkLens.DEFAULTS, ...c.newValue }
        if (!next.enabled) return location.reload()
        for (const k of MarkLens.LIVE_KEYS) this.settings[k] = next[k]
        this.applyLive()
      })
      chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
        if (msg?.type === 'command') this.runCommand(msg.name, true)
        reply({ ok: true })
      })

      if (location.hash) this.scrollToHash()
      else if (this.settings.rememberScroll) this.restoreScroll()
    }

    /* ---------- 工具列 ---------- */
    buildToolbar() {
      const btn = (cls, icon, label, title, fn) => {
        const b = h('button', { class: `ml-tool ${cls}`, title, on: { click: fn } })
        setTool(b, icon, label)
        return b
      }
      this.tocBtn = btn('ml-tool-toc', 'menu', '', t('toolTocTitle'), () => this.toggleToc())
      this.tocBtn.setAttribute('aria-label', t('toggleSidebar'))
      // 寬度與主題：按下展開選項清單（目前的值打勾）；快捷鍵 w／d 仍依序切換
      this.widthBtn = btn('ml-tool-width', 'width', '', t('toolWidthTitle'), () => this.toggleMenu(this.widthBtn, () => this.widthMenu()))
      this.themeBtn = btn('ml-tool-theme', 'auto', '', t('toolThemeTitle'), () => this.toggleMenu(this.themeBtn, () => this.themeMenu()))
      this.fontBtn = btn('ml-tool-font', 'text-size', '', t('toolFontSizeTitle'), () => this.toggleMenu(this.fontBtn, () => this.fontMenu()))
      for (const b of [this.widthBtn, this.themeBtn, this.fontBtn]) {
        b.setAttribute('aria-haspopup', 'menu')
        b.setAttribute('aria-expanded', 'false')
      }
      this.copyMdBtn = btn('ml-tool-copy', 'copy', t('toolCopyMd'), t('toolCopyMdTitle'), () => this.copyMarkdown())
      this.exportBtn = btn('ml-tool-export', 'download', t('toolExport'), t('toolExportTitle'), () => this.exportHtml())
      this.printBtn = btn('ml-tool-print', 'print', t('toolPrint'), t('toolPrintTitle'), () => this.print())
      this.rawBtn = btn('ml-tool-raw', 'code', t('toolRaw'), t('toolRawTitle'), () => this.toggleRaw())
      // 用編輯器開啟：設定中選了編輯器且為本機檔案才顯示
      this.editBtn = btn('ml-tool-edit', 'edit', t('toolEdit'), t('toolEditTitle'), () => this.openInEditor())
      this.editBtn.hidden = !(location.protocol === 'file:' && MarkLens.editorTemplate(this.settings))
      this.topBtn = btn('ml-tool-top', 'arrow-up', t('toolTop'), t('toolTopTitle'), () => scrollTo({ top: 0 }))
      this.topBtn.classList.toggle('ml-tool-away', scrollY < 600) // 開檔時就在頂端：一開始就隱藏，不必等第一次捲動
      return h('div', { class: 'ml-toolbar', attrs: { role: 'toolbar' } }, [
        this.tocBtn,
        h('span', { class: 'ml-spacer' }),
        h('span', { class: 'ml-reading-only' }, [
          (this.foldBtn = btn('ml-tool-fold', 'fold-all', t('toolFoldAll'), t('toolFoldAllTitle'), () => MarkLens.foldAll(this.article))),
          (this.unfoldBtn = btn('ml-tool-unfold', 'unfold-all', t('toolUnfoldAll'), t('toolUnfoldAllTitle'), () => MarkLens.unfoldAll(this.article))),
          this.widthBtn,
          this.fontBtn,
          this.copyMdBtn,
          this.exportBtn,
          this.printBtn,
        ]),
        this.themeBtn,
        this.editBtn,
        this.rawBtn,
        this.topBtn,
      ])
    }

    /** 放不下時依序把按鈕改成只顯示圖示，次要的先收 */
    fitToolbar() {
      const bar = this.toolbar
      const order = [this.unfoldBtn, this.foldBtn, this.exportBtn, this.printBtn, this.copyMdBtn, this.editBtn, this.rawBtn, this.topBtn, this.fontBtn, this.widthBtn, this.themeBtn]
      for (const b of order) b.classList.remove('ml-tool-icon')
      for (const b of order) {
        if (bar.scrollWidth <= bar.clientWidth + 1) break
        b.classList.add('ml-tool-icon')
      }
    }

    /** 按鈕再按一次＝關閉選單 */
    toggleMenu(anchor, open) {
      if (MarkLens.menuOpenFor(anchor)) MarkLens.closeMenu()
      else open()
    }

    widthMenu() {
      const cur = this.view.textWidth
      const items = MarkLens.WIDTH_PRESETS.map(w => ({
        label: w ? `${w} px` : t('widthFull'),
        checked: w === cur,
        fn: () => this.setWidth(w),
      }))
      // popup 設定的自訂寬度不在預設選項裡：列在最後並打勾
      if (!MarkLens.WIDTH_PRESETS.includes(cur)) items.push({ label: t('widthCustomItem', cur), checked: true, fn: () => {} })
      MarkLens.openMenu({ anchor: this.widthBtn, items, radio: true, label: t('widthMenu') })
    }

    themeMenu() {
      const items = MarkLens.THEME_ORDER.map(theme => {
        const [icon, name] = THEME_LABELS[theme]
        return { label: t(name), icon, checked: theme === this.settings.theme, fn: () => this.setTheme(theme) }
      })
      MarkLens.openMenu({ anchor: this.themeBtn, items, radio: true, label: t('themeMenu') })
    }

    /** 字體大小：放大、縮小、重設，以及預設尺寸（目前的值打勾） */
    fontMenu() {
      const cur = this.settings.fontSize
      const def = MarkLens.DEFAULTS.fontSize
      const items = [
        { label: t('fontLarger'), icon: 'plus', fn: () => this.stepFont(1) },
        { label: t('fontSmaller'), icon: 'minus', fn: () => this.stepFont(-1) },
        { label: t('fontReset', `${def} px`), fn: () => this.setFontSize(def) },
        ...MarkLens.FONT_PRESETS.map(px => ({
          label: t('fontSizeItem', px, MarkLens.fontPercent(px)),
          checked: px === cur,
          fn: () => this.setFontSize(px),
        })),
      ]
      if (!MarkLens.FONT_PRESETS.includes(cur)) items.push({ label: t('fontCustomItem', cur), checked: true, fn: () => {} })
      MarkLens.openMenu({ anchor: this.fontBtn, items, radio: true, label: t('fontMenu') })
    }

    /**
     * @param {string} name 指令名稱
     * @param {boolean} [announce] 由快捷鍵觸發：寬度與主題切換後以提示顯示切到哪一個（按鍵時看不到選單）
     */
    runCommand(name, announce = false) {
      switch (name) {
        case 'toggle-toc':
          return this.toggleToc()
        case 'cycle-width':
          this.cycleWidth()
          if (announce) MarkLens.toast(t('toolWidth', MarkLens.widthLabel(this.view.textWidth)), [], 1500)
          return
        case 'cycle-theme': {
          const next = MarkLens.nextOf(MarkLens.THEME_ORDER, this.settings.theme)
          this.setTheme(next)
          if (announce) MarkLens.toast(t('toolTheme', t(THEME_LABELS[next][1])), [], 1500)
          return
        }
        case 'font-larger':
        case 'font-smaller':
        case 'font-reset': {
          const px =
            name === 'font-reset' ? MarkLens.DEFAULTS.fontSize : MarkLens.stepFontSize(this.settings.fontSize, name === 'font-larger' ? 1 : -1)
          this.setFontSize(px)
          if (announce) MarkLens.toast(t('toolFontSize', MarkLens.fontPercent(px)), [], 1500)
          return
        }
        case 'toggle-raw':
          return this.toggleRaw()
        case 'fold-all':
          return MarkLens.foldAll(this.article)
        case 'unfold-all':
          return MarkLens.unfoldAll(this.article)
      }
    }

    /** 頁內單鍵快捷鍵；輸入框有焦點或按著修飾鍵時不觸發 */
    onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      const t = e.target
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (t?.closest?.('.ml-menu')) return // 選單開著時按鍵交給選單
      if (e.key === '/') {
        e.preventDefault()
        return this.toc.openSearch()
      }
      const map = {
        t: 'toggle-toc',
        r: 'toggle-raw',
        w: 'cycle-width',
        d: 'cycle-theme',
        '[': 'fold-all',
        ']': 'unfold-all',
        // 字體大小：= 與 + 同一個鍵（不必按 Shift），數字鍵盤的 + − 也可以
        '+': 'font-larger',
        '=': 'font-larger',
        '-': 'font-smaller',
        0: 'font-reset',
      }
      const name = map[e.key]
      if (!name) return
      e.preventDefault()
      this.runCommand(name, true)
    }

    /* ---------- 渲染 ---------- */
    render(src) {
      const { frontMatter, body } = MarkLens.splitFrontMatter(src)
      // 去掉 front matter 後的行號要加回偏移，才能對應原文
      const lineOffset = (src.slice(0, src.length - body.length).match(/\n/g) || []).length
      const frag = MarkLens.sanitize(this.md.render(body, { lineOffset }), this.md.marklensNonce)
      this.article.textContent = ''
      if (frontMatter != null) {
        this.article.append(
          h('details', { class: 'ml-frontmatter' }, [
            h('summary', { text: 'Front matter' }),
            h('pre', {}, [h('code', { text: frontMatter })]),
          ]),
        )
      }
      this.article.append(frag)
      MarkLens.groupInline(this.article)
      MarkLens.setFoldMode(this.article)

      // 標題的原文行號（0 起算）改存到 data 屬性
      for (const el of this.article.querySelectorAll(`[class*="ml-line-${this.md.marklensNonce}-"]`)) {
        const cls = [...el.classList].find(c => c.startsWith('ml-line-'))
        el.dataset.mlLine = cls.split('-').pop()
        el.classList.remove(cls)
        if (!el.classList.length) el.removeAttribute('class')
      }
      const headings = MarkLens.processHeadings(this.article)
      for (const el of headings) {
        if (el.dataset.mlLine == null) continue // 原文中以 HTML 寫的標題沒有行號，無法切出章節
        el.querySelector('.ml-anchor').after(
          h('button', {
            class: 'ml-heading-copy',
            title: t('headingCopy'),
            attrs: { 'aria-label': t('headingCopy') },
            on: { click: e => (e.preventDefault(), this.copyMarkdown(el)) },
          }, [MarkLens.icon('copy')]),
        )
      }
      MarkLens.processTaskLists(this.article, this.md.marklensNonce)
      this.enableTaskBoxes()
      MarkLens.processAlerts(this.article)
      MarkLens.processCodeBlocks(this.article)
      MarkLens.renderMermaid(this.article, this.settings.mermaid)
      MarkLens.renderMath(this.article, this.settings.math)
      MarkLens.processImages(this.article)
      MarkLens.processLinks(this.article, this.settings.linkNewTab)
      this.tables = Array.from(this.article.querySelectorAll('table'), t => MarkLens.enhanceTable(t, this.settings))

      this.toc.build(headings, this.settings.tocDepth)
      this.toc.setStats(MarkLens.readingStats(this.article))
      const h1 = this.article.querySelector('h1')
      document.title = h1 ? h1.dataset.mlText : fileName()
    }

    /** 自動更新時重新渲染，保留捲動位置、摺疊狀態與表格狀態 */
    update(src) {
      const y = scrollY
      const folded = Array.from(this.article.querySelectorAll(':scope > .ml-folded'), el => el.id)
      const tableStates = this.tables.map(t => t.getState())
      // 全螢幕表格會鎖住頁面捲動，先解除，還原狀態時再套回
      document.documentElement.classList.remove('ml-noscroll')
      this.raw = src
      this.rawExact = location.protocol === 'file:' // 自動更新與衝突重載都是以 UTF-8 精確讀取
      this.pre.textContent = src
      this.render(src)
      this.tables.forEach((t, i) => t.setState(tableStates[i]))
      for (const id of folded) {
        const el = document.getElementById(id)
        if (el && el.parentElement === this.article) MarkLens.toggleFold(el, true)
      }
      scrollTo(0, y)
    }

    /* ---------- 設定 ---------- */
    /**
     * 即時同步的外觀設定
     * @returns {Promise<void>} Mermaid 圖表依新主題重繪完成
     */
    applyLive() {
      const s = this.settings
      const rs = document.documentElement.style
      rs.setProperty('--ml-font-size', `${s.fontSize}px`)
      // 縮放倍率（以預設字體大小為 100%）：給無法用 em 表示大小的內容（Mermaid 圖表）等比縮放
      rs.setProperty('--ml-scale', String(s.fontSize / MarkLens.DEFAULTS.fontSize))
      rs.setProperty('--ml-line-height', String(s.lineHeight))
      const dark = s.theme === 'dark' || (s.theme === 'auto' && this.darkQuery.matches)
      // 列印時一律淺色：紙張不印背景，深色主題的淺色文字印出來看不清楚
      document.documentElement.dataset.mlTheme = dark && !this.printing ? 'dark' : 'light'
      if (s.palette && s.palette !== 'github' && MarkLens.PALETTES.includes(s.palette)) document.documentElement.dataset.mlPalette = s.palette
      else delete document.documentElement.dataset.mlPalette
      this.applyCustomCss(s.customCss)
      // 給下一次開檔的等待畫面用（early.js）；只寫本機檔案的儲存空間，網站讀不到
      if (location.protocol === 'file:') {
        try {
          localStorage.setItem('marklens:theme', dark ? 'dark' : 'light')
        } catch {
          // 無法寫入時下次等待畫面跟隨系統
        }
      }
      if (this.themeBtn) {
        const [icon, name] = THEME_LABELS[s.theme] || THEME_LABELS.auto
        setTool(this.themeBtn, icon, t('toolTheme', t(name)))
      }
      if (this.fontBtn) setTool(this.fontBtn, 'text-size', t('toolFontSize', MarkLens.fontPercent(s.fontSize)))
      return this.article ? MarkLens.rethemeMermaid(this.article) : Promise.resolve()
    }

    /** 分頁狀態與只在載入時套用的設定 */
    applyView() {
      const v = this.view
      const root = document.documentElement
      const rs = root.style
      rs.setProperty('--ml-text-max', v.textWidth ? `${v.textWidth}px` : 'none')
      rs.setProperty('--ml-text-min', v.textWidth ? `min(100%, ${v.textWidth}px)` : '100%')
      rs.setProperty('--ml-toc-width', `${v.tocWidth}px`)
      root.classList.toggle('ml-toc-hidden', v.tocHidden)
      root.classList.toggle('ml-code-wrap', this.settings.codeWrap)
      root.classList.toggle('ml-wide-blocks', this.settings.tableWidth !== 'text')
      setTool(this.widthBtn, 'width', t('toolWidth', MarkLens.widthLabel(v.textWidth)))
      this.tocBtn.classList.toggle('active', !v.tocHidden)
    }

    setView(patch) {
      Object.assign(this.view, patch)
      writeView(this.view)
      this.applyView()
    }

    /** 主題是全域設定：寫入後由 storage.onChanged 同步套用到所有分頁（含本分頁） */
    setTheme(theme) {
      if (!MarkLens.alive()) return this.onOrphaned()
      MarkLens.saveSettings({ theme }).catch(() => {})
    }

    /** 字體大小同主題，是全域設定：所有分頁一起縮放 */
    setFontSize(px) {
      if (!MarkLens.alive()) return this.onOrphaned()
      const fontSize = Math.min(MarkLens.FONT_MAX, Math.max(MarkLens.FONT_MIN, Math.round(px)))
      if (fontSize === this.settings.fontSize) return
      // 以目前閱讀位置為錨點：縮放後頁面高度改變，捲回同一個比例的位置
      const ratio = scrollY / Math.max(1, document.documentElement.scrollHeight)
      this.settings.fontSize = fontSize
      this.applyLive()
      scrollTo(0, ratio * document.documentElement.scrollHeight)
      this.onScroll()
      MarkLens.saveSettings({ fontSize }).catch(() => {})
    }

    stepFont(dir) {
      this.setFontSize(MarkLens.stepFontSize(this.settings.fontSize, dir))
    }

    /** 複製 Markdown 原文：整份文件，或 heading 那一節（到下一個同級或更高的標題為止） */
    async copyMarkdown(heading) {
      let text = this.raw
      if (heading) {
        const lines = this.raw.split('\n')
        const start = Number(heading.dataset.mlLine)
        const level = Number(heading.dataset.mlLevel)
        let end = lines.length
        for (const el of this.article.querySelectorAll('[data-ml-level][data-ml-line]')) {
          const line = Number(el.dataset.mlLine)
          if (line > start && Number(el.dataset.mlLevel) <= level) {
            end = line
            break
          }
        }
        text = lines.slice(start, end).join('\n').trimEnd() + '\n'
      }
      MarkLens.toast(t((await MarkLens.copyText(text)) ? 'mdCopied' : 'mdCopyFailed'))
    }

    /** 以設定的編輯器開啟目前檔案；正在閱讀某個章節時跳到該標題所在行 */
    openInEditor() {
      const heading = this.toc.items[this.toc.activeIndex]?.heading
      const line = heading?.dataset.mlLine != null ? Number(heading.dataset.mlLine) + 1 : 1
      const url = MarkLens.editorUrl(this.settings, location.href, line)
      if (!url) return MarkLens.toast(t('editorInvalid'))
      this.editBtn.dataset.mlHref = url // 供測試確認
      // 自訂協定由瀏覽器詢問是否開啟外部程式，不會離開目前頁面
      const a = h('a', { href: url })
      a.click()
    }

    async exportHtml() {
      if (!MarkLens.alive()) return this.onOrphaned()
      this.exportBtn.disabled = true
      try {
        const name = await MarkLens.exportHtml(this.article)
        MarkLens.toast(t('exportDone', name))
      } catch (err) {
        MarkLens.toast(t('exportFailed', err.message))
      } finally {
        this.exportBtn.disabled = false
      }
    }

    /**
     * 使用者自訂的 CSS：以 constructable stylesheet 套用，不受網站 CSP 的 style-src 限制；
     * 語法錯誤的規則由瀏覽器略過，不影響其他規則
     */
    applyCustomCss(css) {
      if (!this.customSheet) {
        if (!css) return
        this.customSheet = new CSSStyleSheet()
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.customSheet]
      }
      this.customSheet.replaceSync(css || '')
    }

    /** 進入／離開列印狀態（改用淺色）；回傳圖表重繪完成的 Promise */
    setPrinting(on) {
      if (this.printing === on) return Promise.resolve()
      this.printing = on
      return this.applyLive()
    }

    /**
     * 列印／存成 PDF：先改用淺色並等 Mermaid 重繪、延遲載入的圖片載完，再開啟列印對話框
     * 摺疊的段落與篩選掉的表格列由列印樣式（content.css 的 @media print）顯示
     */
    async print() {
      if (this.printBtn.disabled) return
      this.printBtn.disabled = true
      try {
        await this.setPrinting(true)
        await MarkLens.loadImages(this.article)
        window.print() // 對話框關閉後才返回；afterprint 會還原主題
      } finally {
        this.setPrinting(false)
        this.printBtn.disabled = false
      }
    }

    cycleWidth() {
      this.setWidth(MarkLens.nextOf(MarkLens.WIDTH_PRESETS, this.view.textWidth))
    }

    setWidth(textWidth) {
      this.setView({ textWidth })
      this.onScroll()
    }

    /* ---------- 目錄 ---------- */
    isNarrow() {
      return innerWidth <= NARROW
    }

    toggleToc() {
      if (this.isNarrow()) this.setTocOpen(!document.documentElement.classList.contains('ml-toc-open'))
      else this.setView({ tocHidden: !this.view.tocHidden })
    }

    setTocOpen(open) {
      document.documentElement.classList.toggle('ml-toc-open', open)
    }

    /* ---------- 原始文字 ---------- */
    toggleRaw() {
      const on = document.documentElement.classList.toggle('ml-raw')
      setTool(this.rawBtn, on ? 'arrow-left' : 'code', t(on ? 'toolBack' : 'toolRaw'))
      this.rawBtn.classList.toggle('active', on)
      scrollTo(0, 0)
    }

    /* ---------- 捲動 ---------- */
    onScroll() {
      const max = document.documentElement.scrollHeight - innerHeight
      this.progress.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`
      // 保留位置、只切換可見（見 content.css）：用 hidden 移除會讓整排靠右的按鈕位移
      this.topBtn.classList.toggle('ml-tool-away', scrollY < 600)
      this.toc.update()
      if (this.settings.rememberScroll && this.saveScroll) this.saveScroll()
    }

    scrollToHash() {
      let id
      try {
        id = decodeURIComponent(location.hash.slice(1))
      } catch {
        id = location.hash.slice(1)
      }
      const el = id && document.getElementById(id)
      if (!el) return
      MarkLens.revealElement(this.article, el)
      el.scrollIntoView({ block: 'start' })
      this.toc.setTarget(el)
    }

    posKey() {
      return location.href.split('#')[0]
    }

    async persistScroll() {
      if (document.documentElement.classList.contains('ml-raw')) return
      if (!MarkLens.alive()) return this.onOrphaned()
      try {
        const data = (await chrome.storage.local.get(POS_KEY))[POS_KEY] || {}
        const key = this.posKey()
        delete data[key] // 重新插入，讓最近使用的排在最後
        data[key] = Math.round(scrollY)
        const keys = Object.keys(data)
        for (const k of keys.slice(0, Math.max(0, keys.length - POS_LIMIT))) delete data[k]
        await chrome.storage.local.set({ [POS_KEY]: data })
      } catch {
        // 記住捲動位置是附加功能，失敗不影響閱讀
      }
    }

    async restoreScroll() {
      try {
        const data = (await chrome.storage.local.get(POS_KEY))[POS_KEY] || {}
        const y = data[this.posKey()]
        if (y) scrollTo(0, y)
      } catch {
        // 同上
      }
    }

    /* ---------- 任務勾選寫回 ---------- */
    /** 無法寫回的原因（訊息 key）；可以寫回時回傳 null */
    taskReadonlyReason() {
      if (location.protocol !== 'file:') return 'taskReadonlyRemote'
      if (MarkLens.networkFile) return 'taskReadonlyNetwork'
      if (!this.settings.taskWrite) return 'taskReadonlyOff'
      if (!this.rawExact) return 'taskNotUtf8' // 不是 UTF-8：寫回可能損壞原檔的文字
      return null
    }

    /**
     * 有原文行號的勾選框改為可點擊；無法寫回時維持原狀態，點擊與滑過時說明原因，
     * 避免看起來像壞掉（停用的 checkbox 不會觸發任何事件，所以不用 disabled）
     */
    enableTaskBoxes() {
      const reason = this.taskReadonlyReason()
      for (const box of this.article.querySelectorAll('input.ml-task-box[data-ml-line]')) {
        box.disabled = false
        if (reason) {
          box.dataset.mlReadonly = reason
          box.title = t(reason)
        } else {
          box.title = t('taskTitle')
        }
      }
    }

    bindTaskClicks() {
      this.article.addEventListener('click', e => {
        const box = e.target.closest?.('input.ml-task-box[data-ml-line]')
        if (!box || box.disabled) return
        // 先維持原狀，等寫回成功才改變勾選狀態
        e.preventDefault()
        if (box.dataset.mlReadonly) return MarkLens.toast(t(box.dataset.mlReadonly))
        this.toggleTask(Number(box.dataset.mlLine))
      })
    }

    async toggleTask(line) {
      const box = this.article.querySelector(`input.ml-task-box[data-ml-line="${line}"]`)
      if (!box || this.taskBusy) return
      if (!MarkLens.alive()) return this.onOrphaned()
      const from = box.dataset.mlState
      const to = from === 'x' ? ' ' : 'x'
      this.taskBusy = true
      box.classList.add('ml-busy')
      let res
      try {
        res = await chrome.runtime.sendMessage({
          type: 'toggle-task',
          line,
          from,
          to,
          hash: await MarkLens.sha256(this.raw),
        })
      } catch (err) {
        res = { status: 'error', error: err.message }
      } finally {
        this.taskBusy = false
        box.classList.remove('ml-busy')
      }

      const openGrant = () => chrome.runtime.sendMessage({ type: 'open-grant' })
      switch (res?.status) {
        case 'ok': {
          // 頁面原文同步為寫入後的內容，自動更新就不會重新渲染
          this.raw = res.text
          this.pre.textContent = res.text
          box.checked = to === 'x'
          box.dataset.mlState = to
          MarkLens.toast(t(to === 'x' ? 'taskChecked' : 'taskUnchecked'), [{ label: t('undo'), fn: () => this.toggleTask(line) }])
          break
        }
        case 'no-root':
          MarkLens.toast(t('taskNoRoot'), [{ label: t('authorizeFolder'), fn: openGrant }], 8000)
          break
        case 'permission':
          MarkLens.toast(t('taskPermission', res.root), [{ label: t('goConfirm'), fn: openGrant }], 8000)
          break
        case 'conflict':
          this.update(res.text)
          MarkLens.toast(t('taskConflict'))
          break
        case 'not-utf8':
          MarkLens.toast(t('taskNotUtf8'))
          break
        case 'ambiguous':
          MarkLens.toast(t('taskAmbiguous'), [{ label: t('authorizeFolder'), fn: openGrant }], 8000)
          break
        default:
          MarkLens.toast(t('taskError', res?.error || t('unknownError')))
      }
    }

    /**
     * 擴充功能被重新載入後，這個分頁的 content script 已失去連線：
     * 停止所有需要 chrome.* 的背景工作，保留目前畫面，並提示重新整理
     */
    onOrphaned() {
      if (this.orphaned) return
      this.orphaned = true
      clearTimeout(this.refreshTimer)
      this.toolbar.prepend(
        h('span', { class: 'ml-orphan' }, [
          t('orphanBefore'),
          h('button', { class: 'ml-tool', text: t('orphanReload'), on: { click: () => location.reload() } }),
          t('orphanAfter'),
        ]),
      )
    }

    /* ---------- 自動更新 ---------- */
    startRefresh() {
      clearTimeout(this.refreshTimer)
      const mode = this.settings.autoRefresh
      if (mode === 'off' || (mode === 'local' && location.protocol !== 'file:') || MarkLens.networkFile) return
      const tick = async () => {
        if (!MarkLens.alive()) return this.onOrphaned()
        if (!document.hidden) {
          const src = await MarkLens.fetchSource({ ifChanged: true })
          if (src !== MarkLens.UNCHANGED && src != null && src !== this.raw) this.update(src)
        }
        this.refreshTimer = setTimeout(tick, Math.max(300, this.settings.refreshInterval))
      }
      this.refreshTimer = setTimeout(tick, this.settings.refreshInterval)
    }
  }

  /** 不接管這一頁：取消 content.css 載入期間對原始文字的隱藏，並立刻結束換頁轉場 */
  function reveal() {
    document.documentElement.classList.add('ml-off')
    MarkLens.revealPage?.()
  }

  async function boot() {
    const pre = sourcePre()
    if (!pre) return reveal()
    const settings = await MarkLens.loadSettings()
    if (!settings.enabled) {
      reveal()
      // 停用時仍監聽設定，重新啟用後重新整理頁面
      chrome.storage.onChanged.addListener(c => {
        if (c[MarkLens.SETTINGS_KEY]?.newValue?.enabled) location.reload()
      })
      // 讀取設定到掛上監聽之間若剛好被重新啟用，會漏掉通知：再確認一次
      if ((await MarkLens.loadSettings()).enabled) location.reload()
      return
    }
    let raw = pre.textContent
    let exact = false
    if (location.protocol === 'file:' && !MarkLens.networkFile) {
      // 以 UTF-8 重新讀取，修正瀏覽器猜錯編碼的情況
      const text = await MarkLens.fetchSource()
      if (text != null) {
        raw = text
        exact = true
        pre.textContent = text
      }
    }
    await MarkLens.initI18n(settings.uiLang)
    MarkLens.app = new App(settings, pre, raw, exact)
    MarkLens.app.mount()
    // 排版完成：結束換頁轉場，從舊畫面直接換成新頁
    MarkLens.revealPage?.()
  }

  boot().catch(err => {
    reveal()
    console.error('[MarkLens]', err)
  })
})()
