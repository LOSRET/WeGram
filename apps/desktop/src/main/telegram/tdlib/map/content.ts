import type { Message, MessageEntity, RichBlock } from '@wegram/protocol'

import type { TdObject } from '../client'
import { mapEntities } from './entities'
import {
  documentMedia,
  mediaUrls,
  photoMedia,
  videoMedia,
  voiceMedia,
} from './media'
import { mapRichMessage, richPreview } from './rich'
import { mapStickerFormat } from './sticker'

// Re-exported on purpose: this is where message media has always been read from,
// and the shared readers now live in ./media so the rich mapper can use them too.
export { mediaUrls, pickLargest, pickSmallestAtLeast } from './media'

export function mapContent(content: TdObject): {
  kind: Message['kind']
  text: string
  entities: MessageEntity[]
  media?: Message['media']
  rich?: RichBlock[]
  contact?: Message['contact']
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
          ...mediaUrls(sticker.sticker, sticker.thumbnail?.file),
        },
      }
    }
    case 'messageVoiceNote': {
      return {
        kind: 'voice',
        text: content.caption?.text ?? '',
        entities: [],
        media: voiceMedia(content.voice_note),
      }
    }
    case 'messagePoll':
      return { kind: 'poll', text: content.poll?.question?.text ?? '', entities: [] }
    // Telegram's animated emoji: a message that is a single (usually animated)
    // emoji. Keep the glyph and let the renderer size it like WeChat big emoji.
    case 'messageAnimatedEmoji':
      return {
        kind: 'text',
        text: typeof content.emoji === 'string' ? content.emoji : '',
        entities: [],
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
    default:
      return { kind: 'service', text: '', entities: [] }
  }
}

/**
 * Human-readable text for a TDLib service message. TDLib itself ships no text
 * for these — the client must compose it (WeChat-style, Chinese).
 */
export async function serviceText(content: TdObject, ctx: ServiceTextContext): Promise<string> {
  const who = ctx.outgoing ? '你' : ctx.senderName
  const title = (value: unknown): string => (typeof value === 'string' && value ? value : '')
  switch (content._) {
    case 'messageBasicGroupChatCreate':
    case 'messageSupergroupChatCreate': {
      const name = title(content.title)
      return name ? `${who}创建了群聊「${name}」` : `${who}创建了群聊`
    }
    case 'messageChatUpgradeFrom':
    case 'messageChatUpgradeTo':
      return '群聊已升级为超级群组'
    case 'messageChatChangeTitle': {
      const name = title(content.title)
      return name ? `${who}修改群聊名称为「${name}」` : `${who}修改了群聊名称`
    }
    case 'messageChatChangePhoto':
      return `${who}修改了群聊头像`
    case 'messageChatDeletePhoto':
      return `${who}移除了群聊头像`
    case 'messageChatAddMembers': {
      const ids: number[] = Array.isArray(content.member_user_ids) ? content.member_user_ids : []
      const names = await Promise.all(ids.map((id) => ctx.resolveUserName(Number(id))))
      if (names.length === 0) return `${who}邀请了新成员加入群聊`
      return `${who}邀请${names.join('、')}加入了群聊`
    }
    case 'messageChatJoinByLink':
      return `${who}通过邀请链接加入了群聊`
    case 'messageChatJoinByRequest':
      return `${who}加入了群聊`
    case 'messageChatDeleteMember': {
      // The deleted member is the subject, not necessarily the sender.
      const name = await ctx.resolveUserName(Number(content.user_id))
      return `${name}退出了群聊`
    }
    case 'messagePinMessage':
      return `${who}置顶了一条消息`
    case 'messageScreenshotTaken':
      return `${who}对聊天进行了截图`
    case 'messageChatSetBackground':
      return `${who}修改了聊天背景`
    case 'messageChatSetTheme':
      return `${who}修改了聊天主题`
    case 'messageChatSetTtl':
      return `${who}修改了消息自动删除定时`
    case 'messageChatSetMessageAutoDeleteTime':
      return Number(content.message_auto_delete_time) > 0
        ? `${who}开启了消息自动删除`
        : `${who}关闭了消息自动删除`
    case 'messageForumTopicCreated': {
      const name = title(content.name)
      return name ? `${who}创建了话题「${name}」` : `${who}创建了话题`
    }
    case 'messageForumTopicEdited':
      return `${who}编辑了话题`
    case 'messageForumTopicIsClosedToggled':
      return content.is_closed ? `${who}关闭了话题` : `${who}重新打开了话题`
    case 'messageForumTopicIsHiddenToggled':
      return content.is_hidden ? `${who}隐藏了话题` : `${who}显示了话题`
    case 'messageContactRegistered':
      return `${who}加入了 Telegram`
    case 'messageSuggestProfilePhoto':
      return `${who}建议你使用新的头像`
    case 'messageCustomServiceAction':
      return typeof content.text === 'string' ? content.text : ''
    default:
      return ''
  }
}

/** TDLib content types that are service messages (centered transcript notices). */
export const SERVICE_CONTENT_TYPES = new Set([
  'messageBasicGroupChatCreate',
  'messageSupergroupChatCreate',
  'messageChatUpgradeFrom',
  'messageChatUpgradeTo',
  'messageChatChangeTitle',
  'messageChatChangePhoto',
  'messageChatDeletePhoto',
  'messageChatAddMembers',
  'messageChatJoinByLink',
  'messageChatJoinByRequest',
  'messageChatDeleteMember',
  'messagePinMessage',
  'messageScreenshotTaken',
  'messageChatSetBackground',
  'messageChatSetTheme',
  'messageChatSetTtl',
  'messageChatSetMessageAutoDeleteTime',
  'messageForumTopicCreated',
  'messageForumTopicEdited',
  'messageForumTopicIsClosedToggled',
  'messageForumTopicIsHiddenToggled',
  'messageContactRegistered',
  'messageSuggestProfilePhoto',
  'messageCustomServiceAction',
])

interface ServiceTextContext {
  senderName: string
  outgoing: boolean
  resolveUserName: (userId: number) => Promise<string>
}

function servicePreview(content: TdObject): string {
  switch (content._) {
    case 'messageBasicGroupChatCreate':
    case 'messageSupergroupChatCreate':
      return '创建群聊'
    case 'messageChatChangeTitle':
      return '修改群聊名称'
    case 'messageChatChangePhoto':
      return '修改群聊头像'
    case 'messageChatDeletePhoto':
      return '移除群聊头像'
    case 'messageChatAddMembers':
    case 'messageChatJoinByLink':
    case 'messageChatJoinByRequest':
      return '加入群聊'
    case 'messageChatDeleteMember':
      return '退出群聊'
    case 'messagePinMessage':
      return '置顶了一条消息'
    case 'messageScreenshotTaken':
      return '对聊天进行了截图'
    case 'messageContactRegistered':
      return '加入了 Telegram'
    case 'messageCustomServiceAction':
      return typeof content.text === 'string' ? content.text : ''
    default:
      return ''
  }
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
