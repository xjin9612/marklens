'use strict'
// 程式碼區塊的中英對齊：讓中文字寬剛好等於兩個英數字寬
// 系統內建的等寬字型（Consolas、Menlo…）沒有中文，中文會改用系統中文字型顯示，寬度通常不是英數的兩倍，
// 框線字元表格（┌─┬─┐）因此錯位。做法：量出實際使用的英數字寬，以 @font-face 的 size-adjust
// 只針對中文字元範圍，把系統中文字型等比例縮放到剛好兩倍寬。框線字元仍用英數字型（半形）。
// 已安裝更紗黑體（中英本來就 2:1）時不需要校正。
var Markloupe = globalThis.Markloupe || (globalThis.Markloupe = {})

;(() => {
  const FAMILY = 'Markloupe CJK Mono' // content.css 的 --ml-mono 已預留此名稱
  // 與 content.css --ml-mono 的英數字型順序一致，才能量到實際使用的字型
  const ASCII_FONTS = ['Cascadia Code', 'Consolas', 'SFMono-Regular', 'Menlo', 'DejaVu Sans Mono', 'Liberation Mono']
  const ALIGNED_FONTS = ['Sarasa Mono TC', 'Sarasa Term TC', 'Sarasa Mono SC', 'Sarasa Term SC']
  // 系統中文字型：[字型家族名稱, 一般字重的 local() 名稱, 粗體的 local() 名稱]
  const CJK_FONTS = [
    ['Microsoft JhengHei', ['Microsoft JhengHei', 'Microsoft JhengHei Regular', 'MicrosoftJhengHeiRegular'], ['Microsoft JhengHei Bold', 'MicrosoftJhengHeiBold']],
    ['PingFang TC', ['PingFang TC Regular', 'PingFangTC-Regular'], ['PingFang TC Semibold', 'PingFangTC-Semibold']],
    ['Noto Sans CJK TC', ['Noto Sans CJK TC Regular', 'NotoSansCJKtc-Regular', 'Noto Sans CJK TC'], ['Noto Sans CJK TC Bold', 'NotoSansCJKtc-Bold']],
    ['Noto Sans TC', ['Noto Sans TC Regular', 'NotoSansTC-Regular', 'Noto Sans TC'], ['Noto Sans TC Bold', 'NotoSansTC-Bold']],
    ['Microsoft YaHei', ['Microsoft YaHei', 'Microsoft YaHei Regular', 'MicrosoftYaHei'], ['Microsoft YaHei Bold', 'MicrosoftYaHei-Bold']],
  ]
  // 中日韓文字、全形標點與符號；不含框線字元（U+2500–257F），框線字元維持英數字型的半形
  const CJK_RANGE = 'U+2E80-2FDF, U+3000-303F, U+3040-30FF, U+3100-31FF, U+3400-4DBF, U+4E00-9FFF, U+AC00-D7AF, U+F900-FAFF, U+FE30-FE4F, U+FF00-FFEF'

  const ctx = document.createElement('canvas').getContext('2d')
  const SAMPLE = 'mmmmmmmmmmlli0O名稱'

  function width(font, text) {
    ctx.font = font
    return ctx.measureText(text).width
  }

  /** 字型是否已安裝：和兩種不同的備援字型比較寬度，任一不同即表示用到了該字型 */
  function installed(name) {
    for (const generic of ['monospace', 'serif']) {
      if (width(`72px "${name}", ${generic}`, SAMPLE) !== width(`72px ${generic}`, SAMPLE)) return true
    }
    return false
  }

  const CJK_SAMPLE = '名名名名名名名名名名'

  let applied = [] // 目前加入 document.fonts 的校正字型
  let latest = 0

  function replaceFaces(faces, css) {
    for (const f of applied) document.fonts.delete(f)
    for (const f of faces) document.fonts.add(f)
    applied = faces
    Markloupe.codeFontCss = css
  }

  /**
   * codePx：程式碼區塊的字級。PingFang 等 Apple 字型的字距隨字級改變，要在這個字級量寬度。
   * 字級改變時再呼叫一次；較晚的呼叫開始後，較早的呼叫不套用結果並回傳 null。
   * Markloupe.codeFontReady 是最近一次呼叫的 Promise，讀 Markloupe.codeFontCss 前要先等它
   */
  Markloupe.alignCodeFont = function (codePx) {
    return (Markloupe.codeFontReady = align(codePx))
  }

  async function align(codePx) {
    const id = ++latest
    try {
      if (!document.fonts || typeof FontFace !== 'function' || !(codePx > 0)) return null
      if (ALIGNED_FONTS.some(installed)) return { skipped: 'sarasa' }

      const ascii = ASCII_FONTS.find(installed) || 'monospace'
      const asciiFamily = ascii === 'monospace' ? 'monospace' : `"${ascii}"`
      const asciiWidth = width(`${codePx}px ${asciiFamily}`, 'MMMMMMMMMM') / 10

      const cjk = CJK_FONTS.find(([name]) => installed(name))
      if (!cjk) return { skipped: 'no-cjk-font' }
      // 字距取決於 size-adjust 縮放後的字級：在縮放後的字級重新量測，直到比例不再變動
      const cjkWidth = px => width(`${px}px "${cjk[0]}"`, CJK_SAMPLE) / 10 / px
      let ratio = 1
      for (let i = 0; i < 5; i++) {
        const next = (2 * asciiWidth) / (codePx * cjkWidth(codePx * ratio))
        const settled = Math.abs(next - ratio) < 1e-4
        ratio = next
        if (settled) break
      }
      if (Math.abs(ratio - 1) < 0.002) {
        if (id === latest) replaceFaces([], '')
        return { skipped: 'already-aligned' }
      }

      const sizeAdjust = `${(ratio * 100).toFixed(3)}%`
      const faces = []
      const css = []
      for (const [names, weight] of [
        [cjk[1], '400'],
        [cjk[2], '700'],
      ]) {
        const src = names.map(n => `local("${n}")`).join(', ')
        try {
          faces.push(await new FontFace(FAMILY, src, { unicodeRange: CJK_RANGE, sizeAdjust, weight }).load())
          // 同樣的設定以 CSS 形式保留，匯出 HTML 時寫進檔案
          css.push(`@font-face { font-family: "${FAMILY}"; src: ${src}; font-weight: ${weight}; size-adjust: ${sizeAdjust}; unicode-range: ${CJK_RANGE}; }`)
        } catch {
          // 該字重找不到對應的 local() 名稱，交給瀏覽器的一般備援
        }
      }
      if (id !== latest) return null
      replaceFaces(faces, css.join('\n'))
      return { ascii, cjk: cjk[0], codePx, ratio, loaded: faces.length }
    } catch (err) {
      console.warn('[Markloupe] 程式碼字型校正失敗', err)
      return null
    }
  }
})()
