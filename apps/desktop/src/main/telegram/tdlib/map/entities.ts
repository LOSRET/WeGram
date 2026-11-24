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
  textEntityTypeMentionName: 'mentionName',
  textEntityTypeHashtag: 'hashtag',
  textEntityTypeSpoiler: 'spoiler',
  textEntityTypeCustomEmoji: 'customEmoji',
  // `/command`: the transcript makes it clickable, like a mention (§8.3).
  textEntityTypeBotCommand: 'botCommand',
}

/** TDLib entity types we render; unknown ones are dropped, not guessed. */
export function mapEntities(rawEntities: TdObject[] | undefined): MessageEntity[] {
  if (!Array.isArray(rawEntities)) return []
  const result: MessageEntity[] = []
  for (const raw of rawEntities) {
    const kind = raw?.type
    const type = ENTITY_TYPES[kind?._]
    if (!type) continue
    // A mention by id (`entityMentionName`) only carries the user, and a bad id is
    // dropped rather than rounded into somebody else.
    const mentionUserId =
      kind?._ === 'textEntityTypeMentionName' ? Number(kind.user_id) : Number.NaN
    result.push({
      type,
      offset: raw.offset ?? 0,
      length: raw.length ?? 0,
      // TDLib keeps a text entity's own parameters **inside its type object**:
      // `textEntityTypeTextUrl { url }`, `textEntityTypePreCode { language }`,
      // `textEntityTypeMentionName { user_id }`. Reading `raw.url` made every
      // "text shown instead of a raw URL" a dead span — the words rendered, the
      // click did nothing — because the entity arrived without its target.
      ...(typeof kind?.url === 'string' && kind.url ? { url: kind.url } : {}),
      ...(typeof kind?.language === 'string' && kind.language ? { language: kind.language } : {}),
      ...(Number.isSafeInteger(mentionUserId) && mentionUserId > 0
        ? { userId: mentionUserId }
        : {}),
      // TDLib int64: keep it as the string tdl hands over, or the id rounds.
      ...(kind?.custom_emoji_id ? { customEmojiId: String(kind.custom_emoji_id) } : {}),
    })
  }
  return result
}
