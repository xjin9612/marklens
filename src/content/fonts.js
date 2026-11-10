'use strict'
// 程式碼區塊的中英對齊：讓中文字寬剛好等於兩個英數字寬
// 系統內建的等寬字型（Consolas、Menlo…）沒有中文，中文會改用系統中文字型顯示，寬度通常不是英數的兩倍，
// 框線字元表格（┌─┬─┐）因此錯位。做法：量出實際使用的英數字寬，以 @font-face 的 size-adjust
// 只針對中文字元範圍，把系統中文字型等比例縮放到剛好兩倍寬。框線字元仍用英數字型（半形）。
// 已安裝更紗黑體（中英本來就 2:1）時不需要校正。
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

;(() => {
  const FAMILY = 'MarkLens CJK Mono' // content.css 的 --ml-mono 已預留此名稱
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

  /**
   * codePx：程式碼區塊的字級。PingFang 等 Apple 字型的字距隨字級改變，要在這個字級量寬度
   */
  MarkLens.alignCodeFont = async function (codePx) {
    try {
      if (!document.fonts || typeof FontFace !== 'function') return null
      if (ALIGNED_FONTS.some(installed)) return { skipped: 'sarasa' }

      const ascii = ASCII_FONTS.find(installed) || 'monospace'
      const asciiFamily = ascii === 'monospace' ? 'monospace' : `"${ascii}"`
      const asciiWidth = width(`${codePx}px ${asciiFamily}`, 'MMMMMMMMMM') / 10

      const cjk = CJK_FONTS.find(([name]) => installed(name))
      if (!cjk) return { skipped: 'no-cjk-font' }
      // 字距取決於 size-adjust 縮放後的字級，所以在估出的字級再量一次
      const cjkWidth = px => width(`${px}px "${cjk[0]}"`, CJK_SAMPLE) / 10 / px
      const estimate = (2 * asciiWidth) / (codePx * cjkWidth(codePx))
      const ratio = (2 * asciiWidth) / (codePx * cjkWidth(codePx * estimate))
      if (Math.abs(ratio - 1) < 0.002) return { skipped: 'already-aligned' }

      const sizeAdjust = `${(ratio * 100).toFixed(3)}%`
      const faces = [
        [cjk[1], '400'],
        [cjk[2], '700'],
      ].map(
        ([names, weight]) =>
          new FontFace(FAMILY, names.map(n => `local("${n}")`).join(', '), {
            unicodeRange: CJK_RANGE,
            sizeAdjust,
            weight,
          }),
      )
      let loaded = 0
      const css = []
      for (const [i, face] of faces.entries()) {
        try {
          document.fonts.add(await face.load())
          loaded++
          // 同樣的設定以 CSS 形式保留，匯出 HTML 時寫進檔案
          const names = (i === 0 ? cjk[1] : cjk[2]).map(n => `local("${n}")`).join(', ')
          css.push(
            `@font-face { font-family: "${FAMILY}"; src: ${names}; font-weight: ${face.weight}; size-adjust: ${sizeAdjust}; unicode-range: ${CJK_RANGE}; }`,
          )
        } catch {
          // 該字重找不到對應的 local() 名稱，交給瀏覽器的一般備援
        }
      }
      MarkLens.codeFontCss = css.join('\n')
      return { ascii, cjk: cjk[0], codePx, ratio, loaded }
    } catch (err) {
      console.warn('[MarkLens] 程式碼字型校正失敗', err)
      return null
    }
  }
})()
