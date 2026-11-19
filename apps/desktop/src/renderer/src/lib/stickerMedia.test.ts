import { describe, expect, it } from 'vitest'

import { stickerMedia } from './stickerMedia'

describe('stickerMedia', () => {
  it('carries both file ids and both formats, so a grid can use the thumbnail', () => {
    expect(
      stickerMedia({
        fileId: 7,
        format: 'tgs',
        thumbFileId: 8,
        thumbFormat: 'webp',
        emoji: '✨',
        width: 128,
        height: 128,
      }),
    ).toEqual({
      fileId: 7,
      thumbFileId: 8,
      stickerThumbFormat: 'webp',
      stickerFormat: 'tgs',
      stickerEmoji: '✨',
      width: 128,
      height: 128,
    })
  })

  it('omits optional fields instead of sending undefined values', () => {
    const media = stickerMedia({ fileId: 9, format: 'webp' })
    expect(media).toEqual({ fileId: 9, stickerFormat: 'webp' })
    expect(Object.keys(media)).not.toContain('thumbFileId')
    expect(Object.keys(media)).not.toContain('stickerEmoji')
  })
})
