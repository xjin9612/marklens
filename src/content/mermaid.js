'use strict'
// Mermaid 圖表：頁面有 mermaid 區塊時才動態載入程式庫（約 5MB），沒有就完全不載入
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

;(() => {
  const { h } = MarkLens
  const ENTRY = 'vendor/mermaid/mermaid.esm.min.mjs'
  const CACHE_LIMIT = 50

  let loading = null // 載入中／已載入的 Promise
  let seq = 0 // mermaid.render 需要唯一 id
  let queue = Promise.resolve() // mermaid 不支援同時繪製多張，一律排隊
  const cache = new Map() // `${theme}\n${code}` → svg 字串；自動更新重繪時直接沿用，不閃爍

  function themeNow() {
    return document.documentElement.dataset.mlTheme === 'dark' ? 'dark' : 'default'
  }

  function remember(key, svg) {
    cache.delete(key)
    cache.set(key, svg)
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value)
  }

  /**
   * 程式庫檔案只對 file:// 頁面開放（manifest 的 web_accessible_resources），
   * 避免一般網站藉由探測這些檔案得知使用者裝了 MarkLens
   */
  function supported() {
    return location.protocol === 'file:'
  }

  function load() {
    loading ??= import(chrome.runtime.getURL(ENTRY)).then(m => {
      document.documentElement.dataset.mlMermaid = 'loaded'
      return m.default
    })
    return loading
  }

  /** 顯示圖或原始碼 */
  function showSource(wrap, on) {
    wrap.classList.toggle('ml-mermaid-source', on)
    wrap.querySelector('.ml-mermaid-toggle').textContent = on ? '圖表' : '原始碼'
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
    view.replaceChildren(h('strong', { text: 'Mermaid 語法錯誤' }), h('pre', { text: msg }))
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
      theme,
      fontFamily: getComputedStyle(wrap).fontFamily,
    })
    const id = `ml-mermaid-${++seq}`
    try {
      const { svg } = await mermaid.render(id, code)
      remember(key, svg)
      if (wrap.isConnected) setSvg(wrap, svg, theme)
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
  MarkLens.renderMermaid = function (article, enabled) {
    const codes = article.querySelectorAll('.ml-code code.language-mermaid')
    if (!codes.length) return Promise.resolve()
    if (!enabled || !supported()) {
      if (enabled) {
        for (const code of codes) {
          const lang = code.closest('.ml-code').querySelector('.ml-code-lang')
          if (lang) lang.title = 'Mermaid 圖表只在本機檔案繪製'
        }
      }
      return Promise.resolve()
    }
    const pending = []
    for (const code of codes) {
      const wrap = code.closest('.ml-code')
      wrap.classList.add('ml-mermaid')
      wrap.dataset.mlMermaidCode = code.textContent
      const view = h('div', { class: 'ml-mermaid-view ml-mermaid-pending', text: 'Mermaid 圖表繪製中…' })
      const toggle = h('button', {
        class: 'ml-btn ml-mermaid-toggle',
        title: '切換圖表／原始碼',
        on: { click: () => showSource(wrap, !wrap.classList.contains('ml-mermaid-source')) },
      })
      const lang = wrap.querySelector('.ml-code-lang')
      if (lang) lang.after(toggle)
      else wrap.querySelector('.ml-code-bar').prepend(toggle)
      wrap.insertBefore(view, wrap.querySelector('pre'))
      showSource(wrap, false)
      const key = `${themeNow()}\n${wrap.dataset.mlMermaidCode}`
      if (cache.has(key)) setSvg(wrap, cache.get(key), themeNow())
      else pending.push(enqueue(wrap))
    }
    return Promise.all(pending).then(() => {})
  }

  /** 主題切換後，重繪主題不符的圖表 */
  MarkLens.rethemeMermaid = function (article) {
    const theme = themeNow()
    for (const wrap of article.querySelectorAll('.ml-mermaid[data-ml-mermaid-theme]')) {
      if (wrap.dataset.mlMermaidTheme !== theme) enqueue(wrap)
    }
  }
})()
