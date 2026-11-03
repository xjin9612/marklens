// 產生 Chrome Web Store / Edge Add-ons 的商店截圖與 440×280 小型宣傳圖（docs/store/<語系>/）
// 用法：npm run screenshots:store（需要 playwright，與測試相同）
// 商店接受 1280×800 或 640×400；以 1280×800、1 倍縮放截圖，畫面就是使用者實際看到的大小
// 字型取決於執行的作業系統，建議在 Windows 上產生（Segoe UI、微軟正黑體），與多數使用者看到的一致
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { chromium } = createRequire(import.meta.url)('playwright')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const doc = name => pathToFileURL(join(root, name)).href
const WIDTH = 1280
const HEIGHT = 800
// 截圖前統一：關閉轉場與游標閃爍
const FREEZE = '*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }'

// 每個商店語系：瀏覽器語言、輸出資料夾、示範文件與其中的標題文字、檔案分頁要開的文件
const LANGS = [
  {
    lang: 'en-US',
    dir: 'en',
    demo: 'docs/demo.md',
    table: 'docs/store/table.md',
    readme: 'README.md',
    text: { services: 'Services', requests: 'Requests / day', flow: 'Deployment flow' },
    promoText: { tagline: 'A Markdown reader with<br>tables you can actually use', note: 'Open source · Collects no data' },
  },
  {
    lang: 'zh-TW',
    dir: 'zh-TW',
    demo: 'docs/demo.zh-TW.md',
    table: 'docs/store/table.zh-TW.md',
    readme: 'README.zh-TW.md',
    text: { services: '服務', requests: '每日請求數', flow: '部署流程' },
    promoText: { tagline: '表格真的能用的<br>Markdown 閱讀器', note: '開源・不收集任何資料' },
  },
]

const ICON_SVG = readFileSync(join(root, 'icons/icon.svg'), 'utf8').replace('<svg ', '<svg width="52" height="52" ')

/**
 * 小型宣傳圖的 HTML：配色取自圖示（靛藍漸層、青色），截圖只露出表格一角
 */
function promoHtml({ tagline, note }, shotBase64) {
  return `<!doctype html><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; }
    body { width: 440px; height: 280px; overflow: hidden; position: relative;
      font-family: "Segoe UI", "Microsoft JhengHei UI", "Microsoft JhengHei", sans-serif;
      background: radial-gradient(120% 140% at 0% 0%, #4f46e5 0%, #3730a3 45%, #1e3a8a 100%); color: #fff; }
    .text { position: absolute; left: 28px; top: 30px; width: 200px; }
    .icon { width: 52px; height: 52px; display: block; }
    h1 { font-size: 30px; font-weight: 700; letter-spacing: -0.01em; margin-top: 12px; }
    p { font-size: 15px; line-height: 1.45; margin-top: 6px; color: #e0e7ff; }
    .note { position: absolute; left: 28px; bottom: 22px; font-size: 12px; color: #67e8f9; letter-spacing: 0.02em; }
    /* 截圖以一半大小顯示：x 300→150、y 50→25 */
    .shot { position: absolute; left: 244px; top: 52px; width: 260px; height: 200px;
      border-radius: 10px; transform: rotate(-4deg); transform-origin: left top;
      box-shadow: 0 18px 40px rgba(8, 12, 40, .55), 0 0 0 1px rgba(255, 255, 255, .25);
      background: #fff url(data:image/png;base64,${shotBase64}) no-repeat -150px -25px / 640px 400px; }
  </style>
  <div class="text">
    <div class="icon">${ICON_SVG}</div>
    <h1>MarkLens</h1>
    <p>${tagline}</p>
  </div>
  <div class="note">${note}</div>
  <div class="shot"></div>`
}

/** 捲到指定標題，讓它停在工具列下方 */
async function scrollToHeading(page, text) {
  await page.locator('#ml-root .markdown-body :is(h1, h2, h3)', { hasText: text }).first().evaluate(h => {
    scrollTo(0, h.getBoundingClientRect().top + scrollY - 50)
  })
}

for (const { lang, dir, demo, table: tableDoc, readme, text, promoText } of LANGS) {
  const outDir = join(root, 'docs/store', dir)
  mkdirSync(outDir, { recursive: true })
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ml-store-')), {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--disable-extensions-file-access-check', `--lang=${lang}`],
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  })
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'))
  // 每張都從文件頂端開始，不受前一張的閱讀位置影響
  await sw.evaluate(() => MarkLens.saveSettings({ rememberScroll: false }))

  /** 以指定主題開啟文件，等字型、Mermaid、公式都畫完 */
  async function open(url, theme) {
    await sw.evaluate(t => MarkLens.saveSettings({ theme: t }), theme)
    const page = await ctx.newPage()
    await page.goto(url)
    await page.waitForSelector('#ml-root .markdown-body h1')
    await page.addStyleTag({ content: FREEZE })
    await page.waitForFunction(() => !document.querySelector('.ml-mermaid-pending'), null, { timeout: 15000 })
    await page.evaluate(() => document.fonts.ready)
    // README 裡有遠端圖片（測試徽章），等全部載完，否則每次截圖結果不同
    await page.waitForFunction(() => [...document.images].every(i => i.complete), null, { timeout: 15000 })
    await page.mouse.move(0, HEIGHT - 1)
    await page.waitForTimeout(300)
    return page
  }

  /** 依每日請求數由大到小排序（點兩次表頭） */
  async function sortByRequests(page) {
    const th = page.locator('.ml-table th', { hasText: text.requests }).first()
    await th.click()
    await th.click()
  }

  const shots = {
    // 表格：依每日請求數由大到小排序，滑過表格顯示工具列（篩選、複製、全螢幕）
    '1-tables': async () => {
      const p = await open(doc(demo), 'light')
      await scrollToHeading(p, text.services)
      await sortByRequests(p)
      await p.locator('.ml-table').first().hover({ position: { x: 300, y: 60 } })
      return p
    },
    // 文件開頭：目錄、提示框、可勾選的任務清單
    '2-outline-tasks': async () => open(doc(demo), 'light'),
    // 檔案分頁：MarkLens 自己的 README 與它所在的資料夾
    '3-files': async () => {
      const p = await open(doc(readme), 'light')
      await p.click('.ml-side-tab:nth-child(2)')
      await p.waitForSelector('.ml-files-file.active')
      await p.mouse.move(WIDTH - 1, HEIGHT - 1)
      return p
    },
    // 深色主題與 Mermaid 流程圖
    '4-dark-mermaid': async () => {
      const p = await open(doc(demo), 'dark')
      await p.waitForSelector('.ml-mermaid-view svg', { timeout: 15000 })
      await scrollToHeading(p, text.flow)
      return p
    },
    // 表格全螢幕：24 列的大表格依 p95 由大到小排序，篩選出亞洲區域（ap-）
    '5-table-fullscreen': async () => {
      const p = await open(doc(tableDoc), 'light')
      const table = p.locator('.ml-table').first()
      const th = table.locator('th', { hasText: 'p95' })
      await th.click()
      await th.click()
      await table.hover({ position: { x: 300, y: 60 } })
      await table.locator('.ml-table-bar button').last().click() // 全螢幕
      await p.waitForSelector('.ml-table-full')
      await table.locator('.ml-table-filter').fill('ap-')
      await p.mouse.move(WIDTH - 1, HEIGHT - 1)
      return p
    },
  }

  try {
    for (const [name, shoot] of Object.entries(shots)) {
      const page = await shoot()
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(outDir, `${name}.png`) })
      await page.close()
      console.log(`✔ ${dir}/${name}.png`)
    }

    // 小型宣傳圖 440×280：圖示、名稱、標語，右側放第 1 張截圖的表格區域
    const promo = await ctx.newPage()
    await promo.setViewportSize({ width: 440, height: 280 })
    await promo.setContent(promoHtml(promoText, readFileSync(join(outDir, '1-tables.png')).toString('base64')))
    await promo.evaluate(() => document.fonts.ready)
    await promo.screenshot({ path: join(outDir, 'promo-440x280.png') })
    await promo.close()
    console.log(`✔ ${dir}/promo-440x280.png`)
  } finally {
    await ctx.close()
  }
}
console.log(`已輸出到 ${join(root, 'docs/store')}`)
