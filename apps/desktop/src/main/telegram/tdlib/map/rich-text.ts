import type { RichFormatted } from '@wegram/protocol'

import type { TdObject } from '../client'
import { asArray } from '../json'
import { mapEntities } from './entities'

/** A crafted page can nest deeply; the renderer only needs a handful of levels. */
const MAX_DEPTH = 8

/* ---------- rich text -> formatted text ---------- */

/** Currency of the walk: text plus TDLib-style entities, mapped at the end. */
interface CollectedText {
  text: string
  entities: TdObject[]
}

/** Rich-text wrappers that have a plain-text entity equivalent. */
const WRAPPED_ENTITIES: Record<string, string> = {
  richTextBold: 'textEntityTypeBold',
  richTextItalic: 'textEntityTypeItalic',
  richTextUnderline: 'textEntityTypeUnderline',
  richTextStrikethrough: 'textEntityTypeStrikethrough',
  richTextSpoiler: 'textEntityTypeSpoiler',
  richTextFixed: 'textEntityTypeCode',
  richTextMention: 'textEntityTypeMention',
  richTextHashtag: 'textEntityTypeHashtag',
}

/**
 * One rich-text node as the protocol's formatted text.
 *
 * Unknown nodes are not guessed: a node that wraps another text is walked
 * through (the words survive, the styling does not), and a node with no text
 * at all is dropped.
 */
export function richText(node: TdObject | undefined): RichFormatted {
  const collected: CollectedText = { text: '', entities: [] }
  appendRichText(node, collected, 0)
  const entities = mapEntities(collected.entities)
  return { text: collected.text, ...(entities.length ? { entities } : {}) }
}

function appendRichText(node: TdObject | undefined, out: CollectedText, depth: number): void {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return
  switch (node._) {
    case 'richTexts': {
      const texts: TdObject[] = asArray(node.texts)
      for (const child of texts) appendRichText(child, out, depth + 1)
      return
    }
    case 'richTextPlain':
      out.text += typeof node.text === 'string' ? node.text : ''
      return
    case 'richTextCustomEmoji': {
      // The glyph is the alternative text; the animation itself is a sticker
      // file and stays out of scope (same gap as text entities).
      const alternative = typeof node.alternative_text === 'string' ? node.alternative_text : ''
      const start = out.text.length
      out.text += alternative
      if (alternative) {
        out.entities.push({
          offset: start,
          length: alternative.length,
          type: { _: 'textEntityTypeCustomEmoji', custom_emoji_id: node.custom_emoji_id },
        })
      }
      return
    }
    case 'richTextMathematicalExpression':
      out.text += typeof node.expression === 'string' ? node.expression : ''
      return
    default:
      break
  }

  const inner = node.text
  if (!inner || typeof inner !== 'object') return

  if (node._ === 'richTextUrl') {
    const start = out.text.length
    appendRichText(inner, out, depth + 1)
    out.entities.push({
      offset: start,
      length: out.text.length - start,
      type: { _: 'textEntityTypeTextUrl' },
      url: typeof node.url === 'string' ? node.url : '',
    })
    return
  }

  const entityType = WRAPPED_ENTITIES[String(node._)]
  if (!entityType) {
    appendRichText(inner, out, depth + 1)
    return
  }
  const start = out.text.length
  appendRichText(inner, out, depth + 1)
  const length = out.text.length - start
  if (length > 0) out.entities.push({ offset: start, length, type: { _: entityType } })
}
