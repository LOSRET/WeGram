/**
 * OGG/Opus muxing for 语音消息.
 *
 * TDLib accepts a voice note only as Opus inside an OGG container, and Chromium
 * cannot record OGG (its `MediaRecorder` emits WebM or MP4 — see
 * `docs/PRIVATE-CHAT-HANDOFF.md` §10b). The way out without a new dependency is
 * WebCodecs: `AudioEncoder` hands over the raw Opus packets, and this module
 * writes the container around them — the two header pages (OpusHead, OpusTags)
 * and the audio pages with their granule positions.
 *
 * Pure and Electron-free on purpose: the whole format (CRC table, lacing, page
 * sequencing, granule arithmetic) is pinned by `oggOpus.test.ts`, so the only
 * part that cannot be unit-tested is the browser's encoder.
 */

/** A packet exactly as the encoder produced it. */
export interface OpusPacket {
  data: Uint8Array
  /** 48 kHz samples this packet decodes to (20 ms frames are 960). */
  samples: number
}

export interface OggOpusInput {
  packets: OpusPacket[]
  /** Channels in the stream; the recorder records mono. */
  channels?: number
  /** Samples a decoder drops at the start (encoder delay); 0 for a live recording. */
  preSkip?: number
  /** Audio pages close once their payload passes this many bytes. */
  maxPageBytes?: number
}

/** 'WEGR' — one session, one stream, so a constant serial is enough. */
const SERIAL = 0x57454752
const MAX_PACKETS_PER_PAGE = 50
const DEFAULT_PAGE_BYTES = 4096

/** `header_type` bits. */
const BOS = 0x02
const EOS = 0x04

let crcTable: Uint32Array | null = null

/**
 * OGG's CRC-32: polynomial 0x04c11db7, MSB-first, no final inversion — *not* the
 * zlib one. The table is built once.
 */
function table(): Uint32Array {
  if (crcTable) return crcTable
  const built = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let remainder = index << 24
    for (let bit = 0; bit < 8; bit += 1) {
      remainder = (remainder & 0x80000000) !== 0 ? (remainder << 1) ^ 0x04c11db7 : remainder << 1
    }
    built[index] = remainder >>> 0
  }
  crcTable = built
  return built
}

export function oggCrc(bytes: Uint8Array): number {
  const lookup = table()
  let crc = 0
  for (const byte of bytes) {
    const entry = lookup[((crc >>> 24) ^ byte) & 0xff] ?? 0
    crc = ((crc << 8) ^ entry) >>> 0
  }
  return crc >>> 0
}

function writeUint16LE(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff
  out[offset + 1] = (value >>> 8) & 0xff
}

function writeUint32LE(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff
  out[offset + 1] = (value >>> 8) & 0xff
  out[offset + 2] = (value >>> 16) & 0xff
  out[offset + 3] = (value >>> 24) & 0xff
}

/** Granule positions are 64-bit but a recording is far below 2^53 samples. */
function writeUint64LE(out: Uint8Array, offset: number, value: number): void {
  writeUint32LE(out, offset, value % 0x1_0000_0000)
  writeUint32LE(out, offset + 4, Math.floor(value / 0x1_0000_0000))
}

function writeAscii(out: Uint8Array, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    out[offset + index] = text.charCodeAt(index)
  }
}

/**
 * One page. Every packet is segmented into 255-byte lace values plus a final
 * short one, which is what lets a parser find packet boundaries again.
 */
function oggPage(input: {
  headerType: number
  granule: number
  sequence: number
  packets: Uint8Array[]
}): Uint8Array {
  const lacing: number[] = []
  for (const packet of input.packets) {
    let remaining = packet.length
    while (remaining >= 255) {
      lacing.push(255)
      remaining -= 255
    }
    lacing.push(remaining)
  }
  if (lacing.length > 255) throw new Error('an OGG page holds at most 255 lacing values')

  let body = 0
  for (const packet of input.packets) body += packet.length

  const header = 27 + lacing.length
  const page = new Uint8Array(header + body)
  writeAscii(page, 0, 'OggS')
  page[4] = 0
  page[5] = input.headerType
  writeUint64LE(page, 6, input.granule)
  writeUint32LE(page, 14, SERIAL)
  writeUint32LE(page, 18, input.sequence)
  // The CRC field is zero while it is computed, then written back over itself.
  writeUint32LE(page, 22, 0)
  page[26] = lacing.length
  for (let index = 0; index < lacing.length; index += 1) {
    page[27 + index] = lacing[index] ?? 0
  }
  let offset = header
  for (const packet of input.packets) {
    page.set(packet, offset)
    offset += packet.length
  }
  writeUint32LE(page, 22, oggCrc(page))
  return page
}

/** `OpusHead`: the identification header every OGG/Opus stream starts with. */
function opusHead(channels: number, preSkip: number): Uint8Array {
  const head = new Uint8Array(19)
  writeAscii(head, 0, 'OpusHead')
  head[8] = 1
  head[9] = channels
  writeUint16LE(head, 10, preSkip)
  writeUint32LE(head, 12, 48_000)
  writeUint16LE(head, 16, 0)
  head[18] = 0
  return head
}

/** `OpusTags`: the comment header, empty apart from our vendor string. */
function opusTags(): Uint8Array {
  const vendor = 'WeGram'
  const tags = new Uint8Array(8 + 4 + vendor.length + 4)
  writeAscii(tags, 0, 'OpusTags')
  writeUint32LE(tags, 8, vendor.length)
  writeAscii(tags, 12, vendor)
  writeUint32LE(tags, 12 + vendor.length, 0)
  return tags
}

/**
 * Wraps encoder packets in OGG pages.
 *
 * Page 0 is OpusHead (BOS), page 1 is OpusTags, then audio pages carry the
 * packets in order; the last one is EOS. A page's granule is the number of 48 kHz
 * samples decoded up to and including its last packet (pre-skip included), which
 * is what players use for the duration — the voice note's own `duration` field is
 * what Telegram shows.
 */
export function muxOggOpus(input: OggOpusInput): Uint8Array {
  if (input.packets.length === 0) throw new Error('an OGG/Opus stream needs at least one packet')
  const channels = input.channels ?? 1
  const preSkip = input.preSkip ?? 0
  const maxPageBytes = input.maxPageBytes ?? DEFAULT_PAGE_BYTES

  const pages: Uint8Array[] = [
    oggPage({ headerType: BOS, granule: 0, sequence: 0, packets: [opusHead(channels, preSkip)] }),
    oggPage({ headerType: 0, granule: 0, sequence: 1, packets: [opusTags()] }),
  ]

  let sequence = 2
  let granule = preSkip
  let batch: Uint8Array[] = []
  let batchBytes = 0
  let seen = 0
  const flush = (eos: boolean): void => {
    pages.push(oggPage({ headerType: eos ? EOS : 0, granule, sequence, packets: batch }))
    sequence += 1
    batch = []
    batchBytes = 0
  }

  for (const packet of input.packets) {
    seen += 1
    batch.push(packet.data)
    batchBytes += packet.data.length
    granule += packet.samples
    const last = seen === input.packets.length
    if (last || batchBytes >= maxPageBytes || batch.length >= MAX_PACKETS_PER_PAGE) flush(last)
  }

  let total = 0
  for (const page of pages) total += page.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const page of pages) {
    out.set(page, offset)
    offset += page.length
  }
  return out
}
