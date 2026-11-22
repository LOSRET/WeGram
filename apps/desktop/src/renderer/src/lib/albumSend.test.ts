import { describe, expect, it } from 'vitest'

import { albumSendOf } from './albumSend'

describe('albumSendOf', () => {
  it('sends two to ten photos as one album', () => {
    expect(albumSendOf(['a.jpg', 'b.jpg'], 'photo')).toEqual([
      { filePath: 'a.jpg', kind: 'photo' },
      { filePath: 'b.jpg', kind: 'photo' },
    ])
    const ten = Array.from({ length: 10 }, (_, index) => `${index}.jpg`)
    expect(albumSendOf(ten, 'photo')).toHaveLength(10)
  })

  it('keeps a single photo on the normal send path', () => {
    expect(albumSendOf(['a.jpg'], 'photo')).toBeNull()
  })

  it('does not split a selection larger than an album', () => {
    // Eleven photos are eleven messages: an album plus a tail would need a UI
    // that names the split, and silently dropping the eleventh is worse.
    const eleven = Array.from({ length: 11 }, (_, index) => `${index}.jpg`)
    expect(albumSendOf(eleven, 'photo')).toBeNull()
  })

  it('leaves documents as one message each', () => {
    expect(albumSendOf(['a.pdf', 'b.pdf'], 'file')).toBeNull()
  })
})
