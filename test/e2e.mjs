// 端對端測試：以 Chromium 載入未封裝擴充功能，開啟 file:// 與 http:// 的 Markdown 檢查行為
// 用法：node test/e2e.mjs（需要 playwright；截圖輸出到 SHOT_DIR，預設為系統暫存目錄）
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { readFileSync, mkdtempSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

// 以 require 解析，方便使用全域安裝的 playwright
const { chromium } = createRequire(import.meta.url)('playwright')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = join(root, 'test/fixtures/sample.md')
const shotDir = process.env.SHOT_DIR || tmpdir()

// 本機檔案複製到暫存目錄，測試自動更新時才不會改到 fixture
const work = mkdtempSync(join(tmpdir(), 'ml-e2e-'))
const localMd = join(work, 'sample.md')
copyFileSync(fixture, localMd)
const localUrl = pathToFileURL(localMd).href

const mermaidFixture = join(root, 'test/fixtures/mermaid.md')
const localMermaid = join(work, 'mermaid.md')
copyFileSync(mermaidFixture, localMermaid)

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' })
  res.end(readFileSync(req.url.includes('mermaid') ? mermaidFixture : fixture))
}).listen(0)
const port = server.address().port

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ml-prof-')), {
  headless: true,
  channel: 'chromium', // 新版 headless 才支援擴充功能
  args: [
    `--disable-extensions-except=${root}`,
    `--load-extension=${root}`,
    '--disable-extensions-file-access-check', // 等同使用者開啟「允許存取檔案網址」
  ],
  viewport: { width: 1700, height: 950 },
})

const results = []
async function check(name, fn) {
  try {
    await fn()
    results.push(`✔ ${name}`)
  } catch (e) {
    results.push(`✘ ${name}\n    ${e.message.split('\n').slice(0, 3).join('\n    ')}`)
  }
}

const errors = []
async function openDoc(url = localUrl) {
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => m.type() === 'error' && errors.push(m.text()))
  await page.goto(url)
  await page.waitForSelector('#ml-root .markdown-body h1', { timeout: 5000 })
  return page
}
const visible = (page, sel) => page.locator(sel).first().isVisible()

try {
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'))
  const page = await openDoc()

  /* ---------- 渲染 ---------- */
  await check('file:// 渲染且標題正確', async () => {
    assert.equal(await page.title(), 'MarkLens 功能測試')
  })
  await check('UTF-8 中文正確', async () => {
    assert.ok((await page.textContent('.markdown-body p')).includes('這是一段中文段落'))
  })
  await check('front matter 顯示為可收合區塊', async () => {
    assert.ok((await page.textContent('.ml-frontmatter pre')).includes('title: MarkLens 測試文件'))
  })
  await check('刪除線與表格對齊', async () => {
    assert.equal(await page.textContent('.markdown-body s'), '刪除線')
    assert.equal(await page.$eval('.ml-table td:nth-child(2)', el => getComputedStyle(el).textAlign), 'right')
    assert.equal(await page.locator('.markdown-body [style]:not(td):not(th):not(table)').count(), 0)
  })
  await check('==mark== 與 Alert', async () => {
    assert.equal(await page.textContent('.markdown-body mark'), '螢光標記')
    assert.equal(await page.locator('.markdown-alert').count(), 2)
    assert.equal(await page.textContent('.markdown-alert-note .markdown-alert-title'), 'Note')
  })
  await check('任務清單（緊湊與鬆散清單）', async () => {
    assert.equal(await page.locator('.task-list-item input[type=checkbox]').count(), 3)
    assert.equal(await page.locator('.task-list-item input:checked').count(), 1)
    const loose = await page.textContent('.task-list-item:has(strong)')
    assert.ok(!loose.includes('[ ]'), loose)
    assert.ok(loose.trim().startsWith('Step 1'), loose)
  })
  await check('程式碼高亮與語言標籤', async () => {
    assert.ok((await page.locator('.ml-code .hljs-keyword').count()) > 0)
    assert.equal(await page.textContent('.ml-code-lang'), 'js')
  })
  await check('程式碼區塊中英對齊（罫線表格每列等寬）', async () => {
    await page.waitForFunction(() => document.documentElement.dataset.mlCodeFont)
    const info = JSON.parse(await page.evaluate(() => document.documentElement.dataset.mlCodeFont))
    const widths = await page.$eval('.ml-code code.language-text', code => {
      const node = code.firstChild
      const lines = node.textContent.split('\n').filter(Boolean)
      let pos = 0
      return lines.map(line => {
        const start = node.textContent.indexOf(line, pos)
        pos = start + line.length
        const r = document.createRange()
        r.setStart(node, start)
        r.setEnd(node, pos)
        return r.getBoundingClientRect().width
      })
    })
    const spread = Math.max(...widths) - Math.min(...widths)
    assert.ok(spread < 0.5, `各列寬度差 ${spread.toFixed(2)}px：${widths.map(w => w.toFixed(1)).join(', ')}；${JSON.stringify(info)}`)
  })
  await check('腳註', async () => {
    assert.equal(await page.locator('.footnotes li').count(), 1)
  })
  await check('XSS 全部被過濾', async () => {
    await page.waitForTimeout(300)
    assert.equal(await page.evaluate(() => document.body.dataset.xss), undefined)
    assert.equal(await page.locator('.markdown-body script').count(), 0)
    assert.equal(await page.locator('.markdown-body [onerror]').count(), 0)
    assert.equal(await page.getAttribute('.markdown-body a:text("惡意連結")', 'href'), null)
    assert.equal(await page.getAttribute('.markdown-body a:text("編碼繞過")', 'href'), null)
    assert.equal(await page.locator('.markdown-body details kbd').count(), 2)
  })
  await check('獨立行的行內 HTML 歸入文字欄', async () => {
    const left = await page.$eval('.markdown-body > p', el => el.getBoundingClientRect().left)
    const a = await page.$eval('.markdown-body a:text("編碼繞過")', el => el.getBoundingClientRect().left)
    assert.ok(Math.abs(a - left) < 2, `p=${left} a=${a}`)
  })
  await check('重複標題 id 去重、目錄文字不含 #', async () => {
    const ids = await page.$$eval('.markdown-body h2', els => els.map(e => e.id))
    assert.ok(ids.includes('重複標題') && ids.includes('重複標題-1'), ids.join(','))
    const first = await page.textContent('.ml-toc-list li a')
    assert.equal(first, 'MarkLens 功能測試')
  })

  /* ---------- 版面：文字欄與寬表格 ---------- */
  await check('文字欄限制 1200px，表格可超出文字欄', async () => {
    const p = await page.$eval('.markdown-body > p', el => el.getBoundingClientRect().width)
    const t = await page.locator('.markdown-body > .ml-table').nth(2).evaluate(el => el.getBoundingClientRect().width)
    const art = await page.$eval('.ml-body', el => el.clientWidth - 80)
    assert.ok(p <= 1200, `p=${p}`)
    assert.ok(t > 1200 && t <= art + 1, `table=${t} article=${art}`)
  })
  await check('小表格對齊文字欄寬度', async () => {
    const t = await page.locator('.markdown-body > .ml-table').nth(1).evaluate(el => el.getBoundingClientRect().width)
    assert.equal(Math.round(t), 1200)
  })

  /* ---------- 表格 ---------- */
  const firstCol = () => page.$eval('.ml-table', w => Array.from(w.querySelectorAll('tbody tr'), r => r.cells[0].textContent.trim()))
  const th = n => page.locator('.ml-table').first().locator('th').nth(n)
  await check('工具列平常隱藏、滑過才出現；小表格沒有篩選框', async () => {
    const bar = page.locator('.ml-table-bar').first()
    assert.equal(await bar.evaluate(el => getComputedStyle(el).opacity), '0')
    await page.locator('.ml-table').first().hover()
    await page.waitForTimeout(250)
    assert.equal(await bar.evaluate(el => getComputedStyle(el).opacity), '1')
    assert.equal(await page.locator('.ml-table').nth(1).locator('.ml-table-filter').count(), 0)
  })
  await check('排序圖示平常隱藏', async () => {
    await page.mouse.move(5, 500)
    await page.waitForTimeout(100)
    const op = await th(1).evaluate(el => getComputedStyle(el, '::after').opacity)
    assert.equal(op, '0')
  })
  await check('排序：數字（千分位）升冪、空值置底', async () => {
    await th(1).click()
    assert.deepEqual(await firstCol(), ['Banana', 'Elder', '櫻桃', '蘋果', 'Date'])
  })
  await check('排序：降冪', async () => {
    await th(1).click()
    assert.deepEqual(await firstCol(), ['蘋果', '櫻桃', 'Elder', 'Banana', 'Date'])
  })
  await check('排序：第三次回原順序', async () => {
    await th(1).click()
    assert.deepEqual(await firstCol(), ['蘋果', 'Banana', '櫻桃', 'Date', 'Elder'])
  })
  await check('排序：容量單位', async () => {
    await th(2).click()
    assert.deepEqual(await firstCol(), ['櫻桃', 'Elder', '蘋果', 'Banana', 'Date'])
  })
  await check('排序：日期', async () => {
    await th(3).click()
    assert.deepEqual(await firstCol(), ['Date', 'Elder', 'Banana', '櫻桃', '蘋果'])
  })
  await check('拖拉欄寬', async () => {
    const before = (await th(4).boundingBox()).width
    const b = await th(4).locator('.ml-col-resizer').boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x - 150, b.y + b.height / 2, { steps: 5 })
    await page.mouse.up()
    const after = (await th(4).boundingBox()).width
    assert.ok(after < before - 100, `before=${before} after=${after}`)
  })
  await check('篩選', async () => {
    await page.locator('.ml-table').first().hover()
    await page.fill('.ml-table-filter', '櫻')
    assert.equal(await page.locator('.ml-table').first().locator('tbody tr:not([hidden])').count(), 1)
    assert.equal(await page.textContent('.ml-table-count'), '1 / 5')
  })
  await page.screenshot({ path: join(shotDir, 'ml-light.png') })

  /* ---------- 自動更新保留狀態 ---------- */
  await check('自動更新後保留表格排序、欄寬、篩選', async () => {
    const width = (await th(4).boundingBox()).width
    writeFileSync(localMd, readFileSync(fixture, 'utf8').replace('# MarkLens 功能測試', '# 已更新的標題'))
    await page.waitForFunction(() => document.title === '已更新的標題', null, { timeout: 4000 })
    assert.equal(await th(3).getAttribute('aria-sort'), 'ascending')
    assert.equal(await page.inputValue('.ml-table-filter'), '櫻')
    assert.equal(await page.locator('.ml-table').first().locator('tbody tr:not([hidden])').count(), 1)
    const w2 = (await th(4).boundingBox()).width
    assert.ok(Math.abs(w2 - width) < 2, `${width} → ${w2}`)
    await page.fill('.ml-table-filter', '')
  })

  /* ---------- 原始文字 ---------- */
  await check('原始文字：工具列可返回', async () => {
    await page.click('.ml-tool-raw')
    assert.equal(await visible(page, 'pre.ml-source'), true)
    assert.equal(await visible(page, '.ml-body'), false)
    assert.equal(await page.textContent('.ml-tool-raw'), '← 返回閱讀')
    await page.click('.ml-tool-raw')
    assert.equal(await visible(page, '.ml-body'), true)
    assert.equal(await visible(page, 'pre.ml-source'), false)
  })
  await check('原始文字：快捷鍵 r 來回切換', async () => {
    await page.keyboard.press('r')
    assert.equal(await visible(page, 'pre.ml-source'), true)
    await page.keyboard.press('r')
    assert.equal(await visible(page, '.ml-body'), true)
  })
  await check('輸入框內按 r 不觸發', async () => {
    await page.locator('.ml-toc-search').focus()
    await page.keyboard.press('r')
    assert.equal(await visible(page, '.ml-body'), true)
    await page.locator('.ml-toc-search').fill('')
    await page.locator('.ml-body').click({ position: { x: 5, y: 5 } })
  })

  /* ---------- 摺疊 ---------- */
  const hiddenCount = () => page.locator('.markdown-body > [hidden]').count()
  await check('全部摺疊：單一 H1 時改摺 H2，H1 不摺', async () => {
    await page.click('text=▸ 全部摺疊')
    const h1Folded = await page.$eval('.markdown-body > h1', el => el.classList.contains('ml-folded'))
    assert.equal(h1Folded, false)
    assert.ok((await hiddenCount()) > 5)
    assert.equal(await visible(page, '.markdown-body > h2'), true)
  })
  await check('摺疊內容高度為 0', async () => {
    const hgt = await page.$eval('.markdown-body > .contains-task-list', el => el.getBoundingClientRect().height)
    assert.ok(hgt < 1, `height=${hgt}`)
  })
  await check('目錄標示被摺疊的段落', async () => {
    assert.ok((await page.locator('.ml-toc-folded').count()) >= 3)
    assert.ok((await page.locator('.ml-toc-inside-fold').count()) >= 1)
  })
  await check('再按全部摺疊不會卡住；全部展開恢復', async () => {
    await page.click('text=▸ 全部摺疊')
    await page.click('text=▾ 全部展開')
    assert.equal(await hiddenCount(), 0)
    assert.equal(await page.locator('.ml-toc-folded').count(), 0)
  })
  await check('快捷鍵 [ ] 摺疊與展開', async () => {
    await page.keyboard.press('[')
    assert.ok((await hiddenCount()) > 0)
    await page.keyboard.press(']')
    assert.equal(await hiddenCount(), 0)
  })
  await check('單一標題摺疊與展開', async () => {
    const h2 = page.locator('.markdown-body > h2').first()
    await h2.locator('.ml-fold').click()
    assert.equal(await visible(page, '.markdown-body .contains-task-list'), false)
    await h2.locator('.ml-fold').click()
    assert.equal(await visible(page, '.markdown-body .contains-task-list'), true)
  })
  await check('Ctrl+F 命中摺疊內容（beforematch）自動展開', async () => {
    const h2 = page.locator('.markdown-body > h2').first()
    await h2.locator('.ml-fold').click()
    assert.equal(await page.getAttribute('.markdown-body > .contains-task-list', 'hidden'), 'until-found')
    // 模擬瀏覽器尋找：先移除 hidden 再觸發 beforematch
    await page.$eval('.markdown-body > .contains-task-list', el => {
      el.removeAttribute('hidden')
      el.dispatchEvent(new Event('beforematch', { bubbles: true }))
    })
    assert.equal(await h2.evaluate(el => el.classList.contains('ml-folded')), false)
    assert.equal(await hiddenCount(), 0)
  })
  await check('大檔摺疊改用一般隱藏（fast 模式）', async () => {
    const big = join(work, 'big.md')
    const parts = ['# 大檔']
    for (let i = 0; i < 400; i++) parts.push(`## 第 ${i} 章`, ...Array.from({ length: 8 }, (_, j) => `段落 ${i}-${j}`))
    writeFileSync(big, parts.join('\n\n'))
    const bp = await openDoc(pathToFileURL(big).href)
    assert.equal(await bp.$eval('.markdown-body', el => el.dataset.mlFoldMode), 'fast')
    await bp.keyboard.press('[')
    const hidden = await bp.$$eval('.markdown-body > [data-ml-fold]', els => [els.length, els.filter(e => e.hasAttribute('hidden')).length, getComputedStyle(els[0]).display])
    assert.ok(hidden[0] > 3000, `摺疊節點 ${hidden[0]}`)
    assert.equal(hidden[1], 0, '大檔不應使用 hidden=until-found')
    assert.equal(hidden[2], 'none')
    await bp.keyboard.press(']')
    assert.equal(await bp.locator('.markdown-body > [data-ml-fold]').count(), 0)
    assert.equal(await page.$eval('.markdown-body', el => el.dataset.mlFoldMode), 'find')
    await bp.close()
  })
  await check('點目錄中被摺疊的項目會展開並跳轉', async () => {
    await page.keyboard.press('[')
    await page.click('.ml-toc-list a:text("第三層標題")')
    assert.equal(await visible(page, '#第三層標題'), true)
    await page.keyboard.press(']')
  })

  /* ---------- 目錄與分頁獨立 ---------- */
  const page2 = await openDoc()
  await check('目錄頂端收合鈕、工具列展開鈕', async () => {
    await page.click('.ml-toc-close')
    assert.equal(await visible(page, '.ml-toc'), false)
    const box = await page.locator('.ml-tool-toc').boundingBox()
    assert.ok(box.x < 30 && box.y < 10, JSON.stringify(box))
    await page.screenshot({ path: join(shotDir, 'ml-toc-hidden.png') })
  })
  await check('收合目錄只影響目前分頁', async () => {
    await page2.waitForTimeout(300)
    assert.equal(await visible(page2, '.ml-toc'), true)
  })
  await check('分頁狀態重新整理後保留', async () => {
    await page.reload()
    await page.waitForSelector('#ml-root .markdown-body h1')
    assert.equal(await visible(page, '.ml-toc'), false)
    await page.keyboard.press('t')
    assert.equal(await visible(page, '.ml-toc'), true)
  })
  await check('寬度切換只影響目前分頁', async () => {
    await page.click('.ml-tool-width')
    assert.equal(await page.textContent('.ml-tool-width'), '⇔ 寬度：960')
    await page2.waitForTimeout(200)
    assert.equal(await page2.textContent('.ml-tool-width'), '⇔ 寬度：1200')
    await page.keyboard.press('w')
    assert.equal(await page.textContent('.ml-tool-width'), '⇔ 寬度：滿版')
  })
  await check('主題即時同步所有分頁；版面設定不推送', async () => {
    await sw.evaluate(() => MarkLens.saveSettings({ theme: 'dark', textWidth: 960, tocHidden: true }))
    await page2.waitForFunction(() => document.documentElement.dataset.mlTheme === 'dark')
    await page.waitForFunction(() => document.documentElement.dataset.mlTheme === 'dark')
    assert.equal(await page2.textContent('.ml-tool-width'), '⇔ 寬度：1200')
    assert.equal(await visible(page2, '.ml-toc'), true)
  })
  await check('新分頁套用新的預設值', async () => {
    const p3 = await openDoc()
    assert.equal(await p3.textContent('.ml-tool-width'), '⇔ 寬度：960')
    assert.equal(await visible(p3, '.ml-toc'), false)
    await p3.screenshot({ path: join(shotDir, 'ml-dark.png') })
    await p3.close()
  })
  await sw.evaluate(() => MarkLens.saveSettings({ theme: 'auto', textWidth: 1200, tocHidden: false }))

  await check('Alt+Shift 快捷鍵指令只作用於目前分頁', async () => {
    // 直接模擬 background 送出的指令訊息
    // 沒有 tabs 權限拿不到網址，改用「目前作用中的分頁」
    await page.bringToFront()
    const id = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id)
    await sw.evaluate(tid => chrome.tabs.sendMessage(tid, { type: 'command', name: 'toggle-raw' }), id)
    await page.waitForTimeout(200)
    const raws = await Promise.all([page, page2].map(p => p.evaluate(() => document.documentElement.classList.contains('ml-raw'))))
    assert.deepEqual(raws.filter(Boolean).length, 1)
    await sw.evaluate(tid => chrome.tabs.sendMessage(tid, { type: 'command', name: 'toggle-raw' }), id)
  })

  /* ---------- 窄螢幕 ---------- */
  await check('窄螢幕：目錄為抽屜', async () => {
    await page2.bringToFront() // 背景分頁不會跑 CSS 轉場
    await page2.setViewportSize({ width: 420, height: 800 })
    await page2.waitForTimeout(300)
    const r0 = await page2.locator('.ml-toc').evaluate(el => [el.getBoundingClientRect().right, document.documentElement.className, innerWidth])
    assert.ok(r0[0] <= 0, JSON.stringify(r0))
    await page2.click('.ml-tool-toc')
    await page2.waitForTimeout(250)
    const r1 = await page2.locator('.ml-toc').evaluate(el => [el.getBoundingClientRect().left, document.documentElement.className, scrollY])
    assert.ok(r1[0] >= 0, JSON.stringify(r1))
    await page2.screenshot({ path: join(shotDir, 'ml-narrow.png') })
  })

  /* ---------- http ---------- */
  const p4 = await openDoc(`http://127.0.0.1:${port}/docs/readme.md`)
  await check('http:// 渲染', async () => {
    assert.equal(await p4.locator('.markdown-body h1').count(), 1)
  })
  await check('非 .md 網址不接管', async () => {
    await p4.goto(`http://127.0.0.1:${port}/notes.txt`)
    await p4.waitForTimeout(500)
    assert.equal(await p4.locator('#ml-root').count(), 0)
  })

  await check('沒有 JS 錯誤', async () => {
    // fixture 中的 <img src="x"> 本來就會 404，排除
    assert.deepEqual(errors.filter(e => !e.includes('ERR_FILE_NOT_FOUND') && !e.includes('404')), [])
  })

  /* ---------- popup ---------- */
  const extId = sw.url().split('/')[2]
  const pop = await ctx.newPage()
  await pop.goto(`chrome-extension://${extId}/src/popup/popup.html`)
  await check('popup 載入並寫入設定', async () => {
    await pop.selectOption('[name=textWidth]', '1600')
    await pop.waitForTimeout(200)
    const s = await sw.evaluate(() => MarkLens.loadSettings())
    assert.equal(s.textWidth, 1600)
    assert.equal(await pop.locator('#custom-width-row').isVisible(), false)
  })
  await pop.setViewportSize({ width: 330, height: 700 })
  await pop.screenshot({ path: join(shotDir, 'ml-popup.png') })
  await pop.close()

  /* ---------- Mermaid ---------- */
  await check('Mermaid：沒有 mermaid 區塊的文件不載入程式庫', async () => {
    assert.equal(await page.evaluate(() => document.documentElement.dataset.mlMermaid), undefined)
  })
  const mp = await openDoc(pathToFileURL(localMermaid).href)
  await mp.bringToFront()
  const mermaidThemes = () => mp.$$eval('.ml-mermaid', els => els.map(el => el.dataset.mlMermaidTheme ?? 'none'))
  await check('Mermaid：本機檔案繪製成圖表', async () => {
    await mp.waitForFunction(() => document.querySelectorAll('.ml-mermaid-view svg').length === 2, null, { timeout: 15000 })
    assert.equal(await mp.evaluate(() => document.documentElement.dataset.mlMermaid), 'loaded')
    assert.ok((await mp.textContent('.ml-mermaid-view svg')).includes('載入程式庫'))
    assert.equal(await mp.locator('.ml-code:not(.ml-mermaid) pre').count(), 1, '一般程式碼區塊不受影響')
  })
  await check('Mermaid：語法錯誤顯示訊息與原始碼', async () => {
    const bad = mp.locator('.ml-mermaid').nth(2)
    await bad.locator('.ml-mermaid-error').waitFor()
    assert.ok((await bad.textContent()).includes('Mermaid 語法錯誤'))
    assert.equal(await bad.locator(':scope > pre').isVisible(), true)
  })
  await check('Mermaid：標籤注入與點擊事件無效', async () => {
    await mp.waitForTimeout(300)
    assert.equal(await mp.evaluate(() => document.body.dataset.xss), undefined)
    assert.equal(await mp.locator('.ml-mermaid-view img[onerror], .ml-mermaid-view script').count(), 0)
  })
  await check('Mermaid：切換圖表／原始碼', async () => {
    const first = mp.locator('.ml-mermaid').first()
    await first.hover()
    await first.locator('.ml-mermaid-toggle').click()
    assert.equal(await first.locator(':scope > pre').isVisible(), true)
    assert.equal(await first.locator('svg').isVisible(), false)
    await first.locator('.ml-mermaid-toggle').click()
    assert.equal(await first.locator('svg').isVisible(), true)
  })
  await mp.screenshot({ path: join(shotDir, 'ml-mermaid.png'), fullPage: true })
  await check('Mermaid：切換主題後重繪', async () => {
    const before = (await sw.evaluate(() => MarkLens.loadSettings())).theme
    await sw.evaluate(() => MarkLens.saveSettings({ theme: 'dark' }))
    await mp.waitForFunction(() => [...document.querySelectorAll('.ml-mermaid[data-ml-mermaid-theme]')].every(el => el.dataset.mlMermaidTheme === 'dark'))
    assert.deepEqual(await mermaidThemes(), ['dark', 'dark', 'none'])
    await sw.evaluate(t => MarkLens.saveSettings({ theme: t }), before)
    await mp.waitForFunction(() => document.querySelector('.ml-mermaid').dataset.mlMermaidTheme !== 'dark')
  })
  await check('Mermaid：自動更新時沿用已繪製的圖，不閃爍', async () => {
    writeFileSync(localMermaid, readFileSync(mermaidFixture, 'utf8') + '\n自動更新後的段落\n')
    const pending = await mp.waitForFunction(
      () => document.body.innerText.includes('自動更新後的段落') && document.querySelectorAll('.ml-mermaid-pending').length + 1,
      null,
      { timeout: 4000, polling: 'raf' },
    )
    assert.equal(await pending.jsonValue(), 1)
  })
  await mp.close()
  await check('Mermaid：http:// 頁面不載入，保留程式碼', async () => {
    const hp = await openDoc(`http://127.0.0.1:${port}/docs/mermaid.md`)
    await hp.waitForTimeout(500)
    assert.equal(await hp.locator('.ml-mermaid').count(), 0)
    assert.equal(await hp.locator('code.language-mermaid').count(), 3)
    assert.equal(await hp.evaluate(() => document.documentElement.dataset.mlMermaid), undefined)
    await hp.close()
  })
  await check('Mermaid：關閉設定後不繪製', async () => {
    await sw.evaluate(() => MarkLens.saveSettings({ mermaid: false }))
    const op = await openDoc(pathToFileURL(localMermaid).href)
    await op.waitForTimeout(500)
    assert.equal(await op.locator('.ml-mermaid').count(), 0)
    await op.close()
    await sw.evaluate(() => MarkLens.saveSettings({ mermaid: true }))
  })

  /* ---------- 任務勾選寫回 ---------- */
  // 資料夾選擇視窗無法自動化：改用 OPFS（瀏覽器私有檔案系統）裡同名的「work」資料夾當作已授權資料夾，
  // 網址路徑中的 work/ 會對應到它，寫回的結果從 OPFS 讀出驗證。授權視窗本身需手動測試。
  await sw.evaluate(() => MarkLens.saveSettings({ autoRefresh: 'off' })) // 避免自動更新以實體檔覆蓋 OPFS 的寫回結果
  const tasksSrc = readFileSync(join(root, 'test/fixtures/tasks.md'), 'utf8')
  const crlfSrc = tasksSrc.replace(/\n/g, '\r\n')
  const taskDir = join(work, 'work')
  mkdirSync(taskDir)
  writeFileSync(join(taskDir, 'tasks.md'), tasksSrc)
  writeFileSync(join(taskDir, 'tasks-crlf.md'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(crlfSrc)]))
  const opfs = {
    async setup() {
      await sw.evaluate(async ([a, b]) => {
        const rootDir = await navigator.storage.getDirectory()
        await rootDir.removeEntry('work', { recursive: true }).catch(() => {})
        const dir = await rootDir.getDirectoryHandle('work', { create: true })
        const put = async (name, data) => {
          const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
          await w.write(data)
          await w.close()
        }
        await put('tasks.md', a)
        await put('tasks-crlf.md', new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(b)]))
        for (const r of await MarkLens.Roots.list()) await MarkLens.Roots.remove(r.id)
        await MarkLens.Roots.add(dir)
      }, [tasksSrc, crlfSrc])
    },
    read(name) {
      return sw.evaluate(async n => {
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('work')
        const bytes = new Uint8Array(await (await (await dir.getFileHandle(n)).getFile()).arrayBuffer())
        return { text: new TextDecoder().decode(bytes), bom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf }
      }, name)
    },
    append(name, extra) {
      return sw.evaluate(async ([n, x]) => {
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('work')
        const fh = await dir.getFileHandle(n)
        const text = await (await fh.getFile()).text()
        const w = await fh.createWritable()
        await w.write(text + x)
        await w.close()
      }, [name, extra])
    },
  }
  await opfs.setup()
  const tp = await openDoc(pathToFileURL(join(taskDir, 'tasks.md')).href)
  const box = text => tp.locator('.task-list-item', { hasText: text }).last().locator(':scope > input.ml-task-box, :scope > p > input.ml-task-box')
  const toast = () => tp.locator('.ml-toast.show').textContent()

  await check('勾選寫回：可勾選範圍（程式碼區塊與 HTML 清單不可勾）', async () => {
    assert.equal(await tp.locator('input.ml-task-box:not([disabled])').count(), 5)
    assert.equal(await box('HTML 寫的').isDisabled(), true)
    assert.equal(await tp.locator('pre input').count(), 0)
  })
  await check('勾選寫回：寫入正確的行（含 front matter 偏移）', async () => {
    await box('第一項').click()
    await tp.waitForSelector('.ml-toast.show')
    assert.equal(await toast(), '已勾選並存檔復原')
    assert.equal(await box('第一項').isChecked(), true)
    assert.equal((await opfs.read('tasks.md')).text, tasksSrc.replace('- [ ] 第一項', '- [x] 第一項'))
  })
  await check('勾選寫回：引用區塊、有序清單、巢狀清單', async () => {
    await box('引用中的任務').click()
    await tp.waitForFunction(() => document.querySelectorAll('input.ml-task-box:checked').length === 3)
    await box('有序清單任務').click()
    await tp.waitForFunction(() => document.querySelectorAll('input.ml-task-box:checked').length === 4)
    await tp.locator('li li', { hasText: '巢狀任務' }).locator('input').click()
    await tp.waitForFunction(() => document.querySelectorAll('input.ml-task-box:checked').length === 5)
    const t = (await opfs.read('tasks.md')).text
    assert.ok(t.includes('> - [x] 引用中的任務') && t.includes('1. [x] 有序清單任務') && t.includes('  - [x] 巢狀任務'), t)
    assert.ok(t.includes('- [x] 第二項\n'), '巢狀項目不應改到父項目')
    assert.ok(t.includes('- [ ] 程式碼區塊內，不可勾'))
  })
  await check('勾選寫回：取消勾選與復原', async () => {
    await box('第二項').click()
    await tp.waitForFunction(() => document.querySelector('.ml-toast.show')?.textContent.startsWith('已取消勾選'))
    assert.ok((await opfs.read('tasks.md')).text.includes('- [ ] 第二項'))
    await tp.click('.ml-toast-btn:text("復原")')
    await tp.waitForFunction(() => document.querySelector('.ml-toast.show')?.textContent.startsWith('已勾選'))
    assert.ok((await opfs.read('tasks.md')).text.includes('- [x] 第二項'))
  })
  await check('勾選寫回：檔案被其他地方修改時不寫入並重新載入', async () => {
    await opfs.append('tasks.md', '\n- [ ] 編輯器新增的項目\n')
    const before = (await opfs.read('tasks.md')).text
    await box('第一項').click()
    await tp.waitForFunction(() => document.querySelector('.ml-toast.show')?.textContent.includes('其他地方修改'))
    assert.equal((await opfs.read('tasks.md')).text, before)
    assert.equal(await box('編輯器新增的項目').count(), 1)
    await box('編輯器新增的項目').click()
    await tp.waitForFunction(() => document.querySelector('.ml-toast.show')?.textContent.startsWith('已勾選'))
    assert.ok((await opfs.read('tasks.md')).text.includes('- [x] 編輯器新增的項目'))
  })
  await check('勾選寫回：保留 CRLF 與 BOM', async () => {
    const cp = await openDoc(pathToFileURL(join(taskDir, 'tasks-crlf.md')).href)
    await cp.locator('.task-list-item', { hasText: '有序清單任務' }).locator('input').click()
    await cp.waitForSelector('.ml-toast.show')
    const r = await opfs.read('tasks-crlf.md')
    assert.equal(r.bom, true)
    assert.equal(r.text.replace(/^\ufeff/, ''), crlfSrc.replace('1. [ ] 有序清單任務', '1. [x] 有序清單任務'))
    await cp.close()
  })
  await check('勾選寫回：未授權時提示授權', async () => {
    await sw.evaluate(async () => {
      for (const r of await MarkLens.Roots.list()) await MarkLens.Roots.remove(r.id)
    })
    const before = (await opfs.read('tasks.md')).text
    await box('第一項').click()
    await tp.waitForFunction(() => document.querySelector('.ml-toast.show')?.textContent.includes('尚未授權'))
    assert.equal(await tp.locator('.ml-toast-btn:text("授權資料夾")').count(), 1)
    assert.equal((await opfs.read('tasks.md')).text, before)
  })
  await check('勾選寫回：關閉設定後勾選框唯讀', async () => {
    await sw.evaluate(() => MarkLens.saveSettings({ taskWrite: false }))
    const p2 = await openDoc(pathToFileURL(join(taskDir, 'tasks.md')).href)
    assert.equal(await p2.locator('input.ml-task-box:not([disabled])').count(), 0)
    await p2.close()
    await sw.evaluate(() => MarkLens.saveSettings({ taskWrite: true, autoRefresh: 'local' }))
  })
  await check('授權頁載入', async () => {
    const g = await ctx.newPage()
    g.on('pageerror', e => errors.push(e.message))
    await g.goto(`chrome-extension://${sw.url().split('/')[2]}/src/grant/grant.html?back=1`)
    await g.waitForSelector('#empty:not([hidden])')
    assert.equal(await g.locator('#back-row').isVisible(), true)
    await g.screenshot({ path: join(shotDir, 'ml-grant.png') })
    await g.close()
  })
  await tp.close()
  await check('勾選寫回過程沒有 JS 錯誤', async () => {
    assert.deepEqual(errors.filter(e => !e.includes('ERR_FILE_NOT_FOUND') && !e.includes('404')), [])
  })

  /* ---------- 擴充功能重新載入：已開分頁的 content script 失去連線 ---------- */
  // 放在最後：重新載入後原本的 service worker 會失效
  await check('擴充功能重新載入後，舊分頁不報錯並提示重新整理', async () => {
    const before = errors.length
    await page.bringToFront()
    await sw.evaluate(() => chrome.runtime.reload()).catch(() => {})
    await page.waitForTimeout(500)
    // 觸發捲動位置儲存與自動更新
    await page.mouse.wheel(0, 400)
    writeFileSync(localMd, readFileSync(fixture, 'utf8') + '\n\n重新載入後的修改\n')
    await page.waitForSelector('.ml-orphan', { timeout: 4000 })
    await page.waitForTimeout(800)
    assert.deepEqual(errors.slice(before), [])
  })
} finally {
  console.log(results.join('\n'))
  await ctx.close()
  server.close()
}
const failed = results.filter(r => r.startsWith('✘')).length
console.log(`\n${results.length - failed} 通過，${failed} 失敗`)
process.exit(failed ? 1 : 0)
