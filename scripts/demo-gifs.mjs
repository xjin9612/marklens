// 產生 README 的示範動畫（docs/screenshots/*.gif）
// 用法：CDP_URL=http://127.0.0.1:9222 npm run gifs
//   連到已載入 Markloupe、開啟「允許存取檔案網址」的 Chrome（--remote-debugging-port），以 CDP 錄製畫面，再用 ffmpeg 轉成 GIF
//   需要 ffmpeg；介面一律英文，中英 README 共用。會改動該 Chrome 的 Markloupe 設定並加入一個授權資料夾，請用專用的 profile
import { createRequire } from 'node:module'
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'docs/screenshots')
// 放在 repo 內（dist/ 不進版控）：Chrome 可能在 Windows 端執行，讀不到 WSL 的 /tmp
const work = join(root, 'dist/gif-work')
rmSync(work, { recursive: true, force: true })
// 勾選寫回的檔案放在 work/ 下：網址路徑中的 work/ 對應 OPFS 裡同名的已授權資料夾（與 e2e 相同的模擬方式）
const taskDir = join(work, 'work')
mkdirSync(taskDir, { recursive: true })
const W = 1200
const H = 680
const GIF_WIDTH = 800

const TASKS = `# Release checklist

- [x] Freeze the feature branch
- [ ] Run the load test on staging
- [ ] Update \`CHANGELOG.md\`
- [ ] Announce in #release
`
const NOTES = `# Meeting notes

## Decisions

- Ship 2.4 on **Nov 18**
- Move order-api to the new queue
`
writeFileSync(join(taskDir, 'tasks.md'), TASKS)
writeFileSync(join(work, 'notes.md'), NOTES)

/** 錄影看不到滑鼠：畫一個跟著滑鼠移動的游標，按下時出現圓圈；並隱藏模擬視窗尺寸時多出的橫向捲軸 */
function installCursor() {
  document.documentElement.style.overflowX = 'hidden'
  const c = document.createElement('div')
  c.id = 'demo-cursor'
  c.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l15 9-6.5 1.5L8.5 19z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>'
  Object.assign(c.style, { position: 'fixed', left: '-40px', top: '-40px', zIndex: 2147483647, pointerEvents: 'none' })
  document.documentElement.append(c)
  addEventListener('mousemove', e => Object.assign(c.style, { left: `${e.clientX - 3}px`, top: `${e.clientY - 2}px` }), true)
  addEventListener(
    'mousedown',
    e => {
      const r = document.createElement('div')
      Object.assign(r.style, {
        position: 'fixed', left: `${e.clientX - 14}px`, top: `${e.clientY - 14}px`, width: '28px', height: '28px',
        borderRadius: '50%', background: 'rgba(67, 56, 202, .35)', zIndex: 2147483646, pointerEvents: 'none',
        transition: 'transform .4s, opacity .4s',
      })
      document.documentElement.append(r)
      requestAnimationFrame(() => Object.assign(r.style, { transform: 'scale(1.8)', opacity: '0' }))
      setTimeout(() => r.remove(), 500)
    },
    true,
  )
}

/** 右側的「編輯器」面板：顯示檔案原文，改到的行標成黃色 */
function installEditor([name, text]) {
  const style = document.createElement('style')
  style.textContent = `
    html.markloupe .ml-main { margin-right: 430px !important; }
    #demo-editor { position: fixed; top: 0; right: 0; bottom: 0; width: 430px; z-index: 50; display: flex; flex-direction: column;
      background: #1e1e1e; color: #d4d4d4; font: 13px/1.7 Consolas, "DejaVu Sans Mono", monospace; border-left: 1px solid #333; }
    #demo-editor .tab { padding: 8px 14px; background: #252526; color: #fff; font-size: 12px; border-bottom: 1px solid #333; }
    #demo-editor pre { margin: 0; padding: 12px 14px; white-space: pre-wrap; }
    #demo-editor .changed { background: rgba(255, 213, 79, .25); display: block; }
  `
  document.head.append(style)
  const ed = document.createElement('div')
  ed.id = 'demo-editor'
  ed.innerHTML = `<div class="tab"></div><pre></pre>`
  ed.querySelector('.tab').textContent = `${name} — editor`
  ed.querySelector('pre').textContent = text
  document.documentElement.append(ed)
}

function setEditor([text, changed]) {
  const pre = document.querySelector('#demo-editor pre')
  pre.replaceChildren(
    ...text.split('\n').map((line, i) => {
      const s = document.createElement('span')
      s.textContent = `${line}\n`
      if (changed.includes(i)) s.className = 'changed'
      return s
    }),
  )
}

const changedLines = (a, b) => b.split('\n').flatMap((l, i) => (l !== a.split('\n')[i] ? [i] : []))

/** WSL 的 /mnt/<磁碟>/… 要換成 Windows 路徑，Windows 端的 Chrome 才開得到 */
function fileUrl(path) {
  if (process.env.WSL_DISTRO_NAME && path.startsWith('/mnt/')) {
    return `file:///${encodeURI(execFileSync('wslpath', ['-m', path]).toString().trim())}`
  }
  return pathToFileURL(path).href
}

if (!process.env.CDP_URL) throw new Error('請設定 CDP_URL，例如 CDP_URL=http://127.0.0.1:9222')
const browser = await chromium.connectOverCDP(process.env.CDP_URL)
const ctx = browser.contexts()[0]
const sw = ctx.serviceWorkers().find(w => w.url().endsWith('/src/background.js'))
if (!sw) throw new Error('這個 Chrome 沒有載入 Markloupe')
const savedSettings = await sw.evaluate(() => Markloupe.loadSettings())
await sw.evaluate(() => Markloupe.saveSettings({ theme: 'light', rememberScroll: false, textWidth: 960, uiLang: 'en' }))

/** 開啟文件、等畫面穩定、裝上游標，再開始錄影 */
async function open(url) {
  const page = await ctx.newPage()
  await page.setViewportSize({ width: W, height: H })
  await page.goto(url)
  await page.waitForSelector('#ml-root .markdown-body h1')
  await page.waitForFunction(() => !document.querySelector('.ml-mermaid-pending'), null, { timeout: 15000 })
  await page.evaluate(installCursor)
  await page.mouse.move(W / 2, H - 40)
  await page.bringToFront() // 背景分頁不產生錄影畫格
  await page.waitForTimeout(400)
  return { page, rec: await record(page) }
}

/** CDP 錄影：每次重繪送一格，記下時間，結束時寫成 JPEG 序列 */
async function record(page) {
  const cdp = await page.context().newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', f => {
    frames.push({ data: f.data, t: f.metadata.timestamp })
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H })
  return {
    async stop() {
      await page.waitForTimeout(300)
      await cdp.send('Page.stopScreencast')
      frames.push({ ...frames.at(-1), t: frames.at(-1).t + 0.6 }) // 最後一格多停一下
      return frames
    },
  }
}

async function moveTo(page, locator, opts = {}) {
  const box = await locator.boundingBox()
  await page.mouse.move(box.x + (opts.x ?? box.width / 2), box.y + (opts.y ?? box.height / 2), { steps: 20 })
  await page.waitForTimeout(250)
}

async function clickOn(page, locator, opts) {
  await moveTo(page, locator, opts)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(500)
}

/** 畫格轉 GIF：依時間間隔排成影格，縮成 GIF_WIDTH 寬，用調色盤減少色帶 */
function toGif(frames, name) {
  const dir = join(work, `frames-${name}`)
  mkdirSync(dir, { recursive: true })
  const list = []
  frames.forEach((f, i) => {
    const file = join(dir, `${String(i).padStart(5, '0')}.jpg`)
    writeFileSync(file, Buffer.from(f.data, 'base64'))
    if (i < frames.length - 1) list.push(`file '${file}'`, `duration ${Math.max(0.01, frames[i + 1].t - f.t).toFixed(3)}`)
  })
  list.push(`file '${join(dir, `${String(frames.length - 1).padStart(5, '0')}.jpg`)}'`)
  writeFileSync(join(dir, 'list.txt'), list.join('\n'))
  const out = join(outDir, `${name}.gif`)
  const filter = `fps=12,scale=${GIF_WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-vf', filter, '-loop', '0', out])
  console.log(`✔ ${name}.gif（${Math.round(statSync(out).size / 1024)} KB）`)
}

const scenes = {
  // 表格：排序、篩選、拖拉欄寬
  async tables() {
    await sw.evaluate(() => Markloupe.saveSettings({ textWidth: 0, tocHidden: true }))
    const { page, rec } = await open(fileUrl(join(root, 'docs/demo.md')))
    await page.locator('#services').evaluate(h => scrollTo({ top: h.getBoundingClientRect().top + scrollY - 50, behavior: 'smooth' }))
    await page.waitForTimeout(900)
    const table = page.locator('.ml-table').first()
    const requests = table.locator('th', { hasText: 'Requests / day' })
    await clickOn(page, requests)
    await clickOn(page, requests)
    await page.waitForTimeout(600)
    await moveTo(page, table.locator('tbody tr').nth(1)) // 表格工具列要滑過表格才出現
    await clickOn(page, table.locator('.ml-table-filter'))
    await page.locator('.ml-table-filter').first().evaluate(el => {
      if (document.activeElement !== el) throw new Error('篩選框沒有取得焦點，輸入的字會變成快捷鍵')
    })
    await page.keyboard.type('2026-10', { delay: 160 })
    await page.waitForTimeout(1200)
    const handle = table.locator('th', { hasText: 'Service' }).locator('.ml-col-resizer')
    const box = await handle.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 })
    await page.mouse.down()
    await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 25 })
    await page.mouse.up()
    await page.waitForTimeout(1500)
    return { page, rec }
  },

  // 勾選寫回：右側編輯器跟著變
  async tasks() {
    await sw.evaluate(async text => {
      const rootDir = await navigator.storage.getDirectory()
      await rootDir.removeEntry('work', { recursive: true }).catch(() => {})
      const dir = await rootDir.getDirectoryHandle('work', { create: true })
      const w = await (await dir.getFileHandle('tasks.md', { create: true })).createWritable()
      await w.write(text)
      await w.close()
      await Markloupe.Roots.add(dir)
    }, TASKS)
    await sw.evaluate(() => Markloupe.saveSettings({ autoRefresh: 'off' })) // 避免自動更新以實體檔覆蓋 OPFS 的寫回結果
    const read = () =>
      sw.evaluate(async () => {
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('work')
        return (await (await dir.getFileHandle('tasks.md')).getFile()).text()
      })
    const { page, rec } = await open(fileUrl(join(taskDir, 'tasks.md')))
    await page.evaluate(installEditor, ['tasks.md', TASKS])
    await page.waitForTimeout(800)
    let before = TASKS
    for (const text of ['Run the load test', 'Update']) {
      await clickOn(page, page.locator('li', { hasText: text }).locator('input.ml-task-box'))
      await page.waitForFunction(() => !document.querySelector('input.ml-task-box.ml-busy'))
      const after = await read()
      await page.evaluate(setEditor, [after, changedLines(before, after)])
      before = after
      await page.waitForTimeout(1300)
    }
    return { page, rec }
  },

  // 自動更新：在編輯器打字存檔，閱讀頁立即更新
  async liveReload() {
    const file = join(work, 'notes.md')
    const { page, rec } = await open(fileUrl(file))
    await page.evaluate(installEditor, ['notes.md', NOTES])
    await page.waitForTimeout(800)
    let text = NOTES
    for (const add of ['- Re-index search after deploy\n', '\n## Next steps\n\n- [ ] Draft the 2.5 plan\n']) {
      for (const ch of add) {
        text += ch
        await page.evaluate(setEditor, [text, [text.split('\n').length - 2]])
        await page.waitForTimeout(ch === '\n' ? 120 : 45)
      }
      writeFileSync(file, text)
      await page.waitForFunction(t => document.querySelector('.markdown-body').textContent.includes(t), add.trim().split('\n').pop().replace(/^- (\[ \] )?/, ''))
      await page.waitForTimeout(1300)
    }
    return { page, rec }
  },

  // 側邊欄：目錄跳轉、摺疊、檔案分頁
  async sidebar() {
    const { page, rec } = await open(fileUrl(join(root, 'docs/demo.md')))
    await clickOn(page, page.locator('.ml-toc-list a', { hasText: 'Capacity' }))
    await page.waitForTimeout(700)
    await clickOn(page, page.locator('.ml-toc-list a', { hasText: 'Risks' }))
    await page.waitForTimeout(700)
    await clickOn(page, page.locator('.ml-tool-fold'))
    await page.waitForTimeout(900)
    await clickOn(page, page.locator('.ml-side-tab', { hasText: 'Files' }))
    await page.waitForTimeout(1500)
    return { page, rec }
  },
}

try {
  for (const [name, play] of Object.entries(process.argv[2] ? { [process.argv[2]]: scenes[process.argv[2]] } : scenes)) {
    await sw.evaluate(() => Markloupe.saveSettings({ textWidth: 960, tocHidden: false, autoRefresh: 'local' }))
    const { page, rec } = await play()
    const frames = await rec.stop()
    await page.close()
    toGif(frames, name)
  }
} finally {
  await sw.evaluate(s => Markloupe.saveSettings(s), savedSettings)
  await browser.close() // 只中斷連線，不會關閉使用者的 Chrome
}
