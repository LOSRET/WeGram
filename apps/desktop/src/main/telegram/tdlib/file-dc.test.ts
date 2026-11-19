import { describe, expect, it } from 'vitest'

import { dcIdFromRemoteFileId } from './file-dc'

/** The inverse of TDLib's escaping, so the fixtures look like real remote ids. */
function encode(bytes: number[], version = 4): string {
  const escaped: number[] = []
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index] ?? 0
    if (byte !== 0) {
      escaped.push(byte)
      continue
    }
    let run = 1
    while (bytes[index + run] === 0 && run < 250) run += 1
    escaped.push(0, run)
    index += run - 1
  }
  return Buffer.from([...escaped, 1, version]).toString('base64url')
}

/** `FileType` (little-endian int32), then the DC, then opaque location bytes. */
function location(type: number, dc: number, tail: number[] = [1, 2, 3], version = 4): string {
  const bytes = [
    type & 0xff,
    (type >>> 8) & 0xff,
    (type >>> 16) & 0xff,
    (type >>> 24) & 0xff,
    dc & 0xff,
    (dc >>> 8) & 0xff,
    (dc >>> 16) & 0xff,
    (dc >>> 24) & 0xff,
    ...tail,
  ]
  return encode(bytes, version)
}

describe('dcIdFromRemoteFileId', () => {
  it('reads the DC of a profile photo', () => {
    expect(dcIdFromRemoteFileId(location(1, 5))).toBe(5)
    expect(dcIdFromRemoteFileId(location(1 | 0x02000000, 4))).toBe(4)
    expect(dcIdFromRemoteFileId(location(2 | 0x02000000, 1))).toBe(1)
  })

  it('refuses anything that is not a persistent id of this format', () => {
    expect(dcIdFromRemoteFileId(undefined)).toBeUndefined()
    expect(dcIdFromRemoteFileId('')).toBeUndefined()
    expect(dcIdFromRemoteFileId('https://cdn.example/file.jpg')).toBeUndefined()
    expect(dcIdFromRemoteFileId('short')).toBeUndefined()
    // A future TDLib that changes the trailing version must not be guessed at.
    expect(dcIdFromRemoteFileId(location(1, 5, [1, 2, 3], 3))).toBeUndefined()
  })

  it('rejects an out-of-range DC or file type instead of showing it', () => {
    expect(dcIdFromRemoteFileId(location(1, 0))).toBeUndefined()
    expect(dcIdFromRemoteFileId(location(1, 9))).toBeUndefined()
    expect(dcIdFromRemoteFileId(location(200, 5))).toBeUndefined()
  })
})
