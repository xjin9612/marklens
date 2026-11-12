// 版面檢查：以多種視窗寬度與中英介面開啟 repo 內的 Markdown 文件，找出跑版
// 用法：npm run audit:layout（需要 playwright，與測試相同；約 3–4 分鐘，不在 CI 中執行）
// 改了版面（content.css、工具列、側邊欄）後執行；有問題時結束碼為 1
//
// 檢查項目：
//   A 整頁橫向溢出：頁面比視窗寬
//   B 沒對齊文字欄：一般內容（段落、說明、公式…）的左右緣與標題不同
//   C 寬區塊超出文字欄：設定為「可超出文字欄」時表格與程式碼可以超出，只列出來源供參考，不算問題
//   D 工具列換行或溢出
//   E 內容溢出容器：文字超出不能捲動的容器（提示框、引用、清單…）
import { createRequire } from 'node:module'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const mdIn = dir => readdirSync(join(root, dir)).filter(f => f.endsWith('.md')).map(f => `${dir}/${f}`)
const DOCS = [
  ...mdIn('test/manual').filter(f => !/\/09-/.test(f)), // 09 是約 1MB 的大檔，由 npm run manual:bigfile 產生
  ...mdIn('test/fixtures'),
  ...mdIn('docs'),
  ...mdIn('docs/store'),
  ...readdirSync(root).filter(f => f.endsWith('.md')),
]
const WIDTHS = [1920, 1280, 900, 420]
const LANGS = ['zh-TW', 'en-US']
const INFO = 'C' // 只列出、不算問題的類別

/** 在頁面中量測，回傳 [類別, 說明] */
function measure() {
  const out = []
  const de = document.documentElement
  if (de.scrollWidth > innerWidth + 1) out.push(['A 整頁橫向溢出', `scrollWidth ${de.scrollWidth} > ${innerWidth}`])
  const body = document.querySelector('.markdown-body')
  const ref = body.querySelector(':scope > :is(h1, h2, h3, h4, h5, h6, p)')?.getBoundingClientRect()
  const desc = el => [el.tagName.toLowerCase(), ...(typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : [])].join('.')
  for (const el of body.children) {
    const r = el.getBoundingClientRect()
    if (!r.width || !ref) continue
    const wide = el.matches('.ml-table, .ml-code')
    if (!wide && Math.abs(r.left - ref.left) > 1) out.push(['B 沒對齊文字欄', `${desc(el)} 左緣 ${Math.round(r.left)} ≠ ${Math.round(ref.left)}`])
    if (!wide && r.right > ref.right + 1) out.push(['B 超出文字欄右緣', `${desc(el)} 右緣 ${Math.round(r.right)} > ${Math.round(ref.right)}`])
    if (wide && (r.left < ref.left - 1 || r.right > ref.right + 1)) {
      const what = el.matches('.ml-mermaid')
        ? el.querySelector('.ml-mermaid-error')
          ? 'Mermaid 錯誤訊息'
          : el.classList.contains('ml-mermaid-source')
            ? 'Mermaid 原始碼'
            : 'Mermaid 圖'
        : el.matches('.ml-table')
          ? '表格'
          : '程式碼'
      out.push(['C 寬區塊超出文字欄', what])
    }
  }
  for (const el of body.querySelectorAll('blockquote, .markdown-alert, li, p, .ml-mermaid-error, details, h1, h2, h3, h4')) {
    if (/(auto|scroll|hidden)/.test(getComputedStyle(el).overflowX)) continue
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) {
      out.push(['E 內容溢出容器', `${desc(el)} ${el.scrollWidth} > ${el.clientWidth}：${el.textContent.trim().slice(0, 30)}`])
    }
  }
  const tb = document.querySelector('.ml-toolbar')
  if (tb) {
    if (tb.scrollWidth > tb.clientWidth + 1) out.push(['D 工具列溢出', `${tb.scrollWidth} > ${tb.clientWidth}`])
    const rows = new Set(
      [...tb.querySelectorAll('.ml-tool')].filter(b => b.getBoundingClientRect().width).map(b => Math.round(b.getBoundingClientRect().top)),
    )
    if (rows.size > 1) out.push(['D 工具列換行', `${rows.size} 行`])
  }
  return out
}

const findings = new Map() // 類別｜說明 → 出現的位置（同一頁有多個相同情況只記一次）
function add(kind, detail, where) {
  const key = `${kind}｜${detail}`
  if (!findings.has(key)) findings.set(key, new Set())
  findings.get(key).add(where)
}

for (const lang of LANGS) {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ml-layout-')), {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--disable-extensions-file-access-check', `--lang=${lang}`],
  })
  try {
    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'))
    await sw.evaluate(() => Markloupe.saveSettings({ rememberScroll: false }))
    const page = await ctx.newPage()
    for (const doc of DOCS) {
      for (const width of WIDTHS) {
        const where = `${doc} @${width} ${lang}`
        await page.setViewportSize({ width, height: 900 })
        await page.goto(pathToFileURL(join(root, doc)).href)
        try {
          await page.waitForSelector('#ml-root .markdown-body > *', { timeout: 5000 })
        } catch {
          add('載入失敗', '沒有渲染', where)
          continue
        }
        await page.waitForFunction(() => !document.querySelector('.ml-mermaid-pending'), null, { timeout: 15000 }).catch(() => {})
        await page.waitForTimeout(400) // 等字型與目錄高亮穩定
        for (const [kind, detail] of await page.evaluate(measure)) add(kind, detail, where)
      }
    }
  } finally {
    await ctx.close()
  }
}

let problems = 0
for (const [key, places] of [...findings].sort(([a], [b]) => a.localeCompare(b))) {
  const where = [...places]
  const info = key.startsWith(INFO)
  if (!info) problems++
  console.log(`${info ? '·' : '✘'} ${key}（${where.length} 處）\n    ${where.slice(0, 4).join('\n    ')}${where.length > 4 ? '\n    …' : ''}`)
}
console.log(`\n${DOCS.length} 份文件 × ${WIDTHS.length} 種寬度 × ${LANGS.length} 種介面語言：${problems ? `${problems} 類問題` : '沒有發現問題'}（· 為照設計允許的情況，僅供參考）`)
process.exit(problems ? 1 : 0)
