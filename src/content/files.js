'use strict'
// 側邊欄「檔案」分頁：資料夾裡的 Markdown 與子資料夾
// 預設只讀取一層；子資料夾點開才讀取（大型資料夾不會一次掃描全部）。
// 樹的起點（root）在同一個分頁中保持不變：從檔案分頁點進子資料夾的檔案後，仍可回到原本的資料夾；
// 可以用「↑」把起點往上一層，或在資料夾上按右鍵「以此資料夾為起點」。
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

;(() => {
  const { h, t } = MarkLens
  const key = segs => segs.join('/')

  function decodeName(s) {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  }

  /*
   * 資料夾清單快取（sessionStorage，只在本分頁）：同一分頁內換檔時先顯示上次的清單，
   * 背景重新讀取後再更新，側邊欄不會每次都閃一下「讀取中」。
   */
  const CACHE_KEY = 'marklens:files'
  const CACHE_LIMIT = 50 // 最多記住幾個資料夾，超過時丟掉最舊的
  function readCache() {
    try {
      return JSON.parse(sessionStorage.getItem(CACHE_KEY)) || {}
    } catch {
      return {}
    }
  }
  function writeCache(url, entry) {
    try {
      const cache = readCache()
      delete cache[url] // 重新插入，讓它排到最後（最新）
      cache[url] = entry
      const urls = Object.keys(cache)
      for (const old of urls.slice(0, Math.max(0, urls.length - CACHE_LIMIT))) delete cache[old]
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache))
    } catch {
      // 寫不進去（空間不足等）就不快取
    }
  }

  /** 保存的起點是否像本機資料夾網址（實際檢查由背景程式負責） */
  function isFolder(root) {
    return typeof root === 'string' && root.startsWith('file:///') && root.endsWith('/')
  }

  MarkLens.FileTree = class {
    /**
     * @param {object} opts
     * @param {string} [opts.root] 樹的起點（file:// 資料夾網址，結尾為 /），重新整理或在分頁內切換檔案後沿用
     * @param {string[]} [opts.open] 已展開的子資料夾（相對起點的路徑）
     * @param {(state: {root: string, open: string[]}) => void} opts.onChange 起點或展開狀態變更時呼叫，用來保存
     */
    constructor({ root, open = [], onChange }) {
      this.page = location.href.split(/[?#]/)[0]
      this.pageDir = this.page.slice(0, this.page.lastIndexOf('/') + 1)
      const keep = isFolder(root)
      this.root = keep ? root : this.pageDir
      this.open = new Set(keep ? open : [])
      this.expandToPage()
      this.onChange = onChange
      this.nodes = new Map() // 相對路徑 → { status: 'loading'|'ok'|'error', dirs, files }
      this.gen = 0 // 每次 init() 加一，用來丟棄起點變更前發出的讀取
      this.query = ''

      this.upBtn = h('button', { class: 'ml-files-up', text: '↑', attrs: { 'aria-label': t('filesUpLabel') }, on: { click: () => this.goUp() } })
      this.summary = h('span', { class: 'ml-files-summary' })
      // 一般清單＋按鈕與連結：用 Tab 鍵逐列移動，Enter 展開資料夾（不宣告 tree，tree 需要完整的方向鍵操作）
      this.list = h('ul', { class: 'ml-files-list' })
      this.el = h('nav', { class: 'ml-files' }, [h('div', { class: 'ml-files-bar' }, [this.upBtn, this.summary]), this.list])
      this.list.addEventListener('click', e => this.onClick(e))
      this.list.addEventListener('contextmenu', e => {
        const row = e.target.closest('[data-dir]')
        if (row) this.showMenu(e, row)
      })
    }

    /** 目前檔案在起點底下時，自動展開到它所在的資料夾 */
    expandToPage() {
      // 比較解碼後的路徑：頁面網址與自行組出的起點網址，對 + & , 等字元的編碼方式可能不同
      const page = decodeName(this.pageDir)
      const root = decodeName(this.root)
      if (!page.startsWith(root)) return
      const rel = page.slice(root.length).split('/').filter(Boolean)
      for (let i = 1; i <= rel.length; i++) this.open.add(key(rel.slice(0, i)))
    }

    get folder() {
      return decodeName(this.root.split('/').slice(-2, -1)[0] || '/')
    }

    get parent() {
      // 不超過磁碟根目錄：Windows 的 file:///D:/，其他系統的 file:///
      if (/^file:\/\/\/(?:[A-Za-z]:\/)?$/.test(this.root)) return null
      const p = this.root.replace(/[^/]+\/$/, '')
      return p !== this.root ? p : null
    }

    save() {
      this.onChange?.({ root: this.root, open: [...this.open] })
    }

    /** 子資料夾的網址（快取的鍵） */
    dirUrl(segs) {
      return this.root + segs.map(s => `${encodeURIComponent(s)}/`).join('')
    }

    /** 讀取起點，並依序還原展開的子資料夾 */
    async init() {
      // 起點換了之後，舊的讀取結果全部作廢
      const gen = ++this.gen
      this.nodes.clear()
      // 先同步畫出快取的清單（換檔時側邊欄維持原樣），再逐一重新讀取
      const cache = readCache()
      for (const segs of [[], ...[...this.open].map(p => p.split('/'))]) {
        const c = cache[this.dirUrl(segs)]
        if (c) this.nodes.set(key(segs), { status: 'ok', dirs: c.dirs, files: c.files })
      }
      this.render()
      await this.load([], gen)
      if (gen !== this.gen) return
      // 由淺到深讀取，父資料夾讀到後才知道子資料夾還在不在
      for (const p of [...this.open].sort((a, b) => a.split('/').length - b.split('/').length)) {
        const segs = p.split('/')
        const parent = this.nodes.get(key(segs.slice(0, -1)))
        if (parent?.status === 'ok' && parent.dirs.includes(segs.at(-1))) await this.load(segs, gen)
        else this.open.delete(p)
        if (gen !== this.gen) return
      }
      this.render()
    }

    async load(segs, gen = this.gen) {
      const k = key(segs)
      // 已有清單（快取或先前讀過）時重新讀取期間照常顯示，不換成「讀取中」
      if (this.nodes.get(k)?.status !== 'ok') {
        this.nodes.set(k, { status: 'loading', dirs: [], files: [] })
        this.render()
      }
      let res
      try {
        res = await chrome.runtime.sendMessage({ type: 'list-dir', root: this.root, path: segs })
      } catch {
        res = null
      }
      if (gen !== this.gen) return
      if (res?.status === 'ok') {
        const prev = this.nodes.get(k)
        const same = prev?.status === 'ok' && JSON.stringify([prev.dirs, prev.files]) === JSON.stringify([res.dirs, res.files])
        writeCache(this.dirUrl(segs), { dirs: res.dirs, files: res.files })
        // 與快取相同就不重畫，捲動位置與滑鼠停留狀態都不受影響
        if (same) return
        this.nodes.set(k, { status: 'ok', dirs: res.dirs, files: res.files })
      } else {
        this.nodes.set(k, { status: 'error', dirs: [], files: [] })
      }
      this.render()
    }

    /** 起點往上一層；原本的展開狀態接在新起點底下 */
    async goUp() {
      const parent = this.parent
      if (!parent) return
      const name = decodeName(this.root.slice(parent.length, -1))
      this.open = new Set([name, ...[...this.open].map(p => `${name}/${p}`)])
      this.root = parent
      this.save()
      await this.init()
    }

    /** 以子資料夾為新的起點（右鍵選單） */
    async setRoot(path) {
      const prefix = `${path}/`
      this.root += path.split('/').map(s => `${encodeURIComponent(s)}/`).join('')
      this.open = new Set([...this.open].filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length)))
      this.expandToPage()
      this.save()
      await this.init()
    }

    /** 資料夾的右鍵選單；鍵盤（選單鍵、Shift+F10）觸發時沒有滑鼠座標，改貼在該列下方 */
    showMenu(e, row) {
      e.preventDefault()
      this.closeMenu()
      const path = row.dataset.dir
      let { clientX: x, clientY: y } = e
      if (!x && !y) {
        const r = row.getBoundingClientRect()
        x = r.left + 24
        y = r.bottom
      }
      const item = h('button', {
        class: 'ml-files-menu-item',
        text: t('filesSetRoot'),
        attrs: { role: 'menuitem' },
        on: {
          click: () => {
            this.closeMenu()
            this.setRoot(path)
          },
        },
      })
      this.menu = h('div', { class: 'ml-files-menu', attrs: { role: 'menu' }, style: { left: `${x}px`, top: `${y}px` } }, [item])
      document.body.append(this.menu)
      item.focus()
      const close = ev => {
        if (ev.type === 'keydown' && ev.key !== 'Escape') return
        if (ev.type !== 'keydown' && this.menu?.contains(ev.target)) return
        this.closeMenu()
      }
      this.menuClose = close
      for (const type of ['pointerdown', 'keydown', 'scroll', 'blur']) addEventListener(type, close, true)
    }

    closeMenu() {
      this.menu?.remove()
      this.menu = null
      if (this.menuClose) for (const type of ['pointerdown', 'keydown', 'scroll', 'blur']) removeEventListener(type, this.menuClose, true)
      this.menuClose = null
    }

    async toggle(path) {
      if (this.open.has(path)) {
        this.open.delete(path)
        this.render()
      } else {
        this.open.add(path)
        if (!this.nodes.has(path) || this.nodes.get(path).status === 'error') await this.load(path.split('/'))
        else this.render()
      }
      this.save()
    }

    setQuery(q) {
      this.query = q.trim().toLowerCase()
      this.render()
    }

    onClick(e) {
      const row = e.target.closest('[data-dir]')
      if (row) {
        e.preventDefault()
        this.toggle(row.dataset.dir)
      }
      // 檔案是一般連結：同分頁開啟，中鍵或 Ctrl＋點擊則開新分頁
    }

    isCurrent(f) {
      return decodeName(f.url) === decodeName(this.page)
    }

    render() {
      this.list.textContent = ''
      const parent = this.parent
      this.upBtn.disabled = !parent
      this.upBtn.title = parent ? t('filesUp', decodeName(parent.split('/').slice(-2, -1)[0] || '/')) : ''
      const root = this.nodes.get('')
      if (!root) return
      if (this.query) return this.renderSearch()
      this.renderDir([], 0, this.list)
      this.summary.textContent = root.status === 'ok' ? t('filesSummary', this.folder, root.files.length) : this.folder
    }

    renderDir(segs, depth, ul) {
      const node = this.nodes.get(key(segs))
      if (!node || node.status === 'loading') return ul.append(this.note(t('filesLoading'), depth))
      if (node.status === 'error') return ul.append(this.note(t('filesError'), depth))
      if (!node.dirs.length && !node.files.length) return ul.append(this.note(t('filesEmpty'), depth))
      for (const name of node.dirs) {
        const path = key([...segs, name])
        const open = this.open.has(path)
        ul.append(
          h('li', { class: 'ml-files-dir', attrs: { 'data-dir': path, style: `--depth:${depth}` } }, [
            h('button', { class: 'ml-files-row', type: 'button', title: name, attrs: { 'aria-expanded': String(open) } }, [
              h('span', { class: 'ml-files-twisty', text: open ? '▾' : '▸' }),
              h('span', { class: 'ml-files-icon', text: '📁' }),
              h('span', { class: 'ml-files-name', text: name }),
            ]),
          ]),
        )
        if (open) this.renderDir([...segs, name], depth + 1, ul)
      }
      for (const f of node.files) ul.append(this.fileItem(f, depth, f.name))
    }

    fileItem(f, depth, label) {
      const current = this.isCurrent(f)
      return h('li', { class: `ml-files-file${current ? ' active' : ''}`, attrs: { style: `--depth:${depth}` } }, [
        h('a', { class: 'ml-files-row', href: f.url, title: label, attrs: current ? { 'aria-current': 'page' } : {} }, [
          h('span', { class: 'ml-files-twisty' }),
          h('span', { class: 'ml-files-icon', text: '📄' }),
          h('span', { class: 'ml-files-name' }, highlight(label, this.query)),
        ]),
      ])
    }

    note(text, depth) {
      return h('li', { class: 'ml-files-note', text, attrs: { style: `--depth:${depth + 1}` } })
    }

    /** 搜尋：只在已展開的資料夾中比對檔名，以「資料夾 / 檔名」平鋪列出 */
    renderSearch() {
      let n = 0
      for (const [k, node] of this.nodes) {
        if (node.status !== 'ok' || (k && !this.isVisible(k))) continue
        for (const f of node.files) {
          if (!f.name.toLowerCase().includes(this.query)) continue
          this.list.append(this.fileItem(f, 0, k ? `${k} / ${f.name}` : f.name))
          n++
        }
      }
      this.summary.textContent = t('filesFound', n)
    }

    /** 子資料夾的每一層都展開著才算看得到 */
    isVisible(path) {
      const segs = path.split('/')
      for (let i = 1; i <= segs.length; i++) if (!this.open.has(key(segs.slice(0, i)))) return false
      return true
    }
  }

  /** 標出搜尋字串（大小寫不分） */
  function highlight(text, q) {
    if (!q) return [text]
    const out = []
    const lower = text.toLowerCase()
    let i = 0
    let j
    while ((j = lower.indexOf(q, i)) >= 0) {
      out.push(text.slice(i, j), h('mark', { text: text.slice(j, j + q.length) }))
      i = j + q.length
    }
    out.push(text.slice(i))
    return out
  }
})()
