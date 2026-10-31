'use strict'
// 介面文字：來自 _locales/<語系>/messages.json
// 預設跟隨瀏覽器語言（chrome.i18n，找不到時用 en）；設定中指定語言時改讀該語系檔，不必更改 Chrome 的語言
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

;(() => {
  MarkLens.UI_LANGS = ['en', 'zh_TW'] // 與 _locales/ 的資料夾一致

  // 不帶參數的訊息會快取：擴充功能被重新載入後，舊分頁的 chrome.* 會失效，快取讓已用過的文字仍可顯示
  const cache = new Map()
  let dict = null // 指定語言時的訊息表 { key: { message } }
  let lang = null

  /** 依 Chrome 規則替換：$1…$9 為參數，$$ 為 $ 字元 */
  function format(message, subs) {
    return message.replace(/\$(\$|[1-9])/g, (_, g) => (g === '$' ? '$' : (subs[g - 1] ?? '')))
  }

  /** 讀取語系檔：擴充功能頁面可直接讀；content script 無權讀取，交給背景程式 */
  async function readMessages(code) {
    if (location.protocol === 'chrome-extension:') {
      return (await fetch(chrome.runtime.getURL(`_locales/${code}/messages.json`))).json()
    }
    const res = await chrome.runtime.sendMessage({ type: 'read-messages', lang: code })
    if (res?.status !== 'ok') throw new Error(res?.error || 'cannot read messages')
    return res.messages
  }

  /**
   * 套用介面語言設定，需在 t() 之前呼叫
   * @param {string} [setting] 'auto' | 'en' | 'zh_TW'；省略時從設定讀取
   */
  MarkLens.initI18n = async function (setting) {
    try {
      setting ??= (await MarkLens.loadSettings()).uiLang
    } catch {
      setting = 'auto'
    }
    cache.clear()
    dict = null
    lang = null
    if (!MarkLens.UI_LANGS.includes(setting)) return
    try {
      dict = await readMessages(setting)
      lang = setting
    } catch {
      // 讀不到就退回瀏覽器語言
    }
  }

  /** 目前介面語言的 BCP 47 代碼（給 <html lang>） */
  MarkLens.uiLanguage = function () {
    if (lang) return lang.replace('_', '-')
    try {
      return chrome.i18n.getUILanguage()
    } catch {
      return ''
    }
  }

  /**
   * 取得翻譯文字；訊息中的 $1、$2… 依序替換為 subs
   * 找不到訊息時回傳 key 本身，方便發現遺漏
   */
  MarkLens.t = function (key, ...subs) {
    if (!subs.length && cache.has(key)) return cache.get(key)
    const args = subs.map(String)
    let text = ''
    if (dict?.[key]) {
      text = format(dict[key].message, args)
    } else {
      try {
        text = chrome.i18n.getMessage(key, args)
      } catch {
        // 擴充功能已失效
      }
    }
    text ||= key
    if (!subs.length) cache.set(key, text)
    return text
  }

  /**
   * 套用到擴充功能自己的頁面（popup、授權頁、引導頁）
   * data-i18n：純文字；data-i18n-html：含 <b>、<code> 等標記（訊息由擴充功能自帶，不含外部輸入）；
   * data-i18n-title／data-i18n-placeholder：屬性
   */
  MarkLens.localize = function (root = document) {
    for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = MarkLens.t(el.dataset.i18n)
    for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = MarkLens.t(el.dataset.i18nHtml)
    for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = MarkLens.t(el.dataset.i18nTitle)
    for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = MarkLens.t(el.dataset.i18nPlaceholder)
    document.documentElement.lang = MarkLens.uiLanguage()
  }
})()
