'use strict'
// 介面文字：來自 _locales/<語系>/messages.json（chrome.i18n 依瀏覽器語言挑選，找不到時用 en）
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

;(() => {
  // 不帶參數的訊息會快取：擴充功能被重新載入後，舊分頁的 chrome.* 會失效，快取讓已用過的文字仍可顯示
  const cache = new Map()

  /**
   * 取得翻譯文字；訊息中的 $1、$2… 依序替換為 subs
   * 找不到訊息時回傳 key 本身，方便發現遺漏
   */
  MarkLens.t = function (key, ...subs) {
    if (!subs.length && cache.has(key)) return cache.get(key)
    let text = ''
    try {
      text = chrome.i18n.getMessage(key, subs.map(String))
    } catch {
      // 擴充功能已失效
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
    try {
      document.documentElement.lang = chrome.i18n.getUILanguage()
    } catch {
      // 忽略
    }
  }
})()
