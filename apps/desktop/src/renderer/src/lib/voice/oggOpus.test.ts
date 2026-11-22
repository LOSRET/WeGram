import { describe, expect, it } from 'vitest'

import { muxOggOpus, oggCrc, type OpusPacket } from './oggOpus'

interface ParsedPage {
  headerType: number
  granule: number
  sequence: number
  crc: number
  /** The bytes the CRC covers, with the CRC field zeroed. */
  crcInput: Uint8Array
  packets: Uint8Array[]
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) +
      ((bytes[offset + 1] ?? 0) << 8) +
      ((bytes[offset + 2] ?? 0) << 16) +
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  )
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) << 8)) >>> 0
}

function readUint64(bytes: Uint8Array, offset: number): number {
  return readUint32(bytes, offset) + readUint32(bytes, offset + 4) * 0x1_0000_0000
}

/** The container parser a player runs: pages, lacing, packet boundaries. */
function parsePages(bytes: Uint8Array): ParsedPage[] {
  const pages: ParsedPage[] = []
  let offset = 0
  while (offset < bytes.length) {
    expect(String.fromCharCode(...bytes.slice(offset, offset + 4))).toBe('OggS')
    const headerType = bytes[offset + 5] ?? 0
    const granule = readUint64(bytes, offset + 6)
    const sequence = readUint32(bytes, offset + 18)
    const crc = readUint32(bytes, offset + 22)
    const count = bytes[offset + 26] ?? 0
    const lacing = bytes.slice(offset + 27, offset + 27 + count)
    let body = offset + 27 + count
    const packets: Uint8Array[] = []
    let current: number[] = []
    for (let index = 0; index < count; index += 1) {
      const lace = lacing[index] ?? 0
      for (let byte = 0; byte < lace; byte += 1) current.push(bytes[body + byte] ?? 0)
      body += lace
      if (lace < 255) {
        packets.push(Uint8Array.from(current))
        current = []
      }
    }
    // The CRC covers the whole page (header + payload) with the field zeroed.
    pages.push({ headerType, granule, sequence, crc, crcInput: bytes.slice(offset, body), packets })
    offset = body
  }
  return pages
}

function text(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes)
}

/** A bit-at-a-time CRC, independent of the table the muxer builds. */
function referenceCrc(bytes: Uint8Array): number {
  let crc = 0
  for (const byte of bytes) {
    crc ^= byte << 24
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x80000000) !== 0 ? ((crc << 1) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0
    }
  }
  return crc >>> 0
}

function packetsOf(sizes: number[]): OpusPacket[] {
  return sizes.map((size, index) => ({
    data: Uint8Array.from({ length: size }, (_, byte) => (index * 31 + byte) & 0xff),
    samples: 960,
  }))
}

describe('OGG/Opus muxing', () => {
  it('starts with the two header pages', () => {
    const pages = parsePages(muxOggOpus({ packets: packetsOf([12, 12]) }))
    const head = pages[0]?.packets[0] ?? new Uint8Array()
    expect(pages[0]?.headerType ?? 0).toBe(0x02)
    expect(text(head.slice(0, 8))).toBe('OpusHead')
    expect(head[8]).toBe(1)
    expect(head[9]).toBe(1)
    expect(readUint32(head, 12)).toBe(48_000)
    const tags = pages[1]?.packets[0] ?? new Uint8Array()
    expect(pages[1]?.headerType ?? 0).toBe(0)
    expect(text(tags.slice(0, 8))).toBe('OpusTags')
    expect(text(tags.slice(12, 12 + 6))).toBe('WeGram')
  })

  it('gives every packet boundary back in order', () => {
    const source = packetsOf([40, 255, 256, 9])
    const pages = parsePages(muxOggOpus({ packets: source }))
    const audio = pages.slice(2).flatMap((page) => page.packets)
    expect(audio).toHaveLength(source.length)
    for (const [index, packet] of audio.entries()) {
      expect(packet).toEqual(source[index]?.data)
    }
  })

  it('marks the last page EOS and counts its granule in samples', () => {
    const pages = parsePages(muxOggOpus({ packets: packetsOf([12, 12, 12]) }))
    const last = pages[pages.length - 1]
    expect(last?.headerType ?? 0).toBe(0x04)
    expect(last?.granule).toBe(3 * 960)
  })

  it('adds the pre-skip to the granule positions', () => {
    const pages = parsePages(muxOggOpus({ packets: packetsOf([12, 12]), preSkip: 312 }))
    expect(pages[pages.length - 1]?.granule).toBe(312 + 2 * 960)
    expect(readUint16(pages[0]?.packets[0] ?? new Uint8Array(), 10)).toBe(312)
  })

  it('splits audio over several pages once the payload passes the limit', () => {
    const pages = parsePages(muxOggOpus({ packets: packetsOf(new Array(60).fill(200)) }))
    expect(pages.length).toBeGreaterThan(3)
    expect(pages.slice(2).every((page) => page.packets.length > 0)).toBe(true)
  })

  it('computes the header CRC the way a player checks it', () => {
    const pages = parsePages(muxOggOpus({ packets: packetsOf([12, 300, 12]) }))
    for (const page of pages) {
      // The page bytes with the CRC field zeroed are what the field covers.
      const zeroed = new Uint8Array(page.crcInput)
      for (let index = 22; index < 26; index += 1) zeroed[index] = 0
      expect(page.crc).toBe(oggCrc(zeroed))
      expect(page.crc).toBe(referenceCrc(zeroed))
    }
  })

  it('refuses a stream with no packets', () => {
    expect(() => muxOggOpus({ packets: [] })).toThrow()
  })
})
