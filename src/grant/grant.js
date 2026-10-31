'use strict'
// 授權頁：新增、確認、移除可寫回的資料夾
;(() => {
  const $ = sel => document.querySelector(sel)
  const list = $('#roots')
  const STATE_TEXT = { granted: '可寫回', prompt: '需要確認', denied: '已拒絕' }

  function say(text) {
    $('#status').textContent = text
  }

  async function render() {
    const roots = await MarkLens.Roots.list()
    list.textContent = ''
    $('#empty').hidden = roots.length > 0
    for (const r of roots) {
      const state = await r.handle.queryPermission({ mode: 'readwrite' })
      const li = document.createElement('li')
      const name = Object.assign(document.createElement('span'), { className: 'name', textContent: r.handle.name })
      const badge = Object.assign(document.createElement('span'), {
        className: `state ${state}`,
        textContent: STATE_TEXT[state] || state,
      })
      li.append(name, badge)
      if (state !== 'granted') {
        const confirm = Object.assign(document.createElement('button'), { className: 'primary', textContent: '確認權限' })
        confirm.onclick = () => guard(async () => {
          const r2 = await r.handle.requestPermission({ mode: 'readwrite' })
          say(r2 === 'granted' ? `已允許：${r.handle.name}` : `未允許：${r.handle.name}`)
          await render()
        })
        li.append(confirm)
      }
      const remove = Object.assign(document.createElement('button'), { textContent: '移除' })
      remove.onclick = () => guard(async () => {
        await MarkLens.Roots.remove(r.id)
        say(`已移除：${r.handle.name}`)
        await render()
      })
      li.append(remove)
      list.append(li)
    }
  }

  function guard(fn) {
    return fn().catch(err => {
      // 使用者在選擇視窗按取消時不必提示
      if (err.name !== 'AbortError') say(`發生錯誤：${err.message}`)
    })
  }

  $('#add').onclick = () => guard(async () => {
    const handle = await showDirectoryPicker({ mode: 'readwrite', id: 'marklens-root' })
    await MarkLens.Roots.add(handle)
    say(`已授權：${handle.name}`)
    await render()
  })

  // 從閱讀頁開啟時，提供返回原分頁
  const back = Number(new URLSearchParams(location.search).get('back'))
  if (back) {
    $('#back-row').hidden = false
    $('#back').onclick = async () => {
      try {
        await chrome.tabs.update(back, { active: true })
      } catch {
        // 原分頁已關閉
      }
      window.close()
    }
  }

  render()
})()
