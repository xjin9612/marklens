'use strict'
// 首次安裝引導頁：檢查「允許存取檔案網址」是否已開啟，並引導使用者開啟
;(async () => {
  await Markloupe.initI18n()
  Markloupe.localize()
  const $ = sel => document.querySelector(sel)
  const { t } = Markloupe

  function refreshFileAccess() {
    chrome.extension.isAllowedFileSchemeAccess(allowed => {
      const status = $('#file-status')
      status.dataset.state = allowed ? 'ok' : 'off'
      status.textContent = t(allowed ? 'welcomeFileOk' : 'welcomeFileOff')
      $('#step-file').toggleAttribute('data-done', allowed)
    })
  }

  $('#open-details').addEventListener('click', () => {
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })
  })
  $('#version').textContent = `Markloupe ${chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version}`

  Markloupe.bindWebAccess($('#web-access'))
  refreshFileAccess()
  // 使用者切到設定頁開啟後再回來：分頁重新可見時重新檢查
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshFileAccess()
  })
  addEventListener('focus', refreshFileAccess)
})()
