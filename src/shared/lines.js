'use strict'
// 原文切行：閱讀頁與 background 共用，行號才會與 markdown-it 一致（\r\n、單獨的 \r、\n 都算換行）
var MarkLens = globalThis.MarkLens || (globalThis.MarkLens = {})

/** 切成行，每行保留自己的換行字元；串接回去等於原文 */
MarkLens.splitLines = function (text) {
  return text.split(/(?<=\n|\r(?!\n))/)
}
