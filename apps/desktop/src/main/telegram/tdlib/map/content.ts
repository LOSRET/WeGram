import type { Message, MessageEntity, Poll, RichBlock } from '@wegram/protocol'

import type { TdObject } from '../client'
import { asArray } from '../json'
import { mapEntities } from './entities'
import { documentMedia, mediaFileUrl, mediaUrls, photoMedia, videoMedia, voiceMedia } from './media'
import { mapPoll } from './poll'
import { mapRichMessage, richPreview } from './rich'
import { servicePreview } from './service'
import { mapStickerFormat } from './sticker'

/**
 * 语音转文字 (TDLib `SpeechRecognitionResult`). The result hangs off the voice note
 * itself, so a finished transcript arrives as a content update and reaches the
 * row through the ordinary `replace` op — no extra event or request.
 *
 * `pending` keeps the partial text the server has produced so far: showing words
 * as they land is what makes the button feel alive while the rest is transcribed.
 */
function mapTranscription(result: TdObject | undefined): Message['transcription'] {
  switch (result?._) {
    case 'speechRecognitionResultPending': {
      const partial = typeof result.partial_text === 'string' ? result.partial_text : ''
      return { status: 'pending', ...(partial ? { text: partial } : {}) }
    }
    case 'speechRecognitionResultText': {
      const text = typeof result.text === 'string' ? result.text : ''
      return text ? { status: 'done', text } : undefined
    }
    case 'speechRecognitionResultError': {
      const reason = result.error?.message
      return {
        status: 'error',
        ...(typeof reason === 'string' && reason ? { error: reason } : {}),
      }
    }
    default:
      return undefined
  }
}

// Re-exported on purpose: this is where message media has always been read from,
// and the shared readers now live in ./media so the rich mapper can use them too.
export { mediaUrls, pickLargest, pickSmallestAtLeast } from './media'

export function mapContent(content: TdObject): {
  kind: Message['kind']
  text: string
  entities: MessageEntity[]
  transcription?: Message['transcription']
  media?: Message['media']
  rich?: RichBlock[]
  contact?: Message['contact']
  poll?: Poll
} {
  switch (content._) {
    case 'messageText': {
      const formatted = content.text ?? {}
      return {
        kind: 'text',
        text: formatted.text ?? '',
        entities: mapEntities(formatted.entities),
      }
    }
    case 'messagePhoto': {
      return {
        kind: 'photo',
        text: content.caption?.text ?? '',
        entities: mapEntities(content.caption?.entities),
        media: photoMedia(content.photo),
      }
    }
    case 'messageVideo': {
      return {
        kind: 'video',
        text: content.caption?.text ?? '',
        entities: mapEntities(content.caption?.entities),
        media: videoMedia(content.video, 'video'),
      }
    }
    case 'messageAnimation': {
      // GIF-style messages are videos to us: Chromium plays the MP4 natively.
      return {
        kind: 'video',
        text: content.caption?.text ?? '',
        entities: mapEntities(content.caption?.entities),
        media: videoMedia(content.animation, 'animation'),
      }
    }
    case 'messageDocument': {
      return {
        kind: 'file',
        text: content.caption?.text ?? '',
        entities: mapEntities(content.caption?.entities),
        media: documentMedia(content.document),
      }
    }
    case 'messageSticker': {
      const sticker = content.sticker ?? {}
      // A Telegram Premium sticker ships a second TGS — the effect Telegram plays
      // over the sticker (TDLib `stickerFullTypeRegular.premium_animation`).
      // `is_premium` is the message's "play it" flag, and it can stand while the
      // effect file is still unknown, so both must agree before it travels.
      const effect = content.is_premium === true ? sticker.full_type?.premium_animation : undefined
      const effectFileId = Number(effect?.id ?? 0)
      const effectUrl = mediaFileUrl(effect)
      return {
        kind: 'sticker',
        text: '',
        entities: [],
        media: {
          fileId: sticker.sticker?.id ?? 0,
          ...(sticker.thumbnail?.file?.id ? { thumbFileId: sticker.thumbnail.file.id } : {}),
          stickerFormat: mapStickerFormat(sticker.format?._),
          ...(sticker.emoji ? { stickerEmoji: sticker.emoji } : {}),
          ...(sticker.width ? { width: sticker.width } : {}),
          ...(sticker.height ? { height: sticker.height } : {}),
          ...(effectFileId > 0
            ? {
                premiumEffectFileId: effectFileId,
                ...(effectUrl ? { premiumEffectUrl: effectUrl } : {}),
              }
            : {}),
          ...mediaUrls(sticker.sticker, sticker.thumbnail?.file),
        },
      }
    }
    case 'messageVoiceNote': {
      const transcription = mapTranscription(content.voice_note?.speech_recognition_result)
      return {
        kind: 'voice',
        text: content.caption?.text ?? '',
        entities: [],
        media: voiceMedia(content.voice_note),
        ...(transcription ? { transcription } : {}),
      }
    }
    case 'messagePoll': {
      // The question stays `text` for previews and quotes; the card itself is
      // the mapped poll (design doc §9.10).
      const poll = mapPoll(content)
      return {
        kind: 'poll',
        text: content.poll?.question?.text ?? '',
        entities: [],
        ...(poll ? { poll } : {}),
      }
    }
    // Telegram's animated emoji: a message that is exactly one emoji. TDLib has
    // already resolved the "AnimatedEmoji" sticker for it, so the body is that
    // sticker (TGS / WebM / WebP) and the glyph only remains the text — previews,
    // quotes and 复制 need it. A custom emoji whose sticker TDLib does not know
    // yet carries no file: keep the glyph, and the renderer sizes it like a big
    // emoji until the sticker arrives (`updateMessageContent` remaps the row).
    case 'messageAnimatedEmoji': {
      const emoji = typeof content.emoji === 'string' ? content.emoji : ''
      const animated = content.animated_emoji ?? {}
      const sticker = animated.sticker ?? {}
      const fileId = Number(sticker.sticker?.id ?? 0)
      if (!fileId) return { kind: 'text', text: emoji, entities: [] }
      // `sticker_*` is the real artwork; the `animatedEmoji` dimensions are the
      // expected box TDLib reports while the sticker is still unknown.
      const width = Number(sticker.width) || Number(animated.sticker_width) || 0
      const height = Number(sticker.height) || Number(animated.sticker_height) || 0
      return {
        kind: 'emoji',
        text: emoji,
        entities: [],
        media: {
          fileId,
          ...(sticker.thumbnail?.file?.id
            ? { thumbFileId: Number(sticker.thumbnail.file.id) }
            : {}),
          stickerFormat: mapStickerFormat(sticker.format?._),
          ...(emoji ? { stickerEmoji: emoji } : {}),
          ...(width ? { width } : {}),
          ...(height ? { height } : {}),
          ...(animated.sound?.id ? { soundFileId: Number(animated.sound.id) } : {}),
          ...mediaUrls(sticker.sticker, sticker.thumbnail?.file),
        },
      }
    }
    // Dice / basketball etc. carry their emoji; the thrown value is a TDLib
    // update, not part of the message, so we show the emoji itself.
    case 'messageDice':
      return {
        kind: 'text',
        text: typeof content.emoji === 'string' ? content.emoji : '',
        entities: [],
      }
    // A vCard: Telegram sends the card, the client draws it. The words travel
    // as `text` so previews and quotes have something to show.
    case 'messageContact': {
      const card = content.contact ?? {}
      const first = typeof card.first_name === 'string' ? card.first_name : ''
      const last = typeof card.last_name === 'string' ? card.last_name : ''
      const userId = Number(card.user_id ?? 0)
      return {
        kind: 'contact',
        text: [first, last].filter(Boolean).join(' '),
        entities: [],
        contact: {
          firstName: first || '未知',
          ...(last ? { lastName: last } : {}),
          phone: typeof card.phone_number === 'string' ? card.phone_number : '',
          ...(userId ? { userId } : {}),
        },
      }
    }
    // A page of blocks (headings, lists, tables, media) — Telegram's rich
    // message. `text` keeps the flattened words so previews and quotes work.
    case 'messageRichMessage': {
      const rich = mapRichMessage(content.message)
      return { kind: 'rich', text: rich.text, entities: [], rich: rich.blocks }
    }
    // An audio file is a document with a title and a performer: the file bubble
    // downloads it, and its caption carries what the file name often does not.
    case 'messageAudio': {
      const audio = content.audio ?? {}
      const title = typeof audio.title === 'string' ? audio.title : ''
      const performer = typeof audio.performer === 'string' ? audio.performer : ''
      return {
        kind: 'file',
        text: [title, performer].filter(Boolean).join(' · '),
        entities: [],
        media: documentMedia(audio),
      }
    }
    // A round video note is a square MP4 in TDLib, so the existing video bubble
    // and viewer draw and play it unchanged.
    case 'messageVideoNote': {
      const note = content.video_note ?? {}
      const file = note.video
      const length = Number(note.length) || 0
      return {
        kind: 'video',
        text: '',
        entities: [],
        media: {
          fileId: Number(file?.id ?? 0),
          ...(note.thumbnail?.file?.id ? { thumbFileId: Number(note.thumbnail.file.id) } : {}),
          ...(note.duration ? { duration: Number(note.duration) } : {}),
          ...(length ? { width: length, height: length } : {}),
          ...mediaUrls(file, note.thumbnail?.file),
        },
      }
    }
    // No map tiles, story viewer, payment flow or HTML-widget renderer yet: these
    // keep the row and its facts in a text bubble instead of dropping the message
    // into the "unsupported" fallback.
    case 'messageLocation': {
      const point = pointOf(content.location)
      return { kind: 'text', text: point ? `📍 ${point}` : '📍 位置', entities: [] }
    }
    case 'messageLiveLocation': {
      const point = pointOf(content.location)
      const minutes = Math.ceil((Number(content.expires_in) || 0) / 60)
      const head = minutes > 0 ? `📍 实时位置 · 剩余 ${minutes} 分钟` : '📍 实时位置'
      return { kind: 'text', text: [head, point].filter(Boolean).join('\n'), entities: [] }
    }
    case 'messageVenue': {
      const venue = content.venue ?? {}
      const title = typeof venue.title === 'string' ? venue.title : ''
      const address = typeof venue.address === 'string' ? venue.address : ''
      return {
        kind: 'text',
        text: [`📍 ${title || '位置'}`, address, pointOf(venue.location)]
          .filter(Boolean)
          .join('\n'),
        entities: [],
      }
    }
    case 'messageGame': {
      const game = content.game ?? {}
      const title = typeof game.title === 'string' ? game.title : ''
      const description = typeof game.description === 'string' ? game.description : ''
      return {
        kind: 'text',
        text: [`🎮 ${title || '游戏'}`, description].filter(Boolean).join('\n'),
        entities: [],
      }
    }
    case 'messageStakeDice': {
      const value = Number(content.value) || 0
      return { kind: 'text', text: value > 0 ? `🎲 ${value}` : '🎲', entities: [] }
    }
    case 'messageStory':
      return { kind: 'text', text: '📖 转发的故事', entities: [] }
    case 'messageWidget': {
      const caption = content.caption?.text ?? ''
      return {
        kind: 'text',
        text: caption ? `[小组件] ${caption}` : '[小组件]',
        entities: [],
      }
    }
    case 'messageChecklist': {
      const list = content.list ?? {}
      const title = typeof list.title?.text === 'string' ? list.title.text : ''
      const tasks = asArray<TdObject>(list.tasks)
      const lines = tasks
        .slice(0, 6)
        .map((task) =>
          `${Number(task?.completion_date) > 0 ? '☑' : '☐'} ${task?.text?.text ?? ''}`.trim(),
        )
      const more = tasks.length > 6 ? `… 共 ${tasks.length} 项` : ''
      return {
        kind: 'text',
        text: [`☑ ${title || '清单'}`, ...lines, more].filter(Boolean).join('\n'),
        entities: [],
      }
    }
    case 'messageInvoice': {
      const product = content.product_info ?? {}
      const title = typeof product.title === 'string' ? product.title : ''
      return { kind: 'text', text: `🧾 ${title || '账单'}`, entities: [] }
    }
    case 'messageUsersShared': {
      const users = asArray<TdObject>(content.users)
      const names = users.map(sharedUserName).filter(Boolean)
      return {
        kind: 'text',
        text: `[联系人] ${names.join('、') || `${users.length} 位联系人`}`,
        entities: [],
      }
    }
    case 'messageChatShared': {
      const shared = content.chat ?? {}
      return { kind: 'text', text: `[会话] ${sharedChatName(shared)}`, entities: [] }
    }
    case 'messagePaidMedia': {
      const items = asArray<TdObject>(content.media)
      const caption = content.caption?.text ?? ''
      const stars = Number(content.star_count) || 0
      const head = `[付费媒体] ${items.length} 项${stars > 0 ? ` · ${stars} 颗 Star` : ''}`
      return { kind: 'text', text: [head, caption].filter(Boolean).join('\n'), entities: [] }
    }
    default:
      return { kind: 'service', text: '', entities: [] }
  }
}

/** `31.23042, 121.47370`; empty when TDLib sent no usable point. */
function pointOf(value: TdObject | undefined): string {
  const latitude = Number(value?.latitude)
  const longitude = Number(value?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return ''
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
}

function sharedUserName(user: TdObject | undefined): string {
  const name = [user?.first_name, user?.last_name]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ')
  if (name) return name
  return typeof user?.username === 'string' && user.username ? `@${user.username}` : ''
}

function sharedChatName(chat: TdObject): string {
  if (typeof chat.title === 'string' && chat.title) return chat.title
  if (typeof chat.username === 'string' && chat.username) return `@${chat.username}`
  return '会话'
}

export function previewContent(content: TdObject | undefined): string {
  if (!content) return ''
  return extractText(content) ?? (mapContentLabel(content) || servicePreview(content))
}

function mapContentLabel(content: TdObject | undefined): string {
  switch (content?._) {
    case 'messagePhoto':
      return '[图片]'
    case 'messageVideo':
      return '[视频]'
    case 'messageSticker':
      return '[贴纸]'
    case 'messageAnimatedEmoji':
      // One emoji is the whole message, so the list shows the emoji itself.
      return typeof content.emoji === 'string' ? content.emoji : ''
    case 'messageVoiceNote':
      return '[语音]'
    case 'messageDocument':
      return '[文件]'
    case 'messagePoll':
      return '[投票]'
    case 'messageRichMessage':
      return richPreview(content.message) || '[图文消息]'
    case 'messageContact': {
      const name = [content.contact?.first_name, content.contact?.last_name]
        .filter(Boolean)
        .join(' ')
      return name ? `[名片] ${name}` : '[名片]'
    }
    case 'messageAudio':
      return '[音频]'
    case 'messageVideoNote':
      return '[视频消息]'
    case 'messageLocation':
    case 'messageVenue':
      return '[位置]'
    case 'messageLiveLocation':
      return '[实时位置]'
    case 'messageGame':
      return '[游戏]'
    case 'messageStakeDice':
      return '[骰子]'
    case 'messageStory':
      return '[故事]'
    case 'messageWidget':
      return '[小组件]'
    case 'messageChecklist':
      return '[清单]'
    case 'messageInvoice':
      return '[账单]'
    case 'messageUsersShared':
      return '[联系人]'
    case 'messageChatShared':
      return '[会话]'
    case 'messagePaidMedia':
      return '[付费媒体]'
    default:
      return ''
  }
}

/**
 * Spoiler ranges of `previewContent`'s string, so the chat row can draw the same
 * block the transcript draws instead of leaking the hidden words.
 *
 * Only a flat text/caption preview can carry entities: a label like `[图片]` or a
 * service line has no spoiler in it, and a rich page's preview is assembled from
 * several runs, so its offsets would not line up — both return no ranges.
 */
export function previewSpoilers(content: TdObject | undefined): [number, number][] {
  const formatted = formattedOf(content)
  if (!formatted || !Array.isArray(formatted.entities)) return []
  const text: string = formatted.text
  const ranges: [number, number][] = []
  for (const entity of formatted.entities) {
    if (entity?.type?._ !== 'textEntityTypeSpoiler') continue
    // TDLib offsets are UTF-16 code units, exactly like JS string indices.
    const start = Number(entity.offset)
    const end = start + Number(entity.length)
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue
    if (start < 0 || end <= start || end > text.length) continue
    ranges.push([start, end])
  }
  return ranges
}

function formattedOf(content: TdObject | undefined): TdObject | undefined {
  const formatted = content?.text ?? content?.caption
  return formatted && typeof formatted.text === 'string' ? formatted : undefined
}

function extractText(content: TdObject | undefined): string | undefined {
  return formattedOf(content)?.text
}
