// 視覺回歸測試：把幾個固定畫面截圖，與 test/visual/<平台>/ 的基準圖逐像素比對，找出版面跑掉的地方
// 用法：npm run test:visual            比對；沒有基準圖的畫面會直接建立基準
//       npm run test:visual -- --update 以目前畫面覆寫全部基準圖（確認改動是預期的之後）
// 字型隨作業系統不同，基準圖依平台分開存放（linux、win32、darwin），各自在該平台上建立
// 差異圖輸出到 SHOT_DIR（預設為系統暫存目錄）下的 ml-visual/：紅色是不同的像素
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { chromium } = createRequire(import.meta.url)('playwright')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const baseDir = join(root, 'test/visual', process.platform)
const outDir = join(process.env.SHOT_DIR || tmpdir(), 'ml-visual')
const update = process.argv.includes('--update')
// 每個色版差超過 CHANNEL 才算不同（吸收抗鋸齒的細微差異）；不同的像素超過 RATIO 比例才算失敗
const CHANNEL = 32
const RATIO = Number(process.env.VISUAL_TOLERANCE || 0.001)

mkdirSync(baseDir, { recursive: true })
mkdirSync(outDir, { recursive: true })

const doc = name => pathToFileURL(join(root, name)).href
// 截圖前統一：關閉轉場與游標閃爍、隱藏會隨發布改變的版本號
const FREEZE = '*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; } #version { visibility: hidden; }'

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ml-visual-')), {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--disable-extensions-file-access-check', '--lang=zh-TW'],
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
})
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'))
const extId = sw.url().split('/')[2]
const setTheme = theme => sw.evaluate(t => MarkLens.saveSettings({ theme: t }), theme)
// 不記住閱讀位置：同一份文件在不同畫面中都從頂端開始
await sw.evaluate(() => MarkLens.saveSettings({ rememberScroll: false }))

/** 開啟閱讀頁並等到畫面穩定：字型、Mermaid、公式都畫完 */
async function reader(url, { theme = 'light', width = 1280, height = 800 } = {}) {
  await setTheme(theme)
  const page = await ctx.newPage()
  await page.setViewportSize({ width, height })
  await page.goto(url)
  await page.waitForSelector('#ml-root .markdown-body h1')
  await page.addStyleTag({ content: FREEZE })
  await page.waitForFunction(() => !document.querySelector('.ml-mermaid-pending'), null, { timeout: 15000 })
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, height - 1)
  await page.waitForTimeout(300)
  return page
}

async function extPage(name, { scheme = 'light', width = 900, height = 900 } = {}) {
  await setTheme('auto')
  const page = await ctx.newPage()
  await page.emulateMedia({ colorScheme: scheme })
  await page.setViewportSize({ width, height })
  await page.goto(`chrome-extension://${extId}/src/${name}/${name}.html`)
  await page.addStyleTag({ content: FREEZE })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  return page
}

/** 要比對的畫面：名稱 → 產生截圖（PNG Buffer） */
const SCENES = {
  'reader-light': async () => {
    const p = await reader(doc('docs/demo.md'))
    return [p, await p.screenshot()]
  },
  'reader-dark-table': async () => {
    const p = await reader(doc('docs/demo.md'), { theme: 'dark' })
    await p.evaluate(() => {
      const h = document.getElementById('services')
      scrollTo(0, h.getBoundingClientRect().top + scrollY - 50)
    })
    await p.locator('.ml-table th', { hasText: 'Requests / day' }).first().click()
    await p.mouse.move(0, 799)
    await p.waitForTimeout(200)
    return [p, await p.screenshot()]
  },
  'reader-narrow': async () => {
    const p = await reader(doc('docs/demo.md'), { width: 420, height: 800 })
    return [p, await p.screenshot()]
  },
  'sidebar-files': async () => {
    const p = await reader(doc('test/fixtures/sample.md'))
    await p.click('.ml-side-tab:nth-child(2)')
    await p.waitForSelector('.ml-files-file.active')
    await p.mouse.move(0, 799)
    await p.waitForTimeout(200)
    return [p, await p.screenshot({ clip: { x: 0, y: 0, width: 400, height: 300 } })]
  },
  'mermaid-dark': async () => {
    const p = await reader(doc('test/manual/08-Mermaid.md'), { theme: 'dark', height: 1400 })
    return [p, await p.screenshot()]
  },
  'popup-light': async () => {
    const p = await extPage('popup', { width: 330, height: 640 })
    return [p, await p.screenshot()]
  },
  'popup-dark': async () => {
    const p = await extPage('popup', { scheme: 'dark', width: 330, height: 640 })
    return [p, await p.screenshot()]
  },
  'welcome-light': async () => {
    const p = await extPage('welcome', { height: 1100 })
    return [p, await p.screenshot()]
  },
}

/** 在瀏覽器裡用 canvas 比對兩張 PNG（不需要額外的影像套件），回傳不同的像素數與差異圖 */
async function compare(page, expected, actual) {
  return page.evaluate(
    async ([a, b, channel]) => {
      const load = async b64 => {
        const img = new Image()
        img.src = `data:image/png;base64,${b64}`
        await img.decode()
        const c = new OffscreenCanvas(img.width, img.height)
        const g = c.getContext('2d')
        g.drawImage(img, 0, 0)
        return { w: img.width, h: img.height, data: g.getImageData(0, 0, img.width, img.height).data }
      }
      const [x, y] = await Promise.all([load(a), load(b)])
      if (x.w !== y.w || x.h !== y.h) return { sizeMismatch: `${x.w}×${x.h} → ${y.w}×${y.h}` }
      // 差異圖：相同的像素淡化成灰，不同的標紅
      const out = new ImageData(x.w, x.h)
      let diff = 0
      for (let i = 0; i < x.data.length; i += 4) {
        const d = Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]), Math.abs(x.data[i + 2] - y.data[i + 2]))
        if (d > channel) {
          diff++
          out.data.set([255, 0, 0, 255], i)
        } else {
          const v = 200 + ((x.data[i] + x.data[i + 1] + x.data[i + 2]) / 3) * 0.2
          out.data.set([v, v, v, 255], i)
        }
      }
      const c = new OffscreenCanvas(x.w, x.h)
      c.getContext('2d').putImageData(out, 0, 0)
      const blob = await c.convertToBlob({ type: 'image/png' })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return { diff, total: x.w * x.h, image: btoa(bin) }
    },
    [expected.toString('base64'), actual.toString('base64'), CHANNEL],
  )
}

const results = []
let failed = 0
const blank = await ctx.newPage()
try {
  for (const [name, shoot] of Object.entries(SCENES)) {
    const file = join(baseDir, `${name}.png`)
    let page
    try {
      const [p, png] = await shoot()
      page = p
      writeFileSync(join(outDir, `${name}.actual.png`), png)
      if (update || !existsSync(file)) {
        writeFileSync(file, png)
        results.push(`＋ ${name}：${update ? '已更新' : '已建立'}基準圖`)
        continue
      }
      const r = await compare(blank, readFileSync(file), png)
      if (r.sizeMismatch) {
        failed++
        results.push(`✘ ${name}：尺寸不同（${r.sizeMismatch}）`)
        continue
      }
      const ratio = r.diff / r.total
      if (r.diff) writeFileSync(join(outDir, `${name}.diff.png`), Buffer.from(r.image, 'base64'))
      if (ratio > RATIO) {
        failed++
        results.push(`✘ ${name}：${r.diff} 個像素不同（${(ratio * 100).toFixed(3)}%），差異圖 ${join(outDir, `${name}.diff.png`)}`)
      } else {
        results.push(`✔ ${name}${r.diff ? `（${r.diff} 個像素在容許範圍內）` : ''}`)
      }
    } catch (e) {
      failed++
      results.push(`✘ ${name}：${e.message.split('\n')[0]}`)
    } finally {
      await page?.close()
    }
  }
} finally {
  await ctx.close()
}

console.log(results.join('\n'))
console.log(`\n${results.length - failed} 通過，${failed} 失敗（基準圖：${baseDir}）`)
process.exit(failed ? 1 : 0)
