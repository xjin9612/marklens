'use strict'
// 設定面板：表單欄位名稱與設定鍵一一對應，變更即存
;(async () => {
  const { t } = MarkLens
  await MarkLens.initI18n()
  MarkLens.localize()
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
    const preset = MarkLens.WIDTH_PRESETS.includes(s.textWidth)
    widthSel.value = preset ? String(s.textWidth) : 'custom'
    customRow.hidden = preset
    customInput.value = preset ? '' : String(s.textWidth)
    $('#editor-url-row').hidden = s.editor !== 'custom'
  }

  function readValue(el) {
    if (el.type === 'checkbox') return el.checked
    if (el.dataset.type === 'number' || el.type === 'number') return Number(el.value)
    return el.value
  }

  fill({ ...(await MarkLens.loadSettings()), syncEnabled: await MarkLens.isSyncEnabled() })

  form.addEventListener('change', async e => {
    const el = e.target
    if (!el.name) return
    if (el.name === 'textWidth') {
      if (el.value === 'custom') {
        customRow.hidden = false
        customInput.focus()
        return
      }
      customRow.hidden = true
      await MarkLens.saveSettings({ textWidth: Number(el.value) })
    } else if (el.name === 'editor') {
      $('#editor-url-row').hidden = el.value !== 'custom'
      await MarkLens.saveSettings({ editor: el.value })
    } else if (el.name === 'editorUrl') {
      const s = await MarkLens.saveSettings({ editorUrl: el.value.trim() })
      if (el.value.trim() && !MarkLens.editorTemplate(s)) return say(t('editorInvalid'))
    } else if (el.name === 'uiLang') {
      // 介面語言：popup 立即換成新語言；閱讀頁重新整理後套用
      await MarkLens.saveSettings({ uiLang: el.value })
      await MarkLens.initI18n(el.value)
      MarkLens.localize()
    } else if (el.name === 'syncEnabled') {
      // 開啟時若雲端已有設定會套用到這台電腦，重新填入表單
      await MarkLens.setSyncEnabled(el.checked)
      fill({ ...(await MarkLens.loadSettings()), syncEnabled: el.checked })
    } else if (el.name === 'customCss') {
      await MarkLens.saveSettings({ customCss: el.value })
      if (MarkLens.cssBytes(el.value) > MarkLens.CUSTOM_CSS_MAX_BYTES) return say(t('customCssTooLarge'))
    } else if (el.name === 'customWidth') {
      const w = Math.min(4000, Math.max(480, Number(el.value) || 0))
      await MarkLens.saveSettings({ textWidth: w })
    } else {
      if (el.type === 'number' && !el.checkValidity()) return say(t('statusOutOfRange'))
      await MarkLens.saveSettings({ [el.name]: readValue(el) })
    }
    say(t(MarkLens.LIVE_KEYS.includes(el.name) || ['enabled', 'syncEnabled'].includes(el.name) ? 'statusSaved' : 'statusSavedReload'))
  })

  // 可收合區塊的展開狀態：只是這台電腦上的介面偏好，存在 localStorage
  const OPEN_KEY = 'marklens:popup-open'
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

  MarkLens.bindWebAccess($('#web-access'))

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
  $('#help').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome/welcome.html') })
  })
  $('#shortcuts').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
  })

  $('#toggle-raw').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'command', name: 'toggle-raw' })
      window.close()
    } catch {
      say(t('statusNotMarkdown'))
    }
  })
})()
