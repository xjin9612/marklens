'use strict'
// 原文的 SHA-256：閱讀頁與 background 用同一份實作比對原文是否一致，勾選寫回才不會誤判為檔案已被修改
var Markloupe = globalThis.Markloupe || (globalThis.Markloupe = {})

/** 文字的 SHA-256（十六進位小寫） */
Markloupe.sha256 = async function (text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
}
