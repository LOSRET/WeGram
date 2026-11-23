import type { MessageEntity } from '@wegram/protocol'
import { Fragment, useState, type ReactNode } from 'react'

import { segmentText, type EntityAttributes } from '../lib/entities'
import { mentionTarget, type MentionTarget } from '../lib/mention'
import { openMention } from '../lib/openMention'
import { CustomEmoji } from './CustomEmoji'
import { TelegramLink } from './TelegramLink'

interface RichTextProps {
  text: string
  entities?: MessageEntity[] | undefined
  /**
   * Where a mention leads. The transcript keeps the default (`openMention`); the
   * expression picker closes itself first, so the panel does not keep floating
   * over the conversation one of its titles just opened.
   */
  onMention?: (target: MentionTarget) => void
}

/**
 * Renders TL entities (design doc §8.3). Entities are flat offset/length pairs;
 * `segmentText` turns them into pieces that know every entity covering them, and
 * each piece is wrapped inside-out in a fixed order so nesting is stable.
 */
export function RichText({ text, entities, onMention }: RichTextProps) {
  const segments = segmentText(text, entities)
  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {wrapSegment(text, segment.text, segment.entities, onMention)}
        </Fragment>
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
  'mentionName',
  'hashtag',
  'url',
  'textUrl',
]

function wrapSegment(
  fullText: string,
  text: string,
  entities: EntityAttributes[],
  onMention: ((target: MentionTarget) => void) | undefined,
): ReactNode {
  let node: ReactNode = text
  const ordered = [...entities].sort(
    (a, b) => WRAP_ORDER.indexOf(a.type) - WRAP_ORDER.indexOf(b.type),
  )
  for (const entity of ordered) node = wrap(entity, node, fullText, onMention)
  return node
}

function wrap(
  entity: EntityAttributes,
  children: ReactNode,
  fullText: string,
  onMention: ((target: MentionTarget) => void) | undefined,
): ReactNode {
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
      // The covered text is the base emoji glyph. Telegram Premium draws the
      // emoji's sticker art in its place; the glyph is the fallback.
      return entity.customEmojiId === undefined ? (
        <span className="wx-inline-emoji">{children}</span>
      ) : (
        <CustomEmoji id={entity.customEmojiId} glyph={String(children)} />
      )
    case 'mention':
    case 'mentionName': {
      // The entity's own range, not the segment's: another entity (bold inside a
      // mention) splits the segment without changing what the name is.
      const covered = fullText.slice(entity.offset, entity.offset + entity.length)
      const target = mentionTarget(covered, entity)
      if (!target) return <span className="wx-entity-mention">{children}</span>
      const open = onMention ?? openMention
      return (
        <span
          className="wx-entity-mention wx-entity-mention--link"
          role="button"
          tabIndex={0}
          onClick={(event) => {
            // A mention can sit inside a link entity (a textUrl whose words are
            // "@name"). Cancel the anchor's default action too, or one click would
            // open the chat and the URL in a browser window.
            event.preventDefault()
            event.stopPropagation()
            open(target)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') open(target)
          }}
        >
          {children}
        </span>
      )
    }
    case 'hashtag':
      return <span className="wx-entity-mention">{children}</span>
    case 'url':
    case 'textUrl': {
      const href = safeHref(entity.url ?? (entity.type === 'url' ? String(children) : undefined))
      if (!href) return <span>{children}</span>
      return (
        <TelegramLink className="wx-link" href={href}>
          {children}
        </TelegramLink>
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
