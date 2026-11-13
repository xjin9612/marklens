'use strict'
// Mermaid 圖表：頁面有 mermaid 區塊時才動態載入程式庫（約 5MB），沒有就完全不載入
var Markloupe = globalThis.Markloupe || (globalThis.Markloupe = {})

;(() => {
  const { h, t } = Markloupe
  const ENTRY = 'vendor/mermaid/mermaid.mjs'
  const CACHE_LIMIT = 50

  let loading = null // 載入中／已載入的 Promise
  let seq = 0 // mermaid.render 需要唯一 id
  let queue = Promise.resolve() // mermaid 不支援同時繪製多張，一律排隊
  const cache = new Map() // `${theme}\n${code}` → svg 字串；自動更新重繪時直接沿用，不閃爍

  /** 主題加配色：配色改變時圖表也要重繪（顏色取自設計變數）；自訂配色另加三色，改色時也重繪 */
  function themeNow() {
    const root = document.documentElement
    const base = root.dataset.mlTheme === 'dark' ? 'dark' : 'default'
    const palette = root.dataset.mlPalette
    if (palette !== 'custom') return palette ? `${base}-${palette}` : base
    const css = getComputedStyle(root)
    const colors = ['--bg', '--fg', '--accent'].map(n => css.getPropertyValue(n).trim().slice(1))
    return `${base}-custom-${colors.join('-')}`
  }

  /**
   * 圖表配色取自目前主題的設計變數（shared/tokens.css），不用 mermaid 內建的 default／dark：
   * 節點是頁面底色的卡片、細框線，連線與標籤用次要文字色；
   * 圓餅圖、甘特圖、時間軸等需要多種顏色的圖，依序使用提示框的五種語意色與兩個語法標示色
   */
  function themeVariables(theme) {
    const css = getComputedStyle(document.documentElement)
    const v = name => css.getPropertyValue(name).trim()
    const dark = theme.startsWith('dark')
    const palette = ['--alert-note', '--ok', '--warn', '--alert-important', '--danger', '--hl-builtin', '--hl-meta', '--muted'].map(v)
    const onPalette = dark ? v('--bg') : '#ffffff'
    const vars = {
      darkMode: dark,
      background: v('--code-bg'),
      fontSize: '14px',
      primaryColor: v('--bg'),
      primaryTextColor: v('--fg'),
      primaryBorderColor: v('--border'),
      secondaryColor: v('--subtle'),
      tertiaryColor: v('--hover'),
      lineColor: v('--muted'),
      textColor: v('--fg'),
      edgeLabelBackground: v('--code-bg'),
      clusterBkg: v('--subtle'),
      clusterBorder: v('--border'),
      noteBkgColor: v('--accent-soft'),
      noteTextColor: v('--fg'),
      noteBorderColor: v('--accent'),
      pieSectionTextColor: onPalette,
      pieStrokeColor: v('--code-bg'),
      pieOuterStrokeColor: v('--border'),
      pieTitleTextColor: v('--fg'),
      pieLegendTextColor: v('--fg'),
      // 甘特圖：進行中用強調色，完成用次要文字色，關鍵任務與今天線用警示紅
      taskBkgColor: v('--accent'),
      taskBorderColor: v('--accent'),
      taskTextColor: onPalette,
      taskTextOutsideColor: v('--fg'),
      taskTextDarkColor: v('--fg'),
      activeTaskBkgColor: v('--accent-soft'),
      activeTaskBorderColor: v('--accent'),
      doneTaskBkgColor: v('--border'),
      doneTaskBorderColor: v('--border'),
      critBkgColor: v('--danger'),
      critBorderColor: v('--danger'),
      sectionBkgColor: v('--subtle'),
      altSectionBkgColor: v('--code-bg'),
      sectionBkgColor2: v('--subtle'),
      gridColor: v('--border-soft'),
      todayLineColor: v('--danger'),
    }
    palette.forEach((c, i) => {
      vars[`pie${i + 1}`] = c
      vars[`git${i}`] = c
      vars[`gitBranchLabel${i}`] = onPalette
      vars[`cScale${i}`] = c
      vars[`cScaleLabel${i}`] = onPalette
    })
    return vars
  }

  function remember(key, svg) {
    cache.delete(key)
    cache.set(key, svg)
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value)
  }

  function load() {
    loading ??= import(chrome.runtime.getURL(ENTRY)).then(m => {
      document.documentElement.dataset.mlMermaid = 'loaded'
      return m.default
    })
    return loading
  }

  /**
   * 全螢幕檢視：滾輪以游標為中心縮放、拖曳平移、雙擊或「重設」回到原大小，Esc 離開
   * 縮放與位移存在 wrap 的 CSS 變數上，主題切換重繪 SVG 後仍然保留
   */
  const ZOOM_MIN = 0.25
  const ZOOM_MAX = 8

  function fullscreenControls(wrap) {
    const view = () => wrap.querySelector('.ml-mermaid-view')
    let zoom = 1
    let x = 0
    let y = 0
    const apply = () => {
      wrap.style.setProperty('--ml-zoom', String(zoom))
      wrap.style.setProperty('--ml-pan-x', `${x}px`)
      wrap.style.setProperty('--ml-pan-y', `${y}px`)
    }
    /** 以畫面上的 (cx, cy) 為中心縮放到 next 倍 */
    const zoomAt = (next, cx, cy) => {
      next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
      const c = svgCenter()
      const px = cx - c.x
      const py = cy - c.y
      x = px - ((px - x) * next) / zoom
      y = py - ((py - y) * next) / zoom
      zoom = next
      apply()
    }
    /** 未變形時 SVG 的中心：以自身中心縮放時中心只受位移影響，扣掉位移即可 */
    const svgCenter = () => {
      const r = view().querySelector('svg').getBoundingClientRect()
      return { x: r.left + r.width / 2 - x, y: r.top + r.height / 2 - y }
    }
    const zoomCenter = factor => {
      const c = svgCenter()
      zoomAt(zoom * factor, c.x, c.y)
    }
    const reset = () => {
      zoom = 1
      x = 0
      y = 0
      apply()
    }
    const btn = (cls, text, title, fn) => h('button', { class: `ml-btn ${cls}`, text, title, on: { click: fn } })
    const zoomBtns = [
      btn('ml-mermaid-zoom', '+', t('zoomIn'), () => zoomCenter(1.25)),
      btn('ml-mermaid-zoom', '−', t('zoomOut'), () => zoomCenter(0.8)),
      btn('ml-mermaid-zoom', t('zoomReset'), t('zoomReset'), reset),
    ]
    const fullBtn = btn('ml-mermaid-full-btn', t('tableFullscreen'), t('mermaidFullscreenTitle'), () => toggle())
    const toggle = force => {
      const on = wrap.classList.toggle('ml-mermaid-full', typeof force === 'boolean' ? force : undefined)
      fullBtn.textContent = t(on ? 'tableExitFullscreen' : 'tableFullscreen')
      document.documentElement.classList.toggle('ml-noscroll', on)
      reset()
      if (!on) fullBtn.focus()
    }
    wrap.addEventListener('keydown', e => {
      if (e.key === 'Escape' && wrap.classList.contains('ml-mermaid-full')) toggle(false)
    })
    wrap.addEventListener(
      'wheel',
      e => {
        if (!wrap.classList.contains('ml-mermaid-full') || !view().contains(e.target)) return
        e.preventDefault()
        zoomAt(zoom * Math.exp(-e.deltaY / 500), e.clientX, e.clientY)
      },
      { passive: false },
    )
    wrap.addEventListener('dblclick', e => {
      if (wrap.classList.contains('ml-mermaid-full') && view().contains(e.target)) reset()
    })
    wrap.addEventListener('pointerdown', e => {
      if (!wrap.classList.contains('ml-mermaid-full') || e.button !== 0 || !view().contains(e.target)) return
      e.preventDefault()
      const start = { px: e.clientX, py: e.clientY, x, y }
      const v = view()
      v.setPointerCapture(e.pointerId)
      v.classList.add('ml-panning')
      const move = ev => {
        x = start.x + ev.clientX - start.px
        y = start.y + ev.clientY - start.py
        apply()
      }
      const up = () => {
        v.removeEventListener('pointermove', move)
        v.removeEventListener('pointerup', up)
        v.removeEventListener('pointercancel', up)
        v.classList.remove('ml-panning')
      }
      v.addEventListener('pointermove', move)
      v.addEventListener('pointerup', up)
      v.addEventListener('pointercancel', up)
    })
    return [fullBtn, ...zoomBtns]
  }

  /** 圖表的大小（CSS px）：取自 viewBox，沒有時取 width／height 屬性 */
  function svgSize(svg) {
    const box = svg.viewBox?.baseVal
    return {
      w: box?.width || Number.parseFloat(svg.getAttribute('width')) || 600,
      h: box?.height || Number.parseFloat(svg.getAttribute('height')) || 400,
    }
  }

  /** 可獨立開啟的 SVG：寫明寬高，拿掉頁面上用來縮放的 style */
  function svgMarkup(svg) {
    const { w, h } = svgSize(svg)
    const copy = svg.cloneNode(true)
    copy.setAttribute('width', w)
    copy.setAttribute('height', h)
    copy.removeAttribute('style')
    return new XMLSerializer().serializeToString(copy)
  }

  /**
   * 圖表畫成 PNG；文字標籤是 SVG 文字、沒有 foreignObject，畫到 canvas 不會被汙染
   * @param {{scale?: number, background?: string, padding?: number}} [opts] background 省略時透明；padding 以 CSS px 計
   * @returns {Promise<{blob: Blob, width: number, height: number}>} width、height 是乘上 scale 之前的大小（含 padding）
   */
  Markloupe.mermaidPng = async function (svg, { scale = 2, background, padding = 0 } = {}) {
    const { w, h } = svgSize(svg)
    const img = new Image()
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup(svg))}`
    await img.decode()
    const [width, height] = [w + padding * 2, h + padding * 2]
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
    const g = canvas.getContext('2d')
    if (background) {
      g.fillStyle = background
      g.fillRect(0, 0, canvas.width, canvas.height)
    }
    g.drawImage(img, padding * scale, padding * scale, w * scale, h * scale)
    return { blob: await canvas.convertToBlob({ type: 'image/png' }), width, height }
  }

  /** 圖表存成 .svg 檔的內容 */
  Markloupe.mermaidSvgFile = svg => `<?xml version="1.0" encoding="UTF-8"?>\n${svgMarkup(svg)}\n`

  /*
   * 圖表另存成圖片：一律用淺色（和匯出 Word 相同），PNG 以頁面底色為背景、四周留白。
   * 深色主題時由 main.js 提供的 withLightTheme 暫時切到淺色、重繪後再取圖
   */
  const IMAGE_PADDING = 16

  const inLight = fn => (Markloupe.withLightTheme ? Markloupe.withLightTheme(fn) : fn())

  /**
   * 多張圖表一起畫成淺色 PNG，只切換一次主題
   * @returns {Promise<Map<HTMLElement, {blob: Blob, width: number, height: number}>>} 沒有圖（語法錯誤、還沒畫好）或轉檔失敗的略過
   */
  Markloupe.mermaidImages = function (wraps) {
    return inLight(async () => {
      const out = new Map()
      const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
      for (const wrap of wraps) {
        const svg = wrap.querySelector('.ml-mermaid-view svg')
        if (!svg) continue
        try {
          out.set(wrap, await Markloupe.mermaidPng(svg, { background, padding: IMAGE_PADDING }))
        } catch {
          // 轉不了的圖表維持原樣
        }
      }
      return out
    })
  }

  async function imageOf(wrap, kind) {
    if (kind === 'png') {
      const png = (await Markloupe.mermaidImages([wrap])).get(wrap)
      if (!png) throw new Error('no diagram')
      return png.blob
    }
    return inLight(async () => {
      const svg = wrap.querySelector('.ml-mermaid-view svg')
      if (!svg) throw new Error('no diagram')
      return new Blob([Markloupe.mermaidSvgFile(svg)], { type: 'image/svg+xml' })
    })
  }

  function imageMenu(wrap) {
    const name = () => Markloupe.sectionTitle(wrap) || Markloupe.docBaseName()
    const download = async kind => {
      try {
        Markloupe.downloadBlob(await imageOf(wrap, kind), `${name()}.${kind}`)
      } catch {
        Markloupe.toast(t('imageFailed'))
      }
    }
    const copy = async () => {
      try {
        // 圖片以 Promise 交給剪貼簿：等重繪與轉檔的期間不會失去使用者操作的授權
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': imageOf(wrap, 'png') })])
        Markloupe.toast(t('imageCopied'))
      } catch {
        Markloupe.toast(t('imageFailed'))
      }
    }
    const btn = h('button', {
      class: 'ml-btn ml-mermaid-image',
      text: t('mermaidImage'),
      title: t('mermaidImageTitle'),
      attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
      on: {
        click: () => {
          if (Markloupe.menuOpenFor(btn)) return Markloupe.closeMenu()
          // 一般 http 網頁沒有剪貼簿 API，無法寫入圖片
          const canCopy = !!navigator.clipboard?.write && typeof ClipboardItem === 'function'
          Markloupe.openMenu({
            anchor: btn,
            label: t('mermaidImage'),
            items: [
              { label: t('imageCopyPng'), fn: copy, disabled: canCopy ? undefined : t('imageCopyUnavailable') },
              { label: t('imageDownloadPng'), fn: () => download('png') },
              { label: t('imageDownloadSvg'), fn: () => download('svg') },
            ],
          })
        },
      },
    })
    return btn
  }

  /** 顯示圖或原始碼 */
  function showSource(wrap, on) {
    wrap.classList.toggle('ml-mermaid-source', on)
    wrap.querySelector('.ml-mermaid-toggle').textContent = t(on ? 'mermaidChart' : 'mermaidSource')
  }

  function setSvg(wrap, svg, theme) {
    const view = wrap.querySelector('.ml-mermaid-view')
    // mermaid 以 securityLevel 'strict' 繪製：標籤經 DOMPurify 過濾、停用點擊事件與腳本
    view.innerHTML = svg
    view.classList.remove('ml-mermaid-error', 'ml-mermaid-pending')
    wrap.dataset.mlMermaidTheme = theme
  }

  function setError(wrap, err) {
    const view = wrap.querySelector('.ml-mermaid-view')
    view.classList.remove('ml-mermaid-pending')
    view.classList.add('ml-mermaid-error')
    const msg = String(err?.message || err).trim().split('\n').slice(0, 6).join('\n')
    view.replaceChildren(h('strong', { text: t('mermaidError') }), h('pre', { text: msg }))
    delete wrap.dataset.mlMermaidTheme
    showSource(wrap, true)
  }

  async function draw(wrap) {
    if (!wrap.isConnected) return // 已被下一次渲染取代
    const theme = themeNow()
    const code = wrap.dataset.mlMermaidCode
    const key = `${theme}\n${code}`
    if (cache.has(key)) return setSvg(wrap, cache.get(key), theme)
    const mermaid = await load()
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      // 標籤畫成 SVG 文字，不產生 foreignObject：圖表裡不會出現任何 HTML 元素
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      theme: 'base',
      themeVariables: themeVariables(theme),
      fontFamily: getComputedStyle(wrap).fontFamily,
    })
    const id = `ml-mermaid-${++seq}`
    try {
      const { svg } = await mermaid.render(id, code)
      remember(key, svg)
      if (wrap.isConnected) setSvg(wrap, svg, theme)
      // 繪製期間主題變了：rethemeMermaid 只重繪已畫好的圖，這張要自己再排一次
      if (wrap.isConnected && themeNow() !== theme) enqueue(wrap)
    } catch (err) {
      if (wrap.isConnected) setError(wrap, err)
    } finally {
      // 繪製失敗時 mermaid 可能在 body 留下暫存容器（id 為 d + id）；
      // 不能用 id 本身清理，那是產生出來、已插入頁面的 svg
      document.getElementById(`d${id}`)?.remove()
    }
  }

  function enqueue(wrap) {
    queue = queue.then(() => draw(wrap)).catch(() => {})
    return queue
  }

  /**
   * 把 processCodeBlocks 產生的 mermaid 程式碼區塊改成圖表
   * 快取命中的區塊同步完成（自動更新後捲動位置不會跳動），其餘排隊非同步繪製
   * @returns {Promise<void>} 全部繪製完成
   */
  Markloupe.renderMermaid = function (article, enabled) {
    const codes = article.querySelectorAll('.ml-code code.language-mermaid')
    if (!codes.length) return Promise.resolve()
    if (!enabled) return Promise.resolve()
    const pending = []
    for (const code of codes) {
      const wrap = code.closest('.ml-code')
      wrap.classList.add('ml-mermaid')
      wrap.dataset.mlMermaidCode = code.textContent
      const view = h('div', { class: 'ml-mermaid-view ml-mermaid-pending', text: t('mermaidPending') })
      const toggle = h('button', {
        class: 'ml-btn ml-mermaid-toggle',
        title: t('mermaidToggleTitle'),
        on: { click: () => showSource(wrap, !wrap.classList.contains('ml-mermaid-source')) },
      })
      const lang = wrap.querySelector('.ml-code-lang')
      if (lang) lang.after(toggle)
      else wrap.querySelector('.ml-code-bar').prepend(toggle)
      toggle.after(...fullscreenControls(wrap), imageMenu(wrap))
      wrap.insertBefore(view, wrap.querySelector('pre'))
      showSource(wrap, false)
      const key = `${themeNow()}\n${wrap.dataset.mlMermaidCode}`
      if (cache.has(key)) setSvg(wrap, cache.get(key), themeNow())
      else pending.push(enqueue(wrap))
    }
    return Promise.all(pending).then(() => {})
  }

  /**
   * 主題切換後，重繪主題不符的圖表
   * @returns {Promise<void>} 重繪完成
   */
  Markloupe.rethemeMermaid = function (article) {
    const theme = themeNow()
    const pending = []
    for (const wrap of article.querySelectorAll('.ml-mermaid[data-ml-mermaid-theme]')) {
      if (wrap.dataset.mlMermaidTheme !== theme) pending.push(enqueue(wrap))
    }
    return Promise.all(pending).then(() => {})
  }
})()
