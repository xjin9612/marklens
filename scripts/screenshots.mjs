// 產生 README 與商店用的截圖
// 用法：npm run screenshots（需要 playwright，與測試相同）
//   docs/screenshots/<語系>/  原始截圖，README 使用
//   docs/store/<語系>/        商店截圖（上方加說明色帶，文字見 LANGS 的 captions）、440×280 與 1400×560 宣傳圖
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
    captions: {
      '1-tables': 'Sort, filter and resize tables, then paste them into a spreadsheet',
      '2-outline-tasks': 'Check off tasks in local .md files — saved straight back to the file',
      '3-files': 'Browse every Markdown file in a folder, free',
      '4-dark-mermaid': 'Mermaid diagrams, math and a dark theme',
      '5-table-fullscreen': 'Fullscreen tables that filter as you type',
    },
  },
  {
    lang: 'zh-TW',
    dir: 'zh-TW',
    demo: 'docs/demo.zh-TW.md',
    table: 'docs/store/table.zh-TW.md',
    readme: 'README.zh-TW.md',
    text: { services: '服務', requests: '每日請求數', flow: '部署流程' },
    promoText: { tagline: '表格真的能用的<br>Markdown 閱讀器', note: '開源・不收集任何資料' },
    captions: {
      '1-tables': '表格可排序、篩選、拖拉欄寬，一鍵貼到 Excel',
      '2-outline-tasks': '勾選本機 .md 檔的任務，直接存回檔案',
      '3-files': '瀏覽整個資料夾的 Markdown 檔案，完全免費',
      '4-dark-mermaid': 'Mermaid 圖表、數學公式與深色主題',
      '5-table-fullscreen': '表格全螢幕，邊打字邊篩選',
    },
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

/**
 * 大型宣傳圖（marquee）1400×560 的 HTML：同一套配色，右側疊放兩張完整截圖（後方深色、前方淺色），縮成 0.55 倍
 */
function marqueeHtml({ tagline, note }, frontBase64, backBase64) {
  const shot = b64 => `background: url(data:image/png;base64,${b64}) no-repeat 0 0 / 704px 440px;`
  return `<!doctype html><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; }
    body { width: 1400px; height: 560px; overflow: hidden; position: relative;
      font-family: "Segoe UI", "Microsoft JhengHei UI", "Microsoft JhengHei", sans-serif;
      background: radial-gradient(110% 150% at 0% 0%, #4f46e5 0%, #3730a3 45%, #1e3a8a 100%); color: #fff; }
    .text { position: absolute; left: 96px; top: 110px; width: 520px; }
    .icon svg { width: 104px; height: 104px; display: block; }
    h1 { font-size: 68px; font-weight: 700; letter-spacing: -0.015em; margin-top: 22px; }
    p { font-size: 30px; line-height: 1.4; margin-top: 10px; color: #e0e7ff; }
    .note { position: absolute; left: 96px; bottom: 56px; font-size: 22px; color: #67e8f9; letter-spacing: 0.02em; }
    .shot { position: absolute; width: 704px; height: 440px; border-radius: 14px;
      transform: rotate(-3deg); transform-origin: left top;
      box-shadow: 0 30px 70px rgba(8, 12, 40, .6), 0 0 0 1px rgba(255, 255, 255, .25); }
    .back { left: 700px; top: 34px; ${shot(backBase64)} }
    .front { left: 610px; top: 160px; ${shot(frontBase64)} }
  </style>
  <div class="text">
    <div class="icon">${ICON_SVG}</div>
    <h1>MarkLens</h1>
    <p>${tagline}</p>
  </div>
  <div class="note">${note}</div>
  <div class="shot back"></div>
  <div class="shot front"></div>`
}

const CAPTION_HEIGHT = 100

/** 商店截圖：上方是品牌色的說明色帶，下方接原始截圖（不縮放，底部被截掉 CAPTION_HEIGHT） */
function captionHtml(text, shotBase64) {
  return `<!doctype html><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; }
    body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden;
      font-family: "Segoe UI", "Microsoft JhengHei UI", "Microsoft JhengHei", sans-serif; }
    .band { height: ${CAPTION_HEIGHT}px; display: flex; align-items: center; gap: 20px; padding: 0 44px;
      background: linear-gradient(100deg, #4f46e5 0%, #3730a3 50%, #1e3a8a 100%); color: #fff; }
    .band svg { width: 48px; height: 48px; flex: none; }
    .band span { font-size: 32px; font-weight: 600; letter-spacing: -0.005em; }
    .shot { height: ${HEIGHT - CAPTION_HEIGHT}px; background: url(data:image/png;base64,${shotBase64}) no-repeat 0 0 / ${WIDTH}px ${HEIGHT}px; }
  </style>
  <div class="band">${ICON_SVG}<span>${text}</span></div>
  <div class="shot"></div>`
}

/** 捲到指定標題，讓它停在工具列下方 */
async function scrollToHeading(page, text) {
  await page.locator('#ml-root .markdown-body :is(h1, h2, h3)', { hasText: text }).first().evaluate(h => {
    scrollTo(0, h.getBoundingClientRect().top + scrollY - 50)
  })
}

for (const { lang, dir, demo, table: tableDoc, readme, text, promoText, captions } of LANGS) {
  const outDir = join(root, 'docs/store', dir)
  const rawDir = join(root, 'docs/screenshots', dir)
  mkdirSync(outDir, { recursive: true })
  mkdirSync(rawDir, { recursive: true })
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
    // 原始截圖：README 使用，宣傳圖也用沒有說明色帶的畫面
    const raw = {}
    const caption = await ctx.newPage()
    await caption.setViewportSize({ width: WIDTH, height: HEIGHT })
    for (const [name, shoot] of Object.entries(shots)) {
      const page = await shoot()
      await page.waitForTimeout(300)
      raw[name] = await page.screenshot({ path: join(rawDir, `${name}.png`) })
      await page.close()
      // 上方加說明色帶，截圖不縮放、往下移，截掉底部同樣的高度
      await caption.setContent(captionHtml(captions[name], raw[name].toString('base64')))
      await caption.evaluate(() => document.fonts.ready)
      await caption.screenshot({ path: join(outDir, `${name}.png`) })
      console.log(`✔ ${dir}/${name}.png`)
    }
    await caption.close()

    // 小型宣傳圖 440×280：圖示、名稱、標語，右側放第 1 張截圖的表格區域
    const promo = await ctx.newPage()
    await promo.setViewportSize({ width: 440, height: 280 })
    await promo.setContent(promoHtml(promoText, raw['1-tables'].toString('base64')))
    await promo.evaluate(() => document.fonts.ready)
    await promo.screenshot({ path: join(outDir, 'promo-440x280.png') })
    await promo.close()
    console.log(`✔ ${dir}/promo-440x280.png`)

    // 大型宣傳圖 1400×560：只在商店選為精選橫幅時使用；Edge Add-ons 也接受這個尺寸
    const shotB64 = name => raw[name].toString('base64')
    const marquee = await ctx.newPage()
    await marquee.setViewportSize({ width: 1400, height: 560 })
    await marquee.setContent(marqueeHtml(promoText, shotB64('2-outline-tasks'), shotB64('4-dark-mermaid')))
    await marquee.evaluate(() => document.fonts.ready)
    await marquee.screenshot({ path: join(outDir, 'marquee-1400x560.png') })
    await marquee.close()
    console.log(`✔ ${dir}/marquee-1400x560.png`)
  } finally {
    await ctx.close()
  }
}
console.log(`已輸出到 ${join(root, 'docs/store')}`)
