import { describe, expect, it } from 'vitest'

import { albumSendOf } from './albumSend'

const photo = (filePath: string) => ({ filePath, kind: 'photo' as const })
const video = (filePath: string) => ({ filePath, kind: 'video' as const })

describe('albumSendOf', () => {
  it('sends two to ten photos as one album', () => {
    expect(albumSendOf([photo('a.jpg'), photo('b.jpg')])).toEqual([
      { filePath: 'a.jpg', kind: 'photo' },
      { filePath: 'b.jpg', kind: 'photo' },
    ])
    const ten = Array.from({ length: 10 }, (_, index) => photo(`${index}.jpg`))
    expect(albumSendOf(ten)).toHaveLength(10)
  })

  it('mixes videos into the same album', () => {
    expect(albumSendOf([photo('a.jpg'), video('b.mp4')])).toEqual([
      { filePath: 'a.jpg', kind: 'photo' },
      { filePath: 'b.mp4', kind: 'video' },
    ])
  })

  it('keeps a single file on the normal send path', () => {
    expect(albumSendOf([photo('a.jpg')])).toBeNull()
    expect(albumSendOf([video('a.mp4')])).toBeNull()
  })

  it('does not split a selection larger than an album', () => {
    // Eleven files are eleven messages: an album plus a tail would need a UI that
    // names the split, and silently dropping the eleventh is worse.
    const eleven = Array.from({ length: 11 }, (_, index) => photo(`${index}.jpg`))
    expect(albumSendOf(eleven)).toBeNull()
  })

  it('leaves any selection with a document as one message each', () => {
    expect(albumSendOf([photo('a.jpg'), { filePath: 'b.pdf', kind: 'file' as const }])).toBeNull()
  })
})
