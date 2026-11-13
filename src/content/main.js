'use strict'
// 進入點：偵測 Markdown 頁面、組裝版面、套用設定、自動更新
var Markloupe = globalThis.Markloupe || (globalThis.Markloupe = {})

;(() => {
  const { h, t } = Markloupe
  const CONTENT_TYPES = ['text/plain', 'text/markdown', 'text/x-markdown']
  const POS_KEY = 'markloupe:scroll'
  const POS_LIMIT = 300
  const VIEW_KEY = 'markloupe:view' // 分頁狀態，存在 sessionStorage
  const NARROW = 900
  const CHANGE_SEEN_MS = 3000 // 改動的區塊進入畫面後保留標記的時間
  const NEAR_LINE = 40 // 標題頂端在基準線下方這個距離內，視為目前的標題（px）
  const THEME_LABELS = { auto: ['auto', 'themeAuto'], light: ['sun', 'themeLight'], dark: ['moon', 'themeDark'] }

  /**
   * 工具列按鈕的內容：圖示＋文字（窄螢幕或放不下時文字只在畫面上隱藏，螢幕閱讀器仍念得到）
   * 會展開選單的按鈕（aria-haspopup）在最後加一個向下的小箭頭
   */
  function setTool(btn, icon, label) {
    btn.replaceChildren(
      Markloupe.icon(icon),
      label ? h('span', { class: 'ml-tool-label', text: label }) : '',
      btn.hasAttribute('aria-haspopup') ? h('span', { class: 'ml-tool-caret' }, [Markloupe.icon('chevron-down')]) : '',
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
   * 網站可藉此得知裝了 Markloupe；所以網頁上的分頁狀態只留在記憶體，重新整理後回到預設值。
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
      this.emptySince = 0 // 自動更新開始讀到空檔案的時間；0 表示沒有
      this.liveWrites = new Map() // 本分頁還沒寫完的全域外觀設定：鍵 → 寫入數
      this.liveEpoch = 0 // 套用設定通知的次數；讀取期間有變動，讀到的值就可能比通知舊
      this.md = Markloupe.createMarkdown()
      this.tables = []
      this.refreshTimer = null
      this.changeState = { base: raw, seen: Markloupe.noChanges() } // 見 Markloupe.trackChanges
      this.changeMarks = new Map() // 標出改動的元素 → 它代表的改動（目前原文的行號）
      this.changeSeen = null
      this.darkQuery = matchMedia('(prefers-color-scheme: dark)')
      // Mermaid 圖表另存圖片時暫時改用淺色（同列印與匯出 Word），取完圖再還原
      Markloupe.withLightTheme = async fn => {
        await this.setPrinting(true)
        try {
          return await fn()
        } finally {
          this.setPrinting(false)
        }
      }
      // 分頁狀態：以全域預設值為底，套上本分頁先前的調整
      const saved = readView()
      this.view = {
        tocHidden: saved.tocHidden ?? settings.tocHidden,
        tocWidth: saved.tocWidth ?? settings.tocWidth,
        textWidth: saved.textWidth ?? settings.textWidth,
        focus: saved.focus ?? false, // 專注模式：隱藏工具列與側邊欄
        sideTab: saved.sideTab ?? 'toc', // 側邊欄分頁：toc | files
        filesRoot: saved.filesRoot ?? null, // 檔案分頁的起點資料夾（同一分頁內切換檔案時沿用）
        filesOpen: saved.filesOpen ?? [], // 檔案分頁已展開的子資料夾（相對起點）
      }
    }

    mount() {
      const root = document.documentElement
      // 擴充功能更新後才會用到的提示，先取一次存進快取（屆時 chrome.i18n 已無法使用）
      for (const k of ['orphanBefore', 'orphanReload', 'orphanAfter']) t(k)
      root.classList.add('markloupe')

      this.article = h('article', { class: 'ml-body markdown-body' })
      this.toc = new Markloupe.Toc(this)
      this.progress = h('div', { class: 'ml-progress' })
      this.toolbar = this.buildToolbar()
      // 原始文字的 <pre> 移進主區塊，切換時工具列仍在，隨時可以回來；畫面上顯示的是帶行號的 rawView
      this.pre.classList.add('ml-source')
      this.rawView = h('div', { class: 'ml-source-view', on: { click: e => this.onRawClick(e) } })
      this.main = h('main', { class: 'ml-main' }, [this.toolbar, this.article, this.pre, this.rawView])
      this.backdrop = h('div', { class: 'ml-backdrop', on: { click: () => this.setTocOpen(false) } })
      this.appRoot = h('div', { id: 'ml-root' }, [this.progress, this.toc.el, this.backdrop, this.main])
      document.body.append(this.appRoot)

      Markloupe.bindFoldSearch(this.article)
      this.bindTaskClicks()
      this.bindSelection()
      Markloupe.bindFootnotes(this.article)
      this.article.addEventListener('markloupe:fold', () => {
        this.toc.syncFold()
        this.onScroll()
      })

      this.render(this.raw)
      this.applyLive()
      this.applyView()
      this.startRefresh()

      // 工具列寬度與按鈕文字（語系、寬度與字級的數值）都會變：放不下時只顯示圖示
      const fit = Markloupe.rafThrottle(() => this.fitToolbar())
      new ResizeObserver(fit).observe(this.toolbar)
      new MutationObserver(fit).observe(this.toolbar, { childList: true, subtree: true, characterData: true })
      this.fitToolbar()

      this.saveScroll = Markloupe.debounce(() => this.persistScroll(), 400)
      addEventListener('scroll', Markloupe.rafThrottle(() => this.onScroll()), { passive: true })
      addEventListener('resize', Markloupe.rafThrottle(() => this.onScroll()))
      addEventListener('hashchange', () => this.scrollToHash())
      addEventListener('keydown', e => this.onKey(e))
      this.darkQuery.addEventListener('change', () => this.applyLive())
      // Ctrl+P 也改用淺色列印；圖表來不及重繪，列印按鈕才會等圖表重繪完
      addEventListener('beforeprint', () => this.setPrinting(true))
      addEventListener('afterprint', () => this.setPrinting(false))

      // 只有外觀設定即時同步；其餘設定是新分頁的預設值
      chrome.storage.onChanged.addListener((changes, area) => {
        const c = area === 'local' && changes[Markloupe.SETTINGS_KEY]
        if (!c) return
        const next = { ...Markloupe.DEFAULTS, ...c.newValue }
        if (!next.enabled) return location.reload()
        for (const k of Markloupe.LIVE_KEYS) {
          // 本分頁還有這個鍵沒寫完時，通知帶的是較舊的值
          if (this.liveWrites.get(k)) continue
          this.settings[k] = next[k]
        }
        this.liveEpoch++
        this.applyLive()
      })
      chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
        if (msg?.type === 'command') this.runCommand(msg.name, true)
        reply({ ok: true })
      })
      // popup 調色時的預覽：只改畫面、不存檔；popup 關閉（連線中斷）時回到設定中的顏色
      chrome.runtime.onConnect.addListener(port => {
        if (port.name !== 'ml-color-preview') return
        port.onMessage.addListener(colors => {
          this.previewColors = colors
          if (colors) this.applyPalette('custom')
          else this.applyLive()
        })
        port.onDisconnect.addListener(() => {
          if (!this.previewColors) return
          this.previewColors = null
          this.applyLive()
        })
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
      this.copyMdBtn = btn('ml-tool-copy', 'copy', t('toolCopyMd'), t('toolCopyMdTitle'), () => this.toggleMenu(this.copyMdBtn, () => this.copyMenu(this.copyMdBtn)))
      this.exportBtn = btn('ml-tool-export', 'download', t('toolExport'), t('toolExportTitle'), () => this.toggleMenu(this.exportBtn, () => this.exportMenu()))
      for (const b of [this.widthBtn, this.themeBtn, this.fontBtn, this.copyMdBtn, this.exportBtn]) {
        b.setAttribute('aria-haspopup', 'menu')
        b.setAttribute('aria-expanded', 'false')
      }
      // 加上選單的小箭頭
      setTool(this.copyMdBtn, 'copy', t('toolCopyMd'))
      setTool(this.exportBtn, 'download', t('toolExport'))
      this.printBtn = btn('ml-tool-print', 'print', t('toolPrint'), t('toolPrintTitle'), () => this.print())
      this.rawBtn = btn('ml-tool-raw', 'code', t('toolRaw'), t('toolRawTitle'), () => this.toggleRaw())
      // 用編輯器開啟：設定中選了編輯器且為本機檔案才顯示
      this.editBtn = btn('ml-tool-edit', 'edit', t('toolEdit'), t('toolEditTitle'), () => this.openInEditor())
      this.editBtn.hidden = !(location.protocol === 'file:' && Markloupe.editorTemplate(this.settings))
      this.topBtn = btn('ml-tool-top', 'arrow-up', t('toolTop'), t('toolTopTitle'), () => scrollTo({ top: 0 }))
      this.topBtn.classList.toggle('ml-tool-away', scrollY < 600) // 開檔時就在頂端：一開始就隱藏，不必等第一次捲動
      this.changesBtn = btn('ml-tool-changes', 'arrow-down', '', '', () => this.nextChange())
      this.changesBtn.hidden = true
      return h('div', { class: 'ml-toolbar', attrs: { role: 'toolbar' } }, [
        this.tocBtn,
        h('span', { class: 'ml-spacer' }),
        h('span', { class: 'ml-reading-only' }, [
          this.changesBtn,
          (this.foldBtn = btn('ml-tool-fold', 'fold-all', t('toolFoldAll'), t('toolFoldAllTitle'), () => Markloupe.foldAll(this.article))),
          (this.unfoldBtn = btn('ml-tool-unfold', 'unfold-all', t('toolUnfoldAll'), t('toolUnfoldAllTitle'), () => Markloupe.unfoldAll(this.article))),
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
      const order = [this.unfoldBtn, this.foldBtn, this.exportBtn, this.printBtn, this.copyMdBtn, this.editBtn, this.rawBtn, this.topBtn, this.fontBtn, this.widthBtn, this.themeBtn, this.changesBtn]
      for (const b of order) b.classList.remove('ml-tool-icon')
      for (const b of order) {
        if (bar.scrollWidth <= bar.clientWidth + 1) break
        b.classList.add('ml-tool-icon')
      }
    }

    /** 按鈕再按一次＝關閉選單 */
    toggleMenu(anchor, open) {
      if (Markloupe.menuOpenFor(anchor)) Markloupe.closeMenu()
      else open()
    }

    widthMenu() {
      const cur = this.view.textWidth
      const items = Markloupe.WIDTH_PRESETS.map(w => ({
        label: w ? `${w} px` : t('widthFull'),
        checked: w === cur,
        fn: () => this.setWidth(w),
      }))
      // popup 設定的自訂寬度不在預設選項裡：列在最後並打勾
      if (!Markloupe.WIDTH_PRESETS.includes(cur)) items.push({ label: t('widthCustomItem', cur), checked: true, fn: () => {} })
      items.push({ label: t('focusMode'), fn: () => this.toggleFocus(true) })
      Markloupe.openMenu({ anchor: this.widthBtn, items, radio: true, label: t('widthMenu') })
    }

    themeMenu() {
      const items = Markloupe.THEME_ORDER.map(theme => {
        const [icon, name] = THEME_LABELS[theme]
        return { label: t(name), icon, checked: theme === this.settings.theme, fn: () => this.setTheme(theme) }
      })
      Markloupe.openMenu({ anchor: this.themeBtn, items, radio: true, label: t('themeMenu') })
    }

    /** 字體大小：放大、縮小、重設，以及預設尺寸（目前的值打勾） */
    fontMenu() {
      const cur = this.settings.fontSize
      const def = Markloupe.DEFAULTS.fontSize
      const items = [
        { label: t('fontLarger'), icon: 'plus', fn: () => this.stepFont(1) },
        { label: t('fontSmaller'), icon: 'minus', fn: () => this.stepFont(-1) },
        { label: t('fontReset', `${def} px`), fn: () => this.setFontSize(def) },
        ...Markloupe.FONT_PRESETS.map(px => ({
          label: t('fontSizeItem', px, Markloupe.fontPercent(px)),
          checked: px === cur,
          fn: () => this.setFontSize(px),
        })),
      ]
      if (!Markloupe.FONT_PRESETS.includes(cur)) items.push({ label: t('fontCustomItem', cur), checked: true, fn: () => {} })
      Markloupe.openMenu({ anchor: this.fontBtn, items, radio: true, label: t('fontMenu') })
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
          if (announce) Markloupe.toast(t('toolWidth', Markloupe.widthLabel(this.view.textWidth)), [], 1500)
          return
        case 'cycle-theme': {
          const next = Markloupe.nextOf(Markloupe.THEME_ORDER, this.settings.theme)
          this.setTheme(next)
          if (announce) Markloupe.toast(t('toolTheme', t(THEME_LABELS[next][1])), [], 1500)
          return
        }
        case 'font-larger':
        case 'font-smaller':
        case 'font-reset': {
          const px =
            name === 'font-reset' ? Markloupe.DEFAULTS.fontSize : Markloupe.stepFontSize(this.settings.fontSize, name === 'font-larger' ? 1 : -1)
          this.setFontSize(px)
          if (announce) Markloupe.toast(t('toolFontSize', Markloupe.fontPercent(px)), [], 1500)
          return
        }
        case 'toggle-raw':
          return this.toggleRaw()
        case 'fold-all':
          return Markloupe.foldAll(this.article)
        case 'unfold-all':
          return Markloupe.unfoldAll(this.article)
        case 'toggle-focus':
          return this.toggleFocus()
        case 'next-heading':
          return this.jumpHeading(1)
        case 'prev-heading':
          return this.jumpHeading(-1)
      }
    }

    /** 專注模式只影響目前分頁；工具列藏起來後只能按 f 離開，所以進入時提示 */
    toggleFocus(force) {
      const on = force ?? !this.view.focus
      this.setView({ focus: on })
      Markloupe.toast(t(on ? 'focusOn' : 'focusOff'), [], on ? 4000 : 1500)
    }

    /** 跳到下一個或上一個看得到的標題；被摺疊的略過，原始文字模式不動作 */
    jumpHeading(dir) {
      if (document.documentElement.classList.contains('ml-raw')) return
      // 摺疊用 hidden="until-found"，被摺疊的標題仍有外框，checkVisibility() 看不出來
      const all = [...this.article.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(el => !el.closest('[data-ml-fold]') && el.checkVisibility())
      if (!all.length) return
      // 標題捲到頂端時停在 scroll-margin-top 的位置，以此為「目前」的基準線
      const line = parseFloat(getComputedStyle(all[0]).scrollMarginTop) || 0
      const top = el => el.getBoundingClientRect().top - line
      // 頁尾的標題捲不到基準線，依位置判斷會一直選到同一個；已捲到底且上次跳到的標題還在畫面內時，從它接著找
      const atBottom = scrollY + innerHeight >= document.documentElement.scrollHeight - 2
      const r = this.lastJump?.getBoundingClientRect()
      const last = atBottom && r && r.bottom > 0 && r.top < innerHeight ? all.indexOf(this.lastJump) : -1
      // 頁首的第一個標題比基準線低一段外距，往下找時要越過它，否則畫面只捲動幾個像素
      const el = last >= 0 ? all[last + dir] : dir > 0 ? all.find(h => top(h) > NEAR_LINE) : all.findLast(h => top(h) < -1)
      if (!el) return
      el.scrollIntoView({ block: 'start' })
      this.lastJump = el
      if (el.id) history.replaceState(null, '', `#${encodeURIComponent(el.id)}`)
      this.toc.setTarget(el)
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
        f: 'toggle-focus',
        n: 'next-heading',
        p: 'prev-heading',
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
      const { frontMatter, body } = Markloupe.splitFrontMatter(src)
      // 去掉 front matter 後的行號要加回偏移，才能對應原文
      const lineOffset = (src.slice(0, src.length - body.length).match(/\n/g) || []).length
      const frag = Markloupe.sanitize(this.md.render(body, { lineOffset }), this.md.markloupeNonce)
      this.article.textContent = ''
      const lang = Markloupe.frontMatterLang(frontMatter)
      if (lang) this.article.lang = lang
      else this.article.removeAttribute('lang')
      if (frontMatter != null) {
        // 單層的 key: value 以兩欄顯示；用 dl 而不是 table，才不會被當成文件裡的表格加上排序與工具列
        const entries = Markloupe.frontMatterEntries(frontMatter)
        const body = entries
          ? h('dl', { class: 'ml-fm-list' }, entries.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]))
          : h('pre', {}, [h('code', { text: frontMatter })])
        this.article.append(h('details', { class: 'ml-frontmatter' }, [h('summary', { text: 'Front matter' }), body]))
      }
      this.article.append(frag)
      Markloupe.groupInline(this.article)
      Markloupe.setFoldMode(this.article)

      Markloupe.applyLineRanges(this.article, this.md.markloupeNonce)
      const headings = Markloupe.processHeadings(this.article)
      for (const el of headings) {
        if (el.dataset.mlLine == null) continue // 原文中以 HTML 寫的標題沒有行號，無法切出章節
        const copyBtn = h('button', {
          class: 'ml-heading-copy',
          title: t('headingCopy'),
          attrs: { 'aria-label': t('headingCopy'), 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
          on: { click: e => (e.preventDefault(), this.toggleMenu(copyBtn, () => this.copyMenu(copyBtn, el))) },
        }, [Markloupe.icon('copy')])
        el.querySelector('.ml-anchor').after(copyBtn)
      }
      Markloupe.processTaskLists(this.article, this.md.markloupeNonce)
      this.enableTaskBoxes()
      Markloupe.processAlerts(this.article)
      Markloupe.processCodeBlocks(this.article)
      Markloupe.renderMermaid(this.article, this.settings.mermaid)
      Markloupe.renderMath(this.article, this.settings.math)
      Markloupe.processImages(this.article)
      Markloupe.processLinks(this.article, this.settings.linkNewTab)
      this.tables = Array.from(this.article.querySelectorAll('table'), t => Markloupe.enhanceTable(t, this.settings, this.lines()))

      this.toc.build(headings, this.settings.tocDepth)
      this.toc.setStats(Markloupe.readingStats(this.article))
      const h1 = this.article.querySelector('h1')
      document.title = h1 ? h1.dataset.mlText : fileName()
    }

    /** 自動更新時重新渲染，保留捲動位置、摺疊狀態與表格狀態 */
    update(src) {
      this.emptySince = 0
      const y = scrollY
      const folded = Array.from(this.article.querySelectorAll(':scope > .ml-folded'), el => el.id)
      const tableStates = this.tables.map(t => t.getState())
      // 全螢幕表格會鎖住頁面捲動，先解除，還原狀態時再套回
      document.documentElement.classList.remove('ml-noscroll')
      const old = this.raw
      this.raw = src
      this.rawExact = location.protocol === 'file:' // 自動更新與衝突重載都是以 UTF-8 精確讀取
      this.pre.textContent = src
      this.render(src)
      // 表格還原排序前標記，標在列上的 class 才會跟著列移動
      this.showChanges(old, src)
      this.syncRawView()
      this.tables.forEach((t, i) => t.setState(tableStates[i]))
      for (const id of folded) {
        const el = document.getElementById(id)
        if (el && el.parentElement === this.article) Markloupe.toggleFold(el, true)
      }
      scrollTo(0, y)
    }

    /* ---------- 標出改動 ---------- */
    showChanges(old, src) {
      this.changeSeen?.disconnect()
      const changes = this.settings.refreshHighlight ? Markloupe.trackChanges(this.changeState, old, src) : Markloupe.noChanges()
      const marks = Markloupe.markChanges(this.article, changes, this.lines())
      this.changeMarks = marks
      if (!marks.size) this.restartChanges()
      // 進入畫面幾秒後移除標記，視為已看過
      this.changeSeen = new IntersectionObserver(entries => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          this.changeSeen.unobserve(e.target)
          setTimeout(() => this.fadeChange(e.target), CHANGE_SEEN_MS)
        }
      })
      for (const el of marks.keys()) this.changeSeen.observe(el)
      this.syncChangeCount()
    }

    fadeChange(el) {
      const m = this.changeMarks.get(el)
      if (!m) return
      this.changeMarks.delete(el)
      for (const l of m.lines) this.changeState.seen.lines.add(l)
      for (const d of m.dels) this.changeState.seen.dels.add(d)
      if (!this.changeMarks.size) this.restartChanges()
      el.classList.remove(...Markloupe.CHANGE_CLASSES)
      if (!el.classList.length) el.removeAttribute('class')
      this.syncChangeCount()
    }

    /** 改動都看過了：以目前原文為新的比對基準 */
    restartChanges() {
      this.changeState = { base: this.raw, seen: Markloupe.noChanges() }
    }

    syncChangeCount() {
      const n = this.changeMarks.size
      const label = t('changesCount', String(n))
      this.changesBtn.hidden = !n
      this.changesBtn.title = t('changesCountTitle')
      this.changesBtn.setAttribute('aria-label', `${label}. ${t('changesCountTitle')}`)
      setTool(this.changesBtn, 'arrow-down', label)
      this.fitToolbar()
    }

    /** 跳到目前位置之後的下一處改動，到底後從頭開始；摺疊中的先展開 */
    nextChange() {
      const els = [...this.changeMarks.keys()]
        .filter(el => el.isConnected && !el.closest('tr[hidden]'))
        .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      if (!els.length) return
      const y = el => {
        // 摺疊中的元素沒有位置，改用遮住它的標題
        let block = el
        while (block.parentElement !== this.article) block = block.parentElement
        if (!block.dataset.mlFold) return el.getBoundingClientRect().top
        while (block?.dataset.mlFold) block = block.previousElementSibling
        return (block || el).getBoundingClientRect().top + 1
      }
      // 跳過去的元素會置中；捲不到中間（接近文件結尾）時，再按一次要換下一處
      let i = els.findIndex(el => y(el) > innerHeight / 2 + 1)
      if (i < 0) i = 0
      if (els[i] === this.lastChange?.el && Math.abs(y(els[i]) - this.lastChange.y) < 2) i = (i + 1) % els.length
      const target = els[i]
      Markloupe.revealElement(this.article, target)
      target.scrollIntoView({ block: 'center', behavior: 'instant' })
      this.lastChange = { el: target, y: y(target) }
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
      rs.setProperty('--ml-scale', String(s.fontSize / Markloupe.DEFAULTS.fontSize))
      rs.setProperty('--ml-line-height', String(s.lineHeight))
      const body = Markloupe.bodyFontStack(s.bodyFont)
      if (body) rs.setProperty('--ml-body-font', body)
      else rs.removeProperty('--ml-body-font')
      const dark = s.theme === 'dark' || (s.theme === 'auto' && this.darkQuery.matches)
      // 列印時一律淺色：紙張不印背景，深色主題的淺色文字印出來看不清楚
      document.documentElement.dataset.mlTheme = dark && !this.printing ? 'dark' : 'light'
      // 自訂配色以主題色加上使用者 CSS 為推算基準，所以先套用使用者 CSS
      this.applyCustomCss(s.customCss)
      this.applyPalette(Markloupe.PALETTES.includes(s.palette) ? s.palette : 'github')
      // 給下一次開檔的等待畫面用（early.js）；只寫本機檔案的儲存空間，網站讀不到
      if (location.protocol === 'file:') {
        try {
          localStorage.setItem('markloupe:theme', dark ? 'dark' : 'light')
        } catch {
          // 無法寫入時下次等待畫面跟隨系統
        }
      }
      if (this.themeBtn) {
        const [icon, name] = THEME_LABELS[s.theme] || THEME_LABELS.auto
        setTool(this.themeBtn, icon, t('toolTheme', t(name)))
      }
      if (this.fontBtn) setTool(this.fontBtn, 'text-size', t('toolFontSize', Markloupe.fontPercent(s.fontSize)))
      if (s.fontSize !== this.alignedFontSize) {
        this.alignedFontSize = s.fontSize
        // 程式碼區塊中英對齊（非同步，字型換好後瀏覽器會自動重排）；程式碼字級是 content.css 的內文 .85 倍
        Markloupe.alignCodeFont(s.fontSize * 0.85).then(info => {
          if (info) document.documentElement.dataset.mlCodeFont = JSON.stringify(info)
        })
      }
      return this.article ? Markloupe.rethemeMermaid(this.article) : Promise.resolve()
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
      root.classList.toggle('ml-focus', v.focus)
      root.classList.toggle('ml-code-wrap', this.settings.codeWrap)
      root.classList.toggle('ml-wide-blocks', this.settings.tableWidth !== 'text')
      setTool(this.widthBtn, 'width', t('toolWidth', Markloupe.widthLabel(v.textWidth)))
      this.tocBtn.classList.toggle('active', !v.tocHidden)
    }

    setView(patch) {
      Object.assign(this.view, patch)
      writeView(this.view)
      this.applyView()
    }

    /** 全域外觀設定（LIVE_KEYS）：本分頁立即套用，寫入後由 storage.onChanged 同步到其他分頁 */
    saveLive(patch) {
      Object.assign(this.settings, patch)
      this.applyLive()
      const keys = Object.keys(patch)
      for (const k of keys) this.liveWrites.set(k, (this.liveWrites.get(k) || 0) + 1)
      Markloupe.saveSettings(patch)
        .catch(() => {})
        .finally(() => {
          for (const k of keys) this.liveWrites.set(k, this.liveWrites.get(k) - 1)
          this.syncLive(keys)
        })
    }

    /** 寫入期間略過的通知可能來自其他頁面：這些鍵都寫完後，改以儲存的值為準 */
    async syncLive(keys) {
      if (keys.some(k => this.liveWrites.get(k)) || !Markloupe.alive()) return
      const epoch = this.liveEpoch
      const stored = await Markloupe.loadSettings().catch(() => null)
      if (epoch !== this.liveEpoch) return
      const changed = stored && keys.filter(k => !this.liveWrites.get(k) && stored[k] !== this.settings[k])
      if (!changed?.length) return
      for (const k of changed) this.settings[k] = stored[k]
      this.applyLive()
    }

    setTheme(theme) {
      if (!Markloupe.alive()) return this.onOrphaned()
      this.saveLive({ theme })
    }

    setFontSize(px) {
      if (!Markloupe.alive()) return this.onOrphaned()
      const fontSize = Math.min(Markloupe.FONT_MAX, Math.max(Markloupe.FONT_MIN, Math.round(px)))
      if (fontSize === this.settings.fontSize) return
      // 以目前閱讀位置為錨點：縮放後頁面高度改變，捲回同一個比例的位置
      const ratio = scrollY / Math.max(1, document.documentElement.scrollHeight)
      this.saveLive({ fontSize })
      scrollTo(0, ratio * document.documentElement.scrollHeight)
      this.onScroll()
    }

    stepFont(dir) {
      this.setFontSize(Markloupe.stepFontSize(this.settings.fontSize, dir))
    }

    /** 原文切行（Markloupe.splitLines），與 markdown-it 的行號一致 */
    lines() {
      if (this.linesFor !== this.raw) {
        this.linesCache = Markloupe.splitLines(this.raw)
        this.linesFor = this.raw
      }
      return this.linesCache
    }

    /**
     * 複製選單：內容（分享，Markdown 原文並附上 HTML 格式）或位置（給 AI，路徑與行號）
     * @param {HTMLElement} [heading] 只複製這一節；省略時為整份文件
     */
    copyMenu(anchor, heading) {
      Markloupe.openMenu({
        anchor,
        label: t('copyMenu'),
        items: [
          { label: t('copyContent'), icon: 'copy', fn: () => this.copyContent(heading) },
          { label: t('copyLocation'), icon: 'file', fn: () => this.copyLocation(heading) },
        ],
      })
    }

    /** 標題那一節的節點：標題與其後同一層的兄弟節點，到下一個同級或更高的標題為止 */
    sectionNodes(heading) {
      const level = +heading.dataset.mlLevel
      const nodes = [heading]
      for (let n = heading.nextElementSibling; n; n = n.nextElementSibling) {
        if (/^H[1-6]$/.test(n.tagName) && +n.dataset.mlLevel <= level) break
        nodes.push(n)
      }
      return nodes
    }

    async copyContent(heading) {
      let text = this.raw
      let nodes = Array.from(this.article.childNodes)
      if (heading) {
        const range = Markloupe.sectionRange(this.article, heading, this.lines())
        text = this.lines().slice(range[0], range[1]).join('').trimEnd() + '\n'
        nodes = this.sectionNodes(heading)
      }
      // 有剪貼簿 API 時圖表換成圖片；一般 http 網頁只能同步複製，等不了轉圖，維持原樣
      const canWait = !!navigator.clipboard?.write && typeof ClipboardItem === 'function'
      const ok = await Markloupe.copyRich(text, canWait ? Markloupe.clipboardHtml(nodes) : Markloupe.staticHtml(nodes))
      Markloupe.toast(t(ok ? 'mdCopied' : 'mdCopyFailed'))
    }

    async copyLocation(heading) {
      const text = heading
        ? Markloupe.formatLocation(Markloupe.sectionRange(this.article, heading, this.lines()), heading.dataset.mlText)
        : Markloupe.formatLocation()
      Markloupe.toast((await Markloupe.copyText(text)) ? t('locationCopied', text) : t('mdCopyFailed'))
    }

    /* ---------- 選取文字：複製對應的原文或位置 ---------- */
    bindSelection() {
      const btn = (key, kind) => h('button', { class: 'ml-select-btn', type: 'button', text: t(key), on: { click: () => this.copySelection(kind) } })
      this.sourceBtn = btn('selectCopySource', 'source')
      const bar = h('div', { class: 'ml-select-bar', attrs: { role: 'toolbar', 'aria-label': t('selectBar') } }, [this.sourceBtn, btn('selectCopyLocation', 'location')])
      bar.hidden = true
      // 按下按鈕不能清掉選取
      bar.addEventListener('mousedown', e => e.preventDefault())
      document.body.append(bar)
      this.selectBar = bar
      const show = () => {
        const sel = getSelection()
        const range = sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0) : null
        const raw = document.documentElement.classList.contains('ml-raw')
        const host = raw ? this.rawView : this.article
        if (!range || !host?.contains(range.commonAncestorContainer) || !sel.toString().trim()) return (bar.hidden = true)
        this.selRange = range.cloneRange()
        this.sourceBtn.hidden = raw // 原始文字模式選到的就是原文
        bar.hidden = false
        const rects = range.getClientRects()
        const r = rects[rects.length - 1] || range.getBoundingClientRect()
        const left = Math.max(8, Math.min(r.right - bar.offsetWidth, innerWidth - bar.offsetWidth - 8))
        bar.style.left = `${left + scrollX}px`
        bar.style.top = `${r.bottom + scrollY + 6}px`
      }
      document.addEventListener('mouseup', e => bar.contains(e.target) || setTimeout(show))
      document.addEventListener('keyup', e => (e.shiftKey || e.key === 'Shift') && show())
      document.addEventListener('selectionchange', () => getSelection().isCollapsed && (bar.hidden = true))
    }

    async copySelection(kind) {
      this.selectBar.hidden = true
      const range = this.selRange
      if (!range) return
      const r = document.documentElement.classList.contains('ml-raw') ? this.rawSelectionRange(range) : Markloupe.selectionRange(this.article, range, this.lines())
      if (!r) return Markloupe.toast(t('locationUnknown'))
      const text = kind === 'location' ? Markloupe.formatLocation(r) : this.lines().slice(r[0], r[1]).join('').trimEnd() + '\n'
      const ok = await Markloupe.copyText(text)
      if (!ok) return Markloupe.toast(t('mdCopyFailed'))
      Markloupe.toast(kind === 'location' ? t('locationCopied', text) : t('mdCopied'))
    }

    /** 以設定的編輯器開啟目前檔案；正在閱讀某個章節時跳到該標題所在行 */
    openInEditor() {
      const heading = this.toc.items[this.toc.activeIndex]?.heading
      const line = heading?.dataset.mlLine != null ? Number(heading.dataset.mlLine) + 1 : 1
      const url = Markloupe.editorUrl(this.settings, location.href, line)
      if (!url) return Markloupe.toast(t('editorInvalid'))
      this.editBtn.dataset.mlHref = url // 供測試確認
      // 自訂協定由瀏覽器詢問是否開啟外部程式，不會離開目前頁面
      const a = h('a', { href: url })
      a.click()
    }

    exportMenu() {
      Markloupe.openMenu({
        anchor: this.exportBtn,
        label: t('exportMenu'),
        items: [
          { label: t('exportEmbed'), icon: 'file', fn: () => this.exportHtml(true) },
          { label: t('exportLinked'), icon: 'download', fn: () => this.exportHtml(false) },
          { label: t('exportDocx'), icon: 'file', fn: () => this.exportDocx() },
        ],
      })
    }

    async exportDocx() {
      if (!Markloupe.alive()) return this.onOrphaned()
      this.exportBtn.disabled = true
      try {
        // 和列印一樣改用淺色：Mermaid 圖表以淺色重繪後再轉成圖片
        await this.setPrinting(true)
        const { name } = await Markloupe.exportDocx(this.article, await Markloupe.loadSettings())
        Markloupe.toast(t('exportDone', name))
      } catch (err) {
        Markloupe.toast(t('exportFailed', err.message))
      } finally {
        this.setPrinting(false)
        this.exportBtn.disabled = false
      }
    }

    async exportHtml(embed) {
      if (!Markloupe.alive()) return this.onOrphaned()
      this.exportBtn.disabled = true
      try {
        const { name, missed, needsWebAccess } = await Markloupe.exportHtml(this.article, { embed })
        if (!missed) Markloupe.toast(t('exportDone', name))
        else Markloupe.toast(`${t('exportMissed', name, missed)}${needsWebAccess ? t('exportNeedsWebAccess', t('optWebAccess')) : ''}`, [], 10000)
      } catch (err) {
        Markloupe.toast(t('exportFailed', err.message))
      } finally {
        this.exportBtn.disabled = false
      }
    }

    /**
     * 自訂配色依目前主題推算後放進自己的樣式表，Markloupe.paletteCss 供匯出檔沿用。
     * 推算要讀主題本身的語法標示與提示框色，所以先移除配色屬性再讀
     */
    applyPalette(palette) {
      const root = document.documentElement
      if (!this.paletteSheet) {
        this.paletteSheet = new CSSStyleSheet()
        document.adoptedStyleSheets = [this.paletteSheet, ...document.adoptedStyleSheets]
      }
      delete root.dataset.mlPalette
      Markloupe.paletteCss = ''
      if (palette === 'custom') {
        const css = getComputedStyle(root)
        const base = Object.fromEntries(Markloupe.CUSTOM_BASE_VARS.map(n => [n, css.getPropertyValue(n).trim()]))
        const colors = Markloupe.customColorsFor(this.previewColors || this.settings.customColors, root.dataset.mlTheme)
        Markloupe.paletteCss = Markloupe.customPaletteCss(Markloupe.customPaletteVars(colors, base))
      }
      this.paletteSheet.replaceSync(Markloupe.paletteCss)
      if (palette !== 'github') root.dataset.mlPalette = palette
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
        await Markloupe.loadImages(this.article)
        window.print() // 對話框關閉後才返回；afterprint 會還原主題
      } finally {
        this.setPrinting(false)
        this.printBtn.disabled = false
      }
    }

    cycleWidth() {
      this.setWidth(Markloupe.nextOf(Markloupe.WIDTH_PRESETS, this.view.textWidth))
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
      this.syncRawView()
      scrollTo(0, 0)
    }

    /** 原始文字模式才建立逐行的畫面（大檔有數萬行）；原文變了就重建 */
    syncRawView() {
      if (!document.documentElement.classList.contains('ml-raw') || this.rawViewFor === this.raw) return
      const lines = this.lines()
      const frag = document.createDocumentFragment()
      lines.forEach((line, i) => {
        // 換行字元統一為 \n：單獨的 \r 在畫面上不會換行
        const el = h('div', { class: 'ml-src-line', text: line.replace(/\r\n?$/, '\n') })
        el.dataset.n = i + 1
        frag.append(el)
      })
      this.rawView.replaceChildren(frag)
      this.rawView.style.setProperty('--ml-gutter', `${String(lines.length).length}ch`)
      this.rawView.title = t('rawLineTitle')
      this.rawViewFor = this.raw
    }

    /** 點行號（每行左側的留白）複製該行的位置 */
    async onRawClick(e) {
      const line = e.target.closest?.('.ml-src-line')
      if (!line || !getSelection().isCollapsed) return
      if (e.clientX - line.getBoundingClientRect().left > parseFloat(getComputedStyle(line).paddingLeft)) return
      const n = +line.dataset.n - 1
      const text = Markloupe.formatLocation([n, n + 1])
      Markloupe.toast((await Markloupe.copyText(text)) ? t('locationCopied', text) : t('mdCopyFailed'))
    }

    rawSelectionRange(range) {
      const lineOf = node => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('.ml-src-line')
      const { startContainer: sc, startOffset: so, endContainer: ec, endOffset: eo } = range
      const a = sc === this.rawView ? this.rawView.children[so] : lineOf(sc)
      let b = ec === this.rawView ? this.rawView.children[eo - 1] : lineOf(ec)
      // 選到下一行的開頭時，那一行不算
      if (b && b !== a && ec !== this.rawView && eo === 0) b = b.previousElementSibling
      if (!a || !b) return null
      return [+a.dataset.n - 1, +b.dataset.n]
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
      Markloupe.revealElement(this.article, el)
      el.scrollIntoView({ block: 'start' })
      this.toc.setTarget(el)
    }

    posKey() {
      return location.href.split('#')[0]
    }

    async persistScroll() {
      if (document.documentElement.classList.contains('ml-raw')) return
      if (!Markloupe.alive()) return this.onOrphaned()
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
      if (Markloupe.networkFile) return 'taskReadonlyNetwork'
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
        if (box.dataset.mlReadonly) return Markloupe.toast(t(box.dataset.mlReadonly))
        this.toggleTask(Number(box.dataset.mlLine))
      })
    }

    async toggleTask(line) {
      const box = this.article.querySelector(`input.ml-task-box[data-ml-line="${line}"]`)
      if (!box || this.taskBusy) return
      if (!Markloupe.alive()) return this.onOrphaned()
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
          hash: await Markloupe.sha256(this.raw),
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
          this.syncRawView()
          // 自己寫回的勾選不算改動
          if (this.changeMarks.size) this.changeState.seen.lines.add(line)
          else this.restartChanges()
          box.checked = to === 'x'
          box.dataset.mlState = to
          this.toc.syncTasks()
          Markloupe.toast(t(to === 'x' ? 'taskChecked' : 'taskUnchecked'), [{ label: t('undo'), fn: () => this.toggleTask(line) }])
          break
        }
        case 'no-root':
          Markloupe.toast(t('taskNoRoot'), [{ label: t('authorizeFolder'), fn: openGrant }], 8000)
          break
        case 'permission':
          Markloupe.toast(t('taskPermission', res.root), [{ label: t('goConfirm'), fn: openGrant }], 8000)
          break
        case 'conflict':
          // 讀到空檔案可能是編輯器寫入中途：不重繪，交給自動更新等內容穩定
          if (res.text !== '' || this.raw === '') this.update(res.text)
          Markloupe.toast(t('taskConflict'))
          break
        case 'not-utf8':
          Markloupe.toast(t('taskNotUtf8'))
          break
        case 'ambiguous':
          Markloupe.toast(t('taskAmbiguous'), [{ label: t('authorizeFolder'), fn: openGrant }], 8000)
          break
        default:
          Markloupe.toast(t('taskError', res?.error || t('unknownError')))
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
      if (mode === 'off' || (mode === 'local' && location.protocol !== 'file:') || Markloupe.networkFile) return
      const tick = async () => {
        if (!Markloupe.alive()) return this.onOrphaned()
        if (!document.hidden) {
          let src = await Markloupe.fetchSource({ ifChanged: true })
          // 背景程式記住空內容後只回傳 UNCHANGED：仍在等空內容持續時，視為又讀到空的
          if (src === Markloupe.UNCHANGED) src = this.emptySince ? '' : this.raw
          else if (typeof src === 'string' && src !== this.raw && location.protocol === 'file:') src = await settledSource(src)
          if (typeof src !== 'string') {
            // 讀取失敗：維持目前畫面
          } else if (src === '' && this.raw !== '') {
            // 編輯器先清空再寫入：空內容持續 2 秒才套用，期間保留目前畫面
            this.emptySince ||= Date.now()
            if (Date.now() - this.emptySince >= 2000) {
              this.emptySince = 0
              this.update('')
            }
          } else {
            this.emptySince = 0
            if (src !== this.raw) this.update(src)
          }
        }
        this.refreshTimer = setTimeout(tick, Math.max(300, this.settings.refreshInterval))
      }
      this.refreshTimer = setTimeout(tick, this.settings.refreshInterval)
    }
  }

  /**
   * 本機檔案寫入中途可能讀到寫到一半的內容：每隔 100ms 再讀，內容不再變動才採用。
   * 最多再讀 5 次，之後採用最後讀到的內容；再讀失敗時採用目前的內容，背景程式已記住它，之後只會回傳 UNCHANGED
   */
  async function settledSource(src) {
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 100))
      const again = await Markloupe.fetchSource({ ifChanged: true })
      if (again === Markloupe.UNCHANGED || again === src || again == null) break
      src = again
    }
    return src
  }

  /** 不接管這一頁：取消 content.css 載入期間對原始文字的隱藏，並立刻結束換頁轉場 */
  function reveal() {
    document.documentElement.classList.add('ml-off')
    Markloupe.revealPage?.()
  }

  async function boot() {
    const pre = sourcePre()
    if (!pre) return reveal()
    const settings = await Markloupe.loadSettings()
    if (!settings.enabled) {
      reveal()
      // 停用時仍監聽設定，重新啟用後重新整理頁面
      chrome.storage.onChanged.addListener(c => {
        if (c[Markloupe.SETTINGS_KEY]?.newValue?.enabled) location.reload()
      })
      // 讀取設定到掛上監聽之間若剛好被重新啟用，會漏掉通知：再確認一次
      if ((await Markloupe.loadSettings()).enabled) location.reload()
      return
    }
    let raw = pre.textContent
    let exact = false
    if (location.protocol === 'file:' && !Markloupe.networkFile) {
      // 以 UTF-8 重新讀取，修正瀏覽器猜錯編碼的情況
      const text = await Markloupe.fetchSource()
      if (text != null) {
        raw = text
        exact = true
        pre.textContent = text
      }
    }
    await Markloupe.initI18n(settings.uiLang)
    Markloupe.app = new App(settings, pre, raw, exact)
    Markloupe.app.mount()
    // 排版完成：結束換頁轉場，從舊畫面直接換成新頁
    Markloupe.revealPage?.()
  }

  boot().catch(err => {
    reveal()
    console.error('[Markloupe]', err)
  })
})()
