'use strict'
// 數學公式：頁面有公式時才動態載入 KaTeX（程式約 600KB、字型約 300KB），沒有就完全不載入
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

;(() => {
  const ENTRY = 'vendor/katex/katex.mjs'
  const STYLE = 'vendor/katex/katex.min.css'
  const SELECTOR = '.math-inline, .math-display'

  let katex = null // 載入完成後同步繪製，自動更新時不閃爍
  let loading = null

  /** 與 Mermaid 相同：程式庫只對 file:// 頁面開放（manifest 的 web_accessible_resources） */
  function supported() {
    return location.protocol === 'file:'
  }

  function load() {
    loading ??= (async () => {
      // 字型由樣式表以相對路徑載入，所以樣式表必須從擴充功能網址引用
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = chrome.runtime.getURL(STYLE)
      document.head.append(link)
      const mod = await import(chrome.runtime.getURL(ENTRY))
      katex = mod.default
      document.documentElement.dataset.mlMath = 'loaded'
      return katex
    })()
    return loading
  }

  function isDisplay(el) {
    return el.classList.contains('math-display')
  }

  function draw(el) {
    const tex = el.dataset.mlTex ?? el.textContent
    el.dataset.mlTex = tex
    katex.render(tex, el, {
      displayMode: isDisplay(el),
      throwOnError: false, // 語法錯誤顯示紅字原文，不中斷其他公式
      trust: false, // 停用 \href、\url、\includegraphics、\htmlClass 等可產生連結或屬性的指令
      strict: 'ignore',
      maxExpand: 1000, // 限制巨集展開次數，避免惡意文件卡住頁面
      maxSize: 50,
      output: 'htmlAndMathml',
    })
  }

  /** 不繪製時補回 $ 符號，讓讀者看到的是原始寫法 */
  function showSource(els) {
    for (const el of els) {
      const d = isDisplay(el) ? '$$' : '$'
      el.textContent = `${d}${el.textContent}${d}`
    }
  }

  /**
   * 把 .math-inline／.math-display 繪製成公式
   * KaTeX 已載入時同步完成；第一次需要等載入
   * @returns {Promise<void>}
   */
  MarkLens.renderMath = async function (article, enabled) {
    const els = Array.from(article.querySelectorAll(SELECTOR))
    if (!els.length) return
    if (!enabled || !supported()) return showSource(els)
    if (!katex) {
      try {
        await load()
      } catch {
        return showSource(els)
      }
    }
    for (const el of els) {
      if (el.isConnected) draw(el)
    }
  }
})()
