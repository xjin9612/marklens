'use strict'
// 自訂配色：使用者只挑底色、文字色與強調色，其餘設計變數由這三色推算；閱讀頁與 popup 共用
var Markloupe = globalThis.Markloupe || (globalThis.Markloupe = {})

;(() => {
  const HEX = /^#[0-9a-f]{6}$/i
  const MIN_CONTRAST = 4.5
  const MARK = '#e3b341'

  /** 只接受 #rrggbb：推算結果直接寫進樣式表，其他寫法一律不採用 */
  Markloupe.isHexColor = s => typeof s === 'string' && HEX.test(s)

  /** 使用者輸入的色碼：可省略 #，可用 #rgb 簡寫；不是色碼時回傳 null */
  Markloupe.parseHexColor = function (input) {
    let s = String(input).trim().replace(/^#?/, '#').toLowerCase()
    if (/^#[0-9a-f]{3}$/.test(s)) s = `#${[...s.slice(1)].map(c => c + c).join('')}`
    return HEX.test(s) ? s : null
  }

  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  const toHex = c => `#${c.map(x => Math.round(x).toString(16).padStart(2, '0')).join('')}`
  const mix = (a, b, t) => {
    const [x, y] = [rgb(a), rgb(b)]
    return toHex(x.map((v, i) => v + (y[i] - v) * t))
  }
  const channelLuminance = c => {
    const [r, g, b] = c.map(v => {
      const x = v / 255
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const luminance = hex => channelLuminance(rgb(hex))

  const luminanceRatio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

  /** WCAG 對比值（1～21） */
  Markloupe.contrastRatio = (a, b) => luminanceRatio(luminance(a), luminance(b))

  const readableOn = (color, backs) => backs.every(b => Markloupe.contrastRatio(color, b) >= MIN_CONTRAST)

  /** 文字色往底色淡化 t，但在每個底色上都維持 4.5:1；文字色本身不夠時就用文字色 */
  function soften(fg, bg, t, backs) {
    for (let k = t; k > 0; k -= 0.02) {
      const c = mix(fg, bg, k)
      if (readableOn(c, backs)) return c
    }
    return fg
  }

  /** 底色往 color 混合 t，混合量逐步減少到文字色在上面仍有 4.5:1；都不夠時回傳底色本身 */
  function tint(bg, color, t, fg) {
    for (let k = Math.round(t * 100); k > 0; k--) {
      const c = mix(bg, color, k / 100)
      if (readableOn(fg, [c])) return c
    }
    return bg
  }

  /** 對比不足的顏色往文字色靠攏，直到 4.5:1 */
  function ensure(color, fg, backs) {
    for (let k = 0; k < 1; k += 0.1) {
      const c = mix(color, fg, k)
      if (readableOn(c, backs)) return c
    }
    return fg
  }

  /** 推算時沿用目前主題的這些顏色，對比不足才調整 */
  Markloupe.CUSTOM_BASE_VARS = [
    '--hl-keyword', '--hl-string', '--hl-number', '--hl-comment', '--hl-title', '--hl-attr', '--hl-builtin', '--hl-meta',
    '--ok', '--warn', '--danger', '--alert-note', '--alert-important',
  ]

  /** 設定中某個主題的三色；缺少或不是 #rrggbb 的改用預設值 */
  Markloupe.customColorsFor = function (colors, theme) {
    const def = Markloupe.DEFAULTS.customColors[theme]
    const got = colors?.[theme] || {}
    return Object.fromEntries(Object.keys(def).map(k => [k, Markloupe.isHexColor(got[k]) ? got[k].toLowerCase() : def[k]]))
  }

  /**
   * 由三色推算閱讀頁的設計變數
   * @param {{bg: string, fg: string, accent: string}} colors #rrggbb
   * @param {Record<string, string>} base CUSTOM_BASE_VARS 在目前主題（未套用配色）的值；不是 #rrggbb 的略過
   */
  Markloupe.customPaletteVars = function ({ bg, fg, accent }, base) {
    // 程式碼區塊與行內程式碼的底色由文字色加深而來，文字色接近 4.5:1 時要少加一點
    const subtle = tint(bg, fg, 0.04, fg)
    const backs = [bg, subtle]
    // 半透明底色疊在底色上的實際顏色不是整數，以未取整的值判斷
    const [lf, lb, f] = [luminance(fg), rgb(bg), rgb(fg)]
    const onCode = a => luminanceRatio(lf, channelLuminance(lb.map((v, i) => v + (f[i] - v) * a))) >= MIN_CONTRAST
    let codeAlpha = 12
    while (codeAlpha > 0 && !onCode(codeAlpha / 100)) codeAlpha--
    const vars = {
      '--bg': bg,
      '--fg': fg,
      '--muted': soften(fg, bg, 0.3, backs),
      '--faint': soften(fg, bg, 0.38, backs),
      '--border': mix(bg, fg, 0.22),
      '--border-soft': mix(bg, fg, 0.12),
      '--subtle': subtle,
      '--hover': mix(bg, fg, 0.08),
      '--code-bg': subtle,
      '--inline-code-bg': `rgba(${rgb(fg).join(', ')}, ${codeAlpha / 100})`,
      '--link': accent,
      '--accent': accent,
      '--accent-soft': mix(bg, accent, 0.15),
      '--mark': tint(bg, MARK, 0.4, fg),
      '--on-accent': Markloupe.contrastRatio(bg, accent) >= Markloupe.contrastRatio(fg, accent) ? bg : fg,
    }
    for (const name of Markloupe.CUSTOM_BASE_VARS) {
      if (Markloupe.isHexColor(base[name])) vars[name] = ensure(base[name].toLowerCase(), fg, backs)
    }
    return vars
  }

  /** 自訂配色的樣式表；比主題的變數多一個屬性選擇器，不受樣式表順序影響 */
  Markloupe.customPaletteCss = function (vars) {
    const body = Object.entries(vars)
      .map(([k, v]) => `${k}: ${v};`)
      .join(' ')
    return `html.markloupe[data-ml-palette="custom"][data-ml-theme] { ${body} }`
  }
})()
