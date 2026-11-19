import { describe, expect, it } from 'vitest'

import {
  mapContent,
  mediaUrls,
  pickLargest,
  pickSmallestAtLeast,
  previewContent,
  previewSpoilers,
  serviceText,
} from './content'

/**
 * These mappers turn raw TDLib content into the DTO the transcript renders.
 * They are the layer most likely to break silently on a field change: the type
 * checker only sees the DTO, not the TDLib shape that produced it.
 */
describe('mapContent', () => {
  it('maps formatted text and keeps entity offsets untouched', () => {
    const mapped = mapContent({
      _: 'messageText',
      text: {
        text: 'hello world',
        entities: [{ type: { _: 'textEntityTypeBold' }, offset: 0, length: 5 }],
      },
    })

    expect(mapped).toEqual({
      kind: 'text',
      text: 'hello world',
      entities: [{ type: 'bold', offset: 0, length: 5 }],
    })
  })

  it('picks the largest photo as the bubble and a >=160px variant as its thumb', () => {
    const mapped = mapContent({
      _: 'messagePhoto',
      caption: { text: 'a picture' },
      photo: {
        sizes: [
          { width: 90, height: 90, photo: { id: 1 } },
          { width: 320, height: 320, photo: { id: 2 } },
          { width: 1280, height: 1280, photo: { id: 3 } },
        ],
      },
    })

    expect(mapped.kind).toBe('photo')
    expect(mapped.text).toBe('a picture')
    expect(mapped.media).toMatchObject({ fileId: 3, thumbFileId: 2, width: 1280, height: 1280 })
  })

  it('does not report a distinct thumb when the display size is also the smallest', () => {
    const mapped = mapContent({
      _: 'messagePhoto',
      photo: { sizes: [{ width: 200, height: 200, photo: { id: 7 } }] },
    })

    expect(mapped.media).toMatchObject({ fileId: 7 })
    expect(mapped.media).not.toHaveProperty('thumbFileId')
  })

  it('maps a video with its metadata and document fallback fields', () => {
    const mapped = mapContent({
      _: 'messageVideo',
      video: {
        video: { id: 11 },
        duration: 12,
        width: 640,
        height: 360,
        file_name: 'clip.mp4',
        mime_type: 'video/mp4',
        thumbnail: { file: { id: 12 } },
      },
    })

    expect(mapped).toMatchObject({
      kind: 'video',
      media: {
        fileId: 11,
        thumbFileId: 12,
        duration: 12,
        width: 640,
        height: 360,
        fileName: 'clip.mp4',
        mimeType: 'video/mp4',
      },
    })
  })

  it('treats animations as videos', () => {
    const mapped = mapContent({
      _: 'messageAnimation',
      animation: { animation: { id: 21 }, duration: 2, width: 100, height: 80 },
    })

    expect(mapped.kind).toBe('video')
    expect(mapped.media).toMatchObject({ fileId: 21, duration: 2 })
  })

  it('maps a document size and format', () => {
    const mapped = mapContent({
      _: 'messageDocument',
      caption: { text: 'report' },
      document: {
        document: { id: 31, size: 4096 },
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
      },
    })

    expect(mapped).toMatchObject({
      kind: 'file',
      text: 'report',
      media: { fileId: 31, size: 4096, fileName: 'report.pdf', mimeType: 'application/pdf' },
    })
  })

  it('maps all three sticker formats', () => {
    const base = { sticker: { id: 41 }, thumbnail: { file: { id: 42 } } }
    expect(
      mapContent({ _: 'messageSticker', sticker: { ...base, format: { _: 'stickerFormatTgs' } } }),
    ).toMatchObject({
      kind: 'sticker',
      media: { fileId: 41, stickerFormat: 'tgs' },
    })
    expect(
      mapContent({ _: 'messageSticker', sticker: { ...base, format: { _: 'stickerFormatWebm' } } }),
    ).toMatchObject({
      media: { stickerFormat: 'webm' },
    })
    expect(mapContent({ _: 'messageSticker', sticker: base })).toMatchObject({
      media: { stickerFormat: undefined },
    })
  })

  it('maps a voice note to an audio bubble', () => {
    const mapped = mapContent({
      _: 'messageVoiceNote',
      voice_note: { voice: { id: 51 }, duration: 3, mime_type: 'audio/ogg' },
    })

    expect(mapped).toMatchObject({
      kind: 'voice',
      media: { fileId: 51, duration: 3, mimeType: 'audio/ogg' },
    })
  })

  it('uses the poll question as the text', () => {
    expect(
      mapContent({ _: 'messagePoll', poll: { question: { text: 'which one?' } } }),
    ).toMatchObject({ kind: 'poll', text: 'which one?' })
  })

  it('renders animated emoji and dice as their glyph', () => {
    expect(mapContent({ _: 'messageAnimatedEmoji', emoji: '🎉' })).toMatchObject({
      kind: 'text',
      text: '🎉',
    })
    expect(mapContent({ _: 'messageDice', emoji: '🎲' })).toMatchObject({
      kind: 'text',
      text: '🎲',
    })
  })

  it('falls back to a service message for unknown content', () => {
    expect(mapContent({ _: 'messagePinMessage' })).toEqual({
      kind: 'service',
      text: '',
      entities: [],
    })
    expect(mapContent({ _: 'messageSomethingNew' })).toEqual({
      kind: 'service',
      text: '',
      entities: [],
    })
  })
})

describe('mediaUrls', () => {
  it('only exposes a local URL once the file is fully downloaded', () => {
    expect(mediaUrls({ id: 1, local: { is_downloading_completed: false } })).toEqual({})
    expect(mediaUrls({ id: 1, local: { is_downloading_completed: true, path: '' } })).toEqual({})

    const urls = mediaUrls(
      { id: 1, local: { is_downloading_completed: true, path: 'C:\\files\\a.jpg' } },
      { id: 2, local: { is_downloading_completed: true, path: 'C:\\files\\b.jpg' } },
    )
    expect(urls.localUrl).toMatch(/^wx-media:\/\/f\/[0-9a-f]{32}$/)
    expect(urls.thumbUrl).toMatch(/^wx-media:\/\/f\/[0-9a-f]{32}$/)
  })
})

describe('size pickers', () => {
  const sizes = [
    { width: 100, height: 100 },
    { width: 200, height: 400 },
    { width: 300, height: 100 },
  ]

  it('picks the largest by area, not by width', () => {
    expect(pickLargest(sizes)).toBe(sizes[1])
  })

  it('picks the smallest entry that is at least minWidth wide', () => {
    expect(pickSmallestAtLeast(sizes, 150)).toBe(sizes[1])
    expect(pickSmallestAtLeast(sizes, 900)).toBeUndefined()
  })

  it('handles an empty size list', () => {
    expect(pickLargest([])).toBeUndefined()
    expect(pickSmallestAtLeast([], 1)).toBeUndefined()
  })
})

describe('previewContent', () => {
  it('prefers the message text', () => {
    expect(previewContent({ _: 'messageText', text: { text: 'hi' } })).toBe('hi')
  })

  it('labels media when there is no caption', () => {
    expect(previewContent({ _: 'messagePhoto' })).toBe('[图片]')
    expect(previewContent({ _: 'messageVoiceNote' })).toBe('[语音]')
  })

  it('describes service messages', () => {
    expect(previewContent({ _: 'messageChatChangeTitle' })).toBe('修改群聊名称')
    expect(previewContent({ _: 'messagePinMessage' })).toBe('置顶了一条消息')
    expect(previewContent({ _: 'messageSomethingNew' })).toBe('')
  })

  it('returns an empty preview for a missing content object', () => {
    expect(previewContent(undefined)).toBe('')
  })
})

describe('previewSpoilers', () => {
  it('reports the spoiler offsets of a text preview', () => {
    expect(
      previewSpoilers({
        _: 'messageText',
        text: {
          text: '剧透：答案是 42',
          entities: [{ type: { _: 'textEntityTypeSpoiler' }, offset: 3, length: 3 }],
        },
      }),
    ).toEqual([[3, 6]])
  })

  it('reads a spoiler off the caption, which is the whole photo preview', () => {
    expect(
      previewSpoilers({
        _: 'messagePhoto',
        caption: {
          text: 'wwww',
          entities: [{ type: { _: 'textEntityTypeSpoiler' }, offset: 0, length: 4 }],
        },
      }),
    ).toEqual([[0, 4]])
  })

  it('has nothing to mask in a label or a service line', () => {
    expect(previewSpoilers({ _: 'messagePhoto' })).toEqual([])
    expect(previewSpoilers({ _: 'messageChatChangeTitle' })).toEqual([])
    expect(previewSpoilers(undefined)).toEqual([])
  })

  it('drops entities that are not spoilers and ranges past the text', () => {
    expect(
      previewSpoilers({
        _: 'messageText',
        text: {
          text: 'ab',
          entities: [
            { type: { _: 'textEntityTypeBold' }, offset: 0, length: 1 },
            { type: { _: 'textEntityTypeSpoiler' }, offset: 0, length: 9 },
          ],
        },
      }),
    ).toEqual([])
  })
})

describe('serviceText', () => {
  const ctx = {
    senderName: 'Alice',
    outgoing: false,
    resolveUserName: async (userId: number) => `user-${userId}`,
  }

  it('composes group lifecycle notices in WeChat style', async () => {
    expect(await serviceText({ _: 'messageSupergroupChatCreate', title: 'Team' }, ctx)).toBe(
      'Alice创建了群聊「Team」',
    )
    expect(await serviceText({ _: 'messageChatChangeTitle', title: 'New' }, ctx)).toBe(
      'Alice修改群聊名称为「New」',
    )
    expect(await serviceText({ _: 'messageChatChangePhoto' }, ctx)).toBe('Alice修改了群聊头像')
  })

  it('reads the reciprocal pronoun when the message is ours', async () => {
    expect(await serviceText({ _: 'messagePinMessage' }, { ...ctx, outgoing: true })).toBe(
      '你置顶了一条消息',
    )
  })

  it('names the invited members and tolerates an empty list', async () => {
    expect(await serviceText({ _: 'messageChatAddMembers', member_user_ids: [1, 2] }, ctx)).toBe(
      'Alice邀请user-1、user-2加入了群聊',
    )
    expect(await serviceText({ _: 'messageChatAddMembers', member_user_ids: [] }, ctx)).toBe(
      'Alice邀请了新成员加入群聊',
    )
  })

  it('reports the departing member, not the sender, for a removal', async () => {
    expect(await serviceText({ _: 'messageChatDeleteMember', user_id: 9 }, ctx)).toBe(
      'user-9退出了群聊',
    )
  })

  it('turns the auto-delete time into an on/off notice', async () => {
    expect(
      await serviceText(
        { _: 'messageChatSetMessageAutoDeleteTime', message_auto_delete_time: 60 },
        ctx,
      ),
    ).toBe('Alice开启了消息自动删除')
    expect(
      await serviceText(
        { _: 'messageChatSetMessageAutoDeleteTime', message_auto_delete_time: 0 },
        ctx,
      ),
    ).toBe('Alice关闭了消息自动删除')
  })

  it('falls back to empty text for an unhandled service type', async () => {
    expect(await serviceText({ _: 'messageSomethingNew' }, ctx)).toBe('')
  })
})
