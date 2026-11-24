import type { MessageMedia, RichBlock } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { pageViewerItems } from './instantViewMedia'

const photo = (fileId: number, extra: Partial<MessageMedia> = {}): MessageMedia => ({
  fileId,
  ...extra,
})
const video = (fileId: number, extra: Partial<MessageMedia> = {}): MessageMedia => ({
  fileId,
  mimeType: 'video/mp4',
  ...extra,
})

const text = (body: string): RichBlock => ({
  type: 'text',
  role: 'paragraph',
  text: { text: body, entities: [] },
})

/**
 * 即时预览 hands the viewer its own strip, because a page's pictures are blocks and
 * not messages; what matters is document order, the nested blocks a page can carry,
 * and that nothing the viewer cannot page through leaks in.
 */
describe('pageViewerItems', () => {
  it("collects a page's media blocks and gallery cells in document order", () => {
    const items = pageViewerItems([
      text('标题'),
      { type: 'media', kind: 'photo', media: photo(11, { width: 800, height: 600 }) },
      {
        type: 'gallery',
        items: [
          { kind: 'photo', media: photo(12) },
          { kind: 'video', media: video(21, { duration: 12 }) },
        ],
      },
    ])

    expect(items.map((item) => item.fileId)).toEqual([11, 12, 21])
    expect(items[0]).toMatchObject({ kind: 'photo', width: 800, height: 600 })
    expect(items[2]).toMatchObject({ kind: 'video', duration: 12 })
  })

  it('walks the nested blocks a page can carry', () => {
    const items = pageViewerItems([
      {
        type: 'list',
        items: [
          { label: '', value: 0, blocks: [{ type: 'media', kind: 'photo', media: photo(31) }] },
        ],
      },
      {
        type: 'quote',
        blocks: [{ type: 'media', kind: 'photo', media: photo(32) }],
      },
      {
        type: 'details',
        header: { text: '更多', entities: [] },
        open: false,
        blocks: [{ type: 'media', kind: 'photo', media: photo(33) }],
      },
    ])

    expect(items.map((item) => item.fileId)).toEqual([31, 32, 33])
  })

  it('leaves out media the viewer cannot page through', () => {
    const items = pageViewerItems([
      { type: 'media', kind: 'file', media: { fileId: 41, fileName: 'a.pdf' } },
      { type: 'media', kind: 'voice', media: { fileId: 42, duration: 3 } },
      { type: 'media', kind: 'photo', media: photo(0) },
      { type: 'media', kind: 'photo', media: photo(43) },
    ])

    expect(items.map((item) => item.fileId)).toEqual([43])
  })

  it('carries the fields the window needs and no message id', () => {
    const items = pageViewerItems([
      {
        type: 'media',
        kind: 'video',
        media: video(51, { isAnimation: true, minithumbnail: 'AAAA', duration: 4 }),
      },
    ])

    expect(items[0]).toMatchObject({
      kind: 'video',
      fileId: 51,
      duration: 4,
      isAnimation: true,
      minithumbnail: 'AAAA',
    })
    expect(items[0]).not.toHaveProperty('messageId')
  })

  it('is an empty strip for a page without pictures', () => {
    expect(pageViewerItems([text('只有文字'), { type: 'divider' }])).toEqual([])
  })
})
