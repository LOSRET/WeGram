import { describe, expect, it } from 'vitest'

import { createRangeStream, type StreamFeed } from './stream'

/** A feed that only makes the next `step` bytes available when nudged. */
function tailingFeed(bytes: number, step: number): StreamFeed {
  const data = Uint8Array.from({ length: bytes }, (_, index) => index % 256)
  let ready = 0
  return {
    size: bytes,
    available: async (offset) => Math.max(0, ready - offset),
    read: async (offset, length) =>
      data.subarray(offset, Math.min(offset + length, Math.min(ready, bytes))),
    nudge: async (offset) => {
      ready = Math.min(bytes, Math.max(ready, offset + step))
    },
  }
}

describe('createRangeStream', () => {
  it('tails the download and answers exactly the requested range', async () => {
    const feed = tailingFeed(200, 24)
    const stream = createRangeStream(feed, 40, 129, new AbortController().signal, {
      pollMs: 0,
      chunkBytes: 13,
    })
    const body = new Uint8Array(await new Response(stream).arrayBuffer())
    expect(Array.from(body)).toEqual(Array.from({ length: 90 }, (_, index) => (40 + index) % 256))
  })

  it('a whole-file range ends at the last byte', async () => {
    const feed = tailingFeed(50, 50)
    const stream = createRangeStream(feed, 0, 49, new AbortController().signal, {
      pollMs: 0,
      chunkBytes: 20,
    })
    const body = new Uint8Array(await new Response(stream).arrayBuffer())
    expect(body.length).toBe(50)
    expect(body[49]).toBe(49)
  })

  it('fails the response when nothing ever arrives', async () => {
    const feed: StreamFeed = {
      size: 100,
      available: async () => 0,
      read: async () => new Uint8Array(),
      nudge: async () => undefined,
    }
    const stream = createRangeStream(feed, 0, 99, new AbortController().signal, {
      pollMs: 0,
      maxStalls: 3,
    })
    await expect(new Response(stream).arrayBuffer()).rejects.toThrow(/stalled/)
  })

  it('stops without bytes when the request is aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const feed = tailingFeed(100, 10)
    const stream = createRangeStream(feed, 0, 99, controller.signal, { pollMs: 0 })
    const body = new Uint8Array(await new Response(stream).arrayBuffer())
    expect(body.length).toBe(0)
  })
})
