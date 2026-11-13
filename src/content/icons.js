'use strict'
// 介面線條圖示：16×16、線寬 1.5、跟隨文字顏色（樣式在 shared/tokens.css 的 .ml-icon）
// 用 SVG 而不是 emoji 或 Unicode 符號：各系統字型不同，符號的大小、粗細與基線都對不齊
var Markloupe = globalThis.Markloupe || (globalThis.Markloupe = {})

;(() => {
  const NS = 'http://www.w3.org/2000/svg'

  /** 每個圖示是一串 [標籤, 屬性]；path 只寫 d 時可直接給字串 */
  const SHAPES = {
    menu: ['M2.5 4h11', 'M2.5 8h11', 'M2.5 12h11'],
    search: [['circle', { cx: 7, cy: 7, r: 4.5 }], 'M10.5 10.5 14 14'],
    close: ['M4 4l8 8', 'M12 4l-8 8'],
    'chevron-right': ['M6 3.5 10.5 8 6 12.5'],
    'chevron-down': ['M3.5 6 8 10.5 12.5 6'],
    check: ['M3 8.5 6.5 12 13 4.5'],
    'fold-all': ['M5 2.5 8 5.5l3-3', 'M5 13.5l3-3 3 3'],
    'unfold-all': ['M5 5.5l3-3 3 3', 'M5 10.5l3 3 3-3'],
    width: ['M2 8h12', 'M4.5 5.5 2 8l2.5 2.5', 'M11.5 5.5 14 8l-2.5 2.5'],
    download: ['M8 2.5v8', 'M4.5 7 8 10.5 11.5 7', 'M3 13.5h10'],
    // 印表機：上方進紙、機身、下方出紙
    print: ['M4.5 6V2.5h7V6', 'M4.5 11.5H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1h-1.5', 'M4.5 9.5h7v4h-7z'],
    sun: [
      ['circle', { cx: 8, cy: 8, r: 2.75 }],
      'M8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06',
    ],
    moon: ['M13.5 9.6A5.5 5.5 0 1 1 6.4 2.5a4.3 4.3 0 0 0 7.1 7.1z'],
    // 自動：半實心的圓（跟隨系統深淺色）
    auto: [['circle', { cx: 8, cy: 8, r: 5.5 }], ['path', { d: 'M8 2.5a5.5 5.5 0 0 1 0 11z', fill: 'currentColor', stroke: 'none' }]],
    code: ['M5.5 4.5 2 8l3.5 3.5', 'M10.5 4.5 14 8l-3.5 3.5'],
    // 字體大小：大 A 與小 A
    'text-size': ['M1.5 13 5.5 3l4 10', 'M3 9.5h5', 'M10 13l2.5-6 2.5 6', 'M10.9 11h3.2'],
    plus: ['M8 3v10', 'M3 8h10'],
    minus: ['M3 8h10'],
    copy: ['M5.5 5.5h8v8h-8z', 'M3 10.5H2.5v-8h8V3'],
    edit: ['M10.5 2.5l3 3-8 8H2.5v-3z', 'M9 4l3 3'],
    'arrow-up': ['M8 13.5v-11', 'M4 6.5l4-4 4 4'],
    'arrow-down': ['M8 2.5v11', 'M4 9.5l4 4 4-4'],
    'arrow-left': ['M13.5 8h-11', 'M6.5 4l-4 4 4 4'],
    folder: ['M2 4.5a1 1 0 0 1 1-1h3.2l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z'],
    help: [['circle', { cx: 8, cy: 8, r: 6 }], 'M6.2 6.3a1.8 1.8 0 1 1 2.6 1.6c-.5.25-.8.6-.8 1.1v.3', 'M8 11.4v.1'],
    keyboard: ['M1.5 4.5h13v7h-13z', 'M4 7h.01M6.67 7h.01M9.33 7h.01M12 7h.01', 'M5 9.5h6'],
    file: ['M4 1.5h5l3.5 3.5v9a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z', 'M9 1.5V5h3.5'],
  }

  /** 建立圖示；裝飾用，螢幕閱讀器略過（按鈕的名稱由旁邊的文字或 aria-label 提供） */
  Markloupe.icon = function (name) {
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('class', `ml-icon ml-icon-${name}`)
    svg.setAttribute('aria-hidden', 'true')
    for (const shape of SHAPES[name]) {
      const [tag, attrs] = typeof shape === 'string' ? ['path', { d: shape }] : shape
      const el = document.createElementNS(NS, tag)
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
      svg.append(el)
    }
    return svg
  }
})()
