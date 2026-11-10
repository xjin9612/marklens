// 端對端測試：以 Chromium 載入未封裝擴充功能，開啟 file:// 與 http:// 的 Markdown 檢查行為
// 用法：node test/e2e.mjs（需要 playwright；截圖輸出到 SHOT_DIR，預設為系統暫存目錄）
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, mkdtempSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, cpSync } from 'node:fs'
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
  const headers = { 'content-type': 'text/markdown; charset=utf-8' }
  // /strict/…：仿 raw.githubusercontent.com 的 CSP（不允許任何外部資源，且頁面在沙箱中）
  if (req.url.startsWith('/strict/')) headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
  res.writeHead(200, headers)
  const name = ['mermaid', 'math'].find(n => req.url.includes(n))
  res.end(readFileSync(name ? join(root, `test/fixtures/${name}.md`) : fixture))
}).listen(0)
const port = server.address().port

// 網站權限是選用權限，測試無法按下 Chrome 的權限對話框：載入一份改成安裝時就授予的副本，其餘檔案與 repo 相同
const extDir = mkdtempSync(join(tmpdir(), 'ml-ext-'))
for (const d of ['src', 'vendor', '_locales', 'icons']) cpSync(join(root, d), join(extDir, d), { recursive: true })
const realManifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
writeFileSync(
  join(extDir, 'manifest.json'),
  JSON.stringify({ ...realManifest, host_permissions: realManifest.optional_host_permissions, optional_host_permissions: undefined }),
)

/**
 * macOS 的 Chromium 不理會 --lang，介面語言取自 AppleLanguages 偏好設定。
 * 只寫測試用 Chromium 的偏好設定網域，不動系統設定；設定在下一次啟動瀏覽器時生效。lang 為 null 時刪除
 */
function setMacLanguage(lang) {
  if (process.platform !== 'darwin') return
  const info = join(dirname(dirname(chromium.executablePath())), 'Info')
  const id = execFileSync('defaults', ['read', info, 'CFBundleIdentifier'], { encoding: 'utf8' }).trim()
  if (lang) execFileSync('defaults', ['write', id, 'AppleLanguages', '-array', lang])
  else {
    try {
      execFileSync('defaults', ['delete', id, 'AppleLanguages'], { stdio: 'ignore' })
    } catch {
      // 沒有這個設定時 defaults delete 的結束碼不是 0
    }
  }
}
setMacLanguage('zh-TW')

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ml-prof-')), {
  headless: true,
  channel: 'chromium', // 新版 headless 才支援擴充功能
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    '--disable-extensions-file-access-check', // 等同使用者開啟「允許存取檔案網址」
    '--lang=zh-TW', // 介面語言；以下檢查以繁體中文文字為準，英文另有一組檢查
  ],
  viewport: { width: 1700, height: 950 },
})

const results = []
/** 這個環境做不到的檢查：列出原因，不算通過也不算失敗 */
function skip(name, reason) {
  results.push(`－ ${name}（略過：${reason}）`)
}

async function check(name, fn) {
  try {
    await fn()
    results.push(`✔ ${name}`)
  } catch (e) {
    results.push(`✘ ${name}\n    ${e.message.split('\n').slice(0, 8).join('\n    ')}`)
  }
}

const errors = []
async function openDoc(url = localUrl, timeout = 5000) {
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => m.type() === 'error' && errors.push(m.text()))
  await page.goto(url)
  try {
    await page.waitForSelector('#ml-root .markdown-body h1', { timeout })
  } catch (e) {
    // 沒有接管時附上頁面類型與開頭，才分得出是擴充功能沒執行還是瀏覽器給了不同的頁面
    const state = await page.evaluate(() => `${document.contentType} ${document.documentElement.outerHTML.slice(0, 200)}`).catch(() => '')
    throw new Error(`${e.message}\n${url}\n${state}`)
  }
  // 關閉轉場動畫：檢查結果不必等動畫跑完，也不受背景分頁不跑動畫影響
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' })
  return page
}
/**
 * 等到條件成立（從 Node 端輪詢）：用在背景程式的設定值、背景分頁與 sandbox CSP 的頁面。
 * 後兩者的 waitForFunction 不會輪詢：背景分頁暫停 requestAnimationFrame，sandbox CSP 的頁面不執行輪詢
 */
async function until(fn, ms = 3000) {
  const end = Date.now() + ms
  for (;;) {
    if (await fn()) return
    if (Date.now() > end) throw new Error(`逾時：${fn}`)
    await new Promise(r => setTimeout(r, 50))
  }
}
const visible = (page, sel) => page.locator(sel).first().isVisible()

try {
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'))
  // macOS 的 CI 上，第一份文件常超過 5 秒才渲染完成
  const page = await openDoc(localUrl, 30000)

  /* ---------- 首次安裝引導頁 ---------- */
  await check('首次安裝自動開啟引導頁，並顯示檔案存取狀態', async () => {
    const isWelcome = p => p.url().endsWith('/src/welcome/welcome.html')
    const wp = ctx.pages().find(isWelcome) || (await ctx.waitForEvent('page', { predicate: isWelcome, timeout: 5000 }))
    await wp.waitForSelector('#file-status[data-state="ok"]')
    assert.ok((await wp.textContent('#version')).startsWith('MarkLens '))
    assert.equal(await wp.locator('#open-details').isVisible(), false, '已開啟時隱藏設定按鈕')
    await wp.setViewportSize({ width: 1000, height: 1400 })
    await wp.screenshot({ path: join(shotDir, 'ml-welcome.png'), fullPage: true })
    await wp.close()
  })
  await check('網頁上的 .md：manifest 只處理本機檔案、網站權限為選用；授予後以相同腳本註冊到網頁網址', async () => {
    assert.ok(realManifest.content_scripts.every(c => c.matches.every(m => m.startsWith('file:///'))), '固定注入只限本機檔案')
    assert.deepEqual(realManifest.optional_host_permissions, ['*://*/*'])
    assert.equal(realManifest.host_permissions, undefined, '安裝時不要求網站權限')
    const warnings = await sw.evaluate(m => chrome.management.getPermissionWarningsByManifest(m), JSON.stringify(realManifest))
    assert.deepEqual(warnings, [], '安裝時沒有權限警告')
    const regs = () => sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).sort((a, b) => a.id.localeCompare(b.id)))
    await until(async () => (await regs()).length === 2)
    // 同時觸發多次同步（例如安裝與授權事件一起發生）也不會重複註冊或失敗
    await sw.evaluate(() => Promise.all([syncWebScripts(), syncWebScripts(), syncWebScripts()]))
    const r = await regs()
    assert.equal(r.length, 2)
    realManifest.content_scripts.forEach((c, i) => {
      assert.deepEqual(r[i].js, c.js)
      assert.deepEqual(r[i].css || [], c.css || [])
      assert.equal(r[i].runAt, c.run_at)
      // Chrome 回傳的比對網址順序與註冊時不同
      assert.deepEqual([...r[i].matches].sort(), c.matches.map(m => m.replace('file:///', '*://*/')).sort())
    })
    const pp = await ctx.newPage()
    await pp.goto(`chrome-extension://${sw.url().split('/')[2]}/src/popup/popup.html`)
    await pp.waitForFunction(() => document.querySelector('#web-access').checked)
    await pp.close()
  })

  /* ---------- 渲染 ---------- */
  await check('file:// 渲染且標題正確', async () => {
    assert.equal(await page.title(), 'MarkLens 功能測試')
  })
  await check('UTF-8 中文正確', async () => {
    assert.ok((await page.textContent('.markdown-body p')).includes('這是一段中文段落'))
  })
  await check('Emoji 短碼；程式碼、時間與 :) 不轉換', async () => {
    const t = await page.locator('.markdown-body p', { hasText: 'Emoji：' }).innerText()
    assert.equal(t, 'Emoji：🎉 👍 :)，程式碼 :tada: 與時間 10:30:45 不轉換。')
  })
  await check('front matter 顯示為預設收合的區塊', async () => {
    assert.equal(await page.$eval('.ml-frontmatter', el => el.tagName), 'DETAILS')
    assert.equal(await page.$eval('.ml-frontmatter', el => el.open), false, '預設收合')
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
  await check('程式碼區塊中英對齊（框線字元表格每列等寬）', async () => {
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
  await check('腳註：正文的上標連到底部的說明，說明的返回連結指回正文', async () => {
    const r = await page.evaluate(() => {
      const ref = document.querySelector('.markdown-body sup.footnote-ref a')
      const note = ref && document.getElementById(decodeURIComponent(ref.hash.slice(1)))
      const back = note?.querySelector('a.footnote-backref')
      return { note: note?.textContent ?? null, backTo: back ? document.getElementById(decodeURIComponent(back.hash.slice(1))) === ref : false }
    })
    assert.ok(r.note?.includes('這是腳註內容'), JSON.stringify(r))
    assert.equal(r.backTo, true, '返回連結應指向正文的上標')
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
  await check('文字欄限制 1200px；寬表格預設留在文字欄內橫向捲動，右側顯示陰影', async () => {
    const p = await page.$eval('.markdown-body > p', el => el.getBoundingClientRect().width)
    const wide = page.locator('.markdown-body > .ml-table').nth(2)
    assert.ok(p <= 1200, `p=${p}`)
    assert.equal(Math.round(await wide.evaluate(el => el.getBoundingClientRect().width)), 1200)
    await wide.locator('.ml-table-view.ml-more-right').waitFor({ timeout: 2000 })
    assert.equal(await wide.locator('.ml-table-view.ml-more-left').count(), 0)
  })
  await check('設定「可超出文字欄」：寬表格左緣對齊文字欄，往右撐開到版面右緣', async () => {
    await page.evaluate(() => document.documentElement.classList.add('ml-wide-blocks'))
    try {
      const r = await page.evaluate(() => {
        const p = document.querySelector('.markdown-body > p').getBoundingClientRect()
        const t = document.querySelectorAll('.markdown-body > .ml-table')[2].getBoundingClientRect()
        const body = document.querySelector('.ml-body')
        const right = body.getBoundingClientRect().right - parseFloat(getComputedStyle(body).paddingRight)
        return { pLeft: p.left, tLeft: t.left, tRight: t.right, width: t.width, right }
      })
      assert.equal(Math.round(r.tLeft), Math.round(r.pLeft), JSON.stringify(r))
      assert.ok(r.width > 1200 && r.tRight <= r.right + 1, JSON.stringify(r))
    } finally {
      await page.evaluate(() => document.documentElement.classList.remove('ml-wide-blocks'))
    }
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
  await check('排序：鍵盤（Tab 到表頭，Enter／空白鍵）', async () => {
    await th(3).focus()
    await page.keyboard.press('Enter')
    assert.equal(await th(3).getAttribute('aria-sort'), 'descending')
    await page.keyboard.press(' ')
    assert.equal(await th(3).getAttribute('aria-sort'), null)
    await page.keyboard.press('Enter')
    assert.equal(await th(3).getAttribute('aria-sort'), 'ascending')
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'TH', '焦點留在表頭')
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

  await check('自動更新讀到寫入中途的空檔案時保留畫面，寫完後更新，表格狀態保留', async () => {
    // 寫入新內容後的前 3 次讀取回傳空內容：等同編輯器清空檔案後，隔了超過一次自動更新才寫入
    await sw.evaluate(() => {
      const orig = self.fetch
      self.mlEmptyReads = 0
      self.fetch = async (url, opts) => {
        const res = await orig(url, opts)
        if (!String(url).endsWith('/sample.md') || self.mlEmptyReads >= 3) return res
        if (!(await res.clone().text()).includes('寫入中途的標題')) return res
        self.mlEmptyReads++
        return new Response('')
      }
      self.mlRestoreFetch = () => (self.fetch = orig)
    })
    try {
      await page.evaluate(() => {
        window.mlTitles = []
        new MutationObserver(() => window.mlTitles.push(document.title)).observe(document.head, { childList: true, characterData: true, subtree: true })
      })
      writeFileSync(localMd, readFileSync(fixture, 'utf8').replace('# MarkLens 功能測試', '# 寫入中途的標題'))
      await page.waitForFunction(() => document.title === '寫入中途的標題', null, { timeout: 8000 })
      assert.equal(await sw.evaluate(() => self.mlEmptyReads), 3, '空內容應在寫入後被讀到')
      // 空白文件沒有 H1，標題會退回檔名
      const titles = await page.evaluate(() => window.mlTitles)
      assert.ok(!titles.includes('sample.md'), `不應先顯示空白文件：${titles.join(' → ')}`)
      assert.equal(await th(3).getAttribute('aria-sort'), 'ascending')
    } finally {
      await sw.evaluate(() => self.mlRestoreFetch())
    }
  })

  /* ---------- 原始文字 ---------- */
  await check('原始文字：工具列可返回', async () => {
    await page.click('.ml-tool-raw')
    assert.equal(await visible(page, '.ml-source-view'), true)
    assert.equal(await visible(page, '.ml-body'), false)
    assert.equal(await page.textContent('.ml-tool-raw'), '返回閱讀')
    await page.click('.ml-tool-raw')
    assert.equal(await visible(page, '.ml-body'), true)
    assert.equal(await visible(page, '.ml-source-view'), false)
  })
  /* ---------- 無障礙 ---------- */
  await check('無障礙：按鈕都有可念的名稱，不宣告未實作方向鍵的 tree／tablist', async () => {
    const bad = await page.$$eval('#ml-root button', btns =>
      btns
        .filter(b => b.offsetParent)
        .map(b => {
          // 名稱：aria-label，否則是沒有 aria-hidden 的文字
          const clone = b.cloneNode(true)
          clone.querySelectorAll('[aria-hidden="true"]').forEach(n => n.remove())
          return { cls: b.className, name: (b.getAttribute('aria-label') || clone.textContent).trim() }
        })
        .filter(x => !/[\p{L}\p{N}]/u.test(x.name)),
    )
    assert.deepEqual(bad, [], JSON.stringify(bad))
    assert.equal(await page.locator('[role="tree"], [role="treeitem"], [role="tablist"]').count(), 0)
  })
  await check('無障礙：鍵盤焦點有外框；可點擊元素至少 24×24', async () => {
    await page.locator('.ml-body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Tab')
    const outline = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement)
      return `${s.outlineStyle} ${s.outlineWidth}`
    })
    assert.equal(outline, 'solid 2px')
    const small = await page.$$eval('#ml-root :is(.ml-btn, .ml-tool, .ml-side-tab, .ml-files-up, .ml-fold, .ml-table-filter)', els =>
      els
        .filter(el => el.offsetParent)
        .map(el => {
          const r = el.getBoundingClientRect()
          // 摺疊鈕以 ::after 延伸點擊範圍
          const hit = el.classList.contains('ml-fold') ? parseFloat(getComputedStyle(el, '::after').height) : r.height
          return { cls: el.className, w: Math.round(r.width), h: Math.round(hit) }
        })
        .filter(x => x.w < 24 || x.h < 24),
    )
    assert.deepEqual(small, [], JSON.stringify(small))
    await page.keyboard.press('Escape')
  })
  await check('圖片放大：鍵盤可開啟，焦點移到關閉鈕，Esc 關閉後焦點回到圖片', async () => {
    const img = page.locator('img.ml-zoomable').first()
    await img.focus()
    await page.keyboard.press('Enter')
    assert.equal(await visible(page, '.ml-viewer.open'), true)
    assert.equal(await page.evaluate(() => document.activeElement.className), 'ml-viewer-close')
    await page.keyboard.press('Escape')
    assert.equal(await visible(page, '.ml-viewer.open'), false)
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('ml-zoomable')), true)
    assert.equal(await page.getAttribute('img[alt="示意圖"]', 'aria-label'), '放大圖片：示意圖')
  })
  await check('原始文字：快捷鍵 r 來回切換', async () => {
    await page.keyboard.press('r')
    assert.equal(await visible(page, '.ml-source-view'), true)
    await page.keyboard.press('r')
    assert.equal(await visible(page, '.ml-body'), true)
  })
  await check('按 / 開啟搜尋；輸入框內按 r 不觸發；Esc 關閉', async () => {
    await page.locator('.ml-body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('/')
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('ml-toc-search')), true)
    assert.equal(await visible(page, '.ml-side-tabs'), false, '搜尋時分頁標籤換成搜尋框')
    try {
      await page.keyboard.type('r')
      assert.equal(await visible(page, '.ml-body'), true, '輸入框裡的 r 不應切換原始文字')
      await page.fill('.ml-toc-search', '表格')
      const shown = await page.locator('.ml-toc-list li:not([hidden])').allTextContents()
      assert.ok(shown.length > 0 && shown.every(s => s.includes('表格')), shown.join('|'))
    } finally {
      await page.keyboard.press('Escape')
    }
    assert.equal(await visible(page, '.ml-side-search'), false)
    assert.equal(await page.inputValue('.ml-toc-search'), '')
    await page.locator('.ml-body').click({ position: { x: 5, y: 5 } })
  })

  /* ---------- 摺疊 ---------- */
  const hiddenCount = () => page.locator('.markdown-body > [hidden]').count()
  await check('全部摺疊：單一 H1 時改摺 H2，H1 不摺', async () => {
    await page.click('text=全部摺疊')
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
  await check('目錄高亮：頁尾的短章節捲不到頂端，跳轉的目標與捲到底時仍標示正確', async () => {
    const demoUrl = pathToFileURL(join(root, 'docs/demo.md')).href
    const tp = await openDoc(`${demoUrl}#glossary`)
    const active = () => tp.locator('.ml-toc-list li.active').textContent()
    const activeIs = text => tp.waitForFunction(t => document.querySelector('.ml-toc-list li.active')?.textContent === t, text)
    try {
      // 網址 #glossary 開啟：捲到底，Glossary 到不了頂端
      await activeIs('Glossary')
      // 從目錄點 Contacts：同樣在頁尾，要標示 Contacts 而不是最後一個標題
      await tp.click('.ml-toc-list a:text-is("Contacts")')
      await activeIs('Contacts')
      // 網址改成 #rollback：一般的章節照樣標示
      await tp.evaluate(() => (location.hash = '#rollback'))
      await activeIs('Rollback')
      // 自己捲到底（沒有跳轉目標）：標示畫面內最後一個標題
      await tp.mouse.move(800, 500)
      await tp.mouse.wheel(0, 5000)
      await activeIs('Glossary')
      // 往上捲回開頭：恢復一般規則
      await tp.mouse.wheel(0, -50000)
      await activeIs('Release Plan — v2.4')
    } catch (e) {
      throw new Error(`${e.message.split('\n')[0]}；目前標示：${await active().catch(() => '無')}`)
    } finally {
      await tp.close()
    }
  })
  await check('回到頂部按鈕：捲動後才出現，出現前保留位置，其他按鈕不位移', async () => {
    const tp = await openDoc(pathToFileURL(join(root, 'docs/demo.md')).href)
    try {
      const xs = () => tp.$$eval('.ml-toolbar .ml-tool', els => els.filter(el => !el.classList.contains('ml-tool-top')).map(el => Math.round(el.getBoundingClientRect().left)))
      // 同一份文件會還原上次的捲動位置（其他檢查可能捲過），先回到頂端
      await tp.evaluate(() => scrollTo(0, 0))
      await tp.waitForFunction(() => getComputedStyle(document.querySelector('.ml-tool-top')).visibility === 'hidden')
      const before = await xs()
      await tp.evaluate(() => scrollTo(0, 1200))
      await tp.waitForFunction(() => getComputedStyle(document.querySelector('.ml-tool-top')).visibility === 'visible')
      assert.deepEqual(await xs(), before, '其他按鈕的位置不變')
      await tp.click('.ml-tool-top')
      await tp.waitForFunction(() => scrollY === 0)
    } finally {
      await tp.close()
    }
  })
  await check('寬視窗下對齊文字欄：數學公式區塊、Mermaid 錯誤訊息不會超出或偏離文字欄', async () => {
    const edges = async (file, sel) => {
      const p = await openDoc(pathToFileURL(join(root, file)).href)
      try {
        await p.setViewportSize({ width: 1900, height: 900 })
        await p.waitForSelector(sel, { timeout: 15000 })
        return await p.evaluate(sel => {
          const box = el => [Math.round(el.getBoundingClientRect().left), Math.round(el.getBoundingClientRect().right)]
          const target = document.querySelector(sel)
          return { text: box(document.querySelector('.markdown-body > h1')), block: box(target.closest('.markdown-body > *')) }
        }, sel)
      } finally {
        await p.close()
      }
    }
    // 外距簡寫（margin: 0 0 16px）會蓋掉文字欄置中用的左右 auto
    const math = await edges('test/fixtures/math.md', '.markdown-body > .math-display')
    assert.deepEqual(math.block, math.text, '數學公式區塊應與文字欄同寬同位置')
    // 很長的錯誤訊息不應把區塊撐出文字欄
    const err = await edges('test/fixtures/mermaid.md', '.ml-mermaid-error')
    assert.ok(err.block[0] >= err.text[0] && err.block[1] <= err.text[1], `Mermaid 錯誤區塊 ${err.block} 應在文字欄 ${err.text} 內`)
  })
  await check('再按全部摺疊不會卡住；全部展開恢復', async () => {
    await page.click('text=全部摺疊')
    assert.ok((await hiddenCount()) > 0, '再按一次仍是摺疊狀態')
    await page.click('text=全部展開')
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
    // 確實捲到該標題（位於工具列下方附近）
    // 其餘段落仍摺疊、文件變短時捲不到頂端，此時應已捲到底
    const r = await page.locator('#第三層標題').evaluate(el => {
      const se = document.scrollingElement
      return { top: el.getBoundingClientRect().top, atEnd: se.scrollTop + innerHeight >= se.scrollHeight - 2, scrolled: se.scrollTop > 0 }
    })
    assert.ok(r.scrolled && r.top >= 0 && (r.top < 120 || r.atEnd), JSON.stringify(r))
    await page.keyboard.press(']')
  })

  /* ---------- 目錄與分頁獨立 ---------- */
  const page2 = await openDoc()
  await check('側邊欄的選單鈕收合；收合後工具列的選單鈕出現在同一位置', async () => {
    const side = await page.locator('.ml-side-menu').boundingBox()
    assert.equal(await visible(page, '.ml-toolbar .ml-tool-toc'), false, '側邊欄開著時工具列不顯示選單鈕')
    await page.click('.ml-side-menu')
    assert.equal(await visible(page, '.ml-toc'), false)
    const bar = await page.locator('.ml-toolbar .ml-tool-toc').boundingBox()
    assert.ok(Math.abs(bar.x - side.x) <= 2 && Math.abs(bar.y - side.y) <= 2, `${JSON.stringify(side)} vs ${JSON.stringify(bar)}`)
    const box = await page.locator('.ml-tool-toc').boundingBox()
    assert.ok(box.x < 30 && box.y < 10, JSON.stringify(box))
    await page.screenshot({ path: join(shotDir, 'ml-toc-hidden.png') })
  })
  await check('收合目錄只影響目前分頁（不寫入全域設定）', async () => {
    assert.equal(await visible(page2, '.ml-toc'), true)
    assert.equal((await sw.evaluate(() => MarkLens.loadSettings())).tocHidden, false, '全域預設值不應改變')
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
    await page.click('.ml-menu-item:has-text("960 px")')
    assert.equal(await page.textContent('.ml-tool-width'), '寬度：960')
    assert.equal(await page2.textContent('.ml-tool-width'), '寬度：1200')
    assert.equal((await sw.evaluate(() => MarkLens.loadSettings())).textWidth, 1200, '全域預設值不應改變')
    await page.keyboard.press('w')
    assert.equal(await page.textContent('.ml-tool-width'), '寬度：滿版')
    await page.waitForFunction(() => document.querySelector('.ml-toast.show')?.textContent === '寬度：滿版')
  })
  await check('寬度選單：列出全部選項、目前值打勾，鍵盤可操作，Esc 與點外面都會關閉', async () => {
    const btn = page.locator('.ml-tool-width')
    await btn.click()
    assert.equal(await btn.getAttribute('aria-expanded'), 'true')
    const items = await page.$$eval('.ml-menu [role="menuitemradio"]', els => els.map(e => [e.textContent, e.getAttribute('aria-checked')]))
    assert.deepEqual(items, [['滿版', 'true'], ['1600 px', 'false'], ['1200 px', 'false'], ['960 px', 'false']])
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '滿版', '焦點在目前的選項')
    // 選單開著時按 w 不會觸發快捷鍵
    await page.keyboard.press('w')
    assert.equal(await page.textContent('.ml-tool-width'), '寬度：滿版')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    assert.equal(await page.textContent('.ml-tool-width'), '寬度：1200')
    assert.equal(await page.locator('.ml-menu').count(), 0)
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('ml-tool-width')), true, '焦點回到按鈕')
    assert.equal(await btn.getAttribute('aria-expanded'), 'false')
    // 鍵盤開啟、Esc 關閉
    await page.keyboard.press('Enter')
    assert.equal(await page.locator('.ml-menu').count(), 1)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.ml-menu').count(), 0)
    // 再按一次按鈕、點外面都會關閉
    await btn.click()
    await btn.click()
    assert.equal(await page.locator('.ml-menu').count(), 0)
    await btn.click()
    await page.mouse.click(600, 500)
    assert.equal(await page.locator('.ml-menu').count(), 0)
    // popup 設定的自訂寬度（不在預設選項中）列在最後並打勾
    await sw.evaluate(() => MarkLens.saveSettings({ textWidth: 1400 }))
    const cp = await openDoc()
    try {
      await cp.click('.ml-tool-width')
      const last = await cp.$$eval('.ml-menu [role="menuitemradio"]', els => els.map(e => [e.textContent, e.getAttribute('aria-checked')]).at(-1))
      assert.deepEqual(last, ['自訂：1400 px', 'true'])
    } finally {
      await cp.close()
      await sw.evaluate(() => MarkLens.saveSettings({ textWidth: 1200 }))
    }
  })
  await check('主題即時同步所有分頁；版面設定不推送', async () => {
    await sw.evaluate(() => MarkLens.saveSettings({ theme: 'dark', textWidth: 960, tocHidden: true }))
    await until(() => page2.evaluate(() => document.documentElement.dataset.mlTheme === 'dark'))
    await page.waitForFunction(() => document.documentElement.dataset.mlTheme === 'dark')
    assert.equal(await page2.textContent('.ml-tool-width'), '寬度：1200')
    assert.equal(await visible(page2, '.ml-toc'), true)
  })
  await check('新分頁套用新的預設值', async () => {
    const p3 = await openDoc()
    assert.equal(await p3.textContent('.ml-tool-width'), '寬度：960')
    assert.equal(await visible(p3, '.ml-toc'), false)
    await p3.screenshot({ path: join(shotDir, 'ml-dark.png') })
    await p3.close()
  })
  await sw.evaluate(() => MarkLens.saveSettings({ theme: 'auto', textWidth: 1200, tocHidden: false }))

  await check('字體大小：工具列選單與 +／-／0 鍵等比縮放整篇文件，所有分頁同步', async () => {
    const sizes = p =>
      p.evaluate(() => {
        const px = sel => getComputedStyle(document.querySelector(`.markdown-body ${sel}`)).fontSize
        return { p: px('p'), h1: px('h1'), pre: px('.ml-code pre'), fm: px('.ml-frontmatter pre'), td: px('td') }
      })
    const fontSize = async () => (await sw.evaluate(() => MarkLens.loadSettings())).fontSize
    try {
      assert.deepEqual(await sizes(page), { p: '16px', h1: '32px', pre: '13.6px', fm: '13.6px', td: '16px' })
      assert.equal(await page.textContent('.ml-tool-font'), '字級：100%')
      const btn = page.locator('.ml-tool-font')
      await btn.click()
      assert.equal(await btn.getAttribute('aria-expanded'), 'true')
      assert.deepEqual(await page.$$eval('.ml-menu [role="menuitem"]', els => els.map(e => e.textContent)), ['放大', '縮小', '重設（16 px）'])
      const radios = await page.$$eval('.ml-menu [role="menuitemradio"]', els => els.map(e => [e.textContent, e.getAttribute('aria-checked')]))
      assert.deepEqual(radios.find(([, c]) => c === 'true'), ['16 px（100%）', 'true'])
      await page.click('.ml-menu-item:has-text("20 px")')
      // 內文、標題、程式碼、表格以同一比例放大（1.25 倍）
      assert.deepEqual(await sizes(page), { p: '20px', h1: '40px', pre: '17px', fm: '17px', td: '20px' })
      assert.equal(await page.textContent('.ml-tool-font'), '字級：125%')
      for (let i = 0; i < 20 && (await fontSize()) !== 20; i++) await page.waitForTimeout(50)
      assert.equal(await fontSize(), 20)
      await until(() => page2.evaluate(() => document.querySelector('.ml-tool-font').textContent === '字級：125%'))
      assert.equal((await sizes(page2)).pre, '17px', '其他分頁同步縮放')
      // 快捷鍵：+ 與 = 放大一級，- 縮小一級，0 重設
      await page.keyboard.press('=')
      assert.equal(await page.textContent('.ml-tool-font'), '字級：150%')
      await page.waitForFunction(() => document.querySelector('.ml-toast.show')?.textContent === '字級：150%')
      await page.keyboard.press('-')
      await page.keyboard.press('-')
      assert.equal(await page.textContent('.ml-tool-font'), '字級：113%')
      await page.keyboard.press('0')
      assert.deepEqual(await sizes(page), { p: '16px', h1: '32px', pre: '13.6px', fm: '13.6px', td: '16px' })
      // 寫入設定是非同步的：等全域設定回到 16
      for (let i = 0; i < 20 && (await fontSize()) !== 16; i++) await page.waitForTimeout(50)
      assert.equal(await fontSize(), 16)
      // popup 設定的自訂大小（不在預設選項中）列在最後並打勾
      await sw.evaluate(() => MarkLens.saveSettings({ fontSize: 17 }))
      await page.waitForFunction(() => document.querySelector('.ml-tool-font').textContent === '字級：106%')
      await btn.click()
      const last = await page.$$eval('.ml-menu [role="menuitemradio"]', els => els.map(e => [e.textContent, e.getAttribute('aria-checked')]).at(-1))
      assert.deepEqual(last, ['自訂：17 px', 'true'])
      await page.keyboard.press('Escape')
    } finally {
      await sw.evaluate(() => MarkLens.saveSettings({ fontSize: 16 }))
    }
  })

  await check('Alt+Shift 快捷鍵：一般指令只作用於目前分頁，切換主題作用於所有分頁', async () => {
    // 呼叫背景程式真正的快捷鍵處理函式；沒有 tabs 權限拿不到網址，以「目前作用中的分頁」代表 page
    await page.bringToFront()
    const id = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id)
    const raw = p => p.evaluate(() => document.documentElement.classList.contains('ml-raw'))
    await sw.evaluate(tid => onCommand('toggle-raw', { id: tid }), id)
    await page.waitForFunction(() => document.documentElement.classList.contains('ml-raw'))
    assert.equal(await raw(page2), false, '其他分頁不受影響')
    await sw.evaluate(tid => onCommand('toggle-raw', { id: tid }), id)
    await page.waitForFunction(() => !document.documentElement.classList.contains('ml-raw'))
    await sw.evaluate(tid => onCommand('cycle-theme', { id: tid }), id)
    try {
      assert.equal((await sw.evaluate(() => MarkLens.loadSettings())).theme, 'light')
      await until(() => page2.evaluate(() => document.documentElement.dataset.mlTheme === 'light'))
    } finally {
      await sw.evaluate(() => MarkLens.saveSettings({ theme: 'auto' }))
    }
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
  await check('檔案分頁：同層 Markdown 自然排序、資料夾在前、預設略過隱藏與套件資料夾', async () => {
    const nav = join(work, 'nav')
    for (const d of ['sub/deeper', 'empty', 'node_modules/pkg', '.git', 'z.md']) mkdirSync(join(nav, d), { recursive: true })
    for (const [f, h] of [['1-a.md', 'A'], ['2-b.md', 'B'], ['10-c.md', 'C'], ['中文 檔名.md', '中文'], ['sub/inner.md', 'Inner'], ['sub/deeper/deep.md', 'Deep'], ['node_modules/pkg/readme.md', 'X']]) {
      writeFileSync(join(nav, f), `# ${h}\n`)
    }
    writeFileSync(join(nav, 'readme.txt'), 'x')
    const np = await openDoc(pathToFileURL(join(nav, '2-b.md')).href)
    await np.click('.ml-side-tab:text("檔案")')
    await np.waitForSelector('.ml-files-file')
    const rows = await np.locator('.ml-files-list > li').evaluateAll(lis => lis.map(li => li.textContent.trim()))
    assert.deepEqual(rows, ['empty', 'sub', 'z.md', '1-a.md', '2-b.md', '10-c.md', '中文 檔名.md'])
    assert.equal(await np.textContent('.ml-files-file.active'), '2-b.md')
    assert.equal(await np.textContent('.ml-files-summary'), 'nav · 4 份')
    // 展開子資料夾：點開才讀取，再往下一層
    await np.click('.ml-files-dir[data-dir="sub"]')
    await np.waitForSelector('.ml-files-file a[href$="inner.md"]')
    await np.click('.ml-files-dir[data-dir="sub/deeper"]')
    await np.waitForSelector('.ml-files-file a[href$="deep.md"]')
    await np.click('.ml-files-dir[data-dir="empty"]')
    await np.waitForSelector('.ml-files-note:text("（沒有 Markdown）")')
    // 重新整理後保留分頁與展開狀態
    await np.reload()
    await np.waitForSelector('.ml-files-file a[href$="deep.md"]')
    assert.equal(await np.locator('.ml-side-tab.active').textContent(), '檔案')
    // 搜尋：只找已展開的資料夾
    await np.keyboard.press('/')
    await np.keyboard.type('e')
    await np.waitForFunction(() => document.querySelector('.ml-files-summary').textContent.startsWith('已展開的資料夾中找到'))
    const found = await np.locator('.ml-files-file').allTextContents()
    assert.deepEqual(found.sort(), ['sub / inner.md', 'sub/deeper / deep.md'])
    await np.keyboard.press('Escape')
    // 點檔案在同一分頁開啟
    await np.click('.ml-files-file a[href$="10-c.md"]')
    await np.waitForURL(/10-c\.md$/)
    assert.equal(await np.getAttribute('.markdown-body h1', 'data-ml-text'), 'C')
    await np.close()
  })
  await check('檔案分頁：不能以 .. 列出上層資料夾；略過名稱可自訂', async () => {
    const url = pathToFileURL(join(work, 'nav', '1-a.md')).href
    for (const path of [['..'], ['sub', '..', '..'], ['a/b'], ['a\\b'], ['.']]) {
      const r = await sw.evaluate(([u, p]) => HANDLERS['list-dir']({ path: p }, { url: u }), [url, path])
      assert.equal(r.status, 'error', JSON.stringify(path))
    }
    const ok = await sw.evaluate(([u]) => HANDLERS['list-dir']({ path: ['sub'] }, { url: u }), [url])
    assert.deepEqual(ok.files.map(f => f.name), ['inner.md'])
    // 起點必須是本機資料夾網址，不能帶 .. 或其他協定
    const deepUrl = pathToFileURL(join(work, 'nav', 'sub', 'inner.md')).href
    const navDir = pathToFileURL(join(work, 'nav')).href + '/'
    for (const root of [navDir + 'sub/../', navDir + 'sub/./', navDir.slice(0, -1), 'http://example.com/', 'javascript:alert(1)//']) {
      const r = await sw.evaluate(([u, rt]) => HANDLERS['list-dir']({ root: rt, path: [] }, { url: u }), [deepUrl, root])
      assert.equal(r.status, 'error', root)
    }
    const up = await sw.evaluate(([u, rt]) => HANDLERS['list-dir']({ root: rt, path: ['sub'] }, { url: u }), [deepUrl, navDir])
    assert.deepEqual(up.files.map(f => f.name), ['inner.md'])
    await sw.evaluate(() => MarkLens.saveSettings({ fileIgnore: 'sub, *.md' }))
    const ip = await openDoc(pathToFileURL(join(work, 'nav', '1-a.md')).href)
    await ip.click('.ml-side-tab:text("檔案")')
    await ip.waitForSelector('.ml-files-dir')
    const rows = await ip.locator('.ml-files-list > li').evaluateAll(lis => lis.map(li => li.textContent.trim()))
    assert.deepEqual(rows, ['.git', 'empty', 'node_modules'])
    await ip.close()
    await sw.evaluate(d => MarkLens.saveSettings({ fileIgnore: d }), '.*, node_modules, target, dist, build')
  })
  await check('檔案分頁：點進子資料夾的檔案後起點不變，可再點回上層；「上一層」可往上一層', async () => {
    const np = await openDoc(pathToFileURL(join(work, 'nav', '1-a.md')).href)
    await np.click('.ml-side-tab:text("檔案")')
    await np.click('.ml-files-dir[data-dir="sub"]')
    await np.click('.ml-files-dir[data-dir="sub/deeper"]')
    await np.click('.ml-files-file a[href$="deep.md"]')
    await np.waitForURL(/deep\.md$/)
    // 起點仍是 nav，樹自動展開到目前檔案並標亮
    await np.waitForSelector('.ml-files-file.active')
    assert.equal(await np.textContent('.ml-files-summary'), 'nav · 4 份')
    assert.equal(await np.textContent('.ml-files-file.active'), 'deep.md')
    await np.click('.ml-files-file a[href$="1-a.md"]')
    await np.waitForURL(/1-a\.md$/)
    // 另開新分頁直接開子資料夾的檔案：起點是該資料夾，按 ↑ 回到上一層
    const dp = await openDoc(pathToFileURL(join(work, 'nav', 'sub', 'inner.md')).href)
    await dp.click('.ml-side-tab:text("檔案")')
    await dp.waitForSelector('.ml-files-file.active')
    assert.equal(await dp.textContent('.ml-files-summary'), 'sub · 1 份')
    assert.equal(await dp.getAttribute('.ml-files-up', 'title'), '上一層：nav')
    await dp.click('.ml-files-up')
    await dp.waitForFunction(() => document.querySelector('.ml-files-summary').textContent === 'nav · 4 份')
    assert.equal(await dp.getAttribute('.ml-files-dir[data-dir="sub"] > button', 'aria-expanded'), 'true', '原本的資料夾維持展開')
    assert.equal(await dp.textContent('.ml-files-file.active'), 'inner.md')
    // 右鍵「以此資料夾為起點」：多按了 ↑ 也能切回來
    await dp.click('.ml-files-up')
    await dp.waitForSelector('.ml-files-dir[data-dir="nav"]')
    await dp.click('.ml-files-dir[data-dir="nav"]', { button: 'right' })
    await dp.click('.ml-menu-item:has-text("以此資料夾為起點")')
    await dp.waitForFunction(() => document.querySelector('.ml-files-summary').textContent === 'nav · 4 份')
    assert.equal(await dp.getAttribute('.ml-files-dir[data-dir="sub"] > button', 'aria-expanded'), 'true', '目前檔案所在的資料夾維持展開')
    assert.equal(await dp.locator('.ml-menu').count(), 0, '選單已關閉')
    await np.close()
    await dp.close()
  })
  await check('用編輯器開啟：預設不顯示；選 VS Code 後跳到目前章節的行號；自訂網址不能用網頁協定', async () => {
    assert.equal(await page.locator('.ml-tool-edit').isVisible(), false)
    try {
    await sw.evaluate(() => MarkLens.saveSettings({ editor: 'vscode' }))
    const ep = await openDoc()
    await ep.click('.ml-toc-list a:text("程式碼")')
    await ep.waitForFunction(() => document.querySelector('.ml-toc-list li.active')?.textContent === '程式碼')
    const before = errors.length
    await ep.click('.ml-tool-edit')
    const href = await ep.getAttribute('.ml-tool-edit', 'data-ml-href')
    const line = readFileSync(localMd, 'utf8').split('\n').findIndex(l => l === '## 程式碼') + 1
    const path = encodeURI(decodeURIComponent(new URL(localUrl).pathname).replace(/^\/+/, ''))
    assert.equal(href, `vscode://file/${path}:${line}`)
    await ep.close()
    // 沒有安裝 VS Code 的 Windows 會記一筆 scheme 沒有註冊處理程式的錯誤；Linux 不會
    errors.splice(before, Infinity, ...errors.slice(before).filter(e => !e.includes('does not have a registered handler')))
    // 檔名中的 # ? 要編碼，磁碟代號的冒號保留
    const special = await sw.evaluate(() => MarkLens.editorUrl({ editor: 'vscode' }, 'file:///D:/a%20b/c%23d%3F.md', 3))
    assert.equal(special, 'vscode://file/D:/a%20b/c%23d%3F.md:3')
    await sw.evaluate(() => MarkLens.saveSettings({ editor: 'custom', editorUrl: 'javascript:alert("{path}")' }))
    const bp = await openDoc()
    assert.equal(await bp.locator('.ml-tool-edit').isVisible(), false, '不合法的網址不顯示按鈕')
    await bp.close()
    } finally {
      await sw.evaluate(() => MarkLens.saveSettings({ editor: 'none', editorUrl: '' }))
    }
  })
  await check('剛好放得下的小表格不出現水平捲軸（各種文字欄寬度）', async () => {
    await page.bringToFront()
    await page.locator('.ml-body').click({ position: { x: 5, y: 5 } })
    const scroll = page.locator('.ml-table-scroll', { has: page.locator('th', { hasText: '小表格' }) })
    const seen = new Set()
    // 依序切過每一種寬度（回到起點為止），每種寬度都檢查
    for (let i = 0; i < 8; i++) {
      const label = await page.textContent('.ml-tool-width')
      if (seen.has(label)) break
      seen.add(label)
      const r = await scroll.evaluate(s => [s.scrollWidth, s.clientWidth])
      assert.ok(r[0] <= r[1], `${label}：scrollWidth ${r[0]} > clientWidth ${r[1]}`)
      await page.keyboard.press('w')
    }
    assert.ok(seen.size >= 3, [...seen].join('|'))
  })
  await check('http:// 渲染', async () => {
    assert.equal(await p4.locator('.markdown-body h1').count(), 1)
    assert.equal(await p4.locator('.ml-side-tab:text("檔案")').isVisible(), false, '網路上的頁面沒有檔案分頁')
    assert.equal(await p4.locator('input.ml-task-box').first().getAttribute('data-ml-readonly'), 'taskReadonlyRemote')
  })
  await check('網頁上的分頁狀態不寫進網站的儲存空間（網站無法藉此偵測 MarkLens）', async () => {
    await p4.bringToFront()
    await p4.locator('.ml-body').click({ position: { x: 5, y: 5 } })
    const before = await p4.textContent('.ml-tool-width')
    await p4.keyboard.press('w')
    assert.notEqual(await p4.textContent('.ml-tool-width'), before, '寬度仍可在本頁切換')
    const keys = await p4.evaluate(() => [...Object.keys(sessionStorage), ...Object.keys(localStorage)])
    assert.deepEqual(keys.filter(k => k.startsWith('marklens')), [])
    await p4.reload()
    await p4.waitForSelector('#ml-root .markdown-body h1')
    assert.equal(await p4.textContent('.ml-tool-width'), before, '重新整理後回到預設值')
  })
  await check('外部連結開新分頁；錨點、腳註、同站連結不受影響', async () => {
    const attrs = (pg, sel) => pg.locator(sel).first().evaluate(a => `${a.target}|${a.rel}`)
    assert.equal(await attrs(page, '.markdown-body a[href="https://example.com"]'), '_blank|noopener noreferrer')
    assert.equal(await attrs(p4, '.markdown-body a[href="https://example.com"]'), '_blank|noopener noreferrer')
    assert.equal(await attrs(p4, '.markdown-body a[href="./other.md"]'), '|')
    assert.equal(await page.locator('.markdown-body a[target]:is(.ml-anchor, [href^="#"])').count(), 0)
  })
  await check('非 .md 網址不接管', async () => {
    await p4.goto(`http://127.0.0.1:${port}/notes.txt`)
    await p4.waitForTimeout(500)
    assert.equal(await p4.locator('#ml-root').count(), 0)
  })

  /* ---------- 其他閱讀功能 ---------- */
  await check('表格全螢幕：按鈕切換，Esc 離開，頁面恢復捲動', async () => {
    await page.bringToFront()
    const wrap = page.locator('.ml-table').first()
    await wrap.hover()
    assert.equal(await wrap.locator('.ml-table-esc').isVisible(), false, '一般模式不顯示 Esc 提示')
    await wrap.locator('.ml-table-bar button:text("全螢幕")').click()
    assert.equal(await wrap.evaluate(el => el.classList.contains('ml-table-full')), true)
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ml-noscroll')), true)
    assert.match(await wrap.locator('.ml-table-title').textContent(), /^.+ · \d+ 列$/, '標題是章節名稱與列數')
    assert.ok(await wrap.locator('.ml-table-esc').isVisible())
    await page.keyboard.press('Escape')
    assert.equal(await wrap.evaluate(el => el.classList.contains('ml-table-full')), false)
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ml-noscroll')), false)
  })
  await check('網址帶 #錨點 指向被摺疊的段落：展開並捲到該處', async () => {
    const hp = await openDoc()
    try {
      await hp.keyboard.press('[')
      assert.equal(await visible(hp, '#第三層標題'), false, '先確認已摺疊')
      await hp.evaluate(() => (location.hash = encodeURIComponent('第三層標題')))
      await hp.waitForFunction(() => {
        const el = document.getElementById('第三層標題')
        return el && el.offsetParent !== null && document.scrollingElement.scrollTop > 0
      })
    } finally {
      await hp.close()
    }
  })
  await check('記住閱讀位置：重新開啟同一份檔案回到原本的位置；關閉後從頂端開始', async () => {
    const sp1 = await openDoc()
    await sp1.evaluate(() => scrollTo(0, 600))
    await sp1.waitForTimeout(700) // 捲動位置延遲 400ms 才儲存
    await sp1.close()
    const sp2 = await openDoc()
    try {
      await sp2.waitForFunction(() => Math.abs(scrollY - 600) < 2, null, { timeout: 3000 })
    } finally {
      await sp2.close()
    }
    await sw.evaluate(() => MarkLens.saveSettings({ rememberScroll: false }))
    try {
      const sp3 = await openDoc()
      await sp3.waitForTimeout(500)
      assert.equal(await sp3.evaluate(() => scrollY), 0)
      await sp3.close()
    } finally {
      await sw.evaluate(() => MarkLens.saveSettings({ rememberScroll: true }))
    }
  })
  await check('關閉「外部連結開新分頁」後連結維持原樣', async () => {
    await sw.evaluate(() => MarkLens.saveSettings({ linkNewTab: false }))
    try {
      const lp = await openDoc()
      assert.equal(await lp.locator('.markdown-body a[target]').count(), 0)
      await lp.close()
    } finally {
      await sw.evaluate(() => MarkLens.saveSettings({ linkNewTab: true }))
    }
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
    await until(async () => (await sw.evaluate(() => MarkLens.loadSettings())).textWidth === 1600)
    assert.equal(await pop.locator('#custom-width-row').isVisible(), false)
    await sw.evaluate(() => MarkLens.saveSettings({ textWidth: 1200 }))
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
    const dialogs = []
    const onDialog = d => {
      dialogs.push(d.message())
      d.dismiss().catch(() => {})
    }
    mp.on('dialog', onDialog)
    try {
      // 圖中寫了 click A call alert()：點節點 A 不應跳出對話框
      await mp.locator('.ml-mermaid-view .node', { hasText: '讀取檔案' }).first().click()
      await mp.waitForTimeout(300)
    } finally {
      mp.off('dialog', onDialog)
    }
    assert.deepEqual(dialogs, [])
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
  await check('Mermaid：圖表跟著字體大小等比縮放', async () => {
    const width = () => mp.evaluate(() => document.querySelector('.ml-mermaid-view svg').getBoundingClientRect().width)
    const before = await width()
    await sw.evaluate(() => MarkLens.saveSettings({ fontSize: 20 }))
    try {
      await mp.waitForFunction(() => document.documentElement.style.getPropertyValue('--ml-scale') === '1.25')
      const ratio = (await width()) / before
      assert.ok(Math.abs(ratio - 1.25) < 0.02, `圖表寬度比例 ${ratio}`)
    } finally {
      await sw.evaluate(() => MarkLens.saveSettings({ fontSize: 16 }))
      await mp.waitForFunction(() => document.documentElement.style.getPropertyValue('--ml-scale') === '1')
    }
  })
  await check('Mermaid：全螢幕檢視，滾輪縮放、拖曳平移、雙擊重設，Esc 離開', async () => {
    const wrap = mp.locator('.ml-mermaid').first()
    const vars = () =>
      wrap.evaluate(el => ['--ml-zoom', '--ml-pan-x', '--ml-pan-y'].map(v => el.style.getPropertyValue(v)))
    await wrap.hover()
    await wrap.locator('.ml-mermaid-full-btn').click()
    try {
      assert.ok(await wrap.evaluate(el => el.classList.contains('ml-mermaid-full')))
      const box = await wrap.boundingBox()
      const vp = mp.viewportSize()
      assert.ok(box.x === 0 && box.y === 0 && box.width === vp.width && box.height === vp.height, `填滿畫面：${JSON.stringify(box)}`)
      assert.ok(await mp.evaluate(() => document.documentElement.classList.contains('ml-noscroll')), '鎖住頁面捲動')
      assert.ok(await wrap.locator('.ml-mermaid-zoom').first().isVisible(), '全螢幕時顯示縮放按鈕')
      const view = await wrap.locator('.ml-mermaid-view').boundingBox()
      // 滾輪以游標為中心縮放：游標下的節點留在原處
      const node = wrap.locator('.ml-mermaid-view .node').first()
      const n0 = await node.boundingBox()
      await mp.mouse.move(n0.x + n0.width / 2, n0.y + n0.height / 2)
      await mp.mouse.wheel(0, -300)
      await mp.waitForFunction(() => parseFloat(document.querySelector('.ml-mermaid-full').style.getPropertyValue('--ml-zoom')) > 1)
      const n1 = await node.boundingBox()
      const shift = Math.hypot(n1.x + n1.width / 2 - n0.x - n0.width / 2, n1.y + n1.height / 2 - n0.y - n0.height / 2)
      assert.ok(n1.width > n0.width * 1.3 && shift < 3, `節點放大 ${(n1.width / n0.width).toFixed(2)} 倍、位移 ${shift.toFixed(1)}px`)
      const [, xBefore] = await vars()
      await mp.mouse.move(view.x + view.width / 2, view.y + view.height / 2)
      await mp.mouse.down()
      await mp.mouse.move(view.x + view.width / 2 + 120, view.y + view.height / 2 + 40, { steps: 5 })
      await mp.mouse.up()
      const [, xAfter] = await vars()
      assert.equal(parseFloat(xAfter) - parseFloat(xBefore), 120, `拖曳平移：${xBefore} → ${xAfter}`)
      await mp.mouse.dblclick(view.x + view.width / 2, view.y + view.height / 2)
      assert.deepEqual(await vars(), ['1', '0px', '0px'], '雙擊重設')
      await wrap.locator('.ml-mermaid-zoom', { hasText: '+' }).click()
      assert.ok(parseFloat((await vars())[0]) > 1, '放大按鈕')
      await mp.keyboard.press('Escape')
      assert.equal(await wrap.evaluate(el => el.classList.contains('ml-mermaid-full')), false)
      assert.equal(await mp.evaluate(() => document.documentElement.classList.contains('ml-noscroll')), false)
      assert.equal(await mp.evaluate(() => document.activeElement?.className), 'ml-btn ml-mermaid-full-btn', '焦點回到全螢幕按鈕')
      assert.equal(await wrap.locator('.ml-mermaid-zoom').first().isVisible(), false, '離開後隱藏縮放按鈕')
    } finally {
      // 失敗時也離開全螢幕，以免蓋住工具列影響後面的檢查
      await wrap.evaluate(el => {
        if (el.classList.contains('ml-mermaid-full')) el.querySelector('.ml-mermaid-full-btn').click()
      })
    }
  })
  await check('配色：米色與高對比套用到閱讀頁，Mermaid 依配色重繪，GitHub 不設屬性', async () => {
    const bg = () => mp.evaluate(() => getComputedStyle(document.body).backgroundColor)
    try {
      await sw.evaluate(() => MarkLens.saveSettings({ theme: 'light', palette: 'sepia' }))
      await mp.waitForFunction(() => document.documentElement.dataset.mlPalette === 'sepia')
      assert.equal(await bg(), 'rgb(246, 239, 227)')
      await mp.waitForFunction(() => [...document.querySelectorAll('.ml-mermaid[data-ml-mermaid-theme]')].every(el => el.dataset.mlMermaidTheme === 'default-sepia'))
      await sw.evaluate(() => MarkLens.saveSettings({ theme: 'dark', palette: 'contrast' }))
      await mp.waitForFunction(() => document.documentElement.dataset.mlPalette === 'contrast' && document.documentElement.dataset.mlTheme === 'dark')
      assert.equal(await bg(), 'rgb(0, 0, 0)')
      await sw.evaluate(() => MarkLens.saveSettings({ palette: 'github' }))
      await mp.waitForFunction(() => !('mlPalette' in document.documentElement.dataset))
    } finally {
      await sw.evaluate(() => MarkLens.saveSettings({ theme: 'auto', palette: 'github' }))
    }
  })
  await check('Mermaid：切換主題後重繪', async () => {
    const before = (await sw.evaluate(() => MarkLens.loadSettings())).theme
    await sw.evaluate(() => MarkLens.saveSettings({ theme: 'dark' }))
    await mp.waitForFunction(() => [...document.querySelectorAll('.ml-mermaid[data-ml-mermaid-theme]')].every(el => el.dataset.mlMermaidTheme === 'dark'))
    assert.deepEqual(await mermaidThemes(), ['dark', 'dark', 'none'])
    await sw.evaluate(t => MarkLens.saveSettings({ theme: t }), before)
    await mp.waitForFunction(() => document.querySelector('.ml-mermaid').dataset.mlMermaidTheme !== 'dark')
  })
  await check('列印：深色主題改用淺色（Ctrl+P 與列印按鈕），圖表以淺色重繪，結束後還原', async () => {
    const before = (await sw.evaluate(() => MarkLens.loadSettings())).theme
    const themeIs = t => mp.waitForFunction(t => document.documentElement.dataset.mlTheme === t, t)
    // Mermaid 的淺色主題叫 default
    const mermaidIs = t => mp.waitForFunction(t => [...document.querySelectorAll('.ml-mermaid[data-ml-mermaid-theme]')].every(el => el.dataset.mlMermaidTheme === t), t)
    try {
      await sw.evaluate(() => MarkLens.saveSettings({ theme: 'dark' }))
      await mermaidIs('dark')
      // Ctrl+P：瀏覽器在開啟對話框前送出 beforeprint，關閉後送出 afterprint
      await mp.evaluate(() => dispatchEvent(new Event('beforeprint')))
      await themeIs('light')
      await mermaidIs('default')
      await mp.evaluate(() => dispatchEvent(new Event('afterprint')))
      await themeIs('dark')
      await mermaidIs('dark')
      // 列印按鈕：對話框關閉後還原深色，按鈕可再按
      await mp.click('.ml-tool-print')
      await themeIs('dark')
      await mp.waitForFunction(() => !document.querySelector('.ml-tool-print').disabled)
      assert.equal(await mp.evaluate(() => localStorage.getItem('marklens:theme')), 'dark', '等待畫面記住的仍是深色')
    } finally {
      await sw.evaluate(t => MarkLens.saveSettings({ theme: t }), before)
    }
  })
  await check('工具列主題按鈕與 d 鍵：自動 → 淺色 → 深色，圖表跟著重繪', async () => {
    const theme = () => sw.evaluate(async () => (await MarkLens.loadSettings()).theme)
    const before = await theme()
    await sw.evaluate(() => MarkLens.saveSettings({ theme: 'auto' }))
    await mp.waitForFunction(() => document.querySelector('.ml-tool-theme').textContent.includes('自動'))
    await mp.click('.ml-tool-theme')
    assert.deepEqual(
      await mp.$$eval('.ml-menu [role="menuitemradio"]', els => els.map(e => [e.textContent, e.getAttribute('aria-checked')])),
      [['自動', 'true'], ['淺色', 'false'], ['深色', 'false']],
    )
    await mp.click('.ml-menu-item:has-text("淺色")')
    await mp.waitForFunction(() => document.querySelector('.ml-tool-theme').textContent.includes('淺色'))
    assert.equal(await theme(), 'light')
    assert.equal(await mp.evaluate(() => document.documentElement.dataset.mlTheme), 'light')
    await mp.keyboard.press('d')
    await mp.waitForFunction(() => document.querySelector('.ml-tool-theme').textContent.includes('深色'))
    assert.equal(await theme(), 'dark')
    await mp.waitForFunction(() => document.querySelector('.ml-mermaid').dataset.mlMermaidTheme === 'dark')
    await sw.evaluate(t => MarkLens.saveSettings({ theme: t }), before)
  })
  await check('連按 d 與 =：每一次都切換一級，畫面不會被前一次寫入的通知蓋回去', async () => {
    const before = await sw.evaluate(() => MarkLens.loadSettings())
    try {
      await sw.evaluate(() => MarkLens.saveSettings({ theme: 'auto', fontSize: 16 }))
      await mp.waitForFunction(
        () => document.querySelector('.ml-tool-theme').textContent.includes('自動') && document.querySelector('.ml-tool-font').textContent === '字級：100%',
      )
      // 同一個工作內連按：每次寫入的通知一定晚於下一次按鍵
      await mp.evaluate(() => {
        window.mlSeen = []
        const record = () => window.mlSeen.push(`${document.querySelector('.ml-tool-theme').textContent}｜${document.querySelector('.ml-tool-font').textContent}`)
        new MutationObserver(record).observe(document.querySelector('.ml-toolbar'), { subtree: true, childList: true, characterData: true })
        for (const key of ['d', 'd', '=', '=']) document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      })
      const font = await sw.evaluate(() => MarkLens.stepFontSize(MarkLens.stepFontSize(16, 1), 1))
      const label = `字級：${await sw.evaluate(px => MarkLens.fontPercent(px), font)}`
      await until(async () => {
        const s = await sw.evaluate(() => MarkLens.loadSettings())
        return s.theme === 'dark' && s.fontSize === font
      })
      // 通知依寫入順序送達：背景程式再寫一個哨兵值，頁面套用它時，前面的通知都已處理
      await sw.evaluate(() => MarkLens.saveSettings({ lineHeight: 1.71 }))
      await until(() => mp.evaluate(() => document.documentElement.style.getPropertyValue('--ml-line-height') === '1.71'))
      // 四次按鍵在同一個工作內，觀察者只看到最後的畫面；之後的通知不能讓它變動
      const seen = (await mp.evaluate(() => window.mlSeen)).filter((v, i, all) => v !== all[i - 1])
      assert.deepEqual(seen, [`主題：深色｜${label}`])
    } finally {
      await sw.evaluate(s => MarkLens.saveSettings({ theme: s.theme, fontSize: s.fontSize, lineHeight: s.lineHeight }), before)
    }
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
  await check('Mermaid：http(s) 頁面也繪製（含嚴格 CSP 的網站）', async () => {
    for (const path of ['docs/mermaid.md', 'strict/docs/mermaid.md']) {
      // 不用 openDoc：它的 addStyleTag 在 sandbox CSP 的頁面上等不到載入事件，會一直卡住
      const hp = await ctx.newPage()
      hp.on('pageerror', e => errors.push(e.message))
      try {
        await hp.goto(`http://127.0.0.1:${port}/${path}`)
        // waitForFunction 的輪詢在 sandbox CSP 的頁面上不會執行，第一次檢查不成立就只能等到逾時；改用 evaluate 自己輪詢
        await (async () => {
          const done = () => hp.evaluate(() => document.querySelectorAll('.ml-mermaid-view svg').length === 2 && document.querySelectorAll('.ml-mermaid-error').length === 1)
          for (const end = Date.now() + 15000; !(await done()); await hp.waitForTimeout(200)) {
            if (Date.now() > end) throw new Error('Timeout 15000ms exceeded.')
          }
        })().catch(async e => {
          const state = await hp.evaluate(() => ({
            svg: document.querySelectorAll('.ml-mermaid-view svg').length,
            errors: [...document.querySelectorAll('.ml-mermaid-error')].map(el => el.textContent.slice(0, 120)),
            mermaid: document.documentElement.dataset.mlMermaid,
          }))
          throw new Error(`${path}：${e.message.split('\n')[0]} ${JSON.stringify(state)}`)
        })
        // 圖表內的 <style> 生效：節點填色取自主題變數，不是瀏覽器預設的黑色
        const fill = await hp.evaluate(() => getComputedStyle(document.querySelector('.ml-mermaid-view svg .node rect, .ml-mermaid-view svg .node polygon')).fill)
        assert.notEqual(fill, 'rgb(0, 0, 0)', `${path}：圖表樣式沒有套用`)
      } finally {
        await hp.close()
      }
    }
  })
  await check('Mermaid：關閉設定後不繪製', async () => {
    await sw.evaluate(() => MarkLens.saveSettings({ mermaid: false }))
    try {
      const op = await openDoc(pathToFileURL(localMermaid).href)
      await op.waitForTimeout(500)
      assert.equal(await op.locator('.ml-mermaid').count(), 0)
      assert.equal(await op.locator('code.language-mermaid').count(), 3, '保留程式碼')
      await op.close()
    } finally {
      await sw.evaluate(() => MarkLens.saveSettings({ mermaid: true }))
    }
  })

  /* ---------- 數學公式 ---------- */
  await check('數學公式：沒有公式的文件不載入 KaTeX', async () => {
    assert.equal(await page.evaluate(() => document.documentElement.dataset.mlMath), undefined)
  })
  const mathFile = join(work, 'math.md')
  copyFileSync(join(root, 'test/fixtures/math.md'), mathFile)
  const mt = await openDoc(pathToFileURL(mathFile).href)
  await mt.bringToFront()
  await check('數學公式：行內、獨立、```math、表格內都繪製；金額、跳脫、程式碼不轉換', async () => {
    await mt.waitForFunction(() => document.querySelectorAll('.markdown-body :is(.katex, .katex-error)').length === 7, null, { timeout: 15000 })
    const r = await mt.evaluate(() => ({
      inline: document.querySelectorAll('.math-inline > :is(.katex, .katex-error)').length,
      display: document.querySelectorAll('.math-display .katex-display').length,
      error: document.querySelectorAll('.katex-error').length,
      table: document.querySelectorAll('td .katex').length,
      text: document.querySelector('.markdown-body').innerText,
      code: document.querySelector('.markdown-body p code').textContent,
      font: document.fonts.check('16px KaTeX_Main'),
    }))
    assert.equal(r.display, 2)
    assert.equal(r.inline, 5) // E=mc²、√2、表格、錯誤的那一個、x₁
    assert.equal(r.error, 1)
    assert.equal(r.table, 1)
    assert.ok(r.text.includes('價格 $5 與 $10 不是公式，跳脫的 $HOME 也不是'), r.text)
    assert.equal(r.code, '$x$')
    await mt.waitForFunction(() => document.fonts.check('16px KaTeX_Main') && [...document.fonts].some(f => f.family === 'KaTeX_Main' && f.status === 'loaded'), null, { timeout: 5000 })
  })
  await check('數學公式：自動更新時同步重繪，不閃爍', async () => {
    writeFileSync(mathFile, readFileSync(join(root, 'test/fixtures/math.md'), 'utf8') + '\n新增 $y^2$\n')
    const res = await mt.waitForFunction(
      () => document.body.innerText.includes('新增') && document.querySelectorAll('.math-inline:not(:has(.katex, .katex-error))').length + 1,
      null,
      { timeout: 4000, polling: 'raf' },
    )
    assert.equal(await res.jsonValue(), 1)
  })
  await mt.screenshot({ path: join(shotDir, 'ml-math.png'), fullPage: true })

  /* ---------- 匯出 HTML ---------- */
  /** 按工具列的匯出，回傳下載的 HTML 內容與存檔路徑 */
  async function exportFrom(pg) {
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('.ml-tool-export')])
    const file = join(work, `export-${Date.now()}-${dl.suggestedFilename()}`)
    await dl.saveAs(file)
    return { name: dl.suggestedFilename(), file, html: readFileSync(file, 'utf8') }
  }
  await check('匯出 HTML：單一檔案、不含程式碼、全部展開，開啟後樣式正常', async () => {
    await page.bringToFront()
    await page.click('.ml-toolbar button:has-text("全部摺疊")')
    const { name, file, html } = await exportFrom(page)
    await page.click('.ml-toolbar button:has-text("全部展開")')
    assert.equal(name, 'sample.html', '檔名')
    assert.ok(!/<script/i.test(html), '不應含 script')
    assert.ok(html.includes('http-equiv="Content-Security-Policy"'))
    const body = html.slice(html.indexOf('<body>'))
    assert.ok(!/class="[^"]*\bml-(fold|anchor|code-bar|table-bar)\b/.test(body), '不應含閱讀頁的互動元件')
    assert.ok(!/data-ml-fold="/.test(body) && !/ml-folded/.test(body), '應全部展開')
    assert.equal(await page.locator('.ml-toast.show').textContent(), '已匯出 sample.html', '提示')
    const xp = await ctx.newPage()
    const xerr = []
    xp.on('console', m => m.type() === 'error' && !m.text().includes('ERR_FILE_NOT_FOUND') && xerr.push(m.text()))
    await xp.goto(pathToFileURL(file).href)
    assert.equal(await xp.locator('#ml-root').count(), 1, 'ml-root')
    assert.equal(await xp.title(), await page.title(), '標題')
    assert.ok(await xp.locator('.markdown-body h2', { hasText: '安全性' }).isVisible(), '摺疊的段落應顯示')
    const kw = await xp.locator('.hljs-keyword').first().evaluate(el => getComputedStyle(el).color)
    const text = await xp.locator('.markdown-body p').first().evaluate(el => getComputedStyle(el).color)
    assert.notEqual(kw, text, '程式碼高亮樣式應內嵌')
    assert.ok(await xp.locator('.markdown-alert-note').isVisible())
    // 勾選狀態與閱讀頁一致
    const checked = pg => pg.locator('input.ml-task-box:checked').count()
    assert.equal(await checked(xp), await checked(page), '勾選狀態')
    // 程式碼中英對齊的字型設定一併寫入（本機有中文字型、未裝更紗黑體時才會有）
    const codeFont = await page.evaluate(() => JSON.parse(document.documentElement.dataset.mlCodeFont || '{}'))
    if (codeFont.loaded) assert.ok(html.includes('font-family: "MarkLens CJK Mono"; src: local('), '應含程式碼對齊字型')
    else assert.ok(codeFont.skipped, `沒有寫入對齊字型時應記錄原因：${JSON.stringify(codeFont)}`)
    assert.deepEqual(xerr, [])
    await xp.close()
  })
  await check('列印樣式：摺疊的段落照樣印出，工具列、側邊欄與摺疊按鈕不印', async () => {
    await page.bringToFront()
    await page.click('.ml-toolbar button:has-text("全部摺疊")')
    try {
      await page.emulateMedia({ media: 'print' })
      const folded = await page.$$eval('.markdown-body > [data-ml-fold]', els =>
        els.map(el => ({ cv: getComputedStyle(el).contentVisibility, h: el.getBoundingClientRect().height })),
      )
      assert.ok(folded.length > 0, '應有摺疊的內容')
      assert.ok(folded.every(f => f.cv !== 'hidden'), '摺疊的內容不應以 content-visibility 隱藏')
      assert.ok(folded.some(f => f.h > 0), '摺疊的內容應有高度')
      assert.ok(await page.locator('.markdown-body h2', { hasText: '安全性' }).isVisible())
      for (const sel of ['.ml-toolbar', '.ml-toc', '.ml-fold']) assert.equal(await page.locator(sel).first().isVisible(), false, `${sel} 不應印出`)
    } finally {
      await page.emulateMedia({ media: null })
      await page.click('.ml-toolbar button:has-text("全部展開")')
    }
  })
  await check('自訂 CSS：即時套用到閱讀頁，匯出檔也帶上，且不能提前結束 <style>', async () => {
    await page.bringToFront()
    const color = () => page.$eval('.markdown-body h1', el => getComputedStyle(el).color)
    try {
      await sw.evaluate(() => MarkLens.saveSettings({ customCss: '.markdown-body h1 { color: rgb(1, 2, 3) }' }))
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.markdown-body h1')).color === 'rgb(1, 2, 3)')
      await sw.evaluate(() => MarkLens.saveSettings({ customCss: '.markdown-body h1 { color: rgb(4, 5, 6) } </style><b id="ml-injected">x</b>' }))
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.markdown-body h1')).color === 'rgb(4, 5, 6)')
      const { html, file } = await exportFrom(page)
      assert.ok(html.includes('color: rgb(4, 5, 6)'), '匯出檔含自訂 CSS')
      const xp = await ctx.newPage()
      await xp.goto(pathToFileURL(file).href)
      assert.equal(await xp.locator('#ml-injected').count(), 0, '自訂 CSS 不能跳出 <style> 產生元素')
      assert.equal(await xp.$eval('.markdown-body h1', el => getComputedStyle(el).color), 'rgb(4, 5, 6)', '匯出檔套用自訂 CSS')
      await xp.close()
      await sw.evaluate(() => MarkLens.saveSettings({ customCss: '' }))
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.markdown-body h1')).color !== 'rgb(4, 5, 6)')
      assert.notEqual(await color(), 'rgb(4, 5, 6)')
    } finally {
      await sw.evaluate(() => MarkLens.saveSettings({ customCss: '' }))
    }
  })
  await check('設定同步：寫入 storage.sync、套用其他電腦的變更；關閉後兩者都停止；裝置專屬設定不同步', async () => {
    const local = () => sw.evaluate(() => MarkLens.loadSettings())
    const remote = () => sw.evaluate(async () => (await chrome.storage.sync.get('marklens:settings'))['marklens:settings'] || {})
    try {
      assert.equal(await sw.evaluate(() => MarkLens.isSyncEnabled()), true, '預設開啟')
      await sw.evaluate(() => MarkLens.saveSettings({ lineHeight: 1.9, tocWidth: 300, editorUrl: 'vscode://file/{path}' }))
      const r = await remote()
      assert.equal(r.lineHeight, 1.9)
      assert.ok(r._from, '標示寫入的電腦')
      // 自己寫入的變更通知不會被當成其他電腦的變更：連續快速修改後本機仍是最後的值
      for (const v of [1.8, 1.85, 1.95]) await sw.evaluate(v => MarkLens.saveSettings({ lineHeight: v }), v)
      await new Promise(r => setTimeout(r, 500))
      assert.equal((await local()).lineHeight, 1.95, '自己的舊通知不會蓋回較新的設定')
      assert.ok(!('tocWidth' in r) && !('editorUrl' in r) && !('enabled' in r), `不同步的鍵：${Object.keys(r)}`)
      // 模擬其他電腦改了設定
      await sw.evaluate(async () => {
        const k = 'marklens:settings'
        const cur = (await chrome.storage.sync.get(k))[k]
        await chrome.storage.sync.set({ [k]: { ...cur, lineHeight: 2.1, _from: 'other-computer' } })
      })
      await until(async () => (await local()).lineHeight === 2.1)
      assert.equal((await local()).tocWidth, 300, '裝置專屬設定不被覆蓋')
      // 關閉同步：本機變更不再上傳，其他電腦的變更也不再套用
      await sw.evaluate(() => MarkLens.setSyncEnabled(false))
      await sw.evaluate(() => MarkLens.saveSettings({ lineHeight: 1.5 }))
      assert.equal((await remote()).lineHeight, 2.1, '關閉後不上傳')
      await sw.evaluate(async () => {
        const k = 'marklens:settings'
        const cur = (await chrome.storage.sync.get(k))[k]
        await chrome.storage.sync.set({ [k]: { ...cur, lineHeight: 2.3, _from: 'other-computer' } })
      })
      await new Promise(r => setTimeout(r, 500))
      assert.equal((await local()).lineHeight, 1.5, '關閉後不套用')
      // 重新開啟：雲端已有設定，套用到這台
      await sw.evaluate(() => MarkLens.setSyncEnabled(true))
      assert.equal((await local()).lineHeight, 2.3)
    } finally {
      await sw.evaluate(async () => {
        await MarkLens.setSyncEnabled(true)
        await chrome.storage.sync.clear()
        await MarkLens.saveSettings({ lineHeight: 1.7, tocWidth: 260, editorUrl: '' })
      })
    }
  })
  await check('匯出 HTML：數學公式的字型內嵌，離線開啟也能顯示', async () => {
    await mt.bringToFront()
    const { file, html } = await exportFrom(mt)
    assert.ok(html.includes('data:font/woff2;base64,'))
    assert.ok(!/url\(fonts\//.test(html), '不應留下相對路徑的字型')
    const xp = await ctx.newPage()
    await xp.goto(pathToFileURL(file).href)
    await xp.waitForFunction(() => [...document.fonts].some(f => f.family === 'KaTeX_Main' && f.status === 'loaded'), null, { timeout: 5000 })
    assert.equal(await xp.locator('.katex-display').count(), 2)
    await xp.close()
  })
  await mt.close()
  await check('數學公式：關閉設定後不載入 KaTeX，保留 $ 原文', async () => {
    await sw.evaluate(() => MarkLens.saveSettings({ math: false }))
    try {
      const op = await openDoc(pathToFileURL(mathFile).href)
      await op.waitForTimeout(500)
      assert.equal(await op.locator('.katex').count(), 0)
      assert.equal(await op.evaluate(() => document.documentElement.dataset.mlMath), undefined)
      assert.ok((await op.textContent('.markdown-body')).includes('行內公式 $E = mc^2$'))
      await op.close()
    } finally {
      await sw.evaluate(() => MarkLens.saveSettings({ math: true }))
    }
  })
  await check('數學公式：http(s) 頁面也繪製，字型載入成功（含嚴格 CSP 的網站）', async () => {
    for (const path of ['docs/math.md', 'strict/docs/math.md']) {
      // 不用 openDoc：它的 addStyleTag 在 sandbox CSP 的頁面上等不到載入事件，會一直卡住
      const hp = await ctx.newPage()
      hp.on('pageerror', e => errors.push(e.message))
      await hp.goto(`http://127.0.0.1:${port}/${path}`)
      await hp.waitForSelector('#ml-root .markdown-body h1', { timeout: 5000 })
      try {
        const state = () =>
          hp.evaluate(() => ({
            display: document.querySelectorAll('.katex-display').length,
            math: document.documentElement.dataset.mlMath,
            fonts: [...document.fonts].filter(f => f.family.startsWith('KaTeX_Main')).map(f => f.status),
          }))
        try {
          await until(() => hp.evaluate(() => document.querySelectorAll('.katex-display').length === 2), 10000)
          // 主動載入字型並等完成；載入失敗（被擋）時回傳空陣列
          const loaded = await hp.evaluate(() => document.fonts.load('16px KaTeX_Main').then(f => f.length))
          assert.ok(loaded > 0, 'KaTeX_Main 字型載入失敗')
        } catch (e) {
          throw new Error(`${path}：${e.message.split('\n')[0]} ${JSON.stringify(await state())}`)
        }
      } finally {
        await hp.close()
      }
    }
  })
  await check('網站無法以固定的擴充功能網址探測 MarkLens 的資源', async () => {
    const pp = await ctx.newPage()
    try {
      await pp.goto(`http://127.0.0.1:${port}/probe`)
      const extId = sw.url().split('/')[2]
      const results = await pp.evaluate(async id => {
        // 不開放的資源有時不回應而非拒絕：逾時也算讀不到
        const probe = async path =>
          fetch(`chrome-extension://${id}/${path}`, { signal: AbortSignal.timeout(3000) }).then(r => `可讀取 ${r.status}`, () => '無法讀取')
        return [await probe('vendor/katex/katex.min.css'), await probe('vendor/mermaid/mermaid.mjs')]
      }, extId)
      assert.deepEqual(results, ['無法讀取', '無法讀取'])
    } finally {
      await pp.close()
    }
  })

  await check('擴充語法：容器區塊套用提示框樣式、details 可摺疊、定義清單', async () => {
    const ep = await openDoc(pathToFileURL(join(root, 'test/fixtures/extended.md')).href)
    try {
      const alerts = await ep.$$eval('.markdown-body blockquote.markdown-alert', els =>
        els.map(el => [el.className.replace('markdown-alert ', ''), el.querySelector('.markdown-alert-title')?.textContent]),
      )
      assert.deepEqual(alerts, [
        ['markdown-alert-tip', 'Tip'],
        ['markdown-alert-warning', '自訂標題'],
        ['markdown-alert-caution', 'Caution'],
        ['markdown-alert-note', '方括號標題'],
      ])
      assert.equal(await ep.locator('blockquote.markdown-alert-warning li').count(), 1, '容器內的 Markdown 照常解析')
      assert.equal(await ep.textContent('.markdown-body details > summary'), '點我展開')
      assert.equal(await ep.locator('.markdown-body details[open]').count(), 0, 'details 預設收合')
      assert.ok((await ep.textContent('.markdown-body')).includes('::: unknown'), '未知的容器保留原文')
      assert.deepEqual(await ep.$$eval('.markdown-body dl > *', els => els.map(el => el.tagName)), ['DT', 'DD', 'DT', 'DD', 'DD'])
    } finally {
      await ep.close()
    }
  })

  // Windows 的剪貼簿會把 \n 存成 \r\n，讀回時統一換行再比對
  const clip = pg => pg.evaluate(() => navigator.clipboard.readText()).then(t => t.replace(/\r\n/g, '\n'))
  async function copyVia(pg, button, item) {
    await pg.evaluate(() => document.querySelector('.ml-toast')?.classList.remove('show'))
    await button.click()
    await pg.click(`.ml-menu-item:has-text("${item}")`)
    await pg.waitForSelector('.ml-toast.show')
  }
  await check('複製：工具列與章節的選單，複製內容附 HTML 格式，複製位置為路徑與行號', async () => {
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'])
    const cp = await openDoc()
    try {
      await cp.bringToFront()
      const src = readFileSync(localMd, 'utf8')
      await copyVia(cp, cp.locator('.ml-tool-copy'), '複製內容')
      assert.equal(await clip(cp), src)
      const html = await cp.evaluate(async () => {
        const [item] = await navigator.clipboard.read()
        return (await item.getType('text/html')).text()
      })
      assert.ok(html.includes('<h1') && html.includes('任務清單'), 'HTML 含渲染後的內容')
      assert.ok(!/ml-(fold|anchor|heading-copy|code-bar)|data-ml-line/.test(html), 'HTML 不含閱讀介面元件與行號屬性')

      await copyVia(cp, cp.locator('.ml-tool-copy'), '複製位置')
      assert.equal(await clip(cp), localMd, '整份文件的位置是檔案路徑')

      const heading = cp.locator('.markdown-body h2', { hasText: /^任務清單/ }).first()
      await heading.hover()
      await copyVia(cp, heading.locator('.ml-heading-copy'), '複製內容')
      const section = await clip(cp)
      assert.ok(section.startsWith('## 任務清單\n'), JSON.stringify(section.slice(0, 40)))
      assert.ok(!section.includes('## 寬表格'), '不應包含下一節')
      assert.ok(section.includes('- [ ]'), '應包含任務清單內容')

      const lines = src.split('\n')
      const from = lines.indexOf('## 任務清單')
      let to = lines.indexOf('## 寬表格')
      while (!lines[to - 1].trim()) to--
      await heading.hover()
      await copyVia(cp, heading.locator('.ml-heading-copy'), '複製位置')
      assert.equal(await clip(cp), `${localMd}:${from + 1}-${to} (任務清單)`)
    } finally {
      await cp.close()
    }
  })
  const nestedMd = join(work, 'nested.md')
  writeFileSync(
    nestedMd,
    ['# 巢狀', '', '## A', '', '> ## 引用中的標題', '> 引用內容', '', 'A 的後續段落', '', '[ref]: https://example.com', '', '## B', '', 'B 的內容', ''].join('\n'),
  )
  await check('複製：引用中的標題只複製到引用結尾；章節不會被引用中的同級標題截斷，並含連結定義', async () => {
    const np = await openDoc(pathToFileURL(nestedMd).href)
    try {
      await np.bringToFront()
      const a = np.locator('.markdown-body > h2', { hasText: /^A/ })
      await a.hover()
      await copyVia(np, a.locator('.ml-heading-copy'), '複製內容')
      assert.equal(await clip(np), '## A\n\n> ## 引用中的標題\n> 引用內容\n\nA 的後續段落\n\n[ref]: https://example.com\n')
      const q = np.locator('blockquote h2')
      await q.hover()
      await copyVia(np, q.locator('.ml-heading-copy'), '複製內容')
      assert.equal(await clip(np), '> ## 引用中的標題\n> 引用內容\n')
      await q.hover()
      await copyVia(np, q.locator('.ml-heading-copy'), '複製位置')
      assert.equal(await clip(np), `${nestedMd}:5-6 (引用中的標題)`)
    } finally {
      await np.close()
    }
  })
  await check('複製：選取文字後可複製對應的原文與位置', async () => {
    const np = await openDoc(pathToFileURL(nestedMd).href)
    try {
      await np.bringToFront()
      // 從引用內容選到「A 的後續段落」，跨兩個區塊
      const select = (fromSel, toSel, from = 1, to = 2) =>
        np.evaluate(([f, t, a, b]) => {
          const r = document.createRange()
          r.setStart(document.querySelector(f).firstChild, a)
          r.setEnd(document.querySelector(t).firstChild, b)
          getSelection().removeAllRanges()
          getSelection().addRange(r)
          document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        }, [fromSel, toSel, from, to])
      await select('.markdown-body blockquote p', '.markdown-body > p')
      await np.waitForSelector('.ml-select-bar:not([hidden])')
      await np.click('.ml-select-btn:has-text("複製位置")')
      await np.waitForSelector('.ml-toast.show')
      assert.equal(await clip(np), `${nestedMd}:6-8`)
      await select('.markdown-body > p', '.markdown-body > p', 0, 3)
      await np.waitForSelector('.ml-select-bar:not([hidden])')
      await np.click('.ml-select-btn:has-text("複製原文")')
      await np.waitForFunction(() => document.querySelector('.ml-toast.show')?.textContent.includes('Markdown'))
      assert.equal(await clip(np), 'A 的後續段落\n')
      await np.evaluate(() => getSelection().removeAllRanges())
      await np.waitForSelector('.ml-select-bar[hidden]', { state: 'attached' })
    } finally {
      await np.close()
    }
  })
  await check('原始文字：顯示行號，點行號複製該行位置，選取時只能複製位置', async () => {
    const np = await openDoc(pathToFileURL(nestedMd).href)
    try {
      await np.bringToFront()
      await np.keyboard.press('r')
      const view = np.locator('.ml-source-view')
      assert.equal(await view.locator('.ml-src-line').count(), 14)
      assert.equal(await view.textContent(), readFileSync(nestedMd, 'utf8'), '畫面上的文字與原文相同，不含行號')
      await view.locator('.ml-src-line').nth(2).click({ position: { x: 4, y: 4 } })
      await np.waitForSelector('.ml-toast.show')
      assert.equal(await clip(np), `${nestedMd}:3`)
      await np.evaluate(() => {
        const ls = document.querySelectorAll('.ml-src-line')
        const r = document.createRange()
        r.setStart(ls[4].firstChild, 0)
        r.setEnd(ls[7].firstChild, 3)
        getSelection().removeAllRanges()
        getSelection().addRange(r)
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      })
      await np.waitForSelector('.ml-select-bar:not([hidden])')
      assert.equal(await np.locator('.ml-select-btn:has-text("複製原文")').isVisible(), false)
      await np.evaluate(() => document.querySelector('.ml-toast')?.classList.remove('show'))
      await np.click('.ml-select-btn:has-text("複製位置")')
      await np.waitForSelector('.ml-toast.show')
      assert.equal(await clip(np), `${nestedMd}:5-8`)
    } finally {
      await np.close()
    }
  })

  /* ---------- 安全性：攻擊樣本（test/fixtures/security.md） ---------- */
  // 攻擊成功會在 body 留下 data-xss 或跳出對話框。頁面上的 document 方法可能被樣本覆蓋（DOM clobbering），
  // 所以檢查一律透過 Document.prototype 呼叫
  const sp = await openDoc(pathToFileURL(join(root, 'test/fixtures/security.md')).href)
  const dialogs = []
  sp.on('dialog', d => {
    dialogs.push(d.message())
    d.dismiss().catch(() => {})
  })
  await sp.bringToFront()
  const inSec = fn => sp.evaluate(fn)
  // 等圖表與公式都畫完再檢查；放在 check 裡，逾時會記為失敗而不是中斷整個測試
  await check('安全性：攻擊樣本載入完成（7 張圖表、公式都已繪製）', async () => {
    await sp.waitForFunction(
      () => Document.prototype.querySelectorAll.call(document, '.ml-mermaid-view svg, .ml-mermaid-error').length === 7,
      null,
      { timeout: 20000 },
    )
    await sp.waitForFunction(() => document.documentElement.dataset.mlMath === 'loaded')
    await sp.waitForTimeout(200)
  })
  await check('安全性：Mermaid 圖表不含 foreignObject 與任何 HTML 元素', async () => {
    const html = await inSec(() =>
      Array.from(Document.prototype.querySelectorAll.call(document, '.ml-mermaid-view svg *'))
        .filter(el => el.namespaceURI !== 'http://www.w3.org/2000/svg' || el.localName === 'foreignObject')
        .map(el => el.localName),
    )
    assert.deepEqual(html, [])
  })
  await check('安全性：攻擊碼在載入與點擊後都沒有執行', async () => {
    const targets = sp.locator('.markdown-body a, .markdown-body summary, .markdown-body p, .ml-mermaid-view .node, .ml-mermaid-view .edgeLabel')
    // 正常的 http／mailto 連結會連到外部，攔下它的預設跳轉；其他網址（若有漏網的危險連結）照常放行，才測得出來
    await sp.evaluate(() =>
      document.addEventListener(
        'click',
        e => {
          const a = e.target.closest?.('a[href]')
          if (a && /^(https?|mailto):/i.test(a.getAttribute('href'))) e.preventDefault()
        },
        true,
      ),
    )
    const n = await targets.count()
    for (let i = 0; i < n; i++) {
      await targets.nth(i).click({ force: true, timeout: 300 }).catch(() => {})
      if (!sp.url().split('#')[0].endsWith('security.md')) throw new Error(`點擊第 ${i} 個元素後離開了頁面：${sp.url()}`)
    }
    await sp.waitForTimeout(500)
    assert.equal(await inSec(() => document.body.dataset.xss), undefined)
    assert.deepEqual(dialogs, [])
  })
  await check('安全性：危險標籤、事件屬性與危險網址全部移除（含 Mermaid 輸出）', async () => {
    const bad = await inSec(() => {
      const out = []
      const all = Document.prototype.querySelectorAll.call(document, '.markdown-body *')
      for (const el of all) {
        const inDiagram = !!el.closest('.ml-mermaid-view')
        // KaTeX 輸出（含 MathML 與錯誤提示的紅字樣式）另外檢查
        const inMath = !!el.closest('.katex, .katex-error')
        const tag = el.tagName.toUpperCase()
        // 介面的「複製這一節」按鈕圖示（文件中的 HTML 不能使用 ml- 開頭的 class，無法冒用）
        const inUi = !!el.closest('.ml-heading-copy')
        if (!inDiagram && !inUi && !(inMath && tag === 'MATH') && /^(SCRIPT|IFRAME|OBJECT|EMBED|FORM|INPUT|TEXTAREA|META|BASE|LINK|STYLE|SVG|MATH|TEMPLATE|NOSCRIPT|FRAME|FRAMESET)$/.test(tag)) out.push(tag)
        if (!inDiagram && tag === 'BUTTON' && !/\bml-/.test(el.className)) out.push('BUTTON')
        if (inDiagram && /^(SCRIPT|IFRAME|OBJECT|EMBED)$/.test(tag)) out.push(`mermaid ${tag}`)
        if (inMath && /^(A|IMG|SCRIPT)$/.test(tag)) out.push(`katex ${tag}`)
        if (inMath && /\bml-/.test(el.getAttribute('class') || '')) out.push(`katex class ${el.getAttribute('class')}`)
        if (inMath && /position\s*:\s*fixed/i.test(el.getAttribute('style') || '')) out.push('katex fixed')
        for (const at of el.attributes) {
          const v = at.value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase()
          if (at.name.toLowerCase().startsWith('on')) out.push(`${tag} ${at.name}`)
          if (/(^|:)href$|^(src|poster|action|data|srcdoc|formaction)$/i.test(at.name) && /^(javascript|vbscript|data:(?!image\/(png|gif|jpe?g|webp)))/.test(v)) out.push(`${tag} ${at.name}=${v.slice(0, 30)}`)
          if (!inDiagram && !inMath && at.name === 'style' && !/^text-align:/.test(at.value)) out.push(`${tag} style`)
        }
      }
      return out
    })
    assert.deepEqual(bad, [], bad.join(' | '))
  })
  await check('安全性：文件不能借用 MarkLens 介面的 class／id 偽造畫面', async () => {
    const r = await inSec(() => {
      const qa = s => Document.prototype.querySelectorAll.call(document, s)
      return {
        fakes: qa('.markdown-body :is(.ml-viewer, .ml-toast, .ml-toolbar)').length,
        roots: qa('[id="ml-root"]').length,
        forgedTask: qa('.markdown-body [class*="ml-task-0000000000000000"]').length,
      }
    })
    assert.deepEqual(r, { fakes: 0, roots: 1, forgedTask: 0 })
    // 工具列沒有被遮住，可以正常點擊
    await sp.click('.ml-toolbar button:has-text("全部摺疊")', { timeout: 2000 })
    assert.ok((await inSec(() => Document.prototype.querySelectorAll.call(document, '.ml-folded').length)) > 0)
    await sp.click('.ml-toolbar button:has-text("全部展開")', { timeout: 2000 })
  })
  await check('安全性：指向其他主機的 file:// 網址移除，同主機的保留', async () => {
    const src = id => sp.evaluate(i => Document.prototype.getElementById.call(document, i)?.getAttribute('src'), id)
    assert.equal(await src('unc-host'), null)
    assert.equal(await src('unc-slashes'), null)
    assert.equal(await src('same-host-file'), 'file:///marklens-not-exist/x.png')
  })
  await check('匯出 HTML：原文有不合法的網址時仍能匯出，該網址維持原樣', async () => {
    const { html } = await exportFrom(sp)
    assert.ok(html.includes('src="http://a\u0001b/x.png"'), '不合法的網址維持原樣')
    assert.ok(html.includes('本段應正常顯示'), '匯出完整內容')
  })
  await check('安全性：name 屬性無法覆蓋 document 的方法（DOM clobbering）', async () => {
    const r = await inSec(() => [typeof document.getElementById, typeof document.querySelector, typeof document.createElement, String(document.documentElement)])
    assert.deepEqual(r, ['function', 'function', 'function', '[object HTMLHtmlElement]'])
    assert.equal(await sp.locator('.markdown-body a[name="old-style-anchor"]').count(), 1, '<a name> 舊式錨點應保留')
  })
  await check('安全性：安全的內容照常顯示', async () => {
    assert.equal(await sp.locator('#safe-png[src^="data:image/png"]').count(), 1)
    assert.equal(await sp.locator('.ml-mermaid-view svg').count(), 7)
    assert.ok((await sp.textContent('.markdown-body')).includes('本段應正常顯示'))
    const toc = await sp.locator('.ml-toc-list a').allTextContents()
    assert.ok(toc.includes('第三層') && toc.includes('第四層'), toc.join('|'))
    assert.equal(await sp.locator('.ml-toc :is(img, script, a[href^="javascript"])').count(), 0)
  })
  await check('自動連結比照 GitHub：README.md、裸網域不連結', async () => {
    const p = sp.locator('.markdown-body p', { hasText: '自動連結：' })
    const hrefs = await p.locator('a').evaluateAll(as => as.map(a => a.getAttribute('href')))
    assert.deepEqual(hrefs, ['http://www.example.com', 'https://example.com/a', 'mailto:a@example.com'])
  })
  await sp.close()
  if (process.platform === 'win32') skip('安全性：檔名中的 HTML 不會被執行', 'Windows 檔名不能含 < >，CI 在 Linux 上檢查')
  else await check('安全性：檔名中的 HTML 不會被執行', async () => {
    const evilName = '<img src=x onerror=document.body.dataset.xss=1>.md'
    writeFileSync(join(work, evilName), '沒有標題的文件，頁面標題取自檔名。\n')
    const fp = await ctx.newPage()
    await fp.goto(pathToFileURL(join(work, evilName)).href)
    await fp.waitForSelector('#ml-root .markdown-body p')
    await fp.waitForTimeout(300)
    assert.equal(await fp.title(), evilName)
    assert.equal(await fp.evaluate(() => document.body.dataset.xss), undefined)
    await fp.close()
  })

  /* ---------- 載入時不閃出原始文字 ---------- */
  await check('載入中先隱藏原始文字；停用 MarkLens 時原文照常顯示', async () => {
    // 樣式表比程式早套用：程式接手前原文是隱藏的
    const hp = await ctx.newPage()
    await hp.addInitScript(() => {
      new MutationObserver((_, obs) => {
        const pre = document.querySelector('body > pre')
        if (!pre) return
        window.__preVis = getComputedStyle(pre).visibility
        obs.disconnect()
      }).observe(document, { childList: true, subtree: true })
    })
    await hp.goto(localUrl)
    await hp.waitForSelector('#ml-root .markdown-body h1')
    assert.equal(await hp.evaluate(() => window.__preVis), 'hidden')
    await hp.close()
    await sw.evaluate(() => MarkLens.saveSettings({ enabled: false }))
    try {
      const op = await ctx.newPage()
      await op.goto(localUrl)
      await op.waitForFunction(() => document.documentElement.classList.contains('ml-off'))
      assert.equal(await op.locator('#ml-root').count(), 0)
      assert.equal(await op.locator('body > pre').evaluate(el => getComputedStyle(el).visibility), 'visible')
      await op.close()
    } finally {
      await sw.evaluate(() => MarkLens.saveSettings({ enabled: true }))
    }
    // 停用／啟用會重新整理所有已開啟的分頁：等主要分頁重新渲染，後面的檢查才能繼續用
    await page.waitForSelector('#ml-root .markdown-body h1', { timeout: 5000 })
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' })
  })

  await check('同分頁換檔：舊畫面保留到新頁排好版（沒有空白頁），檔案清單不出現「讀取中」', async () => {
    const nav = join(work, 'nav')
    const vp = await openDoc(pathToFileURL(join(nav, '1-a.md')).href)
    try {
      await vp.click('.ml-side-tab:text("檔案")')
      await vp.waitForSelector('.ml-files-file a[href$="2-b.md"]')
      // 新頁一開始就記錄：轉場物件、排版完成與轉場結束的時間、是否出現過「讀取中」
      await vp.addInitScript(() => {
        const r = (window.__nav = { loading: false })
        addEventListener('pagereveal', e => {
          r.vt = !!e.viewTransition
          e.viewTransition?.finished.then(() => (r.vtEnd = performance.now()))
        })
        new MutationObserver(() => {
          if (!r.root && document.getElementById('ml-root')) r.root = performance.now()
          if ([...document.querySelectorAll('.ml-files-note')].some(n => n.textContent.includes('讀取中'))) r.loading = true
        }).observe(document, { childList: true, subtree: true, characterData: true })
      })
      await vp.click('.ml-files-file a[href$="2-b.md"]')
      await vp.waitForURL(/2-b\.md$/)
      await vp.waitForSelector('#ml-root .markdown-body h1:text("B")')
      await vp.waitForFunction(() => window.__nav.vtEnd)
      const r = await vp.evaluate(() => window.__nav)
      assert.equal(r.vt, true, '應有跨文件轉場')
      // 排版完成就結束轉場（不是等 1.5 秒的保底）
      assert.ok(r.vtEnd - r.root < 300, JSON.stringify(r))
      assert.equal(r.loading, false, '不應出現「讀取中」')
      assert.equal(await vp.textContent('.ml-files-file.active'), '2-b.md')
    } finally {
      await vp.close()
    }
  })
  await check('開新分頁時，等待畫面的背景沿用上次的主題（MarkLens 深色、系統淺色）', async () => {
    const before = (await sw.evaluate(() => MarkLens.loadSettings())).theme
    await sw.evaluate(() => MarkLens.saveSettings({ theme: 'dark' }))
    try {
      await (await openDoc()).close() // 讓深色主題寫進本機檔案的儲存空間
      const bp = await ctx.newPage()
      await bp.addInitScript(() => {
        new MutationObserver((_, obs) => {
          if (!document.querySelector('body > pre')) return
          window.__bg = getComputedStyle(document.documentElement).backgroundColor
          obs.disconnect()
        }).observe(document, { childList: true, subtree: true })
      })
      await bp.goto(localUrl)
      await bp.waitForSelector('#ml-root .markdown-body h1')
      assert.equal(await bp.evaluate(() => window.__bg), 'rgb(13, 17, 23)')
      await bp.close()
    } finally {
      await sw.evaluate(t => MarkLens.saveSettings({ theme: t }), before)
    }
  })

  /* ---------- 任務勾選寫回 ---------- */
  // 資料夾選擇視窗無法自動化：改用 OPFS（瀏覽器私有檔案系統）裡同名的「work」資料夾當作已授權資料夾，
  // 網址路徑中的 work/ 會對應到它，寫回的結果從 OPFS 讀出驗證。授權視窗本身需手動測試。
  // 背景程式只寫入內容與頁面所在檔案相同的那一份：每次寫回後以 opfs.mirror() 把 OPFS 的內容同步到實體檔，兩者才會一致
  await sw.evaluate(() => MarkLens.saveSettings({ autoRefresh: 'off' })) // 避免自動更新以實體檔覆蓋 OPFS 的寫回結果
  const tasksSrc = readFileSync(join(root, 'test/fixtures/tasks.md'), 'utf8')
  const crlfSrc = tasksSrc.replace(/\n/g, '\r\n')
  // 單獨的 \r 也是換行（markdown-it 與舊版 Mac 的換行）：「一」在第 2 行
  const crSrc = '# CR\r\r- [ ] 一\n- [ ] 二\n'
  const taskDir = join(work, 'work')
  mkdirSync(taskDir)
  writeFileSync(join(taskDir, 'tasks.md'), tasksSrc)
  writeFileSync(join(taskDir, 'tasks-crlf.md'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(crlfSrc)]))
  writeFileSync(join(taskDir, 'cr.md'), crSrc)
  const opfs = {
    async setup() {
      await sw.evaluate(async ([a, b, c]) => {
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
        await put('cr.md', c)
        for (const r of await MarkLens.Roots.list()) await MarkLens.Roots.remove(r.id)
        await MarkLens.Roots.add(dir)
      }, [tasksSrc, crlfSrc, crSrc])
    },
    /** 把 OPFS 的檔案內容寫回實體檔（模擬寫回的是頁面所在的那個檔案） */
    async mirror(name = 'tasks.md') {
      const bytes = await sw.evaluate(async n => {
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('work')
        return Array.from(new Uint8Array(await (await (await dir.getFileHandle(n)).getFile()).arrayBuffer()))
      }, name)
      writeFileSync(join(taskDir, name), Buffer.from(bytes))
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
    await opfs.mirror()
    assert.equal(await toast(), '已勾選並存檔復原')
    assert.equal(await box('第一項').isChecked(), true)
    assert.equal((await opfs.read('tasks.md')).text, tasksSrc.replace('- [ ] 第一項', '- [x] 第一項'))
  })
  await check('勾選寫回：引用區塊、有序清單、巢狀清單', async () => {
    await box('引用中的任務').click()
    await tp.waitForFunction(() => document.querySelectorAll('input.ml-task-box:checked').length === 3)
    await opfs.mirror()
    await box('有序清單任務').click()
    await tp.waitForFunction(() => document.querySelectorAll('input.ml-task-box:checked').length === 4)
    await opfs.mirror()
    await tp.locator('li li', { hasText: '巢狀任務' }).locator('input').click()
    await tp.waitForFunction(() => document.querySelectorAll('input.ml-task-box:checked').length === 5)
    await opfs.mirror()
    const t = (await opfs.read('tasks.md')).text
    assert.ok(t.includes('> - [x] 引用中的任務') && t.includes('1. [x] 有序清單任務') && t.includes('  - [x] 巢狀任務'), t)
    assert.ok(t.includes('- [x] 第二項\n'), '巢狀項目不應改到父項目')
    assert.ok(t.includes('- [ ] 程式碼區塊內，不可勾'))
  })
  await check('勾選寫回：取消勾選與復原', async () => {
    await box('第二項').click()
    await tp.waitForFunction(() => document.querySelector('.ml-toast.show')?.textContent.startsWith('已取消勾選'))
    await opfs.mirror()
    assert.ok((await opfs.read('tasks.md')).text.includes('- [ ] 第二項'))
    await tp.click('.ml-toast-btn:text("復原")')
    await tp.waitForFunction(() => document.querySelector('.ml-toast.show')?.textContent.startsWith('已勾選'))
    await opfs.mirror()
    assert.ok((await opfs.read('tasks.md')).text.includes('- [x] 第二項'))
  })
  await check('勾選寫回：檔案被其他地方修改時不寫入並重新載入', async () => {
    await opfs.append('tasks.md', '\n- [ ] 編輯器新增的項目\n')
    await opfs.mirror()
    const before = (await opfs.read('tasks.md')).text
    await box('第一項').click()
    await tp.waitForFunction(() => document.querySelector('.ml-toast.show')?.textContent.includes('其他地方修改'))
    assert.equal((await opfs.read('tasks.md')).text, before)
    assert.equal(await box('編輯器新增的項目').count(), 1)
    await box('編輯器新增的項目').click()
    await tp.waitForFunction(() => document.querySelector('.ml-toast.show')?.textContent.startsWith('已勾選'))
    await opfs.mirror()
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
  await check('勾選寫回：單獨的 \\r 換行，寫入點的那一行', async () => {
    const cp = await openDoc(pathToFileURL(join(taskDir, 'cr.md')).href)
    await cp.locator('.task-list-item', { hasText: '一' }).locator('input').click()
    await cp.waitForFunction(() => document.querySelector('.ml-toast.show')?.textContent.startsWith('已勾選'))
    assert.equal((await opfs.read('cr.md')).text, crSrc.replace('- [ ] 一', '- [x] 一'))
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
  await check('勾選寫回：關閉設定後勾選框唯讀，點擊時說明原因', async () => {
    await sw.evaluate(() => MarkLens.saveSettings({ taskWrite: false }))
    try {
    const p2 = await openDoc(pathToFileURL(join(taskDir, 'tasks.md')).href)
    const before = (await opfs.read('tasks.md')).text
    const b = p2.locator('.task-list-item', { hasText: '第一項' }).locator('input')
    assert.equal(await b.getAttribute('data-ml-readonly'), 'taskReadonlyOff')
    const was = await b.isChecked()
    await b.click()
    await p2.waitForFunction(() => document.querySelector('.ml-toast.show')?.textContent === '勾選寫回已關閉，可在 popup 開啟')
    assert.equal(await b.isChecked(), was, '勾選狀態不變')
    assert.equal((await opfs.read('tasks.md')).text, before, '檔案不變')
    await p2.close()
    } finally {
      await sw.evaluate(() => MarkLens.saveSettings({ taskWrite: true, autoRefresh: 'local' }))
    }
  })
  await check('勾選寫回：非 UTF-8 檔案唯讀，點擊時說明原因', async () => {
    // A4 A4 是 Big5 的「中」，不是合法的 UTF-8
    const big5 = join(taskDir, 'big5.md')
    writeFileSync(big5, Buffer.concat([Buffer.from('# Big5\n\n- [ ] '), Buffer.from([0xa4, 0xa4]), Buffer.from('\n')]))
    const p3 = await openDoc(pathToFileURL(big5).href)
    const b = p3.locator('input.ml-task-box')
    assert.equal(await b.getAttribute('data-ml-readonly'), 'taskNotUtf8')
    await b.click()
    await p3.waitForFunction(() => document.querySelector('.ml-toast.show')?.textContent === '此檔案不是 UTF-8 編碼，無法寫回')
    assert.equal(await b.isChecked(), false)
    await p3.close()
  })
  await check('Big5 檔案：照常渲染，中文不出現替代字元，勾選框唯讀並以滑過提示說明原因', async () => {
    // 使用手動測試的 Big5 檔（真實內容：標題、提示框、清單、表格、任務清單），複製一份避免改到原檔
    const big5 = join(taskDir, 'big5-manual.md')
    copyFileSync(join(root, 'test/manual/02-編碼-Big5.md'), big5)
    const p4 = await openDoc(pathToFileURL(big5).href)
    try {
      const r = await p4.evaluate(() => ({
        h1: document.querySelector('.markdown-body h1')?.dataset.mlText,
        alerts: document.querySelectorAll('.markdown-alert').length,
        items: document.querySelectorAll('.markdown-body li').length,
        tables: document.querySelectorAll('.markdown-body table').length,
        text: document.querySelector('.markdown-body').textContent,
        boxes: Array.from(document.querySelectorAll('input.ml-task-box'), b => [b.dataset.mlReadonly, b.title]),
      }))
      assert.ok(r.h1?.includes('Big5'), `標題：${r.h1}`)
      assert.equal(r.alerts, 2)
      assert.equal(r.tables, 1)
      assert.ok(r.items >= 6, `清單項目 ${r.items}`)
      // UTF-8 解碼失敗時要退回瀏覽器的解碼結果，不能留下 U+FFFD
      assert.equal(r.text.includes('\ufffd'), false, '出現替代字元')
      assert.ok(r.text.includes('繁體中文'), '中文內容')
      assert.equal(r.boxes.length, 4)
      for (const [reason, title] of r.boxes) {
        assert.equal(reason, 'taskNotUtf8')
        assert.equal(title, '此檔案不是 UTF-8 編碼，無法寫回')
      }
    } finally {
      await p4.close()
    }
  })
  await check('勾選寫回：多個授權資料夾都有這個路徑時，寫入內容與頁面相同的那一份；分不出來或只有別處的同名檔案就不寫', async () => {
    // OPFS：<暫存目錄名>/work/tasks.md（與頁面相同）、copy/work/tasks.md（另一份同名檔案）
    // 授權 <暫存目錄名>、<暫存目錄名>/work（巢狀，指向同一個檔案）與 copy/work
    const base = work.split(/[\\/]/).pop()
    writeFileSync(join(taskDir, 'tasks.md'), tasksSrc) // 前面的檢查已把勾選結果同步到實體檔
    const setup = (copySrc, onlyCopy = false) =>
      sw.evaluate(
        async ([b, a, c, only]) => {
          const top = await navigator.storage.getDirectory()
          for (const n of [b, 'copy']) await top.removeEntry(n, { recursive: true }).catch(() => {})
          const put = async (dir, text) => {
            const w = await (await dir.getFileHandle('tasks.md', { create: true })).createWritable()
            await w.write(text)
            await w.close()
          }
          const baseDir = await top.getDirectoryHandle(b, { create: true })
          const mine = await baseDir.getDirectoryHandle('work', { create: true })
          const other = await (await top.getDirectoryHandle('copy', { create: true })).getDirectoryHandle('work', { create: true })
          await put(mine, a)
          await put(other, c)
          for (const r of await MarkLens.Roots.list()) await MarkLens.Roots.remove(r.id)
          for (const d of only ? [other] : [baseDir, mine, other]) await MarkLens.Roots.add(d)
        },
        [base, tasksSrc, copySrc, onlyCopy],
      )
    const readOpfs = path =>
      sw.evaluate(async p => {
        let dir = await navigator.storage.getDirectory()
        for (const n of p.slice(0, -1)) dir = await dir.getDirectoryHandle(n)
        return (await (await dir.getFileHandle(p.at(-1))).getFile()).text()
      }, path)
    const click = async (pg, expect) => {
      await pg.locator('.task-list-item', { hasText: '第一項' }).first().locator('input').click()
      await pg.waitForFunction(t => document.querySelector('.ml-toast.show')?.textContent.startsWith(t), expect)
    }
    try {
      const other = tasksSrc.replace('第二項', '另一份檔案')
      await setup(other)
      const p5 = await openDoc(pathToFileURL(join(taskDir, 'tasks.md')).href)
      await click(p5, '已勾選並存檔')
      await p5.close()
      assert.equal(await readOpfs([base, 'work', 'tasks.md']), tasksSrc.replace('- [ ] 第一項', '- [x] 第一項'), '寫入與頁面相同的那一份')
      assert.equal(await readOpfs(['copy', 'work', 'tasks.md']), other, '另一份不動')
      // 兩份內容完全相同：分不出是哪一個檔案，不寫入
      await setup(tasksSrc)
      const p6 = await openDoc(pathToFileURL(join(taskDir, 'tasks.md')).href)
      await click(p6, '多個授權資料夾都有這個檔案')
      await p6.close()
      assert.equal(await readOpfs([base, 'work', 'tasks.md']), tasksSrc)
      assert.equal(await readOpfs(['copy', 'work', 'tasks.md']), tasksSrc)
      // 只授權了別處的同名檔案（copy/work），內容與頁面不同：不寫入，頁面也不換成那份的內容
      await setup(other, true)
      const p7 = await openDoc(pathToFileURL(join(taskDir, 'tasks.md')).href)
      await click(p7, '此檔案所在的資料夾尚未授權')
      assert.equal(await p7.locator('.task-list-item', { hasText: '另一份檔案' }).count(), 0, '頁面維持原內容')
      await p7.close()
      assert.equal(await readOpfs(['copy', 'work', 'tasks.md']), other, '別處的同名檔案不動')
    } finally {
      // 回到前一項檢查之後的狀態：沒有授權資料夾
      await sw.evaluate(async () => {
        for (const r of await MarkLens.Roots.list()) await MarkLens.Roots.remove(r.id)
      })
    }
  })
  await check('授權頁載入（沒有授權資料夾時顯示空白說明）', async () => {
    await sw.evaluate(async () => {
      for (const r of await MarkLens.Roots.list()) await MarkLens.Roots.remove(r.id)
    })
    const g = await ctx.newPage()
    g.on('pageerror', e => errors.push(e.message))
    await g.goto(`chrome-extension://${sw.url().split('/')[2]}/src/grant/grant.html?back=1`)
    await g.waitForSelector('#empty:not([hidden])')
    assert.equal(await g.locator('#back-row').isVisible(), true)
    await g.screenshot({ path: join(shotDir, 'ml-grant.png') })
    await g.close()
  })
  await tp.close()
  await check('勾選寫回：背景程式拒絕不合法的行號與勾選狀態，不會寫入檔案', async () => {
    const base = { line: 0, from: ' ', to: 'x', hash: '' }
    const bad = [{ to: '<script>' }, { from: 'y' }, { line: -1 }, { line: 1.5 }, { line: '0' }, { hash: 1 }]
    const results = await sw.evaluate(
      ([base, bad, url]) => Promise.all(bad.map(b => toggleTask({ ...base, ...b }, { url }))),
      [base, bad, pathToFileURL(localMd).href],
    )
    for (const r of results) assert.deepEqual(r, { status: 'error', error: 'invalid message' })
  })
  await check('勾選寫回：任務行的比對不會因大量引用符號而回溯過久（ReDoS）', async () => {
    const ms = await sw.evaluate(() => {
      const line = '> '.repeat(30) + '!'
      const start = performance.now()
      TASK_LINE_RE.exec(line)
      return performance.now() - start
    })
    assert.ok(ms < 100, `比對花了 ${Math.round(ms)}ms`)
  })
  await check('勾選寫回過程沒有 JS 錯誤', async () => {
    const left = errors.filter(e => !e.includes('ERR_FILE_NOT_FOUND') && !e.includes('404'))
    assert.deepEqual(left, [], left.join(' | '))
  })

  /* ---------- 介面多語系 ---------- */
  await check('語系檔：各語系的鍵與 $1 參數都與 en 一致，程式與頁面用到的鍵都存在', async () => {
    const load = loc => JSON.parse(readFileSync(join(root, `_locales/${loc}/messages.json`), 'utf8'))
    const en = load('en')
    const locales = readdirSync(join(root, '_locales')).filter(l => l !== 'en')
    assert.deepEqual(locales.sort(), ['zh_CN', 'zh_TW'])
    const params = m => (m.message.match(/\$\d/g) || []).sort().join()
    for (const loc of locales) {
      const other = load(loc)
      assert.deepEqual(Object.keys(other).sort(), Object.keys(en).sort(), loc)
      for (const k of Object.keys(en)) assert.equal(params(other[k]), params(en[k]), `${loc} ${k}`)
    }
    // 掃描原始碼中的 t('key')、data-i18n="key"、__MSG_key__
    const used = new Set()
    const scan = (file, re) => {
      for (const m of readFileSync(join(root, file), 'utf8').matchAll(re)) used.add(m[1])
    }
    const files = ['manifest.json', ...readdirSync(join(root, 'src'), { recursive: true }).map(f => join('src', f))]
    for (const f of files.filter(f => /\.(js|html|json)$/.test(f))) {
      scan(f, /\bt\(\s*'([A-Za-z0-9_]+)'/g)
      scan(f, /data-i18n(?:-html|-title|-placeholder)?="([A-Za-z0-9_]+)"/g)
      scan(f, /__MSG_([A-Za-z0-9_]+)__/g)
    }
    const missing = [...used].filter(k => !(k in en))
    assert.deepEqual(missing, [])
  })
  await check('介面語言設定：指定简体中文，閱讀頁與 popup 改為簡體中文', async () => {
    await sw.evaluate(() => MarkLens.saveSettings({ uiLang: 'zh_CN' }))
    try {
      const lp = await openDoc()
      const tools = (await lp.locator('.ml-toolbar').innerText()).replace(/\s+/g, ' ')
      assert.ok(tools.includes('全部折叠') && tools.includes('导出 HTML'), tools)
      assert.equal(await lp.locator('.ml-toc-search').getAttribute('placeholder'), '搜索标题')
      await lp.close()
      const pp = await ctx.newPage()
      await pp.goto(`chrome-extension://${extId}/src/popup/popup.html`)
      await pp.waitForFunction(() => document.querySelector('[data-i18n="uiLang"]')?.textContent === '界面语言')
      assert.equal(await pp.locator('select[name="uiLang"]').inputValue(), 'zh_CN')
      await pp.close()
    } finally {
      await sw.evaluate(() => MarkLens.saveSettings({ uiLang: 'auto' }))
    }
  })
  await check('介面語言設定：中文瀏覽器下指定 English，閱讀頁、popup、引導頁改為英文', async () => {
    await sw.evaluate(() => MarkLens.saveSettings({ uiLang: 'en' }))
    try {
      const lp = await openDoc()
      const tools = (await lp.locator('.ml-toolbar').innerText()).replace(/\s+/g, ' ')
      assert.ok(tools.includes('Fold all') && tools.includes('Export HTML'), tools)
      assert.equal(await lp.locator('.ml-toc-search').getAttribute('placeholder'), 'Search headings', 'placeholder')
      await lp.close()
      const wp = await ctx.newPage()
      await wp.goto(`chrome-extension://${extId}/src/welcome/welcome.html`)
      await wp.waitForSelector('#file-status[data-state="ok"]')
      await wp.waitForFunction(() => document.querySelector('h1').textContent === 'Welcome to MarkLens', null, { timeout: 3000 })
      assert.equal(await wp.evaluate(() => document.documentElement.lang), 'en', 'lang')
      await wp.close()
      // popup 切回自動時立即換回中文
      const pp = await ctx.newPage()
      await pp.goto(`chrome-extension://${extId}/src/popup/popup.html`)
      // popup 的文字是非同步填入的，等填好再檢查
      await pp.waitForFunction(() => document.querySelector('[data-i18n="secLayout"]').textContent === 'Layout defaults', null, { timeout: 3000 })
      await pp.selectOption('[name=uiLang]', 'auto')
      await pp.waitForFunction(() => document.querySelector('[data-i18n="secLayout"]').textContent === '版面預設值')
      assert.equal((await sw.evaluate(() => MarkLens.loadSettings())).uiLang, 'auto')
      await pp.close()
    } finally {
      await sw.evaluate(() => MarkLens.saveSettings({ uiLang: 'auto' }))
    }
  })
  await check('英文介面：工具列、popup 與引導頁顯示英文', async () => {
    setMacLanguage('en-US')
    const enCtx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ml-prof-en-')), {
      headless: true,
      channel: 'chromium',
      args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--disable-extensions-file-access-check', '--lang=en-US'],
    })
    setMacLanguage('zh-TW')
    try {
      const enSw = enCtx.serviceWorkers()[0] || (await enCtx.waitForEvent('serviceworker'))
      const ep = await enCtx.newPage()
      await ep.goto(localUrl)
      await ep.waitForSelector('#ml-root .markdown-body h1')
      const tools = (await ep.locator('.ml-toolbar').innerText()).replace(/\s+/g, ' ')
      assert.ok(tools.includes('Fold all') && tools.includes('Unfold all') && tools.includes('Theme: Auto'), tools)
      assert.match(await ep.textContent('.ml-toc-stats'), /^About [\d,]+ words · \d+ min$/)
      assert.equal(await ep.getAttribute('img[alt="示意圖"]', 'aria-label'), 'Enlarge image: 示意圖')
      const pp = await enCtx.newPage()
      await pp.goto(`chrome-extension://${enSw.url().split('/')[2]}/src/popup/popup.html`)
      await pp.waitForFunction(() => document.body.textContent.includes('Layout defaults'), null, { timeout: 3000 })
      assert.equal(await pp.locator('[name=theme] option[value=auto]').textContent(), 'System')
      assert.equal(await pp.evaluate(() => document.documentElement.lang), 'en-US')
    } finally {
      await enCtx.close()
    }
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
    // 重新載入當下若有一個讀檔請求還在等背景程式回應，要等它失敗後下一輪才發現失聯，所以多給一點時間
    await page.waitForSelector('.ml-orphan', { timeout: 8000 })
    await page.waitForTimeout(800)
    assert.deepEqual(errors.slice(before), [])
    const wrap = page.locator('.ml-table').first()
    await wrap.hover()
    await wrap.locator('.ml-table-bar button').last().click()
    assert.equal(await wrap.locator('.ml-table-bar button').last().textContent(), '離開全螢幕', '失聯後才用到的文字應是翻譯而不是 key')
    assert.match(await wrap.locator('.ml-table-title').textContent(), / · \d+ 列$/, '失聯後才用到的文字應是翻譯而不是 key')
  })
} finally {
  console.log(results.join('\n'))
  await ctx.close()
  server.close()
  setMacLanguage(null)
}
const failed = results.filter(r => r.startsWith('✘')).length
const skipped = results.filter(r => r.startsWith('－')).length
console.log(`\n${results.length - failed - skipped} 通過，${failed} 失敗${skipped ? `，${skipped} 略過` : ''}`)
process.exit(failed ? 1 : 0)
