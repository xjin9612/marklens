'use strict'
// 產生 ZIP 檔（DOCX 的外層格式）：瀏覽器支援 deflate-raw 時壓縮，否則以不壓縮（stored）儲存
var Markloupe = globalThis.Markloupe || (globalThis.Markloupe = {})

;(() => {
  const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })

  function crc32(bytes) {
    let c = 0xffffffff
    for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }

  async function deflate(bytes) {
    let stream
    try {
      stream = new CompressionStream('deflate-raw')
    } catch {
      return null
    }
    const out = new Blob([bytes]).stream().pipeThrough(stream)
    return new Uint8Array(await new Response(out).arrayBuffer())
  }

  /** MS-DOS 格式的日期與時間（ZIP 標頭使用） */
  function dosTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 4) | d.getDate(),
    }
  }

  /**
   * @param {Array<{name: string, data: string | Uint8Array}>} files 字串以 UTF-8 編碼
   * @returns {Promise<Blob>}
   */
  Markloupe.zip = async function (files, mime = 'application/zip') {
    const enc = new TextEncoder()
    const { time, date } = dosTime(new Date())
    const parts = []
    const central = []
    let offset = 0
    for (const f of files) {
      const name = enc.encode(f.name)
      const raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data
      const packed = await deflate(raw)
      const method = packed && packed.length < raw.length ? 8 : 0
      const body = method ? packed : raw
      const crc = crc32(raw)
      const head = new DataView(new ArrayBuffer(30))
      head.setUint32(0, 0x04034b50, true)
      head.setUint16(4, 20, true) // 需要的版本 2.0
      head.setUint16(6, 0x0800, true) // 檔名是 UTF-8
      head.setUint16(8, method, true)
      head.setUint16(10, time, true)
      head.setUint16(12, date, true)
      head.setUint32(14, crc, true)
      head.setUint32(18, body.length, true)
      head.setUint32(22, raw.length, true)
      head.setUint16(26, name.length, true)
      parts.push(head, name, body)

      const dir = new DataView(new ArrayBuffer(46))
      dir.setUint32(0, 0x02014b50, true)
      dir.setUint16(4, 20, true)
      dir.setUint16(6, 20, true)
      dir.setUint16(8, 0x0800, true)
      dir.setUint16(10, method, true)
      dir.setUint16(12, time, true)
      dir.setUint16(14, date, true)
      dir.setUint32(16, crc, true)
      dir.setUint32(20, body.length, true)
      dir.setUint32(24, raw.length, true)
      dir.setUint16(28, name.length, true)
      dir.setUint32(42, offset, true)
      central.push(dir, name)
      offset += 30 + name.length + body.length
    }
    const size = central.reduce((n, p) => n + p.byteLength, 0)
    // 沒有實作 ZIP64：超過 4 GiB 時標頭的欄位放不下，寧可失敗也不產生壞檔
    if (offset + size > 0xffffffff || files.length > 0xffff) throw new Error('ZIP 超過 4 GiB 或 65535 個檔案')
    const end = new DataView(new ArrayBuffer(22))
    end.setUint32(0, 0x06054b50, true)
    end.setUint16(8, files.length, true)
    end.setUint16(10, files.length, true)
    end.setUint32(12, size, true)
    end.setUint32(16, offset, true)
    return new Blob([...parts, ...central, end], { type: mime })
  }
})()
