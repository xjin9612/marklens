// 重新取得 vendor/ 下的第三方程式庫（僅在要升級版本時手動執行）
// 用法：node scripts/vendor.mjs
// 只使用 Node 標準庫與系統內建的 npm、tar（Windows 10+ 內建 tar.exe）
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendorDir = join(root, 'vendor')
const licenseDir = join(vendorDir, 'licenses')

// 版本固定在這裡；升級時改這張表再執行
const PACKAGES = [
  {
    name: 'markdown-it',
    version: '14.3.3',
    files: [['dist/markdown-it.min.js', 'markdown-it.min.js']],
  },
  {
    name: 'markdown-it-footnote',
    version: '4.0.0',
    files: [['dist/markdown-it-footnote.min.js', 'markdown-it-footnote.min.js']],
  },
  {
    name: '@highlightjs/cdn-assets',
    version: '11.11.1',
    license: 'highlight.js',
    files: [['highlight.min.js', 'highlight.min.js']],
  },
  {
    // ESM 版本：主檔加上按圖表類型拆分的 chunk，只在頁面有 mermaid 區塊時才動態載入
    name: 'mermaid',
    version: '12.2.0',
    files: [['dist/mermaid.esm.min.mjs', 'mermaid/mermaid.esm.min.mjs']],
    dirs: [['dist/chunks/mermaid.esm.min', 'mermaid/chunks/mermaid.esm.min']],
  },
]

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const work = mkdtempSync(join(tmpdir(), 'ml-vendor-'))
mkdirSync(licenseDir, { recursive: true })

const lines = ['# 第三方程式庫版本', '', '| 套件 | 版本 | 檔案 |', '|---|---|---|']
try {
  for (const pkg of PACKAGES) {
    const spec = `${pkg.name}@${pkg.version}`
    console.log(`取得 ${spec}`)
    const tgz = execFileSync(npm, ['pack', spec, '--silent'], {
      cwd: work,
      shell: process.platform === 'win32',
    })
      .toString()
      .trim()
      .split(/\r?\n/)
      .pop()
    const out = join(work, pkg.name.replace(/[@/]/g, '_'))
    mkdirSync(out)
    execFileSync('tar', ['-xzf', join(work, tgz), '-C', out])
    for (const [from, to] of pkg.files) {
      mkdirSync(dirname(join(vendorDir, to)), { recursive: true })
      copyFileSync(join(out, 'package', from), join(vendorDir, to))
    }
    // 整個資料夾（不含 sourcemap）；先清空，避免殘留舊版的 chunk
    for (const [from, to] of pkg.dirs ?? []) {
      const dest = join(vendorDir, to)
      rmSync(dest, { recursive: true, force: true })
      mkdirSync(dest, { recursive: true })
      for (const f of readdirSync(join(out, 'package', from))) {
        if (!f.endsWith('.map')) copyFileSync(join(out, 'package', from, f), join(dest, f))
      }
    }
    const licName = pkg.license ?? pkg.name
    copyFileSync(join(out, 'package', 'LICENSE'), join(licenseDir, `${licName}.LICENSE`))
    lines.push(`| ${pkg.name} | ${pkg.version} | ${[...pkg.files, ...(pkg.dirs ?? [])].map(f => f[1]).join(', ')} |`)
  }
  writeFileSync(join(vendorDir, 'VERSIONS.md'), lines.join('\n') + '\n')
  console.log('完成')
} finally {
  rmSync(work, { recursive: true, force: true })
}
