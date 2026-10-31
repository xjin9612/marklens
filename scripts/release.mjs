// 發版輔助：檢查版本號、取出 CHANGELOG 段落、打包擴充功能 zip
// 用法：
//   node scripts/release.mjs check v1.2.0          檢查標籤、manifest.json、package.json、CHANGELOG 是否一致
//   node scripts/release.mjs notes v1.2.0 [輸出檔]  取出 CHANGELOG 中該版本的段落（Release 說明）
//   node scripts/release.mjs pack v1.2.0 [輸出目錄]  打包 dist/marklens-v1.2.0.zip（只含擴充功能需要的檔案）
// 只使用 Node 標準庫；打包使用系統的 zip（Linux / macOS）或 PowerShell Compress-Archive（Windows）
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// 打包進 zip 的檔案與資料夾；測試、腳本、開發設定都不需要
const PACKAGE_FILES = ['manifest.json', 'src', 'vendor', 'icons', 'LICENSE', 'README.md', 'README.zh-TW.md', 'CHANGELOG.md']

function fail(msg) {
  console.error(`✘ ${msg}`)
  process.exit(1)
}

function parseTag(tag) {
  const m = /^v(\d+\.\d+\.\d+)$/.exec(tag || '')
  if (!m) fail(`標籤格式應為 vX.Y.Z，收到：${tag}`)
  return m[1]
}

/** 取出 CHANGELOG 中 ## [version] 到下一個 ## [ 之間的內容 */
function changelogSection(version) {
  const text = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n')
  const escaped = version.replace(/\./g, '\\.')
  const m = new RegExp(`^## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|(?![\\s\\S]))`, 'm').exec(text)
  if (!m) return null
  // 最後一個版本段落之後是檔案底部的連結定義（[1.0.0]: https://…），不屬於說明內容
  return m[1].replace(/^\[[^\]]+\]:\s+\S+\s*$/gm, '').trim() || null
}

function check(version) {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const errors = []
  if (manifest.version !== version) errors.push(`manifest.json 版本為 ${manifest.version}`)
  if (manifest.version_name && manifest.version_name !== version) errors.push(`manifest.json version_name 為 ${manifest.version_name}`)
  if (pkg.version !== version) errors.push(`package.json 版本為 ${pkg.version}`)
  const notes = changelogSection(version)
  if (!notes) errors.push(`CHANGELOG.md 找不到 ## [${version}] 段落，或段落是空的`)
  if (errors.length) fail(`版本 ${version} 不一致：\n  - ${errors.join('\n  - ')}`)
  console.error(`✔ 版本 ${version}：標籤、manifest.json、package.json、CHANGELOG.md 一致`)
  return notes
}

function pack(version, outDir) {
  const dist = resolve(outDir || join(root, 'dist'))
  const name = `marklens-v${version}`
  const stage = join(dist, name)
  const zip = join(dist, `${name}.zip`)
  rmSync(stage, { recursive: true, force: true })
  rmSync(zip, { force: true })
  mkdirSync(stage, { recursive: true })
  for (const f of PACKAGE_FILES) {
    if (!existsSync(join(root, f))) fail(`找不到要打包的檔案：${f}`)
    cpSync(join(root, f), join(stage, f), { recursive: true })
  }
  // zip 內含一層 marklens-vX.Y.Z/ 資料夾，解壓縮後直接「載入未封裝項目」選這個資料夾
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${stage}' -DestinationPath '${zip}'`])
  } else {
    execFileSync('zip', ['-qr', zip, name], { cwd: dist })
  }
  rmSync(stage, { recursive: true, force: true })
  console.log(`✔ 已打包 ${zip}`)
}

const [cmd, tag, arg] = process.argv.slice(2)
const version = parseTag(tag)
if (cmd === 'check') {
  check(version)
} else if (cmd === 'notes') {
  const notes = check(version)
  if (arg) writeFileSync(arg, notes + '\n')
  else console.log(notes)
} else if (cmd === 'pack') {
  check(version)
  pack(version, arg)
} else {
  fail('用法：node scripts/release.mjs <check|notes|pack> vX.Y.Z [輸出]')
}
