'use strict'
// 側邊欄：「目錄｜檔案」兩個分頁、搜尋、目前章節高亮、摺疊標記、拖拉寬度
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

;(() => {
  const { h, t, icon } = MarkLens

  MarkLens.Toc = class {
    constructor(app) {
      this.app = app
      this.items = [] // { heading, li, level, text }
      this.activeIndex = -1
      this.target = null // 從目錄或網址 #… 跳到的標題，見 update()
      this.hovering = false
      this.tab = 'toc'
      this.statsText = ''

      // 標題列：選單 ｜ 目錄 檔案 ｜ 搜尋；搜尋時分頁標籤換成搜尋框
      const menu = h(
        'button',
        { class: 'ml-tool ml-side-menu', title: t('toolTocTitle'), attrs: { 'aria-label': t('toggleSidebar') }, on: { click: () => this.app.toggleToc() } },
        [icon('menu')],
      )
      this.tabToc = h('button', { class: 'ml-side-tab', text: t('tabToc'), on: { click: () => this.setTab('toc') } })
      this.tabFiles = h('button', { class: 'ml-side-tab', text: t('tabFiles'), on: { click: () => this.setTab('files') } })
      // 兩顆切換鈕（aria-pressed），不宣告 tablist：分頁標籤需要方向鍵操作，這裡用一般 Tab 鍵就夠
      this.tabs = h('div', { class: 'ml-side-tabs' }, [this.tabToc, this.tabFiles])
      this.searchBtn = h(
        'button',
        { class: 'ml-tool ml-side-icon', title: t('searchTitle'), attrs: { 'aria-label': t('searchTitle') }, on: { click: () => this.openSearch() } },
        [icon('search')],
      )
      this.search = h('input', {
        class: 'ml-toc-search',
        type: 'search',
        attrs: { 'aria-label': t('searchTitle') },
        on: {
          input: () => this.applyQuery(),
          keydown: e => {
            if (e.key === 'Escape') {
              e.preventDefault()
              this.closeSearch()
            }
          },
        },
      })
      const closeSearch = h(
        'button',
        { class: 'ml-side-search-close', title: t('searchClose'), attrs: { 'aria-label': t('searchClose') }, on: { click: () => this.closeSearch() } },
        [icon('close')],
      )
      this.searchBox = h('label', { class: 'ml-side-search', hidden: true }, [icon('search'), this.search, closeSearch])

      this.stats = h('div', { class: 'ml-toc-stats' })
      this.list = h('ul', { class: 'ml-toc-list' })
      this.tocNav = h('nav', { class: 'ml-toc-nav' }, [this.list])
      this.resizer = h('div', { class: 'ml-toc-resizer', title: t('tocResizeTitle') })
      this.el = h('aside', { class: 'ml-toc', attrs: { 'aria-label': t('tocLabel') } }, [
        h('div', { class: 'ml-toc-head' }, [menu, this.tabs, this.searchBox, this.searchBtn]),
        this.stats,
        this.tocNav,
        this.resizer,
      ])

      // 「檔案」分頁只有本機檔案才有（網路上的資料夾無法列出內容）
      if (location.protocol === 'file:') {
        this.files = new MarkLens.FileTree({
          root: app.view.filesRoot,
          open: app.view.filesOpen,
          onChange: ({ root, open }) => app.setView({ filesRoot: root, filesOpen: open }),
        })
        this.el.insertBefore(this.files.el, this.resizer)
      } else {
        this.tabs.hidden = true
      }
      this.setTab(this.files && app.view.sideTab === 'files' ? 'files' : 'toc', false)

      this.el.addEventListener('mouseenter', () => (this.hovering = true))
      this.el.addEventListener('mouseleave', () => (this.hovering = false))
      this.list.addEventListener('click', e => this.onClick(e))
      this.bindTargetRelease()
      this.bindResize()
    }

    /** 切換「目錄｜檔案」分頁；檔案清單第一次切到時才讀取 */
    setTab(tab, save = true) {
      if (tab === 'files' && !this.files) tab = 'toc'
      this.tab = tab
      this.tabToc.classList.toggle('active', tab === 'toc')
      this.tabFiles.classList.toggle('active', tab === 'files')
      this.tabToc.setAttribute('aria-pressed', String(tab === 'toc'))
      this.tabFiles.setAttribute('aria-pressed', String(tab === 'files'))
      this.tocNav.hidden = tab !== 'toc'
      if (this.files) this.files.el.hidden = tab !== 'files'
      this.search.placeholder = t(tab === 'files' ? 'filesSearch' : 'tocSearch')
      if (tab === 'files' && !this.filesStarted) {
        this.filesStarted = true
        this.files.init()
      }
      this.applyQuery()
      if (save) this.app.setView({ sideTab: tab })
    }

    openSearch() {
      if (this.app.view.tocHidden && !this.app.isNarrow()) this.app.setView({ tocHidden: false })
      if (this.app.isNarrow()) this.app.setTocOpen(true)
      this.tabs.hidden = true
      this.searchBtn.hidden = true
      this.searchBox.hidden = false
      this.search.focus()
    }

    closeSearch() {
      this.search.value = ''
      this.searchBox.hidden = true
      this.searchBtn.hidden = false
      this.tabs.hidden = !this.files
      this.applyQuery()
    }

    /** 依目前分頁套用搜尋字串 */
    applyQuery() {
      if (this.tab === 'files') this.files.setQuery(this.search.value)
      else this.applyFilter()
      this.syncStats()
    }

    syncStats() {
      // 檔案分頁的摘要顯示在分頁自己的頂端（含「↑ 上一層」）
      this.stats.textContent = this.tab === 'files' ? '' : this.statsText
    }

    build(headings, depth) {
      this.depth = depth
      this.list.textContent = ''
      const minLevel = Math.min(6, ...headings.map(el => +el.dataset.mlLevel))
      this.items = headings.map(heading => {
        const level = +heading.dataset.mlLevel
        const text = heading.dataset.mlText
        const a = h('a', { href: `#${encodeURIComponent(heading.id)}`, text, title: text })
        const li = h('li', { class: `ml-toc-l${level - minLevel + 1}` }, [a])
        this.list.append(li)
        return { heading, li, level, text: text.toLowerCase() }
      })
      this.activeIndex = -1
      this.applyFilter()
      this.syncFold()
      // 延到下一個畫面再量位置，避免在建立目錄時強制整頁排版
      requestAnimationFrame(() => this.update())
    }

    applyFilter() {
      const q = this.search.value.trim().toLowerCase()
      for (const it of this.items) {
        // 搜尋時忽略層級限制
        it.li.hidden = q ? !it.text.includes(q) : it.level > this.depth
      }
    }

    /** 摺疊標記：被摺疊的標題前加小箭頭（CSS），被收在摺疊段落裡的標題變淡 */
    syncFold() {
      for (const it of this.items) {
        it.li.classList.toggle('ml-toc-folded', it.heading.classList.contains('ml-folded'))
        it.li.classList.toggle('ml-toc-inside-fold', !!it.heading.dataset.mlFold)
      }
      // 未被摺疊隱藏的標題，供 update() 二分搜尋
      this.visible = this.items.filter(it => !it.heading.dataset.mlFold)
    }

    setStats({ chars, minutes }) {
      this.statsText = t('tocStats', chars.toLocaleString(), minutes)
      this.syncStats()
    }

    onClick(e) {
      const a = e.target.closest('a')
      if (!a) return
      e.preventDefault()
      const it = this.items.find(x => x.li.contains(a))
      if (!it) return
      MarkLens.revealElement(this.app.article, it.heading)
      // 點被摺疊的標題本身：順便展開它
      if (it.heading.classList.contains('ml-folded')) MarkLens.toggleFold(it.heading, false)
      it.heading.scrollIntoView({ block: 'start' })
      history.replaceState(null, '', `#${encodeURIComponent(it.heading.id)}`)
      this.setTarget(it.heading)
      if (this.app.isNarrow()) this.app.setTocOpen(false)
    }

    /**
     * 記住剛跳到的標題（不是目錄中的標題時清除），之後使用者自己捲動、點擊或按鍵就放掉
     * 頁尾的短章節捲不到頂端，只靠位置判斷會一直標示前面的章節
     */
    setTarget(el) {
      this.target = this.items.some(it => it.heading === el) ? el : null
      this.update()
    }

    /** 使用者自己操作捲動時放掉跳轉目標 */
    bindTargetRelease() {
      const release = () => {
        this.target = null
      }
      for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown']) addEventListener(type, release, { passive: true, capture: true })
    }

    /** visible 中最後一個頂端在 y 以上的標題（二分搜尋：標題依文件順序排列、位置遞增，只量少數幾個標題） */
    lastAbove(y) {
      const list = this.visible
      let lo = 0
      let hi = list.length - 1
      let found = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (list[mid].heading.getBoundingClientRect().top <= y) {
          found = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      return found
    }

    /**
     * 捲動時高亮目前章節，依序：
     * 1. 剛跳到的標題仍在畫面內：標示它
     * 2. 已捲到底：標示畫面內最後一個標題（頁尾的短章節永遠到不了頂端）
     * 3. 其餘：最後一個頂端已越過工具列下緣的標題
     */
    update() {
      const list = this.visible
      let found = -1
      const target = this.target ? list.findIndex(it => it.heading === this.target) : -1
      if (target >= 0) {
        const r = this.target.getBoundingClientRect()
        if (r.bottom > 0 && r.top < innerHeight) found = target
      }
      if (found < 0) {
        const atBottom = scrollY + innerHeight >= document.documentElement.scrollHeight - 2
        found = this.lastAbove(atBottom ? innerHeight : 90)
      }
      const idx = found < 0 ? -1 : this.items.indexOf(list[found])
      if (idx === this.activeIndex) return
      this.items[this.activeIndex]?.li.classList.remove('active')
      this.activeIndex = idx
      const cur = this.items[idx]
      if (!cur) return
      cur.li.classList.add('active')
      // 滑鼠在目錄上時不要自動捲動目錄，避免干擾操作
      if (!this.hovering && !cur.li.hidden) cur.li.scrollIntoView({ block: 'nearest' })
    }

    bindResize() {
      this.resizer.addEventListener('pointerdown', e => {
        e.preventDefault()
        this.resizer.setPointerCapture(e.pointerId)
        document.documentElement.classList.add('ml-dragging')
        let width = this.el.getBoundingClientRect().width
        const move = ev => {
          width = Math.round(Math.min(600, Math.max(160, ev.clientX)))
          this.app.setView({ tocWidth: width })
        }
        const up = () => {
          this.resizer.removeEventListener('pointermove', move)
          this.resizer.removeEventListener('pointerup', up)
          this.resizer.removeEventListener('pointercancel', up)
          document.documentElement.classList.remove('ml-dragging')
          // 同時記成新分頁的預設值（不影響已開的分頁）
          if (MarkLens.alive()) MarkLens.saveSettings({ tocWidth: width }).catch(() => {})
        }
        this.resizer.addEventListener('pointermove', move)
        this.resizer.addEventListener('pointerup', up)
        // 拖拉被系統中斷（例如切換視窗）時一樣要收尾，否則會一直停在拖拉狀態
        this.resizer.addEventListener('pointercancel', up)
      })
    }
  }
})()
