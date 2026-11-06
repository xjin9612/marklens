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

  /** 複製文章並整理成靜態內容 */
  function staticArticle(article) {
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
    // 相對路徑改成絕對路徑，檔案搬到別處後圖片與連結仍有效；頁內錨點維持原樣
    // 原文的網址可能不合法（例如主機名稱含控制字元），轉換失敗就維持原樣，不中斷匯出
    const absolute = url => {
      try {
        return new URL(url, location.href).href
      } catch {
        return url
      }
    }
    for (const img of clone.querySelectorAll('img[src], source[src], video[src], audio[src]')) {
      img.setAttribute('src', absolute(img.getAttribute('src')))
    }
    for (const a of clone.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href')
      if (!href.startsWith('#')) a.setAttribute('href', absolute(href))
    }
    return clone
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

  /** 產生匯出用的完整 HTML 字串 */
  MarkLens.buildExportHtml = async function (article) {
    const root = document.documentElement
    let css = `${(await asset('src/shared/tokens.css')).text}\n${(await asset('src/content/content.css')).text}`
    if (article.querySelector('.katex')) css += `\n${await katexCss()}`
    // 程式碼區塊中英對齊（fonts.js 依本機字型算出的設定）
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

    return `<!doctype html>
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
<div id="ml-root"><main class="ml-main">${staticArticle(article).outerHTML}</main></div>
</body>
</html>
`
  }

  /** 匯出並下載；檔名沿用 .md 的檔名 */
  MarkLens.exportHtml = async function (article) {
    const html = await MarkLens.buildExportHtml(article)
    let base = location.pathname.split('/').pop() || 'document'
    try {
      base = decodeURIComponent(base)
    } catch {
      // 不合法的 % 編碼：沿用原字串
    }
    base = base.replace(/\.(md|markdown|mkd|mdx)$/i, '')
    const name = `${base}.html`
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    const a = MarkLens.h('a', { href: url, download: name })
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    return name
  }
})()
