'use strict'
// 側邊目錄：層級過濾、文字搜尋、目前章節高亮、摺疊標記、拖拉寬度
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

;(() => {
  const { h, t } = MarkLens

  MarkLens.Toc = class {
    constructor(app) {
      this.app = app
      this.items = [] // { heading, li, level, text }
      this.activeIndex = -1
      this.hovering = false

      this.stats = h('div', { class: 'ml-toc-stats' })
      this.search = h('input', {
        class: 'ml-toc-search',
        type: 'search',
        placeholder: t('tocSearch'),
        on: { input: () => this.applyFilter() },
      })
      const closeBtn = h('button', {
        class: 'ml-btn ml-toc-close',
        text: '«',
        title: t('tocCloseTitle'),
        on: { click: () => this.app.toggleToc() },
      })
      this.list = h('ul', { class: 'ml-toc-list' })
      this.resizer = h('div', { class: 'ml-toc-resizer', title: t('tocResizeTitle') })
      this.el = h('aside', { class: 'ml-toc', attrs: { 'aria-label': t('tocLabel') } }, [
        h('div', { class: 'ml-toc-head' }, [h('div', { class: 'ml-toc-row' }, [this.search, closeBtn]), this.stats]),
        h('nav', { class: 'ml-toc-nav' }, [this.list]),
        this.resizer,
      ])
      this.el.addEventListener('mouseenter', () => (this.hovering = true))
      this.el.addEventListener('mouseleave', () => (this.hovering = false))
      this.list.addEventListener('click', e => this.onClick(e))
      this.bindResize()
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

    /** 摺疊標記：被摺疊的標題加 ▸，被收在摺疊段落裡的標題變淡 */
    syncFold() {
      for (const it of this.items) {
        it.li.classList.toggle('ml-toc-folded', it.heading.classList.contains('ml-folded'))
        it.li.classList.toggle('ml-toc-inside-fold', !!it.heading.dataset.mlFold)
      }
      // 未被摺疊隱藏的標題，供 update() 二分搜尋
      this.visible = this.items.filter(it => !it.heading.dataset.mlFold)
    }

    setStats({ chars, minutes }) {
      this.stats.textContent = t('tocStats', chars.toLocaleString(), minutes)
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
      if (this.app.isNarrow()) this.app.setTocOpen(false)
    }

    /**
     * 捲動時高亮目前章節：取最後一個頂端已越過工具列下緣的標題
     * 標題依文件順序排列、位置遞增，用二分搜尋只量少數幾個標題的位置，大檔捲動時才不會卡頓
     */
    update() {
      const list = this.visible
      let lo = 0
      let hi = list.length - 1
      let found = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (list[mid].heading.getBoundingClientRect().top <= 90) {
          found = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
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
          document.documentElement.classList.remove('ml-dragging')
          // 同時記成新分頁的預設值（不影響已開的分頁）
          if (MarkLens.alive()) MarkLens.saveSettings({ tocWidth: width }).catch(() => {})
        }
        this.resizer.addEventListener('pointermove', move)
        this.resizer.addEventListener('pointerup', up)
      })
    }
  }
})()
