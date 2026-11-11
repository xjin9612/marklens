'use strict'
// 匯出 HTML：把目前的渲染結果存成單一 HTML 檔（樣式內嵌、不含任何 JavaScript），可離線開啟或分享
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

;(() => {
  // 匯出的檔案禁止執行任何腳本；圖片與影音可來自任何位置，字型只允許內嵌
  const CSP =
    "default-src 'none'; img-src * data: blob: file:; media-src * data: blob: file:; style-src 'unsafe-inline'; font-src data:"

  // 閱讀頁才有用的互動元件
  const REMOVE = '.ml-fold, .ml-anchor, .ml-heading-copy, .ml-code-bar, .ml-table-bar, .ml-col-resizer, .ml-mermaid-toggle, .ml-mermaid-pending'

  /** 由背景程式讀取擴充功能內的檔案（content script 無法直接讀取未開放的擴充功能檔案） */
  async function asset(path) {
    const res = await chrome.runtime.sendMessage({ type: 'read-asset', path })
    if (!res || res.status !== 'ok') throw new Error(res?.error || `cannot read ${path}`)
    return res
  }

  /** KaTeX 樣式：woff2 字型轉成 data URL 內嵌，其他格式的備援來源移除 */
  async function katexCss() {
    let css = (await asset('vendor/katex/katex.min.css')).text
    css = css.replace(/,\s*url\(fonts\/[^)]+\.(?:woff|ttf)\)\s*format\("[a-z]+"\)/g, '')
    const fonts = [...new Set(css.match(/fonts\/KaTeX_[A-Za-z0-9-]+\.woff2/g) || [])]
    for (const f of fonts) {
      const { base64 } = await asset(`vendor/katex/${f}`)
      css = css.split(`url(${f})`).join(`url(data:font/woff2;base64,${base64})`)
    }
    return css
  }

  // 原文的網址可能不合法（例如主機名稱含控制字元），轉換失敗就維持原樣，不中斷匯出
  function absolute(url) {
    try {
      return new URL(url, location.href).href
    } catch {
      return url
    }
  }

  // 與匯出檔名使用同一份副檔名清單，改寫後的連結才對得上匯出的檔名
  const MD_EXT = /\.(md|markdown|mkd|mdx)$/i

  /** 路徑部分是 Markdown 檔時，副檔名改成 .html；query、錨點與原文的編碼不變 */
  function mdToHtml(href) {
    const cut = href.search(/[?#]/)
    const path = cut < 0 ? href : href.slice(0, cut)
    return MD_EXT.test(path) ? path.replace(MD_EXT, '.html') + href.slice(path.length) : href
  }

  /**
   * 複製文章並整理成靜態內容
   * @param {{portable?: boolean}} [opts] portable：指向本機檔案的網址保留原文的寫法，.md 連結改成匯出後的 .html，
   *   匯出檔不帶出本機路徑；原文自己寫的 file: 網址照原文保留。其餘網址一律改成絕對網址
   */
  function staticArticle(article, { portable = false } = {}) {
    const clone = article.cloneNode(true)
    for (const el of clone.querySelectorAll(REMOVE)) el.remove()
    for (const el of clone.querySelectorAll('[data-ml-line]')) {
      delete el.dataset.mlLine
      delete el.dataset.mlEnd
    }
    // 全部展開、顯示被篩選掉的表格列
    for (const el of clone.querySelectorAll('[data-ml-fold]')) {
      el.removeAttribute('hidden')
      delete el.dataset.mlFold
    }
    for (const el of clone.querySelectorAll('.ml-folded')) el.classList.remove('ml-folded')
    // 全螢幕中的圖表回到文件裡，縮放與位移不帶進匯出檔
    for (const el of clone.querySelectorAll('.ml-mermaid-full')) {
      el.classList.remove('ml-mermaid-full')
      el.removeAttribute('style')
    }
    for (const tr of clone.querySelectorAll('tr[hidden]')) tr.hidden = false
    // 畫好的 Mermaid 圖顯示圖本身，不是原始碼
    for (const el of clone.querySelectorAll('.ml-mermaid-source')) {
      if (el.querySelector('.ml-mermaid-view svg')) el.classList.remove('ml-mermaid-source')
    }
    // 勾選狀態是屬性值（checked property），序列化成 HTML 前要寫成 checked 屬性
    const states = Array.from(article.querySelectorAll('input.ml-task-box'), box => box.checked)
    clone.querySelectorAll('input.ml-task-box').forEach((box, i) => {
      box.toggleAttribute('checked', states[i])
      box.disabled = true
      box.removeAttribute('title')
    })
    // 匯出的檔案沒有放大功能：圖片不再是按鈕；表頭不再可聚焦排序
    for (const img of clone.querySelectorAll('img.ml-zoomable')) {
      img.classList.remove('ml-zoomable')
      for (const a of ['tabindex', 'role', 'aria-label']) img.removeAttribute(a)
    }
    for (const th of clone.querySelectorAll('th.ml-sortable')) th.removeAttribute('tabindex')
    // 絕對網址讓檔案搬到別處後仍有效；頁內錨點維持原樣
    const rewrite = (el, attr) => {
      const raw = el.getAttribute(attr)
      if (attr === 'href' && raw.startsWith('#')) return
      const abs = absolute(raw)
      if (!portable || !/^file:/i.test(abs)) el.setAttribute(attr, abs)
      else if (attr === 'href' && !/^\s*file:/i.test(raw)) el.setAttribute(attr, mdToHtml(raw))
    }
    for (const el of clone.querySelectorAll('img[src], source[src], video[src], audio[src]')) rewrite(el, 'src')
    for (const el of clone.querySelectorAll('video[poster]')) rewrite(el, 'poster')
    for (const el of clone.querySelectorAll('a[href]')) rewrite(el, 'href')
    return clone
  }

  // 內嵌圖片的總量上限（base64 字元數）；超過後的圖片維持原網址
  const EMBED_TOTAL_MAX = 64 * 1024 * 1024

  /**
   * 圖片改成 data: 網址內嵌，由背景程式讀取；讀不到、不是圖片或超過大小上限的維持原本的 src
   * @returns {Promise<{missed: number, needsWebAccess: boolean}>} missed：沒有內嵌的圖片網址數；
   *   needsWebAccess：其中有網路圖片因為沒有網站權限而讀不到
   */
  async function embedImages(root) {
    const target = new Map()
    for (const img of root.querySelectorAll('img[src]')) {
      const url = absolute(img.getAttribute('src'))
      if (/^(https?|file):/i.test(url)) target.set(img, url)
    }
    const uses = new Map()
    for (const url of target.values()) uses.set(url, (uses.get(url) || 0) + 1)
    const urls = [...uses.keys()]
    const embedded = new Map()
    let total = 0
    let needsWebAccess = false
    // 依序讀取，同一時間只佔用一張圖片的記憶體
    for (const url of urls) {
      const res = await chrome.runtime.sendMessage({ type: 'read-image', url }).catch(() => null)
      // 同一張圖出現幾次，匯出檔就寫入幾份
      const size = res?.status === 'ok' ? res.base64.length * uses.get(url) : 0
      if (res?.status === 'ok' && total + size <= EMBED_TOTAL_MAX) {
        total += size
        embedded.set(url, `data:${res.mime};base64,${res.base64}`)
      } else if (res?.reason === 'no-permission') needsWebAccess = true
    }
    for (const [img, url] of target) {
      const data = embedded.get(url)
      if (!data) continue
      img.setAttribute('src', data)
      // srcset 與 <picture> 的 <source> 優先於 src，留著就會改用原網址
      img.removeAttribute('srcset')
      if (img.parentElement?.tagName === 'PICTURE') for (const el of img.parentElement.querySelectorAll('source')) el.remove()
    }
    return { missed: urls.filter(u => !embedded.has(u)).length, needsWebAccess }
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  }

  /** 部分內容（例如一個章節）整理成靜態 HTML，供複製到剪貼簿 */
  MarkLens.staticHtml = function (nodes) {
    const box = document.createElement('article')
    for (const n of nodes) box.append(n.cloneNode(true))
    return staticArticle(box).innerHTML
  }

  /**
   * 產生匯出用的完整 HTML
   * @param {{embed?: boolean}} [opts] embed：單一檔，圖片改成 data: 網址內嵌，指向本機檔案的網址保留原文的寫法；
   *   否則圖片與連結一律改成絕對網址
   * @returns {Promise<{html: string, missed: number, needsWebAccess: boolean}>} missed 與 needsWebAccess 同 embedImages
   */
  MarkLens.buildExportHtml = async function (article, { embed = false } = {}) {
    const root = document.documentElement
    const body = staticArticle(article, { portable: embed })
    const images = embed ? await embedImages(body) : { missed: 0, needsWebAccess: false }
    let css = `${(await asset('src/shared/tokens.css')).text}\n${(await asset('src/content/content.css')).text}`
    if (article.querySelector('.katex')) css += `\n${await katexCss()}`
    // 程式碼區塊中英對齊（fonts.js 依本機字型算出的設定）
    await MarkLens.codeFontReady
    if (MarkLens.codeFontCss) css += `\n${MarkLens.codeFontCss}`
    // 使用者自訂的 CSS 放在最後，與閱讀頁相同可覆蓋前面的樣式
    const custom = (await MarkLens.loadSettings()).customCss
    if (custom) css += `\n${custom.replace(/<\/style/gi, '<\\/style')}` // 不能提前結束 <style>

    // 沿用目前的主題、字體、行高與文字寬度
    const vars = Array.from(root.style)
      .filter(p => p.startsWith('--ml-'))
      .map(p => `${p}: ${root.style.getPropertyValue(p)}`)
      .join('; ')
    const classes = ['marklens', 'ml-toc-hidden', 'ml-export']
    for (const c of ['ml-wide-blocks', 'ml-code-wrap']) if (root.classList.contains(c)) classes.push(c)
    const version = chrome.runtime.getManifest().version

    const html = `<!doctype html>
<html lang="${escapeHtml(root.lang || '')}" class="${classes.join(' ')}" data-ml-theme="${escapeHtml(root.dataset.mlTheme || 'light')}"${root.dataset.mlPalette ? ` data-ml-palette="${escapeHtml(root.dataset.mlPalette)}"` : ''} style="${escapeHtml(vars)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="generator" content="MarkLens ${escapeHtml(version)}">
<title>${escapeHtml(document.title)}</title>
<style>
${css}
</style>
</head>
<body>
<div id="ml-root"><main class="ml-main">${body.outerHTML}</main></div>
</body>
</html>
`
    return { html, ...images }
  }

  /**
   * 匯出並下載；檔名沿用 .md 的檔名
   * @returns {Promise<{name: string, missed: number, needsWebAccess: boolean}>}
   */
  MarkLens.exportHtml = async function (article, opts) {
    const { html, missed, needsWebAccess } = await MarkLens.buildExportHtml(article, opts)
    let base = location.pathname.split('/').pop() || 'document'
    try {
      base = decodeURIComponent(base)
    } catch {
      // 不合法的 % 編碼：沿用原字串
    }
    base = base.replace(MD_EXT, '')
    const name = `${base}.html`
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    const a = MarkLens.h('a', { href: url, download: name })
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    return { name, missed, needsWebAccess }
  }
})()
