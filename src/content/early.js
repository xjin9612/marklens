'use strict'
// 最早執行的部分（document_start，早於頁面任何繪製）：處理換頁時的畫面，讓切換檔案不閃爍
// 主程式要等文件讀完、設定與原文讀取完成才會排版；在那之前瀏覽器只能畫出一頁空白。
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

;(() => {
  /*
   * 同一分頁內換檔（點檔案分頁、相對連結、上一頁）：content.css 開啟了跨文件 View Transition，
   * 舊畫面會先保留在新頁上方。新頁排好版後呼叫 MarkLens.revealPage() 立刻結束轉場、顯示新頁，
   * 中間不會出現空白頁。轉場物件只能在 pagereveal 事件裡取得，所以必須在這裡提早監聽。
   */
  let transition = null
  addEventListener('pagereveal', e => (transition = e.viewTransition || null), { once: true })
  MarkLens.revealPage = function () {
    const vt = transition
    transition = null
    vt?.skipTransition()
  }

  /*
   * 開新分頁沒有舊畫面可保留：等待期間的背景色沿用上次的主題（只存在本機檔案的儲存空間），
   * MarkLens 設為深色但系統是淺色時，才不會先白一下。網頁上不讀寫，避免網站藉此得知裝了 MarkLens。
   */
  if (location.protocol === 'file:') {
    try {
      const theme = localStorage.getItem('marklens:theme')
      if (theme === 'light' || theme === 'dark') document.documentElement.dataset.mlEarlyTheme = theme
    } catch {
      // 無法讀取儲存空間時維持跟隨系統
    }
  }
})()
