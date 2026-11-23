import { describe, expect, it } from 'vitest'

import {
  mapContent,
  mediaUrls,
  pickLargest,
  pickSmallestAtLeast,
  previewContent,
  previewSpoilers,
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
    expect(mapped.media).not.toHaveProperty('isAnimation')
  })

  it('treats animations as videos', () => {
    const mapped = mapContent({
      _: 'messageAnimation',
      animation: { animation: { id: 21 }, duration: 2, width: 100, height: 80 },
    })

    expect(mapped.kind).toBe('video')
    // The flag is what makes the bubble autoplay it; an ordinary video waits for
    // the viewer, so the two must not be told apart by kind alone.
    expect(mapped.media).toMatchObject({ fileId: 21, duration: 2, isAnimation: true })
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

  it("carries the pack's set id so a click can open its box", () => {
    const mapped = mapContent({
      _: 'messageSticker',
      sticker: { sticker: { id: 41 }, set_id: '1366529573954559812' },
    })
    // TDLib sends int64 as a string; the box must use it verbatim.
    expect(mapped.media).toMatchObject({ stickerSetId: '1366529573954559812' })
    // "0" is TDLib's "this sticker has no set".
    expect(
      mapContent({ _: 'messageSticker', sticker: { sticker: { id: 41 }, set_id: '0' } }).media,
    ).not.toHaveProperty('stickerSetId')
  })

  it("carries a premium sticker's effect only when TDLib says to play it", () => {
    const premium = {
      _: 'messageSticker',
      is_premium: true,
      sticker: {
        sticker: { id: 71 },
        format: { _: 'stickerFormatTgs' },
        full_type: { _: 'stickerFullTypeRegular', premium_animation: { id: 72 } },
      },
    }
    expect(mapContent(premium).media).toMatchObject({
      fileId: 71,
      stickerFormat: 'tgs',
      premiumEffectFileId: 72,
    })
    // The flag is the message's "play it": a premium sticker message can arrive
    // without it (the effect is not meant to run), so the file is dropped.
    expect(mapContent({ ...premium, is_premium: false }).media?.premiumEffectFileId).toBeUndefined()
    // And the animation itself may still be unknown (file id 0 is not drawable).
    expect(
      mapContent({
        _: 'messageSticker',
        is_premium: true,
        sticker: { sticker: { id: 73 }, full_type: { _: 'stickerFullTypeRegular' } },
      }).media?.premiumEffectFileId,
    ).toBeUndefined()
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

  it('maps an animated emoji to its sticker and keeps the glyph as text', () => {
    expect(
      mapContent({
        _: 'messageAnimatedEmoji',
        emoji: '✨',
        animated_emoji: {
          sticker: {
            sticker: { id: 61 },
            thumbnail: { file: { id: 62 } },
            format: { _: 'stickerFormatTgs' },
            width: 512,
            height: 512,
          },
          sticker_width: 512,
          sticker_height: 512,
          sound: { id: 63 },
        },
      }),
    ).toMatchObject({
      kind: 'emoji',
      text: '✨',
      media: {
        fileId: 61,
        thumbFileId: 62,
        stickerFormat: 'tgs',
        stickerEmoji: '✨',
        soundFileId: 63,
        width: 512,
        height: 512,
      },
    })
  })

  it('keeps the glyph when an animated emoji has no sticker yet', () => {
    expect(
      mapContent({ _: 'messageAnimatedEmoji', emoji: '🎉', animated_emoji: { sticker: null } }),
    ).toMatchObject({ kind: 'text', text: '🎉' })
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

  it('maps audio and video notes onto the existing media bubbles', () => {
    const audio = mapContent({
      _: 'messageAudio',
      audio: {
        _: 'audio',
        duration: 61,
        title: 'Song',
        performer: 'Band',
        file_name: 'song.mp3',
        mime_type: 'audio/mpeg',
        audio: { _: 'file', id: 7, size: 1024 },
      },
    })
    expect(audio.kind).toBe('file')
    expect(audio.text).toBe('Song · Band')
    expect(audio.media).toMatchObject({
      fileId: 7,
      fileName: 'song.mp3',
      mimeType: 'audio/mpeg',
      size: 1024,
    })

    const note = mapContent({
      _: 'messageVideoNote',
      video_note: {
        _: 'videoNote',
        duration: 4,
        length: 240,
        video: { _: 'file', id: 8 },
      },
    })
    expect(note.kind).toBe('video')
    expect(note.media).toMatchObject({ fileId: 8, duration: 4, width: 240, height: 240 })
  })

  it('keeps the facts of location, game, checklist, invoice, shared and paid media', () => {
    expect(
      mapContent({
        _: 'messageLocation',
        location: { latitude: 31.2304, longitude: 121.4737 },
      }),
    ).toMatchObject({ kind: 'text', text: '📍 31.23040, 121.47370' })

    expect(
      mapContent({
        _: 'messageLiveLocation',
        expires_in: 600,
        location: { latitude: 31.23, longitude: 121.47 },
      }).text,
    ).toBe('📍 实时位置 · 剩余 10 分钟\n31.23000, 121.47000')

    expect(
      mapContent({
        _: 'messageVenue',
        venue: {
          title: '外滩',
          address: '中山东一路',
          location: { latitude: 1, longitude: 2 },
        },
      }).text,
    ).toBe('📍 外滩\n中山东一路\n1.00000, 2.00000')

    expect(
      mapContent({ _: 'messageGame', game: { title: 'Chess', description: 'Play' } }).text,
    ).toBe('🎮 Chess\nPlay')

    expect(
      mapContent({
        _: 'messageChecklist',
        list: {
          title: { text: '购物' },
          tasks: [
            { text: { text: '牛奶' }, completion_date: 1 },
            { text: { text: '面包' }, completion_date: 0 },
          ],
        },
      }).text,
    ).toBe('☑ 购物\n☑ 牛奶\n☐ 面包')

    expect(mapContent({ _: 'messageInvoice', product_info: { title: 'Pro' } }).text).toBe('🧾 Pro')
    expect(
      mapContent({
        _: 'messageUsersShared',
        users: [{ first_name: 'Ada', last_name: 'Lovelace' }, { username: 'bob' }],
      }).text,
    ).toBe('[联系人] Ada Lovelace、@bob')
    expect(mapContent({ _: 'messageChatShared', chat: { title: 'Team' } }).text).toBe('[会话] Team')
    expect(
      mapContent({
        _: 'messagePaidMedia',
        star_count: 15,
        media: [{}, {}],
        caption: { text: '两张图' },
      }).text,
    ).toBe('[付费媒体] 2 项 · 15 颗 Star\n两张图')
    expect(mapContent({ _: 'messageStory' }).text).toBe('📖 转发的故事')
    expect(mapContent({ _: 'messageStakeDice', value: 4 }).text).toBe('🎲 4')
    expect(mapContent({ _: 'messageWidget', caption: { text: '预测' } }).text).toBe('[小组件] 预测')
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
    expect(previewContent({ _: 'messagePollOptionAdded' })).toBe('添加了投票选项')
    expect(previewContent({ _: 'messagePollOptionDeleted' })).toBe('删除了投票选项')
    expect(previewContent({ _: 'messageCall', is_video: true })).toBe('视频通话')
    expect(previewContent({ _: 'messageVideoChatEnded' })).toBe('群通话')
    expect(previewContent({ _: 'messageChatOwnerChanged' })).toBe('群主已变更')
    expect(previewContent({ _: 'messageChatHasProtectedContentToggled' })).toBe('禁止保存和转发')
    expect(previewContent({ _: 'messageExpiredPhoto' })).toBe('[图片已过期]')
    expect(previewContent({ _: 'messageExpiredVoiceNote' })).toBe('[语音已过期]')
    expect(previewContent({ _: 'messageChatJoinFromCommunity' })).toBe('通过社区加入群聊')
    expect(previewContent({ _: 'messageChatBoost' })).toBe('为群聊助力')
    expect(previewContent({ _: 'messageGameScore' })).toBe('游戏得分')
    expect(previewContent({ _: 'messageManagedBotCreated' })).toBe('创建了新机器人')
    expect(previewContent({ _: 'messageGiftedStars' })).toBe('赠送 Star')
    expect(previewContent({ _: 'messageProximityAlertTriggered' })).toBe('距离提醒')
    expect(previewContent({ _: 'messageLocation' })).toBe('[位置]')
    expect(previewContent({ _: 'messageAudio' })).toBe('[音频]')
    expect(previewContent({ _: 'messageChecklist' })).toBe('[清单]')
    expect(previewContent({ _: 'messagePaidMedia' })).toBe('[付费媒体]')
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
