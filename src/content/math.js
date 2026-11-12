'use strict'
// 數學公式：頁面有公式時才動態載入 KaTeX（程式約 600KB、字型約 300KB），沒有就完全不載入
var Markloupe = globalThis.Markloupe || (globalThis.Markloupe = {})

;(() => {
  const ENTRY = 'vendor/katex/katex.mjs'
  const STYLE = 'vendor/katex/katex.min.css'
  const SELECTOR = '.math-inline, .math-display'

  let katex = null // 載入完成後同步繪製，自動更新時不閃爍
  let loading = null

  function load() {
    loading ??= (async () => {
      await adoptStyle()
      const mod = await import(chrome.runtime.getURL(ENTRY))
      katex = mod.default
      document.documentElement.dataset.mlMath = 'loaded'
      return katex
    })()
    return loading
  }

  /**
   * KaTeX 樣式。程式庫以動態網址開放給網頁（manifest 的 use_dynamic_url，網址每個工作階段不同，網站無法藉此偵測 Markloupe），
   * 但樣式表裡的相對路徑會被解析成固定 ID 的網址而載入失敗，所以字型改為動態網址的絕對路徑；只留 woff2（vendor 只收這種）。
   * 以 constructable stylesheet 套用，不受頁面 CSP 的 style-src 限制
   */
  async function adoptStyle() {
    const res = await chrome.runtime.sendMessage({ type: 'read-asset', path: STYLE })
    if (res?.status !== 'ok') throw new Error(res?.error || `cannot read ${STYLE}`)
    const css = res.text
      .replace(/,\s*url\(fonts\/[^)]+\.(?:woff|ttf)\)\s*format\("[a-z]+"\)/g, '')
      .replace(/url\((fonts\/[^)]+)\)/g, (_, path) => `url(${chrome.runtime.getURL(`vendor/katex/${path}`)})`)
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
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
  Markloupe.renderMath = async function (article, enabled) {
    const els = Array.from(article.querySelectorAll(SELECTOR))
    if (!els.length) return
    if (!enabled) return showSource(els)
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
