'use strict'
// 網頁上的 .md：網站權限是選用權限，安裝時不要求；使用者在 popup 或引導頁開啟後，background 才註冊網頁用的 content script
var Markloupe = globalThis.Markloupe || (globalThis.Markloupe = {})

Markloupe.WEB_ORIGINS = ['*://*/*']

/**
 * 把勾選框綁定到網站權限：勾選時向使用者請求，取消時移除；權限在別處變更（擴充功能詳細資料頁）時同步顯示
 * @param {HTMLInputElement} box
 */
Markloupe.bindWebAccess = function (box) {
  const perm = { origins: Markloupe.WEB_ORIGINS }
  const refresh = async () => {
    box.checked = await chrome.permissions.contains(perm)
  }
  box.addEventListener('change', async () => {
    try {
      if (box.checked) await chrome.permissions.request(perm)
      else await chrome.permissions.remove(perm)
    } finally {
      await refresh()
    }
  })
  chrome.permissions.onAdded.addListener(refresh)
  chrome.permissions.onRemoved.addListener(refresh)
  return refresh()
}
