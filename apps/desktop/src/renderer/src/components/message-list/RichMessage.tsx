import type { RichBlock, RichFormatted, RichListItem, RichTextRole } from '@wegram/protocol'

import { MediaBubble } from '../MediaBubble'
import { RichText } from '../RichText'
import { InlineButtons } from './InlineButtons'

interface RichMessageProps {
  blocks: RichBlock[]
  /** Conversation and message the media belongs to (the photo viewer needs both). */
  chatId: number
  messageId: number
  /**
   * 即时预览 draws a page wider than a bubble, so its hero pictures ask for a
   * bigger box; a chat bubble keeps MediaBubble's own 240 × 300.
   */
  maxMediaWidth?: number
  maxMediaHeight?: number
}

/**
 * Renders a rich message (Telegram's `messageRichMessage`) inside one bubble:
 * headings, paragraphs, lists, tables, quotes, collapsible blocks and media.
 *
 * `map/rich.ts` has already turned TDLib's page blocks into the protocol union
 * and dropped what a chat bubble cannot draw, so this component only lays out.
 */
export function RichMessage({
  blocks,
  chatId,
  messageId,
  maxMediaWidth,
  maxMediaHeight,
}: RichMessageProps) {
  return (
    <div className="wx-rich">
      {blocks.map((block, index) => (
        <Block
          key={index}
          block={block}
          chatId={chatId}
          messageId={messageId}
          maxMediaWidth={maxMediaWidth}
          maxMediaHeight={maxMediaHeight}
        />
      ))}
    </div>
  )
}

interface BlockProps {
  block: RichBlock
  chatId: number
  messageId: number
  maxMediaWidth?: number
  maxMediaHeight?: number
}

function Block({ block, chatId, messageId, maxMediaWidth, maxMediaHeight }: BlockProps) {
  switch (block.type) {
    case 'text':
      return <TextBlock role={block.role} size={block.size} text={block.text} />
    case 'divider':
      return <hr className="wx-rich__divider" />
    case 'buttons':
      return <InlineButtons rows={block.rows} chatId={chatId} messageId={messageId} />
    case 'list':
      return (
        <ListBlock
          items={block.items}
          chatId={chatId}
          messageId={messageId}
          maxMediaWidth={maxMediaWidth}
          maxMediaHeight={maxMediaHeight}
        />
      )
    case 'table':
      return <TableBlock block={block} />
    case 'quote':
      return (
        <blockquote className="wx-rich__quote">
          {block.blocks.map((child, index) => (
            <Block
              key={index}
              block={child}
              chatId={chatId}
              messageId={messageId}
              maxMediaWidth={maxMediaWidth}
              maxMediaHeight={maxMediaHeight}
            />
          ))}
          {block.credit ? (
            <div className="wx-rich__credit">
              <RichText text={block.credit.text} entities={block.credit.entities} />
            </div>
          ) : null}
        </blockquote>
      )
    case 'details':
      return (
        <details className="wx-rich__details" open={block.open}>
          <summary className="wx-rich__summary">
            <RichText text={block.header.text} entities={block.header.entities} />
          </summary>
          {block.blocks.map((child, index) => (
            <Block
              key={index}
              block={child}
              chatId={chatId}
              messageId={messageId}
              maxMediaWidth={maxMediaWidth}
              maxMediaHeight={maxMediaHeight}
            />
          ))}
        </details>
      )
    case 'media':
      return (
        <figure className="wx-rich__media">
          <MediaBubble
            media={block.media}
            kind={block.kind}
            chatId={chatId}
            messageId={messageId}
            {...mediaLimits(maxMediaWidth, maxMediaHeight)}
          />
          {block.caption ? (
            <figcaption className="wx-rich__caption">
              <RichText text={block.caption.text} entities={block.caption.entities} />
            </figcaption>
          ) : null}
        </figure>
      )
    case 'gallery':
      return (
        <div className="wx-rich__gallery-block">
          <div className="wx-rich__gallery">
            {block.items.map((item, index) => (
              <div className="wx-rich__gallery-item" key={index}>
                <MediaBubble
                  media={item.media}
                  kind={item.kind}
                  chatId={chatId}
                  messageId={messageId}
                  {...mediaLimits(maxMediaWidth, maxMediaHeight)}
                />
              </div>
            ))}
          </div>
          {block.caption ? (
            <div className="wx-rich__caption">
              <RichText text={block.caption.text} entities={block.caption.entities} />
            </div>
          ) : null}
        </div>
      )
    default:
      return null
  }
}

/**
 * TDLib's section headings are 1 (largest) to 6 (smallest).
 *
 * em rather than px so the heading follows the bubble, which is what carries
 * 消息字号 (§9.11.3); the stylesheet's `.wx-rich__text` is the 14 px base they
 * are relative to.
 */
const SECTION_SIZE: Record<number, string> = {
  1: '1.214em',
  2: '1.143em',
  3: '1.071em',
  4: '1em',
  5: '0.929em',
  6: '0.857em',
}

function TextBlock({
  role,
  size,
  text,
}: {
  role: RichTextRole
  size?: number
  text: RichFormatted
}) {
  const className = `wx-rich__text wx-rich__text--${role}`
  const body = <RichText text={text.text} entities={text.entities} />
  if (role === 'title') return <h2 className={className}>{body}</h2>
  if (role === 'subtitle' || role === 'header') return <h3 className={className}>{body}</h3>
  if (role === 'subheader') return <h4 className={className}>{body}</h4>
  if (role === 'pre') return <pre className={`${className} wx-pre`}>{body}</pre>
  const fontSize = role === 'section' && size ? SECTION_SIZE[size] : undefined
  return (
    <p className={className} style={fontSize ? { fontSize } : undefined}>
      {body}
    </p>
  )
}

function ListBlock({
  items,
  chatId,
  messageId,
  maxMediaWidth,
  maxMediaHeight,
}: {
  items: RichListItem[]
  chatId: number
  messageId: number
  maxMediaWidth?: number
  maxMediaHeight?: number
}) {
  const ordered = items.some((item) => item.value > 0)
  return (
    <ol className={`wx-rich__list${ordered ? '' : ' wx-rich__list--plain'}`}>
      {items.map((item, index) => (
        <li className="wx-rich__item" key={index}>
          <span className="wx-rich__marker">{markerOf(item, ordered, index)}</span>
          <div className="wx-rich__item-body">
            {item.blocks.map((child, childIndex) => (
              <Block
                key={childIndex}
                block={child}
                chatId={chatId}
                messageId={messageId}
                maxMediaWidth={maxMediaWidth}
                maxMediaHeight={maxMediaHeight}
              />
            ))}
          </div>
        </li>
      ))}
    </ol>
  )
}

/** The MediaBubble props a page asks for; a chat bubble passes none. */
function mediaLimits(maxWidth?: number, maxHeight?: number): { maxWidth?: number; maxHeight?: number } {
  return {
    ...(maxWidth ? { maxWidth } : {}),
    ...(maxHeight ? { maxHeight } : {}),
  }
}

function markerOf(item: RichListItem, ordered: boolean, index: number): string {
  if (item.checked !== undefined) return item.checked ? '☑' : '☐'
  if (item.label) return item.label
  return ordered ? `${item.value || index + 1}.` : '•'
}

function TableBlock({ block }: { block: Extract<RichBlock, { type: 'table' }> }) {
  const className = [
    'wx-rich__table',
    block.bordered ? 'wx-rich__table--bordered' : '',
    block.striped ? 'wx-rich__table--striped' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className="wx-rich__table-wrap">
      <table className={className}>
        {block.caption ? (
          <caption className="wx-rich__caption">
            <RichText text={block.caption.text} entities={block.caption.entities} />
          </caption>
        ) : null}
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => {
                const Tag = cell.header ? 'th' : 'td'
                return (
                  <Tag
                    key={cellIndex}
                    colSpan={cell.colspan}
                    rowSpan={cell.rowspan}
                    className={`wx-rich__cell wx-rich__cell--${cell.align}`}
                  >
                    {cell.text ? (
                      <RichText text={cell.text.text} entities={cell.text.entities} />
                    ) : null}
                  </Tag>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
