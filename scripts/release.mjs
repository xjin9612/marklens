// 發版輔助：檢查版本號、取出 CHANGELOG 段落、打包擴充功能 zip
// 用法：
//   node scripts/release.mjs check v1.2.0          檢查標籤、manifest.json、package.json、CHANGELOG 是否一致，
//                                                  以及商店欄位長度（name、short_name、description）
//   node scripts/release.mjs notes v1.2.0 [輸出檔]  取出 CHANGELOG 中該版本的段落（Release 說明）
//   node scripts/release.mjs pack v1.2.0 [輸出目錄]  打包 dist/marklens-v1.2.0.zip（開發者版，內含一層資料夾）
//                                                  與 dist/marklens-v1.2.0-store.zip（商店版，manifest.json 在根目錄），
//                                                  只含擴充功能需要的檔案
// 只使用 Node 標準庫；打包使用系統的 zip（Linux / macOS）或 PowerShell Compress-Archive（Windows）
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// 打包進 zip 的檔案與資料夾；測試、腳本、開發設定都不需要
const PACKAGE_FILES = ['manifest.json', '_locales', 'src', 'vendor', 'icons', 'LICENSE', 'README.md', 'README.zh-TW.md', 'CHANGELOG.md']

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

/**
 * manifest.json 引用到的檔案都必須存在，且位在 PACKAGE_FILES 的範圍內，否則打包出來的 zip 無法載入
 * （例如新增 _locales/ 卻忘了加進打包清單）
 */
function manifestFiles(manifest) {
  const files = []
  for (const cs of manifest.content_scripts || []) files.push(...(cs.js || []), ...(cs.css || []))
  if (manifest.background?.service_worker) files.push(manifest.background.service_worker)
  if (manifest.action?.default_popup) files.push(manifest.action.default_popup)
  files.push(...Object.values(manifest.icons || {}), ...Object.values(manifest.action?.default_icon || {}))
  for (const war of manifest.web_accessible_resources || []) {
    // 萬用字元只檢查前面的資料夾
    files.push(...war.resources.map(r => r.replace(/\/\*.*$/, '')))
  }
  if (manifest.default_locale) files.push(`_locales/${manifest.default_locale}/messages.json`)
  // service worker 以 importScripts 載入的檔案
  if (manifest.background?.service_worker) {
    const sw = readFileSync(join(root, manifest.background.service_worker), 'utf8')
    for (const m of sw.matchAll(/importScripts\(([^)]*)\)/g)) {
      for (const s of m[1].matchAll(/['"]\/?([^'"]+)['"]/g)) files.push(s[1])
    }
  }
  return files
}

/**
 * Chrome Web Store 的長度上限：超過會被擋上傳。
 * __MSG_key__ 依 _locales/ 內每個語系各展開一次檢查
 */
const STORE_LIMITS = { name: 75, short_name: 12, description: 132 }

function storeLimitErrors(manifest) {
  const errors = []
  const localesDir = join(root, '_locales')
  const locales = existsSync(localesDir) ? readdirSync(localesDir) : []
  for (const [field, max] of Object.entries(STORE_LIMITS)) {
    const value = manifest[field]
    if (typeof value !== 'string') continue
    const key = /^__MSG_(\w+)__$/.exec(value)?.[1]
    const variants = key
      ? locales.map(l => {
          const messages = JSON.parse(readFileSync(join(localesDir, l, 'messages.json'), 'utf8'))
          return [`${l} 的 ${key}`, messages[key]?.message]
        })
      : [[field, value]]
    for (const [label, text] of variants) {
      if (text === undefined) errors.push(`manifest.json ${field} 引用的 ${label} 不存在`)
      else if ([...text].length > max) errors.push(`manifest.json ${field}（${label}）有 ${[...text].length} 字元，商店上限 ${max}`)
    }
  }
  return errors
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
  errors.push(...storeLimitErrors(manifest))
  for (const f of manifestFiles(manifest)) {
    if (!existsSync(join(root, f))) errors.push(`manifest.json 引用的檔案不存在：${f}`)
    else if (!PACKAGE_FILES.includes(f.split('/')[0])) errors.push(`manifest.json 引用的 ${f} 不在打包清單 PACKAGE_FILES 中`)
  }
  if (errors.length) fail(`版本 ${version} 檢查未通過：\n  - ${errors.join('\n  - ')}`)
  console.error(`✔ 版本 ${version}：標籤、manifest.json、package.json、CHANGELOG.md 一致，商店欄位長度符合上限`)
  return notes
}

function pack(version, outDir) {
  const dist = resolve(outDir || join(root, 'dist'))
  const name = `marklens-v${version}`
  const stage = join(dist, name)
  const zip = join(dist, `${name}.zip`)
  const storeZip = join(dist, `${name}-store.zip`)
  rmSync(stage, { recursive: true, force: true })
  rmSync(zip, { force: true })
  rmSync(storeZip, { force: true })
  mkdirSync(stage, { recursive: true })
  for (const f of PACKAGE_FILES) {
    if (!existsSync(join(root, f))) fail(`找不到要打包的檔案：${f}`)
    cpSync(join(root, f), join(stage, f), { recursive: true })
  }
  // 開發者版：zip 內含一層 marklens-vX.Y.Z/ 資料夾，解壓縮後直接「載入未封裝項目」選這個資料夾
  // 商店版：manifest.json 必須位於 zip 根目錄，Chrome Web Store 與 Edge Add-ons 才收
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${stage}' -DestinationPath '${zip}'`])
    execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${join(stage, '*')}' -DestinationPath '${storeZip}'`])
  } else {
    execFileSync('zip', ['-qr', zip, name], { cwd: dist })
    execFileSync('zip', ['-qr', storeZip, '.'], { cwd: stage })
  }
  rmSync(stage, { recursive: true, force: true })
  console.log(`✔ 已打包 ${zip}（開發者版，載入未封裝項目用）`)
  console.log(`✔ 已打包 ${storeZip}（商店版，manifest.json 位於根目錄）`)
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
