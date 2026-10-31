'use strict'
// Service worker：快捷鍵、代讀本機檔案
importScripts('/src/shared/settings.js')

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'cycle-theme') {
    // 主題是全域設定，所有分頁同步
    const s = await MarkLens.loadSettings()
    await MarkLens.saveSettings({ theme: MarkLens.nextOf(MarkLens.THEME_ORDER, s.theme) })
    return
  }
  // 其餘指令只作用於目前分頁
  if (tab?.id != null) chrome.tabs.sendMessage(tab.id, { type: 'command', name: command }).catch(() => {})
})

// 代 content script 讀取「它自己所在頁面」的本機檔案
// 只接受 sender.url，不接受任意路徑，避免被用來讀取其他檔案
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'read-self') return
  const url = (sender.url || '').split('#')[0]
  if (!url.startsWith('file:') || sender.id !== chrome.runtime.id) {
    reply({ text: null })
    return
  }
  fetch(url, { cache: 'no-store' })
    .then(r => r.arrayBuffer())
    .then(buf => {
      try {
        reply({ text: new TextDecoder('utf-8', { fatal: true }).decode(buf) })
      } catch {
        // 不是合法 UTF-8：交給瀏覽器原本的解碼結果
        reply({ text: null })
      }
    })
    .catch(() => reply({ text: null }))
  return true // 非同步回覆
})
