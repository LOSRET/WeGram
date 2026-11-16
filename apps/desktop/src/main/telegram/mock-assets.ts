import { deflateSync } from 'node:zlib'

/**
 * Assets for the mock adapter.
 *
 * They are generated or embedded instead of shipped as binary files so the mock
 * works from the asar bundle with no `extraResources` step. The two WebP
 * stickers and the TGS animation are real files of their real formats — the
 * renderer paths are exactly the ones a real account would exercise.
 */
export const STICKER_FACE_WEBP =
  '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'

export const STICKER_HEART_WEBP =
  'UklGRhoEAABXRUJQVlA4WAoAAAAQAAAAfwAAfwAAQUxQSIEAAAABCQZtG0lSNuFPet87BBH9nwD+6K6FQiDUjhQoGGMcMHbbJ3SiAO1c0codTZ4QeEbecLcHw7aRFM30X/QxM/1HTMAEIHwdFqg0oTiTyhFqAQBUggC1pbwEqDPlIkDTBai9ICQRBFjkFIWasrELrRMgc7JQw0qlFN/fqQmU5Pf/L38AVlA4IHIDAADQGgCdASqAAIAAPjEWikMiISEViLzEIAMEsTdwYAH8AYYD8AP0A/gGqAfgB+gH8Atf/KAvwD8ALjpr37XqwvSP4B+yX8g/UDpSNku7f7jZgj4B+T/5f+u/gx2gPMA/QX/Lf1r8De4B5gP1K6gHoAfzH+lf+3//+61/sfYA9ADzRv9h/qvcO/ab9kvgF/kv9E/8/YEfwD1AP4B/DfbYOeo68xQQuQ/ErLI6NmejdIeSeI9XSmvHzbs54dcGmzEHyg2F6vKodz6aWzmvH0ab5eDmq7vKecTpHqzaFPFZyU5AAP59BgAQP/+xOD/+9xhxmm8nkONtTP00cPtrPZWR1WJ09tN+aX7LZpfaMTRqS16WHVIPtz4hfCI7caPjk40CbhP8HzGeFdKldGeUR4jFsYmQzwA0b2BAnwomuDZ9X38PyIUjnUq+G6ugDvNMfzCzTTt6AXoN9mN3vkR2oTP2Kk2N/+/kNLo81Wl0/ESd/x7enP5gRolHb1PGB/MZ4QXAVkZ5qjfD9Wc3dd5snjh4gAgMjNZuSdBSBypGQwMJoasIfyXjfGFTvxuIMuJZfb8WpzB3gMkPkijR+f+AVDFNu507PB0LTWE4XE1v+3vxPhTQjBOKJVHnPNBhTQU3lXnZaTuDeEcSMq9LP1p/HLhdOPQ9btUdwPvsYDSyRy0BwZuzsiUJWCFntYYItICefVN293rflVks7u8G9CZyvNXSuYY/vhRulH72j5HNyVk4GqNbACtOLmMHSonScn7twvRGYHBJs/ql2G5HP5SB9HbXy1sQ9AaoTj1fOyZQBuoP1ZNkmqGqdVY1Kw3ZgBdVUXqH7BmB7XkKPlJd8W8HlJDdwJAkevstcjprXcRgsl+J5+Xn0lWdrNc7uuSAfNYXRKdOE761N8TXTYeeg4o29EpFIDKtDIXfk0BqhOPV87JlB4JGY7OazV+opheFUCtqhhXKMtfbN4gY3SFDk4egcK6YpjYAkgehXP5evyoT5LaoX2NVzk+jgEyXVPFJcKABcmkOC9IReD/jRXbqX0x8/lIH0dtfLWxD0BqhOPV87JlxGZ4XGTazbJ1WhfJAZbCRGbMrQrbjpk3f5z6okyTL2fW5ayiVUabjB/Q0LBuiZuy//or3apBXxq12LiYI2EUm7Am0/pgRjcQXQpGHJXsUFM5KbnmAAAA='

/** gzip(Lottie JSON) — a real TGS file, decompressed by the renderer. */
export const STICKER_WAVE_TGS =
  'H4sIAGBJ+2oC/6VT226DMAz9Fz9HyIxLKb8y8ZBxKxoUlrB2COXfZyfRGB172SSIybF9jh2HFW6QQxKcghgENAryCAV0E+RkRjJnsnfIw6dMwMXb60A5d3mrWyUHSquqysZLretZQ/5cCOjlUiv+Xr/c3ZVsKGBeII89i36jfK0s/krhK4y8SAfY9NkmM1WISMwdB3zQFoOYtgs7CiNcosNTj2NhjLAMceIoouSvDOdvRRiOVr8Xiv8ViVIvMnkRdCJpLOhB9si9BwU6XO9xKlf4l1VAX+RUu7nwHKBVNIBu3gBV8kRtW/pA/KAoL6x2aJgZP2JVlzPY/pi+6Ym+fCAIMBIYnFJaokxsx7SxITqF0JM2Xd9vpDM3cVyVPESPD+lnF3hYiSl8Fa0a3yfg7cMfo91deBmYojCfs22fcmYDAAA='

/** Minimal PNG encoder: gradient test photos without shipping binaries. */
export function createGradientPng(
  width: number,
  height: number,
  from: [number, number, number],
  to: [number, number, number],
): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  let offset = 0
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0
    offset += 1
    const mix = y / Math.max(1, height - 1)
    for (let x = 0; x < width; x += 1) {
      const dx = x / Math.max(1, width - 1)
      // Diagonal band so the image is obviously a photo stand-in, not a flat fill.
      const wave = Math.max(0, 1 - Math.abs(mix - dx) * 3)
      raw[offset] = Math.round(from[0] + (to[0] - from[0]) * mix + wave * 24)
      raw[offset + 1] = Math.round(from[1] + (to[1] - from[1]) * mix + wave * 18)
      raw[offset + 2] = Math.round(from[2] + (to[2] - from[2]) * mix + wave * 12)
      offset += 3
    }
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: truecolour
  header[10] = 0
  header[11] = 0
  header[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function pngChunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
