import type { MessageEntity } from '@wegram/protocol'

import type { TdObject } from '../client'

const ENTITY_TYPES: Record<string, MessageEntity['type']> = {
  textEntityTypeBold: 'bold',
  textEntityTypeItalic: 'italic',
  textEntityTypeUnderline: 'underline',
  textEntityTypeStrikethrough: 'strikethrough',
  textEntityTypeCode: 'code',
  textEntityTypePre: 'pre',
  textEntityTypePreCode: 'pre',
  textEntityTypeUrl: 'url',
  textEntityTypeTextUrl: 'textUrl',
  textEntityTypeMention: 'mention',
  textEntityTypeHashtag: 'hashtag',
  textEntityTypeSpoiler: 'spoiler',
  textEntityTypeCustomEmoji: 'customEmoji',
}

/** TDLib entity types we render; unknown ones are dropped, not guessed. */
export function mapEntities(rawEntities: TdObject[] | undefined): MessageEntity[] {
  if (!Array.isArray(rawEntities)) return []
  const result: MessageEntity[] = []
  for (const raw of rawEntities) {
    const type = ENTITY_TYPES[raw?.type?._]
    if (!type) continue
    result.push({
      type,
      offset: raw.offset ?? 0,
      length: raw.length ?? 0,
      ...(raw.url ? { url: raw.url } : {}),
      ...(raw.language ? { language: raw.language } : {}),
      // TDLib int64: keep it as the string tdl hands over, or the id rounds.
      ...(raw.type?.custom_emoji_id ? { customEmojiId: String(raw.type.custom_emoji_id) } : {}),
    })
  }
  return result
}
