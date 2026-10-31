'use strict'
// 已授權的資料夾（FileSystemDirectoryHandle）
// 存在擴充功能自己的 IndexedDB（chrome-extension:// origin），本機網頁無法取得
// 供 background 與授權頁使用；content script 不載入此檔
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

MarkLens.Roots = (() => {
  const DB_NAME = 'marklens'
  const STORE = 'roots'

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  async function run(mode, fn) {
    const db = await open()
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        tx.oncomplete = () => resolve(req?.result)
        tx.onerror = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  }

  /** @returns {Promise<Array<{id:number, handle:FileSystemDirectoryHandle, addedAt:number}>>} */
  const list = () => run('readonly', s => s.getAll())

  /** 加入資料夾；同一個資料夾重複授權時回傳既有的項目 */
  async function add(handle) {
    for (const r of await list()) {
      if (await r.handle.isSameEntry(handle)) return r
    }
    const id = await run('readwrite', s => s.add({ handle, addedAt: Date.now() }))
    return { id, handle }
  }

  const remove = id => run('readwrite', s => s.delete(id))

  /**
   * 由頁面網址找到對應的檔案
   * handle 不提供絕對路徑，所以在網址路徑中找出與資料夾同名的段落，再逐層往下；
   * 同名段落可能出現多次，逐一嘗試。找到的檔案是否正確，由呼叫端比對內容確認。
   * @returns {Promise<{root, file: FileSystemFileHandle, path: string} | null>}
   */
  async function locate(pageUrl) {
    const segs = decodeURIComponent(new URL(pageUrl).pathname).split('/').filter(Boolean)
    for (const root of await list()) {
      const name = root.handle.name.toLowerCase()
      for (let i = 0; i < segs.length - 1; i++) {
        if (segs[i].toLowerCase() !== name) continue
        try {
          let dir = root.handle
          const rest = segs.slice(i + 1)
          for (const part of rest.slice(0, -1)) dir = await dir.getDirectoryHandle(part)
          const file = await dir.getFileHandle(rest[rest.length - 1])
          return { root, file, path: `${root.handle.name}/${rest.join('/')}` }
        } catch {
          // 這個位置對不上，繼續找下一個
        }
      }
    }
    return null
  }

  return { list, add, remove, locate }
})()
