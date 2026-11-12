'use strict'
// 擴充功能頁面（popup、引導頁、授權頁）的主題：跟閱讀頁一樣依 Markloupe 的主題設定（自動／淺色／深色）
// 放在 <head> 同步執行：先依系統深淺色設定，讀到設定後再修正，避免畫面先白再暗
;(() => {
  const root = document.documentElement
  const dark = matchMedia('(prefers-color-scheme: dark)')
  let theme = 'auto'
  const apply = () => (root.dataset.mlTheme = theme === 'auto' ? (dark.matches ? 'dark' : 'light') : theme)
  apply()
  dark.addEventListener('change', apply)
  const KEY = 'markloupe:settings'
  chrome.storage.local.get(KEY).then(d => {
    theme = d[KEY]?.theme || 'auto'
    apply()
  })
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local' || !c[KEY]) return
    theme = c[KEY].newValue?.theme || 'auto'
    apply()
  })
})()
