import type { Message, MessageEntity } from '@wegram/protocol'

import { registerMediaFile } from '../../../media/registry'
import type { TdObject } from '../client'
import { mapEntities } from './entities'
import { mapStickerFormat } from './sticker'

export function mapContent(content: TdObject): {
  kind: Message['kind']
  text: string
  entities: MessageEntity[]
  media?: Message['media']
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
      const photo = content.photo ?? {}
      const sizes: TdObject[] = Array.isArray(photo.sizes) ? photo.sizes : []
      const display = pickLargest(sizes)
      // A small variant doubles as the bubble placeholder until the full file lands.
      const thumb = pickSmallestAtLeast(sizes, 160) ?? pickLargest(sizes)
      return {
        kind: 'photo',
        text: content.caption?.text ?? '',
        entities: mapEntities(content.caption?.entities),
        media: {
          fileId: display?.photo?.id ?? 0,
          ...(thumb && thumb !== display ? { thumbFileId: thumb.photo?.id } : {}),
          ...(display?.width ? { width: display.width } : {}),
          ...(display?.height ? { height: display.height } : {}),
          ...(photo.minithumbnail?.data ? { minithumbnail: photo.minithumbnail.data } : {}),
          ...mediaUrls(display?.photo, thumb?.photo),
        },
      }
    }
    case 'messageVideo': {
      const video = content.video ?? {}
      return {
        kind: 'video',
        text: content.caption?.text ?? '',
        entities: mapEntities(content.caption?.entities),
        media: {
          fileId: video.video?.id ?? 0,
          ...(video.thumbnail?.file?.id ? { thumbFileId: video.thumbnail.file.id } : {}),
          ...(video.duration ? { duration: video.duration } : {}),
          ...(video.width ? { width: video.width } : {}),
          ...(video.height ? { height: video.height } : {}),
          ...(video.file_name ? { fileName: video.file_name } : {}),
          ...(video.mime_type ? { mimeType: video.mime_type } : {}),
          ...(video.minithumbnail?.data ? { minithumbnail: video.minithumbnail.data } : {}),
          ...mediaUrls(video.video, video.thumbnail?.file),
        },
      }
    }
    case 'messageAnimation': {
      // GIF-style messages are videos to us: Chromium plays the MP4 natively.
      const animation = content.animation ?? {}
      return {
        kind: 'video',
        text: content.caption?.text ?? '',
        entities: mapEntities(content.caption?.entities),
        media: {
          fileId: animation.animation?.id ?? 0,
          ...(animation.thumbnail?.file?.id ? { thumbFileId: animation.thumbnail.file.id } : {}),
          ...(animation.duration ? { duration: animation.duration } : {}),
          ...(animation.width ? { width: animation.width } : {}),
          ...(animation.height ? { height: animation.height } : {}),
          ...(animation.file_name ? { fileName: animation.file_name } : {}),
          ...(animation.mime_type ? { mimeType: animation.mime_type } : {}),
          ...mediaUrls(animation.animation, animation.thumbnail?.file),
        },
      }
    }
    case 'messageDocument': {
      const document = content.document ?? {}
      return {
        kind: 'file',
        text: content.caption?.text ?? '',
        entities: mapEntities(content.caption?.entities),
        media: {
          fileId: document.document?.id ?? 0,
          ...(document.thumbnail?.file?.id ? { thumbFileId: document.thumbnail.file.id } : {}),
          ...(document.file_name ? { fileName: document.file_name } : {}),
          ...(document.document?.size ? { size: document.document.size } : {}),
          ...(document.mime_type ? { mimeType: document.mime_type } : {}),
          ...(document.minithumbnail?.data ? { minithumbnail: document.minithumbnail.data } : {}),
          ...mediaUrls(document.document, document.thumbnail?.file),
        },
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
      const voice = content.voice_note ?? {}
      return {
        kind: 'voice',
        text: content.caption?.text ?? '',
        entities: [],
        media: {
          fileId: voice.voice?.id ?? 0,
          mimeType: voice.mime_type ?? 'audio/ogg',
          ...(voice.duration ? { duration: voice.duration } : {}),
          ...mediaUrls(voice.voice),
        },
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
    default:
      return ''
  }
}

function extractText(content: TdObject | undefined): string | undefined {
  const formatted = content?.text ?? content?.caption
  if (formatted && typeof formatted.text === 'string') return formatted.text
  return undefined
}

/** Local URLs for an already-downloaded file (and optional thumbnail). */
export function mediaUrls(
  file: TdObject | undefined,
  thumb?: TdObject | undefined,
): { localUrl?: string; thumbUrl?: string } {
  const localUrl = localUrlOf(file)
  const thumbUrl = localUrlOf(thumb)
  return {
    ...(localUrl ? { localUrl } : {}),
    ...(thumbUrl ? { thumbUrl } : {}),
  }
}

function localUrlOf(file: TdObject | undefined): string | undefined {
  const local = file?.local
  if (!local?.is_downloading_completed) return undefined
  if (typeof local.path !== 'string' || local.path.length === 0) return undefined
  return registerMediaFile(local.path)
}

export function pickLargest(sizes: TdObject[]): TdObject | undefined {
  return sizes.reduce<TdObject | undefined>((best, size) => {
    if (!best) return size
    const area = (size.width ?? 0) * (size.height ?? 0)
    const bestArea = (best.width ?? 0) * (best.height ?? 0)
    return area > bestArea ? size : best
  }, undefined)
}

export function pickSmallestAtLeast(sizes: TdObject[], minWidth: number): TdObject | undefined {
  return [...sizes]
    .filter((size) => (size.width ?? 0) >= minWidth)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0]
}
