'use strict'
// 側邊欄「檔案」分頁：目前檔案所在資料夾的 Markdown 與子資料夾
// 預設只讀取同層；子資料夾點開才讀取（大型資料夾不會一次掃描全部）
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

;(() => {
  const { h, t } = MarkLens
  const key = segs => segs.join('/')

  MarkLens.FileTree = class {
    /**
     * @param {object} opts
     * @param {string[]} opts.open 已展開的子資料夾（相對路徑），重新整理後還原
     * @param {(open: string[]) => void} opts.onToggle 展開狀態變更時呼叫，用來保存
     * @param {(text: string) => void} opts.onSummary 更新摘要文字
     */
    constructor({ open = [], onToggle, onSummary }) {
      this.nodes = new Map() // 相對路徑 → { status: 'loading'|'ok'|'error', dirs, files }
      this.open = new Set(open)
      this.onToggle = onToggle
      this.onSummary = onSummary
      this.query = ''
      this.current = decodeName(location.pathname.split('/').pop())
      this.folder = decodeName(location.pathname.split('/').slice(-2, -1)[0] || '')
      this.list = h('ul', { class: 'ml-files-list', attrs: { role: 'tree' } })
      this.el = h('nav', { class: 'ml-files' }, [this.list])
      this.list.addEventListener('click', e => this.onClick(e))
    }

    /** 讀取同層，並還原先前展開的子資料夾 */
    async init() {
      await this.load([])
      // 由淺到深依序讀取，父資料夾讀到後才知道子資料夾還在不在
      for (const p of [...this.open].sort((a, b) => a.split('/').length - b.split('/').length)) {
        const segs = p.split('/')
        const parent = this.nodes.get(key(segs.slice(0, -1)))
        if (parent?.status === 'ok' && parent.dirs.includes(segs.at(-1))) await this.load(segs)
        else this.open.delete(p)
      }
      this.render()
    }

    async load(segs) {
      const k = key(segs)
      this.nodes.set(k, { status: 'loading', dirs: [], files: [] })
      this.render()
      let res
      try {
        res = await chrome.runtime.sendMessage({ type: 'list-dir', path: segs })
      } catch {
        res = null
      }
      this.nodes.set(k, res?.status === 'ok' ? { status: 'ok', dirs: res.dirs, files: res.files } : { status: 'error', dirs: [], files: [] })
      this.render()
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
      this.onToggle?.([...this.open])
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

    render() {
      this.list.textContent = ''
      const root = this.nodes.get('')
      if (!root) return
      if (this.query) return this.renderSearch()
      this.renderDir([], 0, this.list)
      if (root.status === 'ok') this.onSummary?.(t('filesSummary', this.folder, this.countLoaded()))
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
          h('li', { class: 'ml-files-dir', attrs: { 'data-dir': path, role: 'treeitem', 'aria-expanded': String(open), style: `--depth:${depth}` } }, [
            h('span', { class: 'ml-files-twisty', text: open ? '▾' : '▸' }),
            h('span', { class: 'ml-files-icon', text: '📁' }),
            h('span', { class: 'ml-files-name', text: name, title: name }),
          ]),
        )
        if (open) this.renderDir([...segs, name], depth + 1, ul)
      }
      for (const f of node.files) ul.append(this.fileItem(f, depth, f.name, !segs.length && f.name === this.current))
    }

    fileItem(f, depth, label, current) {
      return h('li', { class: `ml-files-file${current ? ' active' : ''}`, attrs: { role: 'treeitem', style: `--depth:${depth}` } }, [
        h('a', { href: f.url, title: label, attrs: current ? { 'aria-current': 'page' } : {} }, [
          h('span', { class: 'ml-files-twisty' }),
          h('span', { class: 'ml-files-icon', text: '📄' }),
          h('span', { class: 'ml-files-name' }, highlight(label, this.query)),
        ]),
      ])
    }

    note(text, depth) {
      return h('li', { class: 'ml-files-note', text, attrs: { style: `--depth:${depth + 1}` } })
    }

    /** 搜尋：只在已讀取的資料夾中比對檔名，以「資料夾 / 檔名」平鋪列出 */
    renderSearch() {
      let n = 0
      for (const [k, node] of this.nodes) {
        if (node.status !== 'ok' || (k && !this.isVisible(k))) continue
        for (const f of node.files) {
          if (!f.name.toLowerCase().includes(this.query)) continue
          const label = k ? `${k} / ${f.name}` : f.name
          this.list.append(this.fileItem(f, 0, label, !k && f.name === this.current))
          n++
        }
      }
      this.onSummary?.(t('filesFound', n))
    }

    /** 子資料夾的每一層都展開著才算看得到 */
    isVisible(path) {
      const segs = path.split('/')
      for (let i = 1; i <= segs.length; i++) if (!this.open.has(key(segs.slice(0, i)))) return false
      return true
    }

    countLoaded() {
      return this.nodes.get('')?.files.length ?? 0
    }
  }

  function decodeName(s) {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
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
