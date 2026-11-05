// 重新取得 vendor/ 下的第三方程式庫（升級版本時手動執行；CI 也執行一次，確認 vendor/ 可以重現）
// 用法：node scripts/vendor.mjs
// 只使用 Node 標準庫與系統內建的 npm、tar（Windows 10+ 內建 tar.exe）
// 安全檢查：套件檔的 sha512 必須等於 lockfile 記錄的 integrity；版本發布未滿 7 天不採用
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendorDir = join(root, 'vendor')
const licenseDir = join(vendorDir, 'licenses')

// 版本與 integrity 記在 scripts/vendor/ 的 package.json 與 package-lock.json，GitHub 依 lockfile 發出漏洞警示。
// 升級：改 package.json 的版本，在 scripts/vendor/ 執行 npm install --package-lock-only --ignore-scripts，再執行本腳本
// 安全性修補要立刻升級時，在該套件加上 minAgeDays: 0 並註明原因（例如 CVE 編號），滿 7 天後拿掉
const MIN_AGE_DAYS = 7
const PACKAGES = [
  {
    name: 'markdown-it',
    files: [['dist/markdown-it.min.js', 'markdown-it.min.js']],
  },
  {
    name: 'markdown-it-footnote',
    files: [['dist/markdown-it-footnote.min.js', 'markdown-it-footnote.min.js']],
  },
  {
    // 容器區塊：::: tip、::: details 等（VitePress、VuePress、Docusaurus）
    name: 'markdown-it-container',
    files: [['dist/markdown-it-container.min.js', 'markdown-it-container.min.js']],
  },
  {
    // 定義清單：術語換行接「: 說明」
    name: 'markdown-it-deflist',
    files: [['dist/markdown-it-deflist.min.js', 'markdown-it-deflist.min.js']],
  },
  {
    // GitHub 的 emoji 短碼表（:tada: → 🎉）
    name: 'markdown-it-emoji',
    files: [['dist/markdown-it-emoji.min.js', 'markdown-it-emoji.min.js']],
  },
  {
    name: '@highlightjs/cdn-assets',
    license: 'highlight.js',
    files: [['highlight.min.js', 'highlight.min.js']],
  },
  {
    // 數學公式：單檔 ESM 與樣式，只在頁面有公式時才動態載入；字型只取 woff2（所有支援的瀏覽器都優先使用 woff2）
    name: 'katex',
    files: [
      ['dist/katex.mjs', 'katex/katex.mjs'],
      ['dist/katex.min.css', 'katex/katex.min.css'],
    ],
    dirs: [['dist/fonts', 'katex/fonts', /\.woff2$/]],
  },
  {
    // 單檔版改成模組，只在頁面有 mermaid 區塊時才動態載入。
    // 不用官方 ESM 版：它的 chunk 以相對路徑互相引用，在 use_dynamic_url 下會解析成固定網址而被擋
    name: 'mermaid',
    files: [['dist/mermaid.min.js', 'mermaid/mermaid.mjs', iifeToModule]],
    clean: ['mermaid'],
  },
]

/** 官方單檔版以 var 宣告全域變數，結尾再掛到 globalThis；當模組載入時 var 只在模組內，改成直接 export */
function iifeToModule(src) {
  const tail = 'globalThis["mermaid"] = globalThis.__esbuild_esm_mermaid_nm["mermaid"].default;'
  if (!src.includes(tail)) throw new Error('mermaid.min.js 的結尾與預期不同，請檢查新版的打包格式')
  return src.replace(tail, 'export default __esbuild_esm_mermaid_nm["mermaid"].default;')
}

const depsDir = join(root, 'scripts/vendor')
const { dependencies } = JSON.parse(readFileSync(join(depsDir, 'package.json'), 'utf8'))
const locked = JSON.parse(readFileSync(join(depsDir, 'package-lock.json'), 'utf8')).packages
for (const name of Object.keys(dependencies)) {
  if (!PACKAGES.some(p => p.name === name)) throw new Error(`scripts/vendor/package.json 的 ${name} 不在 PACKAGES`)
}
for (const pkg of PACKAGES) {
  pkg.version = dependencies[pkg.name]
  const lock = locked[`node_modules/${pkg.name}`]
  if (!pkg.version || lock?.version !== pkg.version) throw new Error(`${pkg.name} 的版本與 lockfile 不一致，請重新產生 lockfile`)
  pkg.integrity = lock.integrity
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const work = mkdtempSync(join(tmpdir(), 'ml-vendor-'))
mkdirSync(licenseDir, { recursive: true })

const run = args => execFileSync(npm, args, { cwd: work, shell: process.platform === 'win32' }).toString()
const lines = ['# 第三方程式庫版本', '', '| 套件 | 版本 | 檔案 |', '|---|---|---|']
try {
  for (const pkg of PACKAGES) {
    const spec = `${pkg.name}@${pkg.version}`
    console.log(`取得 ${spec}`)
    const published = JSON.parse(run(['view', spec, 'time', '--json']))[pkg.version]
    const days = (Date.now() - Date.parse(published)) / 86400000
    const minAge = pkg.minAgeDays ?? MIN_AGE_DAYS
    if (!(days >= minAge)) throw new Error(`${spec} 發布未滿 ${minAge} 天（${published}），等滿再升級；緊急修補見 PACKAGES 上方的說明`)
    const tgz = run(['pack', spec, '--silent']).trim().split(/\r?\n/).pop()
    const integrity = `sha512-${createHash('sha512').update(readFileSync(join(work, tgz))).digest('base64')}`
    if (pkg.integrity !== integrity) throw new Error(`${spec} 的 integrity 與 lockfile 不符：${integrity}`)
    const out = join(work, pkg.name.replace(/[@/]/g, '_'))
    mkdirSync(out)
    execFileSync('tar', ['-xzf', join(work, tgz), '-C', out])
    // 先清空，避免殘留舊版的檔案
    for (const dir of pkg.clean ?? []) rmSync(join(vendorDir, dir), { recursive: true, force: true })
    for (const [from, to, transform] of pkg.files) {
      mkdirSync(dirname(join(vendorDir, to)), { recursive: true })
      if (transform) writeFileSync(join(vendorDir, to), transform(readFileSync(join(out, 'package', from), 'utf8')))
      else copyFileSync(join(out, 'package', from), join(vendorDir, to))
    }
    // 整個資料夾（不含 sourcemap）；先清空，避免殘留舊版的檔案
    for (const [from, to, only] of pkg.dirs ?? []) {
      const dest = join(vendorDir, to)
      rmSync(dest, { recursive: true, force: true })
      mkdirSync(dest, { recursive: true })
      for (const f of readdirSync(join(out, 'package', from))) {
        if (f.endsWith('.map') || (only && !only.test(f))) continue
        copyFileSync(join(out, 'package', from, f), join(dest, f))
      }
    }
    const licName = pkg.license ?? pkg.name
    copyFileSync(join(out, 'package', 'LICENSE'), join(licenseDir, `${licName}.LICENSE`))
    lines.push(`| ${pkg.name} | ${pkg.version} | ${[...pkg.files.map(f => (f[2] ? `${f[1]}（${f[0]} 改為模組）` : f[1])), ...(pkg.dirs ?? []).map(d => d[1])].join(', ')} |`)
  }
  writeFileSync(join(vendorDir, 'VERSIONS.md'), lines.join('\n') + '\n')
  console.log('完成')
} finally {
  rmSync(work, { recursive: true, force: true })
}
