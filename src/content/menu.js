'use strict'
// 下拉選單：工具列的寬度、字級與主題（單選，目前的值打勾）、檔案分頁資料夾的右鍵選單共用
// 鍵盤：開啟時焦點落在目前選項（或第一項），↑↓／Home／End 移動，Enter／空白鍵選取，Esc 關閉並把焦點還給按鈕
var Markloupe = globalThis.Markloupe || (globalThis.Markloupe = {})

;(() => {
  const { h } = Markloupe
  let current = null // { el, anchor, cleanup }

  Markloupe.closeMenu = function ({ restoreFocus = false } = {}) {
    if (!current) return
    const { el, anchor, cleanup } = current
    current = null
    cleanup()
    el.remove()
    anchor?.setAttribute('aria-expanded', 'false')
    if (restoreFocus) anchor?.focus()
  }

  /** 選單是否正由這個按鈕開著（再按一次按鈕＝關閉） */
  Markloupe.menuOpenFor = anchor => current?.anchor === anchor

  /**
   * 開啟選單
   * @param {object} opts
   * @param {HTMLElement} opts.anchor 觸發的按鈕；選單貼在它下方，關閉後焦點回到它
   * @param {Array<{label: string, icon?: string, checked?: boolean, disabled?: string, fn: Function}>} opts.items
   *   disabled：無法使用的原因；項目顯示為停用（仍可用鍵盤移到），選取時以提示說明原因，不執行 fn
   * @param {boolean} [opts.radio] 單選（項目旁顯示勾號、公開 aria-checked）；沒有 checked 的項目是一般動作（例如放大、縮小）
   * @param {{x: number, y: number}} [opts.at] 指定位置（右鍵選單用滑鼠座標）
   * @param {string} [opts.label] 選單名稱（螢幕閱讀器）
   */
  Markloupe.openMenu = function ({ anchor, items, radio = false, at, label }) {
    Markloupe.closeMenu()
    const buttons = items.map(it => {
      const isRadio = radio && it.checked !== undefined
      return h(
        'button',
        {
          class: `ml-menu-item${it.checked ? ' checked' : ''}`,
          type: 'button',
          title: it.disabled,
          attrs: {
            ...(isRadio ? { role: 'menuitemradio', 'aria-checked': String(!!it.checked) } : { role: 'menuitem' }),
            ...(it.disabled ? { 'aria-disabled': 'true' } : {}),
          },
          on: {
            click: () => {
              Markloupe.closeMenu({ restoreFocus: true })
              if (it.disabled) Markloupe.toast(it.disabled)
              else it.fn()
            },
          },
        },
        [
          radio ? h('span', { class: 'ml-menu-check' }, it.checked ? [Markloupe.icon('check')] : []) : null,
          it.icon ? Markloupe.icon(it.icon) : null,
          h('span', { text: it.label }),
        ],
      )
    })
    const el = h('div', { class: 'ml-menu', attrs: { role: 'menu', ...(label ? { 'aria-label': label } : {}) } }, buttons)
    document.body.append(el)

    // 位置：預設貼在按鈕下方靠右對齊；超出視窗時往內收
    const r = anchor.getBoundingClientRect()
    const pos = at || { x: r.right - el.offsetWidth, y: r.bottom + 4 }
    el.style.left = `${Math.max(8, Math.min(pos.x, innerWidth - el.offsetWidth - 8))}px`
    el.style.top = `${Math.max(8, Math.min(pos.y, innerHeight - el.offsetHeight - 8))}px`

    const onKey = e => {
      const i = buttons.indexOf(document.activeElement)
      const go = n => buttons[(n + buttons.length) % buttons.length].focus()
      if (e.key === 'Escape') Markloupe.closeMenu({ restoreFocus: true })
      else if (e.key === 'ArrowDown') go(i + 1)
      else if (e.key === 'ArrowUp') go(i < 0 ? -1 : i - 1)
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(-1)
      else if (e.key === 'Tab') return Markloupe.closeMenu() // 讓 Tab 照常移到下一個元素
      else return
      e.preventDefault()
      e.stopPropagation() // 選單開著時不觸發頁面的單鍵快捷鍵
    }
    // 點選單外面、捲動頁面、調整視窗大小都關閉（點觸發按鈕本身交給按鈕處理，才能「再按一次關閉」）
    const onOutside = e => {
      if (el.contains(e.target) || anchor.contains(e.target)) return
      Markloupe.closeMenu()
    }
    // 只看頁面本身的捲動（不用捕獲階段）：側邊欄目錄自動捲到目前章節時不該關閉選單
    const onScroll = () => Markloupe.closeMenu()
    const onResize = () => Markloupe.closeMenu()
    el.addEventListener('keydown', onKey)
    addEventListener('pointerdown', onOutside, true)
    addEventListener('scroll', onScroll)
    addEventListener('resize', onResize)
    current = {
      el,
      anchor,
      cleanup: () => {
        removeEventListener('pointerdown', onOutside, true)
        removeEventListener('scroll', onScroll)
        removeEventListener('resize', onResize)
      },
    }
    anchor.setAttribute('aria-expanded', 'true')
    ;(buttons.find(b => b.classList.contains('checked')) || buttons[0]).focus()
  }
})()
