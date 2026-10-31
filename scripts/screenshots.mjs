// 重新產生 README 用的截圖（docs/screenshots/）
// 用法：npm run screenshots（需要 playwright，與測試相同）
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { chromium } = createRequire(import.meta.url)('playwright')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'docs/screenshots')
const demoUrl = pathToFileURL(join(root, 'docs/demo.md')).href
mkdirSync(outDir, { recursive: true })

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ml-shot-')), {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--disable-extensions-file-access-check'],
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
})

/** 以指定主題開啟示範文件，等 Mermaid 畫完 */
async function open(theme) {
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'))
  await sw.evaluate(t => MarkLens.saveSettings({ theme: t }), theme)
  const page = await ctx.newPage()
  await page.goto(demoUrl)
  // 截圖環境（Linux）沒有 Segoe UI／蘋方，英文會落到中文字型；改用外觀相近的 Inter，貼近 Windows／Mac 的實際樣子
  // Inter 的等寬數字（tnum）連字號也是數字寬，表格裡的 order-api 會變寬；Segoe UI 沒有這個問題
  await page.addStyleTag({
    content: ':root { --ml-font: Inter, "Segoe UI", "Noto Sans CJK TC", sans-serif !important; } .ml-table td { font-variant-numeric: normal !important; }',
  })
  await page.waitForSelector('.ml-mermaid-view svg', { timeout: 15000 })
  await page.mouse.move(0, 0)
  await page.waitForTimeout(500) // 等字型與目錄高亮穩定
  return page
}

try {
  // 淺色：文件開頭，含目錄、提示框、任務清單
  const light = await open('light')
  await light.screenshot({ path: join(outDir, 'light.png') })
  await light.close()

  // 深色：表格依每日請求數由大到小排序，滑過表格顯示工具列，下方接 Mermaid 圖
  const dark = await open('dark')
  await dark.evaluate(() => {
    const h = document.getElementById('services')
    scrollTo(0, h.getBoundingClientRect().top + scrollY - 50)
  })
  const th = dark.locator('.ml-table th', { hasText: 'Requests / day' }).first()
  await th.click()
  await th.click()
  await dark.locator('.ml-table').first().hover({ position: { x: 300, y: 60 } })
  await dark.waitForTimeout(300)
  await dark.screenshot({ path: join(outDir, 'dark.png') })
  await dark.close()
  console.log(`已輸出到 ${outDir}`)
} finally {
  await ctx.close()
}
