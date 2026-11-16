import type { MessageEntity } from '@wechatgram/protocol'

export interface EntityAttributes {
  type: MessageEntity['type']
  url?: string
  language?: string
  customEmojiId?: number
}

export interface TextSegment {
  text: string
  entities: EntityAttributes[]
}

/**
 * Splits message text into flat segments that carry every entity covering them.
 *
 * TL entities are offset/length pairs in **UTF-16 code units** (§8.3), which is
 * exactly what `String.prototype.slice` uses, so no code-point arithmetic is
 * needed. Nested and partially overlapping entities both fall out of the
 * boundary walk — no regex substitution, which would break on emoji offsets.
 */
export function segmentText(text: string, entities: MessageEntity[] | undefined): TextSegment[] {
  if (!text) return []
  if (!entities?.length) return [{ text, entities: [] }]

  const length = text.length
  const valid = entities
    .map((entity) => ({
      ...entity,
      offset: Math.max(0, Math.min(entity.offset, length)),
      length: Math.max(0, Math.min(entity.length, length - Math.max(0, entity.offset))),
    }))
    .filter((entity) => entity.length > 0)

  if (valid.length === 0) return [{ text, entities: [] }]

  const boundaries = new Set<number>([0, length])
  for (const entity of valid) {
    boundaries.add(entity.offset)
    boundaries.add(entity.offset + entity.length)
  }
  const points = [...boundaries].sort((a, b) => a - b)

  const segments: TextSegment[] = []
  let previousKey: string | null = null
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!
    const end = points[index + 1]!
    if (end <= start) continue
    const active = valid
      .filter((entity) => entity.offset <= start && entity.offset + entity.length >= end)
      .map<EntityAttributes>((entity) => ({
        type: entity.type,
        ...(entity.url ? { url: entity.url } : {}),
        ...(entity.language ? { language: entity.language } : {}),
        ...(entity.customEmojiId ? { customEmojiId: entity.customEmojiId } : {}),
      }))
      .sort((a, b) => a.type.localeCompare(b.type))

    const key = active.map((entity) => `${entity.type}:${entity.url ?? ''}`).join('|')
    const piece = text.slice(start, end)
    const last = segments[segments.length - 1]
    if (last && key === previousKey) last.text += piece
    else segments.push({ text: piece, entities: active })
    previousKey = key
  }

  return segments
}
