// 產生手動測試用的大檔 test/manual/09-大檔效能.md（約 1MB，不進版控）
// 用法：npm run manual:bigfile
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'test/manual/09-大檔效能.md')
const TARGET = 1_000_000

// 固定種子的亂數，每次產生的內容相同
let seed = 1
const rand = n => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed % n
}
const words = '資料 服務 訂單 庫存 佇列 部署 測試 版本 效能 快取 索引 排程 監控 告警 權限 設定'.split(' ')
const pick = list => list[rand(list.length)]

const lines = [
  '# 大檔效能測試（約 1MB）',
  '',
  '> [!NOTE]',
  '> 預期結果：開檔約 2～3 秒內可閱讀；捲動順暢；全部摺疊不到 1 秒。',
  '',
  '## 檢查項目',
  '',
  '- [ ] 開檔後捲動不卡頓，左側目錄高亮跟著移動',
  '- [ ] 按「▸ 全部摺疊」約 1 秒內完成；按「▾ 全部展開」約 1～2 秒內完成',
  '- [ ] 本檔超過約 400KB，摺疊後 Ctrl+F 搜不到摺疊內容（屬預期取捨，展開後即可搜尋）；較小的 [04-摺疊與搜尋.md](./04-摺疊與搜尋.md) 仍可搜到',
  '- [ ] 開著本檔約 1 分鐘，工作管理員（Shift+Esc）裡該分頁的 CPU 維持接近 0',
  '',
]
let size = Buffer.byteLength(lines.join('\n'))
const push = (...ls) => {
  for (const l of ls) {
    lines.push(l)
    size += Buffer.byteLength(l) + 1
  }
}
for (let ch = 1; size < TARGET; ch++) {
  push(`## 第 ${ch} 章 ${pick(words)}${pick(words)}`, '')
  for (let sec = 1; sec <= 3; sec++) {
    push(`### ${ch}.${sec} ${pick(words)}`, '')
    for (let p = 0; p < 3; p++) {
      push(`${Array.from({ length: 30 }, () => pick(words) + pick(['，', '、', '。'])).join('')} order-api v2.4 \`queue.v2\``, '')
    }
    if (sec === 2) {
      push('| 服務 | 請求數 | 延遲 | 日期 |', '|---|---:|---:|---|')
      for (let r = 0; r < 6; r++) {
        const day = `2026-${String(rand(12) + 1).padStart(2, '0')}-${String(rand(28) + 1).padStart(2, '0')}`
        push(`| svc-${r} | ${(rand(998999) + 1000).toLocaleString('en-US')} | ${rand(895) + 5} ms | ${day} |`)
      }
      push('')
    }
    if (sec === 3) push('```js', `function handler${ch}(req) {`, '  const id = req.params.id', '  return db.find(id)', '}', '```', '')
  }
}
writeFileSync(out, lines.join('\n'))
console.log(`已產生 ${out}（${(size / 1024).toFixed(0)} KB）`)
