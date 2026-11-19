import type { MessageEntity } from '@wegram/protocol'
import { Fragment, useState, type ReactNode } from 'react'

import { segmentText, type EntityAttributes } from '../lib/entities'

interface RichTextProps {
  text: string
  entities?: MessageEntity[] | undefined
}

/**
 * Renders TL entities (design doc §8.3). Entities are flat offset/length pairs;
 * `segmentText` turns them into pieces that know every entity covering them, and
 * each piece is wrapped inside-out in a fixed order so nesting is stable.
 */
export function RichText({ text, entities }: RichTextProps) {
  const segments = segmentText(text, entities)
  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={index}>{wrapSegment(segment.text, segment.entities)}</Fragment>
      ))}
    </>
  )
}

/** Inner → outer. Links must be outermost so bold text inside a link stays clickable. */
const WRAP_ORDER: Array<MessageEntity['type']> = [
  'customEmoji',
  'code',
  'pre',
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'spoiler',
  'mention',
  'hashtag',
  'url',
  'textUrl',
]

function wrapSegment(text: string, entities: EntityAttributes[]): ReactNode {
  let node: ReactNode = text
  const ordered = [...entities].sort(
    (a, b) => WRAP_ORDER.indexOf(a.type) - WRAP_ORDER.indexOf(b.type),
  )
  for (const entity of ordered) node = wrap(entity, node)
  return node
}

function wrap(entity: EntityAttributes, children: ReactNode): ReactNode {
  switch (entity.type) {
    case 'bold':
      return <strong>{children}</strong>
    case 'italic':
      return <em>{children}</em>
    case 'underline':
      return <u>{children}</u>
    case 'strikethrough':
      return <s>{children}</s>
    case 'code':
      return <code className="wx-code">{children}</code>
    case 'pre':
      return <pre className="wx-pre">{children}</pre>
    case 'spoiler':
      return <Spoiler>{children}</Spoiler>
    case 'customEmoji':
      // The covered text is the base emoji glyph; rendering the actual sticker
      // needs `getCustomEmojiStickers` and is still a gap (see HANDOFF).
      return <span className="wx-inline-emoji">{children}</span>
    case 'mention':
    case 'hashtag':
      return <span className="wx-entity-mention">{children}</span>
    case 'url':
    case 'textUrl': {
      const href = safeHref(entity.url ?? (entity.type === 'url' ? String(children) : undefined))
      if (!href) return <span>{children}</span>
      return (
        <a className="wx-link" href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      )
    }
    default:
      return <span>{children}</span>
  }
}

/** Only real web/telegram links leave the app (§8.3). */
export function safeHref(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    return ['http:', 'https:', 'tg:', 'mailto:'].includes(parsed.protocol) ? url : undefined
  } catch {
    return undefined
  }
}

function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <span
      className={`wx-spoiler${revealed ? ' wx-spoiler--revealed' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => setRevealed(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') setRevealed(true)
      }}
    >
      {children}
    </span>
  )
}
