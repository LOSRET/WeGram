import { CAPTION_MESSAGE_KINDS } from '@wegram/protocol'
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

export function editTargetOf(message: Message): EditTarget | null {
  if (message.kind === 'text') return 'text'
  if (CAPTION_MESSAGE_KINDS.has(message.kind) && message.media) return 'caption'
  return null
}

/** The menu's word for each path: a caption is 说明 in WeChat's vocabulary. */
export function editLabel(target: EditTarget): string {
  return target === 'caption' ? '编辑说明' : '编辑'
}
