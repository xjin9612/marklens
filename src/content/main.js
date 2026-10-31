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
  const THEME_LABELS = { auto: ['◐', 'themeAuto'], light: ['☀', 'themeLight'], dark: ['☾', 'themeDark'] }

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

  /* ---------- 分頁狀態：只影響目前分頁，重新整理後保留，關閉分頁即清除 ---------- */
  function readView() {
    try {
      return JSON.parse(sessionStorage.getItem(VIEW_KEY)) || {}
    } catch {
      return {}
    }
  }
  function writeView(view) {
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

      this.saveScroll = MarkLens.debounce(() => this.persistScroll(), 400)
      addEventListener('scroll', MarkLens.rafThrottle(() => this.onScroll()), { passive: true })
      addEventListener('resize', MarkLens.rafThrottle(() => this.onScroll()))
      addEventListener('hashchange', () => this.scrollToHash())
      addEventListener('keydown', e => this.onKey(e))
      this.darkQuery.addEventListener('change', () => this.applyLive())

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
        if (msg?.type === 'command') this.runCommand(msg.name)
        reply({ ok: true })
      })

      if (location.hash) this.scrollToHash()
      else if (this.settings.rememberScroll) this.restoreScroll()
    }

    /* ---------- 工具列 ---------- */
    buildToolbar() {
      const btn = (cls, text, title, fn) => h('button', { class: `ml-tool ${cls}`, text, title, on: { click: fn } })
      this.tocBtn = btn('ml-tool-toc', t('toolToc'), t('toolTocTitle'), () => this.toggleToc())
      this.widthBtn = btn('ml-tool-width', '', t('toolWidthTitle'), () => this.cycleWidth())
      this.themeBtn = btn('ml-tool-theme', '', t('toolThemeTitle'), () => this.cycleTheme())
      this.exportBtn = btn('ml-tool-export', '', t('toolExportTitle'), () => this.exportHtml())
      // 窄螢幕只顯示圖示（文字部分由 CSS 隱藏）
      this.exportBtn.append('⤓', h('span', { class: 'ml-tool-label', text: t('toolExport') }))
      this.rawBtn = btn('ml-tool-raw', t('toolRaw'), t('toolRawTitle'), () => this.toggleRaw())
      this.topBtn = btn('ml-tool-top', t('toolTop'), t('toolTopTitle'), () => scrollTo({ top: 0 }))
      return h('div', { class: 'ml-toolbar', attrs: { role: 'toolbar' } }, [
        this.tocBtn,
        h('span', { class: 'ml-spacer' }),
        h('span', { class: 'ml-reading-only' }, [
          btn('', t('toolFoldAll'), t('toolFoldAllTitle'), () => MarkLens.foldAll(this.article)),
          btn('', t('toolUnfoldAll'), t('toolUnfoldAllTitle'), () => MarkLens.unfoldAll(this.article)),
          this.widthBtn,
          this.exportBtn,
        ]),
        this.themeBtn,
        this.rawBtn,
        this.topBtn,
      ])
    }

    runCommand(name) {
      switch (name) {
        case 'toggle-toc':
          return this.toggleToc()
        case 'cycle-width':
          return this.cycleWidth()
        case 'cycle-theme':
          return this.cycleTheme()
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
      const map = { t: 'toggle-toc', r: 'toggle-raw', w: 'cycle-width', d: 'cycle-theme', '[': 'fold-all', ']': 'unfold-all' }
      const name = map[e.key]
      if (!name) return
      e.preventDefault()
      this.runCommand(name)
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

      const headings = MarkLens.processHeadings(this.article)
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
    /** 即時同步的外觀設定 */
    applyLive() {
      const s = this.settings
      const rs = document.documentElement.style
      rs.setProperty('--ml-font-size', `${s.fontSize}px`)
      rs.setProperty('--ml-line-height', String(s.lineHeight))
      const dark = s.theme === 'dark' || (s.theme === 'auto' && this.darkQuery.matches)
      document.documentElement.dataset.mlTheme = dark ? 'dark' : 'light'
      if (this.themeBtn) {
        // 窄螢幕只顯示圖示（文字部分由 CSS 隱藏）
        const [icon, name] = THEME_LABELS[s.theme] || THEME_LABELS.auto
        this.themeBtn.replaceChildren(icon, h('span', { class: 'ml-tool-label', text: t('toolTheme', t(name)) }))
      }
      if (this.article) MarkLens.rethemeMermaid(this.article)
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
      this.widthBtn.textContent = t('toolWidth', MarkLens.widthLabel(v.textWidth))
      this.tocBtn.classList.toggle('active', !v.tocHidden)
    }

    setView(patch) {
      Object.assign(this.view, patch)
      writeView(this.view)
      this.applyView()
    }

    /** 主題是全域設定：寫入後由 storage.onChanged 同步套用到所有分頁（含本分頁） */
    cycleTheme() {
      if (!MarkLens.alive()) return
      MarkLens.saveSettings({ theme: MarkLens.nextOf(MarkLens.THEME_ORDER, this.settings.theme) }).catch(() => {})
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

    cycleWidth() {
      this.setView({ textWidth: MarkLens.nextOf(MarkLens.WIDTH_PRESETS, this.view.textWidth) })
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
      this.rawBtn.textContent = t(on ? 'toolBack' : 'toolRaw')
      this.rawBtn.classList.toggle('active', on)
      scrollTo(0, 0)
    }

    /* ---------- 捲動 ---------- */
    onScroll() {
      const max = document.documentElement.scrollHeight - innerHeight
      this.progress.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`
      this.topBtn.hidden = scrollY < 600
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
    canWriteTasks() {
      return this.settings.taskWrite && location.protocol === 'file:' && this.rawExact
    }

    /** 有原文行號的勾選框改為可點擊 */
    enableTaskBoxes() {
      if (!this.canWriteTasks()) return
      for (const box of this.article.querySelectorAll('input.ml-task-box[data-ml-line]')) {
        box.disabled = false
        box.title = t('taskTitle')
      }
    }

    bindTaskClicks() {
      this.article.addEventListener('click', e => {
        const box = e.target.closest?.('input.ml-task-box[data-ml-line]')
        if (!box || box.disabled) return
        // 先維持原狀，等寫回成功才改變勾選狀態
        e.preventDefault()
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
      if (mode === 'off' || (mode === 'local' && location.protocol !== 'file:')) return
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

  async function boot() {
    const pre = sourcePre()
    if (!pre) return
    const settings = await MarkLens.loadSettings()
    if (!settings.enabled) {
      // 停用時仍監聽設定，重新啟用後重新整理頁面
      chrome.storage.onChanged.addListener(c => {
        if (c[MarkLens.SETTINGS_KEY]?.newValue?.enabled) location.reload()
      })
      return
    }
    let raw = pre.textContent
    let exact = false
    if (location.protocol === 'file:') {
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
  }

  boot().catch(err => console.error('[MarkLens]', err))
})()
