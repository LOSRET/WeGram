import type { Message, MessageMedia } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { buildViewerStrip, viewerWindow } from './viewer'

function message(
  id: number,
  kind: Message['kind'],
  media?: MessageMedia,
  overrides: Partial<Message> = {},
): Message {
  return {
    id,
    chatId: 1,
    senderId: 1,
    senderName: '我',
    outgoing: true,
    date: 1_700_000_000,
    kind,
    text: '',
    ...(media ? { media } : {}),
    ...overrides,
  }
}

const photo = (fileId: number, extra: Partial<MessageMedia> = {}): MessageMedia => ({
  fileId,
  ...extra,
})
const video = (fileId: number, extra: Partial<MessageMedia> = {}): MessageMedia => ({
  fileId,
  mimeType: 'video/mp4',
  ...extra,
})

/**
 * The viewer pages through what the transcript already has, so the two rules that
 * matter are "one kind per strip" and "the clicked message is the start index".
 */
describe('buildViewerStrip', () => {
  it('collects the photos of the chat and starts on the clicked one', () => {
    const strip = buildViewerStrip(
      [
        message(1, 'text'),
        message(2, 'photo', photo(11, { width: 800, height: 600, fileName: 'a.jpg' })),
        message(3, 'voice', { fileId: 0, duration: 3 }),
        message(4, 'photo', photo(12, { minithumbnail: 'AAAA' })),
      ],
      'photo',
      4,
    )

    expect(strip?.index).toBe(1)
    expect(strip?.items.map((item) => item.fileId)).toEqual([11, 12])
    expect(strip?.items[0]).toMatchObject({ kind: 'photo', messageId: 2, width: 800, height: 600 })
    expect(strip?.items[1]).toMatchObject({ kind: 'photo', minithumbnail: 'AAAA' })
  })

  it('keeps photos out of a video strip and carries the duration', () => {
    const strip = buildViewerStrip(
      [
        message(1, 'photo', photo(11)),
        message(2, 'video', video(21, { duration: 51, width: 720, height: 1280 })),
      ],
      'video',
      2,
    )

    expect(strip?.items).toHaveLength(1)
    expect(strip?.items[0]).toMatchObject({ kind: 'video', fileId: 21, duration: 51 })
  })

  it('marks an animation so the canvas loops it instead of offering a transport', () => {
    const strip = buildViewerStrip(
      [message(1, 'video', video(21)), message(2, 'video', video(22, { isAnimation: true }))],
      'video',
      2,
    )

    expect(strip?.items[0]).not.toHaveProperty('isAnimation')
    expect(strip?.items[1]).toMatchObject({ kind: 'video', fileId: 22, isAnimation: true })
  })

  it('refuses to open when the clicked message is not in the strip', () => {
    expect(buildViewerStrip([message(1, 'photo', photo(11))], 'photo', 9)).toBeNull()
    expect(buildViewerStrip([message(5, 'text')], 'photo', 5)).toBeNull()
  })

  it('carries the save capability so protected media cannot be saved', () => {
    const strip = buildViewerStrip(
      [message(1, 'photo', photo(11)), message(2, 'photo', photo(12), { canBeSaved: false })],
      'photo',
      2,
    )

    expect(strip?.items[0]?.canBeSaved).toBeUndefined()
    expect(strip?.items[1]?.canBeSaved).toBe(false)
  })

  it('skips media that has no file yet', () => {
    const strip = buildViewerStrip(
      [message(1, 'photo', photo(0)), message(2, 'photo', photo(13))],
      'photo',
      2,
    )

    expect(strip?.items.map((item) => item.fileId)).toEqual([13])
    expect(strip?.index).toBe(0)
  })
})
/**
 * A page can hold more pictures than one window pages through (the protocol caps a
 * strip at 200), so the click has to be centred inside the window it opens.
 */
describe('viewerWindow', () => {
  const ids = Array.from({ length: 250 }, (_, index) => index)

  it('keeps a short strip whole', () => {
    expect(viewerWindow([1, 2, 3], 1)).toEqual({ items: [1, 2, 3], index: 1 })
  })

  it('centres a long strip on the clicked item', () => {
    const strip = viewerWindow(ids, 120)

    expect(strip.items).toHaveLength(200)
    expect(strip.items[strip.index]).toBe(120)
    expect(strip.items[0]).toBe(20)
  })

  it('clamps at both ends instead of running off the strip', () => {
    expect(viewerWindow(ids, 0)).toMatchObject({ index: 0 })
    expect(viewerWindow(ids, 0).items[0]).toBe(0)
    const last = viewerWindow(ids, 249)
    expect(last.items).toHaveLength(200)
    expect(last.items[last.index]).toBe(249)
  })
})
