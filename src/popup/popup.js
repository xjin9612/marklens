'use strict'
// 設定面板：表單欄位名稱與設定鍵一一對應，變更即存
;(async () => {
  const { t } = Markloupe
  await Markloupe.initI18n()
  Markloupe.localize()
  const form = document.body
  const $ = sel => document.querySelector(sel)
  const status = $('#status')
  const customRow = $('#custom-width-row')
  const widthSel = form.querySelector('[name=textWidth]')
  const customInput = form.querySelector('[name=customWidth]')

  function say(text) {
    status.textContent = text
    clearTimeout(say.t)
    say.t = setTimeout(() => (status.textContent = ''), 1500)
  }

  function fill(s) {
    for (const el of form.querySelectorAll('[name]')) {
      const key = el.name
      if (!(key in s)) continue
      if (el.type === 'checkbox') el.checked = !!s[key]
      else el.value = String(s[key])
    }
    // 不在預設選項中的寬度視為自訂
    const preset = Markloupe.WIDTH_PRESETS.includes(s.textWidth)
    widthSel.value = preset ? String(s.textWidth) : 'custom'
    customRow.hidden = preset
    customInput.value = preset ? '' : String(s.textWidth)
    $('#editor-url-row').hidden = s.editor !== 'custom'
    fillColors(s)
  }

  /* ---------- 自訂配色 ---------- */
  const COLOR_NAMES = { bg: 'colorBg', fg: 'colorFg', accent: 'colorAccent' }
  const THEME_NAMES = { light: 'themeLight', dark: 'themeDark' }
  let colors = Markloupe.DEFAULTS.customColors
  const colorName = cc => {
    const [theme, key] = cc.split('.')
    return t('colorName', t(THEME_NAMES[theme]), t(COLOR_NAMES[key]))
  }
  const withColor = (all, cc, value) => {
    const [theme, key] = cc.split('.')
    return { ...all, [theme]: { ...all[theme], [key]: value } }
  }
  const colorOf = cc => {
    const [theme, key] = cc.split('.')
    return colors[theme][key]
  }

  /** 只更新這個顏色的色碼欄位與色塊，不重填其他正在輸入的欄位 */
  function showColor(cc, value) {
    const input = form.querySelector(`input[data-cc="${cc}"]`)
    input.value = value
    input.removeAttribute('aria-invalid')
    form.querySelector(`[data-swatch="${cc}"]`).style.background = value
  }

  function fillColors(s) {
    if (picker.cc) {
      hidePicker()
      preview(null)
    }
    $('#custom-colors').hidden = s.palette !== 'custom'
    colors = { light: Markloupe.customColorsFor(s.customColors, 'light'), dark: Markloupe.customColorsFor(s.customColors, 'dark') }
    for (const el of form.querySelectorAll('input[data-cc]')) showColor(el.dataset.cc, colorOf(el.dataset.cc))
    labelColors()
  }

  /** 依介面語言寫入的文字；切換介面語言時要重寫 */
  function labelColors() {
    for (const el of form.querySelectorAll('[data-cc], [data-swatch]')) el.setAttribute('aria-label', colorName(el.dataset.cc || el.dataset.swatch))
    if (picker.cc) $('#cc-picker-name').textContent = colorName(picker.cc)
    showContrast()
  }

  /** 文字與強調色由使用者決定，不自動調整；對比不足時提醒 */
  function showContrast() {
    const low = []
    for (const theme of ['light', 'dark']) {
      for (const key of ['fg', 'accent']) {
        const ratio = Markloupe.contrastRatio(colors[theme][key], colors[theme].bg)
        if (ratio < 4.5) low.push(`${colorName(`${theme}.${key}`)} ${ratio.toFixed(1)}:1`)
      }
    }
    $('#cc-warning').hidden = !low.length
    $('#cc-warning').textContent = low.length ? t('colorLowContrast', low.join(' / ')) : ''
  }

  async function setColor(cc, value) {
    colors = withColor(colors, cc, value)
    showColor(cc, value)
    showContrast()
    await storeColors(stored => withColor(stored, cc, value))
    say(t('statusSaved'))
  }

  async function saveColor(el) {
    const value = Markloupe.parseHexColor(el.value)
    if (!value) {
      el.setAttribute('aria-invalid', 'true')
      return say(t('colorInvalid'))
    }
    if (picker.cc === el.dataset.cc) {
      Object.assign(picker, { original: value }, hexToHsv(value))
      drawPicker()
    }
    await setColor(el.dataset.cc, value)
  }

  /**
   * customColors 整份寫入，所以存檔依序執行，每次以儲存中的最新值為底：
   * 連續修改、其他分頁或同步帶來的變更都不會被 popup 開啟時的舊值蓋掉
   */
  let colorQueue = Promise.resolve()
  function storeColors(update) {
    const run = colorQueue.then(async () => {
      const cur = (await Markloupe.loadSettings()).customColors
      const stored = { light: Markloupe.customColorsFor(cur, 'light'), dark: Markloupe.customColorsFor(cur, 'dark') }
      await Markloupe.saveSettings({ customColors: update(stored) })
    })
    colorQueue = run.catch(() => {})
    return run
  }

  /* 調色區塊：拖動時只預覽，按「完成」才存檔；「取消」或關閉 popup 都回到原本的顏色 */
  const picker = { cc: null, original: '', h: 0, s: 0, v: 0 }
  const sv = $('.cc-sv')
  const hue = $('.cc-hue')
  const clamp = x => Math.min(1, Math.max(0, x))

  function hexToHsv(hex) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    const max = Math.max(r, g, b)
    const d = max - Math.min(r, g, b)
    let h = 0
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max }
  }

  function hsvToHex({ h, s, v }) {
    const f = n => {
      const k = (n + h / 60) % 6
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
    }
    return `#${[5, 3, 1].map(n => Math.round(f(n) * 255).toString(16).padStart(2, '0')).join('')}`
  }

  function drawPicker() {
    sv.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${picker.h} 100% 50%))`
    sv.firstElementChild.style.left = `${picker.s * 100}%`
    sv.firstElementChild.style.top = `${(1 - picker.v) * 100}%`
    sv.setAttribute('aria-valuetext', hsvToHex(picker))
    hue.value = String(Math.round(picker.h))
  }

  function openPicker(cc) {
    if (picker.cc === cc) return
    if (picker.cc) donePicker()
    Object.assign(picker, { cc, original: colorOf(cc) }, hexToHsv(colorOf(cc)))
    $('#cc-picker-name').textContent = colorName(cc)
    $('#cc-picker').hidden = false
    form.querySelector(`[data-swatch="${cc}"]`).setAttribute('aria-expanded', 'true')
    drawPicker()
    sv.focus()
  }

  function hidePicker() {
    cancelAnimationFrame(previewFrame)
    form.querySelector(`[data-swatch="${picker.cc}"]`).setAttribute('aria-expanded', 'false')
    picker.cc = null
    $('#cc-picker').hidden = true
  }

  function pickerChanged() {
    const hex = hsvToHex(picker)
    colors = withColor(colors, picker.cc, hex)
    showColor(picker.cc, hex)
    showContrast()
    drawPicker()
    schedulePreview()
  }

  // 先存檔再結束預覽，閱讀頁不會閃回舊顏色
  function donePicker() {
    const { cc } = picker
    hidePicker()
    setColor(cc, colorOf(cc)).finally(() => preview(null))
  }

  function cancelPicker() {
    const { cc, original } = picker
    hidePicker()
    colors = withColor(colors, cc, original)
    showColor(cc, original)
    showContrast()
    preview(null)
  }

  function pickAt(e) {
    const r = sv.getBoundingClientRect()
    picker.s = clamp((e.clientX - r.left) / r.width)
    picker.v = 1 - clamp((e.clientY - r.top) / r.height)
    pickerChanged()
  }
  sv.addEventListener('pointerdown', e => {
    sv.setPointerCapture(e.pointerId)
    pickAt(e)
  })
  sv.addEventListener('pointermove', e => {
    if (sv.hasPointerCapture(e.pointerId)) pickAt(e)
  })
  sv.addEventListener('keydown', e => {
    const step = e.shiftKey ? 0.1 : 0.02
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
    if (!d) return
    e.preventDefault()
    picker.s = clamp(picker.s + d[0])
    picker.v = clamp(picker.v + d[1])
    pickerChanged()
  })
  hue.addEventListener('input', () => {
    picker.h = Number(hue.value)
    pickerChanged()
  })
  $('#cc-picker').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') donePicker()
  })
  for (const el of form.querySelectorAll('[data-swatch]')) el.addEventListener('click', () => openPicker(el.dataset.swatch))
  $('#cc-done').addEventListener('click', donePicker)
  $('#cc-cancel').addEventListener('click', cancelPicker)

  /**
   * 預覽送到每個分頁的閱讀頁（null 表示結束預覽）；popup 關閉時連線中斷，閱讀頁回到設定中的顏色。
   * 不是閱讀頁的分頁沒有接收端，連線會立即中斷
   */
  let ports = null
  async function preview(next) {
    if (!ports && next === null) return
    ports ??= chrome.tabs.query({}).then(tabs =>
      tabs.flatMap(tab => {
        try {
          const port = chrome.tabs.connect(tab.id, { name: 'ml-color-preview' })
          port.onDisconnect.addListener(() => void chrome.runtime.lastError)
          return [port]
        } catch {
          return [] // 分頁已關閉
        }
      })
    )
    for (const port of await ports) {
      try {
        port.postMessage(next)
      } catch {
        // 已中斷的連線
      }
    }
  }
  let previewFrame = 0
  function schedulePreview() {
    cancelAnimationFrame(previewFrame)
    previewFrame = requestAnimationFrame(() => preview(colors))
  }

  function readValue(el) {
    if (el.type === 'checkbox') return el.checked
    if (el.dataset.type === 'number' || el.type === 'number') return Number(el.value)
    return el.value
  }

  fill({ ...(await Markloupe.loadSettings()), syncEnabled: await Markloupe.isSyncEnabled() })

  form.addEventListener('change', async e => {
    const el = e.target
    if (el.dataset.cc) return saveColor(el)
    if (!el.name) return
    if (el.name === 'palette') {
      if (picker.cc) cancelPicker()
      $('#custom-colors').hidden = el.value !== 'custom'
    }
    if (el.name === 'textWidth') {
      if (el.value === 'custom') {
        customRow.hidden = false
        customInput.focus()
        return
      }
      customRow.hidden = true
      await Markloupe.saveSettings({ textWidth: Number(el.value) })
    } else if (el.name === 'editor') {
      $('#editor-url-row').hidden = el.value !== 'custom'
      await Markloupe.saveSettings({ editor: el.value })
    } else if (el.name === 'editorUrl') {
      const s = await Markloupe.saveSettings({ editorUrl: el.value.trim() })
      if (el.value.trim() && !Markloupe.editorTemplate(s)) return say(t('editorInvalid'))
    } else if (el.name === 'uiLang') {
      // 介面語言：popup 立即換成新語言；閱讀頁重新整理後套用
      await Markloupe.saveSettings({ uiLang: el.value })
      await Markloupe.initI18n(el.value)
      Markloupe.localize()
      labelColors()
    } else if (el.name === 'syncEnabled') {
      // 開啟時若雲端已有設定會套用到這台電腦，重新填入表單
      await Markloupe.setSyncEnabled(el.checked)
      fill({ ...(await Markloupe.loadSettings()), syncEnabled: el.checked })
    } else if (el.name === 'customCss') {
      await Markloupe.saveSettings({ customCss: el.value })
      if (Markloupe.cssBytes(el.value) > Markloupe.CUSTOM_CSS_MAX_BYTES) return say(t('customCssTooLarge'))
    } else if (el.name === 'customWidth') {
      const w = Math.min(4000, Math.max(480, Number(el.value) || 0))
      await Markloupe.saveSettings({ textWidth: w })
    } else {
      if (el.type === 'number' && !el.checkValidity()) return say(t('statusOutOfRange'))
      await Markloupe.saveSettings({ [el.name]: readValue(el) })
    }
    say(t(Markloupe.LIVE_KEYS.includes(el.name) || ['enabled', 'syncEnabled'].includes(el.name) ? 'statusSaved' : 'statusSavedReload'))
  })

  // 可收合區塊的展開狀態：只是這台電腦上的介面偏好，存在 localStorage
  const OPEN_KEY = 'markloupe:popup-open'
  let opened = []
  try {
    opened = JSON.parse(localStorage.getItem(OPEN_KEY)) || []
  } catch {
    // 讀不到就全部收合
  }
  for (const d of document.querySelectorAll('details.sec')) {
    d.open = opened.includes(d.dataset.sec)
    d.addEventListener('toggle', () => {
      const now = [...document.querySelectorAll('details.sec[open]')].map(x => x.dataset.sec)
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(now))
      } catch {
        // 存不了就下次再收合
      }
    })
  }

  $('#cc-reset').addEventListener('click', async () => {
    fillColors({ palette: 'custom', customColors: Markloupe.DEFAULTS.customColors })
    await storeColors(() => Markloupe.DEFAULTS.customColors)
    say(t('statusSaved'))
  })

  Markloupe.bindWebAccess($('#web-access'))

  // 本機檔案存取權限提示
  chrome.extension.isAllowedFileSchemeAccess(allowed => {
    $('#file-warning').hidden = allowed
  })
  $('#open-details').addEventListener('click', () => {
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })
  })
  $('#manage-roots').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/grant/grant.html') })
  })
  $('#help').append(Markloupe.icon('help'))
  $('#shortcuts').append(Markloupe.icon('keyboard'))
  $('#help').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome/welcome.html') })
  })
  $('#shortcuts').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
  })
})()
