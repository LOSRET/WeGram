import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseImageSize, probeImageSize } from './image-size'

describe('probeImageSize', () => {
  it('answers null for a file it cannot open, so the send becomes a document', async () => {
    await expect(
      probeImageSize(join(process.cwd(), 'definitely-missing-image.png')),
    ).resolves.toBeNull()
  })
})

/**
 * `inputPhoto` needs the real pixel size: a wrong guess sends a broken photo to
 * the chat, and nothing in the UI would explain it. These are synthesised headers
 * (only the bytes the parser reads), one per supported container.
 */
function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24)
  buffer.writeUInt32BE(0x89504e47, 0) // PNG signature
  buffer.writeUInt32BE(0x0d0a1a0a, 4)
  buffer.writeUInt32BE(13, 8) // IHDR length
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

function gifHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(13)
  buffer.write('GIF89a', 0, 'ascii')
  buffer.writeUInt16LE(width, 6)
  buffer.writeUInt16LE(height, 8)
  return buffer
}

function webpVp8xHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(22, 4)
  buffer.write('WEBP', 8, 'ascii')
  buffer.write('VP8X', 12, 'ascii')
  buffer.writeUInt32LE(10, 16)
  // Canvas size is stored minus one in 24-bit little-endian fields.
  buffer.writeUIntLE(width - 1, 24, 3)
  buffer.writeUIntLE(height - 1, 27, 3)
  return buffer
}

function webpVp8lHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(22, 4)
  buffer.write('WEBP', 8, 'ascii')
  buffer.write('VP8L', 12, 'ascii')
  buffer.writeUInt32LE(10, 16)
  buffer[20] = 0x2f // signature byte
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)
  buffer.writeUInt32LE(bits >>> 0, 21)
  return buffer
}

function webpVp8Header(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(22, 4)
  buffer.write('WEBP', 8, 'ascii')
  buffer.write('VP8 ', 12, 'ascii')
  buffer.writeUInt32LE(10, 16)
  buffer.writeUInt16LE(width & 0x3fff, 26)
  buffer.writeUInt16LE(height & 0x3fff, 28)
  return buffer
}

/** SOI, an APP0 segment (to prove segments are skipped), then an SOF0. */
function jpegHeader(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)])
  const sof0 = Buffer.alloc(19)
  sof0.writeUInt16BE(0xffc0, 0)
  sof0.writeUInt16BE(17, 2) // segment length
  sof0[4] = 8 // precision
  sof0.writeUInt16BE(height, 5)
  sof0.writeUInt16BE(width, 7)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0])
}

describe('parseImageSize', () => {
  it('reads PNG dimensions from IHDR', () => {
    expect(parseImageSize(pngHeader(1920, 1080), '.png')).toEqual({ width: 1920, height: 1080 })
  })

  it('reads GIF dimensions from the logical screen descriptor', () => {
    expect(parseImageSize(gifHeader(320, 240), '.gif')).toEqual({ width: 320, height: 240 })
  })

  it('reads a WebP with a VP8X chunk', () => {
    expect(parseImageSize(webpVp8xHeader(1024, 768), '.webp')).toEqual({
      width: 1024,
      height: 768,
    })
  })

  it('reads a WebP with a VP8L chunk', () => {
    expect(parseImageSize(webpVp8lHeader(512, 384), '.webp')).toEqual({ width: 512, height: 384 })
  })

  it('reads a WebP with a lossy VP8 chunk', () => {
    expect(parseImageSize(webpVp8Header(800, 600), '.webp')).toEqual({ width: 800, height: 600 })
  })

  it('skips JPEG segments and reads the SOF frame size', () => {
    expect(parseImageSize(jpegHeader(640, 480), '.jpg')).toEqual({ width: 640, height: 480 })
  })

  it('returns null for containers it does not parse', () => {
    expect(parseImageSize(Buffer.from('not an image at all'), '.txt')).toBeNull()
    expect(parseImageSize(Buffer.alloc(4), '.png')).toBeNull()
    expect(parseImageSize(Buffer.from('RIFF0000WEBP'), '.webp')).toBeNull()
    expect(parseImageSize(Buffer.alloc(200), '.avif')).toBeNull()
    expect(parseImageSize(Buffer.alloc(200), '.heic')).toBeNull()
  })

  it('returns null instead of throwing on a truncated header', () => {
    const truncated = pngHeader(10, 10).subarray(0, 18)
    expect(() => parseImageSize(truncated, '.png')).not.toThrow()
    expect(parseImageSize(truncated, '.png')).toBeNull()
  })
})
