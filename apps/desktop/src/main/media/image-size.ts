import { open } from 'node:fs/promises'
import { extname } from 'node:path'

export interface ImageSize {
  width: number
  height: number
}

const HEADER_BYTES = 256 * 1024

/**
 * Reads just enough of an image to learn its pixel size.
 *
 * TDLib's `inputPhoto` wants real width/height, and guessing them produces a
 * broken photo in the chat. Returns null for formats we do not parse, which the
 * adapter turns into "send as a document" instead of sending a bad photo.
 */
export async function probeImageSize(filePath: string): Promise<ImageSize | null> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(HEADER_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return parseImageSize(buffer.subarray(0, bytesRead), extname(filePath).toLowerCase())
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

export function parseImageSize(buffer: Buffer, ext = ''): ImageSize | null {
  if (buffer.length < 12) return null
  // PNG: signature then IHDR width/height (big endian).
  if (buffer.readUInt32BE(0) === 0x89504e47) {
    if (buffer.length < 24) return null
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  // GIF: logical screen descriptor (little endian).
  if (buffer.toString('ascii', 0, 3) === 'GIF') {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
  }
  // WebP: RIFF container, three possible chunk layouts.
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return parseWebp(buffer)
  }
  // JPEG: walk the segment markers until a Start Of Frame.
  if (buffer.readUInt16BE(0) === 0xffd8) {
    return parseJpeg(buffer)
  }
  if (ext === '.avif' || ext === '.heic') return null
  return null
}

function parseWebp(buffer: Buffer): ImageSize | null {
  if (buffer.length < 30) return null
  const chunk = buffer.toString('ascii', 12, 16)
  if (chunk === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    }
  }
  if (chunk === 'VP8L') {
    const bits = buffer.readUInt32LE(21)
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }
  }
  if (chunk === 'VP8 ') {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    }
  }
  return null
}

function parseJpeg(buffer: Buffer): ImageSize | null {
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]!
    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = buffer.readUInt16BE(offset + 2)
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    if (isSof) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
    }
    offset += 2 + length
  }
  return null
}
