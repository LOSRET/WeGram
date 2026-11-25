import { open } from 'node:fs/promises'

export interface VideoMeta {
  width: number
  height: number
  /** Whole seconds; TDLib's `inputVideo.duration`. 0 when the file has no timescale. */
  duration: number
}

/** A `moov` larger than this is not a phone clip this client should read whole. */
const MOOV_LIMIT = 8 * 1024 * 1024

/**
 * Reads an MP4/MOV's display size and duration for TDLib's `inputVideo`.
 *
 * A video message cannot be sent blind the way a document can: TDLib wants the
 * dimensions and the duration, and guessing them produces a bubble with a wrong
 * box and a "0:00" badge that never recovers. The boxes are read from the file
 * itself (ISO BMFF: `moov` → `mvhd`/`tkhd`) with no dependency and no decoding.
 *
 * Anything this cannot parse — WebM/MKV, a fragmented MP4 whose moov is bigger
 * than the cap, a damaged file — answers null, and the adapter sends the file as
 * a document instead of a broken video.
 */
export async function probeVideoMeta(filePath: string): Promise<VideoMeta | null> {
  const handle = await open(filePath, 'r')
  try {
    const { size } = await handle.stat()
    let offset = 0
    while (offset + 8 <= size) {
      const header = Buffer.alloc(16)
      const { bytesRead } = await handle.read(header, 0, header.length, offset)
      if (bytesRead < 8) return null
      const type = header.toString('ascii', 4, 8)
      let boxSize = header.readUInt32BE(0)
      let headerSize = 8
      if (boxSize === 1) {
        if (bytesRead < 16) return null
        // 64-bit size: high/low words, still exact while under 2^53 bytes.
        boxSize = header.readUInt32BE(8) * 2 ** 32 + header.readUInt32BE(12)
        headerSize = 16
      } else if (boxSize === 0) {
        boxSize = size - offset
      }
      if (boxSize < headerSize) return null
      if (type === 'moov') {
        const payloadSize = boxSize - headerSize
        if (payloadSize > MOOV_LIMIT) return null
        const payload = Buffer.alloc(payloadSize)
        const { bytesRead: read } = await handle.read(
          payload,
          0,
          payload.length,
          offset + headerSize,
        )
        if (read < payload.length) return null
        return parseMp4Meta(payload)
      }
      offset += boxSize
    }
    return null
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

interface TrackSizes {
  width: number
  height: number
  /** True when the display matrix rotates the stored frame by 90° or 270°. */
  rotated: boolean
}

/**
 * The `moov` payload as the protocol's video facts. Pure, so the box walker is
 * pinned by tests without a real clip on disk.
 */
export function parseMp4Meta(moov: Buffer): VideoMeta | null {
  let timescale = 0
  let durationTicks = 0
  // Held in an object because the box walker is a callback: TypeScript cannot
  // narrow a plain `let` assigned inside one back to non-null afterwards.
  const found: { sizes: TrackSizes | null } = { sizes: null }
  walkBoxes(moov, 0, moov.length, (type, start, end) => {
    if (type === 'mvhd') {
      const timing = readMvhd(moov, start, end)
      if (timing) {
        timescale = timing.timescale
        durationTicks = timing.duration
      }
    } else if (type === 'tkhd' && found.sizes === null) {
      // A video track is the one whose tkhd carries non-zero dimensions; an
      // audio track's is 0×0, so the first sized track is the picture.
      const sizes = readTkhd(moov, start, end)
      if (sizes) found.sizes = sizes
    }
  })
  const video = found.sizes
  if (!video) return null
  const width = video.rotated ? video.height : video.width
  const height = video.rotated ? video.width : video.height
  if (width <= 0 || height <= 0) return null
  return {
    width,
    height,
    duration: timescale > 0 ? Math.max(0, Math.round(durationTicks / timescale)) : 0,
  }
}

/** Boxes whose payload is a list of boxes. Everything else is a leaf. */
const CONTAINERS: ReadonlySet<string> = new Set(['moov', 'trak'])

function walkBoxes(
  buffer: Buffer,
  start: number,
  end: number,
  visit: (type: string, payloadStart: number, payloadEnd: number) => void,
): void {
  let offset = start
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    let header = 8
    if (size === 1) {
      if (offset + 16 > end) return
      size = buffer.readUInt32BE(offset + 8) * 2 ** 32 + buffer.readUInt32BE(offset + 12)
      header = 16
    } else if (size === 0) {
      size = end - offset
    }
    if (size < header || offset + size > end) return
    const payloadStart = offset + header
    const payloadEnd = offset + size
    if (CONTAINERS.has(type)) walkBoxes(buffer, payloadStart, payloadEnd, visit)
    else visit(type, payloadStart, payloadEnd)
    offset += size
  }
}

function readMvhd(
  buffer: Buffer,
  start: number,
  end: number,
): { timescale: number; duration: number } | null {
  if (end - start < 4) return null
  const version = buffer[start]
  if (version === 1) {
    if (end - start < 32) return null
    return {
      timescale: buffer.readUInt32BE(start + 20),
      duration: buffer.readUInt32BE(start + 24) * 2 ** 32 + buffer.readUInt32BE(start + 28),
    }
  }
  if (end - start < 20) return null
  return {
    timescale: buffer.readUInt32BE(start + 12),
    duration: buffer.readUInt32BE(start + 16),
  }
}

function readTkhd(buffer: Buffer, start: number, end: number): TrackSizes | null {
  if (end - start < 4) return null
  const version = buffer[start]
  // Version 0: 4-byte fields up to the 36-byte matrix; version 1: 8-byte times.
  const matrix = version === 1 ? start + 52 : start + 40
  const widthAt = version === 1 ? start + 88 : start + 76
  if (widthAt + 8 > end) return null
  const width = buffer.readUInt32BE(widthAt) / 65_536
  const height = buffer.readUInt32BE(widthAt + 4) / 65_536
  if (width <= 0 || height <= 0) return null
  const a = buffer.readInt32BE(matrix)
  const b = buffer.readInt32BE(matrix + 4)
  return { width, height, rotated: a === 0 && b !== 0 }
}
