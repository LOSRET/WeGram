import type { Message } from '@wegram/protocol'

/**
 * Which edit path a transcript row has, if any.
 *
 * TDLib's `messageProperties.can_be_edited` covers three calls, and this client
 * implements two of them: `editMessageText` for a text row and
 * `editMessageCaption` for the media kinds whose content carries a caption.
 * The flag alone is not enough to offer 编辑 — a poll is "editable" for TDLib
 * (stop it) and a sticker's emoji is not a caption — so the row's kind decides
 * the label and the channel. Returns null when this client cannot edit the row
 * at all.
 */
export type EditTarget = 'text' | 'caption'

/**
 * The kinds whose TDLib content carries a caption: photo, video (an animation is
 * a video to us), document and voice note. A sticker's emoji and a rich page's
 * blocks are edited by other calls that are not implemented.
 */
const CAPTION_KINDS: ReadonlySet<Message['kind']> = new Set<Message['kind']>([
  'photo',
  'video',
  'file',
  'voice',
])

export function editTargetOf(message: Message): EditTarget | null {
  if (message.kind === 'text') return 'text'
  if (CAPTION_KINDS.has(message.kind) && message.media) return 'caption'
  return null
}

/** The menu's word for each path: a caption is 说明 in WeChat's vocabulary. */
export function editLabel(target: EditTarget): string {
  return target === 'caption' ? '编辑说明' : '编辑'
}
