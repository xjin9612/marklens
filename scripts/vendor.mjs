// 重新取得 vendor/ 下的第三方程式庫（升級版本時手動執行；CI 也執行一次，確認 vendor/ 可以重現）
// 用法：node scripts/vendor.mjs
// 只使用 Node 標準庫與系統內建的 npm、tar（Windows 10+ 內建 tar.exe）
// 安全檢查：套件檔的 sha512 必須等於 PACKAGES 記錄的 integrity；版本發布未滿 7 天不採用
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendorDir = join(root, 'vendor')
const licenseDir = join(vendorDir, 'licenses')

// 版本固定在這裡；升級時改版本並清空 integrity 再執行，腳本會印出新值，確認後填回
// 安全性修補要立刻升級時，在該套件加上 minAgeDays: 0 並註明原因（例如 CVE 編號），滿 7 天後拿掉
const MIN_AGE_DAYS = 7
const PACKAGES = [
  {
    name: 'markdown-it',
    version: '14.3.3',
    integrity: 'sha512-L//tDAkjTjJCU6pBUSBTgs3Kg4InVaZuUZog/b6V12UKhcDQ7S78877ibbCanRExwPuYP1CZD7Gd2dxSy1GXRg==',
    files: [['dist/markdown-it.min.js', 'markdown-it.min.js']],
  },
  {
    name: 'markdown-it-footnote',
    version: '4.0.0',
    integrity: 'sha512-WYJ7urf+khJYl3DqofQpYfEYkZKbmXmwxQV8c8mO/hGIhgZ1wOe7R4HLFNwqx7TjILbnC98fuyeSsin19JdFcQ==',
    files: [['dist/markdown-it-footnote.min.js', 'markdown-it-footnote.min.js']],
  },
  {
    // 容器區塊：::: tip、::: details 等（VitePress、VuePress、Docusaurus）
    name: 'markdown-it-container',
    version: '4.0.0',
    integrity: 'sha512-HaNccxUH0l7BNGYbFbjmGpf5aLHAMTinqRZQAEQbMr2cdD3z91Q6kIo1oUn1CQndkT03jat6ckrdRYuwwqLlQw==',
    files: [['dist/markdown-it-container.min.js', 'markdown-it-container.min.js']],
  },
  {
    // 定義清單：術語換行接「: 說明」
    name: 'markdown-it-deflist',
    version: '3.0.0',
    integrity: 'sha512-OxPmQ/keJZwbubjiQWOvKLHwpV2wZ5I3Smc81OjhwbfJsjdRrvD5aLTQxmZzzePeO0kbGzAo3Krk4QLgA8PWLg==',
    files: [['dist/markdown-it-deflist.min.js', 'markdown-it-deflist.min.js']],
  },
  {
    // GitHub 的 emoji 短碼表（:tada: → 🎉）
    name: 'markdown-it-emoji',
    version: '3.1.0',
    integrity: 'sha512-NhmMEH2ywduD4Nty1E8uB5NqfLhAT1VR0dyvoJyStKOqCzbZmVdn/+8wj7zpDsb/fLBikpCPsWwxqKlvMmbz4g==',
    files: [['dist/markdown-it-emoji.min.js', 'markdown-it-emoji.min.js']],
  },
  {
    name: '@highlightjs/cdn-assets',
    version: '11.11.1',
    integrity: 'sha512-VEPdHzwelZ12hEX18BHduqxMZGolcUsrbeokHYxOUIm8X2+M7nx5QPtPeQgRxR9XjhdLv4/7DD5BWOlSrJ3k7Q==',
    license: 'highlight.js',
    files: [['highlight.min.js', 'highlight.min.js']],
  },
  {
    // 數學公式：單檔 ESM 與樣式，只在頁面有公式時才動態載入；字型只取 woff2（所有支援的瀏覽器都優先使用 woff2）
    name: 'katex',
    version: '0.19.1',
    integrity: 'sha512-jG8uKntjSEcm2EpQOh0XturpPuuC9r3Sq5HLHdsFdWZT27E672SF19QEi+of0/YeOy15lDgRhKvr5614uRrEfA==',
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
    version: '12.2.0',
    integrity: 'sha512-w7nr/SFrLO7BaVTs3dQTvYSV6nYSBj0Yy9DjBhsIJtAcHqRzXSq4Pg32ujHZ/AdWsAMNEvvhbm5dt9E2tOiHzw==',
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

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const work = mkdtempSync(join(tmpdir(), 'ml-vendor-'))
mkdirSync(licenseDir, { recursive: true })

const run = args => execFileSync(npm, args, { cwd: work, shell: process.platform === 'win32' }).toString()
const lines = ['# 第三方程式庫版本', '', '| 套件 | 版本 | 檔案 |', '|---|---|---|']
const missing = []
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
    if (!pkg.integrity) missing.push(`${spec}: '${integrity}'`)
    else if (pkg.integrity !== integrity) throw new Error(`${spec} 的 integrity 與記錄不符：${integrity}`)
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
    // 整個資料夾（不含 sourcemap）；先清空，避免殘留舊版的 chunk
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
  if (missing.length) {
    console.error(`下列套件沒有記錄 integrity，確認來源無誤後填入 PACKAGES：\n${missing.join('\n')}`)
    process.exitCode = 1
  } else console.log('完成')
} finally {
  rmSync(work, { recursive: true, force: true })
}
