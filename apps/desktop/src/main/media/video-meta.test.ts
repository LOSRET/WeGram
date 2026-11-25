import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseMp4Meta, probeVideoMeta } from './video-meta'

describe('probeVideoMeta', () => {
  it('answers null for a file it cannot open, so the send becomes a document', async () => {
    await expect(
      probeVideoMeta(join(process.cwd(), 'definitely-missing-clip.mp4')),
    ).resolves.toBeNull()
  })
})

/** One ISO BMFF box: a 32-bit size, a four-character type, then the payload. */
function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(8 + payload.length, 0)
  header.write(type, 4, 'ascii')
  return Buffer.concat([header, payload])
}

function mvhd(timescale: number, duration: number, version: 0 | 1 = 0): Buffer {
  const payload = Buffer.alloc(version === 1 ? 32 : 20)
  payload[0] = version
  if (version === 1) {
    payload.writeUInt32BE(timescale, 20)
    payload.writeUInt32BE(0, 24)
    payload.writeUInt32BE(duration, 28)
  } else {
    payload.writeUInt32BE(timescale, 12)
    payload.writeUInt32BE(duration, 16)
  }
  return box('mvhd', payload)
}

/** A track header with a 16.16 fixed-point box and the rotation matrix. */
function tkhd(width: number, height: number, rotated = false): Buffer {
  const payload = Buffer.alloc(84)
  // Matrix: a = 1, b = 0 is upright; a = 0, b = 1 is a 90° turn.
  payload.writeInt32BE(rotated ? 0 : 0x10000, 40)
  payload.writeInt32BE(rotated ? 0x10000 : 0, 44)
  payload.writeUInt32BE(width * 65_536, 76)
  payload.writeUInt32BE(height * 65_536, 80)
  return box('tkhd', payload)
}

const moov = (...children: Buffer[]): Buffer => Buffer.concat(children)

describe('parseMp4Meta', () => {
  it('reads the picture size and the duration TDLib wants', () => {
    const meta = parseMp4Meta(moov(mvhd(1000, 12_500), box('trak', tkhd(1920, 1080))))
    expect(meta).toEqual({ width: 1920, height: 1080, duration: 13 })
  })

  it('swaps a portrait clip whose matrix rotates the stored frame', () => {
    expect(parseMp4Meta(moov(mvhd(600, 3000), box('trak', tkhd(1920, 1080, true))))).toEqual({
      width: 1080,
      height: 1920,
      duration: 5,
    })
  })

  it('takes the first sized track, so an audio track never becomes the picture', () => {
    const audio = box('tkhd', Buffer.alloc(84))
    expect(
      parseMp4Meta(moov(mvhd(1000, 1000), box('trak', audio), box('trak', tkhd(640, 360)))),
    ).toMatchObject({ width: 640, height: 360 })
  })

  it('has no video facts without a sized track or a moov at all', () => {
    expect(parseMp4Meta(moov(mvhd(1000, 1000)))).toBeNull()
    expect(parseMp4Meta(Buffer.alloc(0))).toBeNull()
    expect(parseMp4Meta(box('mvhd', Buffer.alloc(20)))).toBeNull()
  })

  it('keeps a missing timescale as a zero duration rather than dividing by it', () => {
    expect(parseMp4Meta(moov(mvhd(0, 12_500), box('trak', tkhd(320, 240))))).toEqual({
      width: 320,
      height: 240,
      duration: 0,
    })
  })
})
