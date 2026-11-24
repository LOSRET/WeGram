import type {
  MessageMedia,
  RichAlign,
  RichBlock,
  RichFormatted,
  RichListItem,
  RichMedia,
  RichTableCell,
  RichTextRole,
} from '@wegram/protocol'

import type { TdObject } from '../client'
import { asArray } from '../json'
import { inlineButtonOf } from './buttons'
import { documentMedia, photoMedia, videoMedia, voiceMedia } from './media'
import { richText } from './rich-text'

/**
 * TDLib 1.8.70's rich message: the body is a page of blocks (headings,
 * paragraphs, lists, tables, quotes, media) instead of a caption. This module
 * walks that tree into the protocol's RichBlock union and flattens it to plain
 * text, which is what previews, quotes and 复制 use. The rich-text runs
 * themselves are mapped in ./rich-text.
 *
 * Everything here is pure: no client, no registry writes beyond the media
 * registration that already-downloaded files need.
 */

/** A crafted page can nest deeply; the renderer only needs a handful of levels. */
const MAX_DEPTH = 8

export function mapRichMessage(raw: TdObject | undefined): { blocks: RichBlock[]; text: string } {
  const blocks = mapPageBlocks(raw?.blocks, 0)
  return { blocks, text: flattenBlocks(blocks) }
}

/** Chat-list preview: the page's words on one line. */
export function richPreview(raw: TdObject | undefined): string {
  return mapRichMessage(raw).text.replace(/\s+/g, ' ').trim()
}

/* ---------- page blocks ---------- */

/**
 * TDLib's `PageBlock` list as the protocol's rich blocks.
 *
 * Shared by the rich-message mapper and 即时预览 (`web:instantView`): TDLib's
 * `webPageInstantView.blocks` is the same union, so an Instant View page is drawn
 * by the one `RichMessage` renderer instead of a second block walker.
 */
export function mapPageBlocks(raw: unknown, depth = 0): RichBlock[] {
  if (!Array.isArray(raw) || depth > MAX_DEPTH) return []
  const out: RichBlock[] = []
  for (const block of raw as TdObject[]) {
    const mapped = mapBlock(block, depth)
    if (mapped) out.push(mapped)
  }
  return out
}

function mapBlock(block: TdObject | undefined, depth: number): RichBlock | null {
  if (!block || depth > MAX_DEPTH) return null
  switch (block._) {
    case 'pageBlockTitle':
      return textBlock('title', block.title)
    case 'pageBlockSubtitle':
      return textBlock('subtitle', block.subtitle)
    case 'pageBlockHeader':
      return textBlock('header', block.header)
    case 'pageBlockSubheader':
      return textBlock('subheader', block.subheader)
    case 'pageBlockSectionHeading':
      return textBlock('section', block.text, sectionSize(block.size))
    case 'pageBlockKicker':
      return textBlock('kicker', block.kicker)
    case 'pageBlockParagraph':
    case 'pageBlockThinking':
      return textBlock('paragraph', block.text)
    case 'pageBlockPreformatted':
      return textBlock('pre', block.text)
    case 'pageBlockFooter':
      return textBlock('footer', block.footer)
    case 'pageBlockAuthorDate':
      return textBlock('footer', block.author)
    case 'pageBlockDivider':
      return { type: 'divider' }
    case 'pageBlockList':
      return listBlock(block, depth)
    case 'pageBlockTable':
      return tableBlock(block)
    case 'pageBlockBlockQuote':
    case 'pageBlockExpandableBlockQuote':
      return quoteBlock(block, depth)
    case 'pageBlockPullQuote':
      return pullQuoteBlock(block)
    case 'pageBlockDetails':
      return detailsBlock(block, depth)
    case 'pageBlockButtonRow':
      return buttonRowBlock(block)
    case 'pageBlockCollage':
    case 'pageBlockSlideshow':
      return galleryBlock(block)
    case 'pageBlockCover':
      // A cover is one more block (normally a photo); its own caption stays.
      return mapBlock(block.cover, depth + 1)
    case 'pageBlockPhoto':
    case 'pageBlockVideo':
    case 'pageBlockAnimation':
    case 'pageBlockAudio':
    case 'pageBlockDocument':
    case 'pageBlockVoiceNote':
      return mediaBlock(block)
    default:
      // Anchors, embedded pages, related articles, maps: nothing to draw in a
      // chat bubble yet. Returning null keeps the rest of the page intact.
      return null
  }
}

function textBlock(
  role: RichTextRole,
  node: TdObject | undefined,
  size?: number,
): RichBlock | null {
  const text = richText(node)
  if (!text.text.trim()) return null
  return { type: 'text', role, text, ...(size ? { size } : {}) }
}

function sectionSize(value: unknown): number | undefined {
  const size = Number(value ?? 0)
  if (!Number.isFinite(size) || size < 1 || size > 6) return undefined
  return size
}

function listBlock(block: TdObject, depth: number): RichBlock | null {
  const rawItems: TdObject[] = asArray(block.items)
  const items: RichListItem[] = rawItems.map((item) => ({
    label: typeof item.label === 'string' ? item.label : '',
    value: Number(item.value ?? 0),
    ...(item.has_checkbox ? { checked: Boolean(item.is_checked) } : {}),
    blocks: mapPageBlocks(item.blocks, depth + 1),
  }))
  return items.length ? { type: 'list', items } : null
}

function tableBlock(block: TdObject): RichBlock | null {
  const rawRows: TdObject[][] = asArray<TdObject[]>(block.cells)
  const rows = rawRows.map((row) => asArray(row).map(tableCell))
  if (!rows.length) return null
  const caption = captionOf(block.caption)
  return {
    type: 'table',
    bordered: Boolean(block.is_bordered),
    striped: Boolean(block.is_striped),
    compact: Boolean(block.is_compact),
    ...(caption ? { caption } : {}),
    rows,
  }
}

function tableCell(cell: TdObject): RichTableCell {
  const text = cell?.text ? richText(cell.text) : undefined
  return {
    ...(text && text.text.trim() ? { text } : {}),
    header: Boolean(cell?.is_header),
    colspan: Math.max(1, Number(cell?.colspan ?? 1)),
    rowspan: Math.max(1, Number(cell?.rowspan ?? 1)),
    align: alignOf(cell?.align?._),
  }
}

function alignOf(value: unknown): RichAlign {
  if (value === 'pageBlockHorizontalAlignmentCenter') return 'center'
  if (value === 'pageBlockHorizontalAlignmentRight') return 'right'
  return 'left'
}

function quoteBlock(block: TdObject, depth: number): RichBlock | null {
  const blocks = mapPageBlocks(block.blocks, depth + 1)
  if (!blocks.length) return null
  const credit = block.credit ? richText(block.credit) : undefined
  return {
    type: 'quote',
    blocks,
    ...(credit && credit.text.trim() ? { credit } : {}),
    ...(block._ === 'pageBlockExpandableBlockQuote' ? { expandable: true } : {}),
  }
}

function pullQuoteBlock(block: TdObject): RichBlock | null {
  const text = richText(block.text)
  if (!text.text.trim()) return null
  const credit = block.credit ? richText(block.credit) : undefined
  return {
    type: 'quote',
    blocks: [{ type: 'text', role: 'paragraph', text }],
    ...(credit && credit.text.trim() ? { credit } : {}),
  }
}

function detailsBlock(block: TdObject, depth: number): RichBlock | null {
  const blocks = mapPageBlocks(block.blocks, depth + 1)
  if (!blocks.length) return null
  return { type: 'details', header: richText(block.header), blocks, open: Boolean(block.is_open) }
}

function buttonRowBlock(block: TdObject): RichBlock | null {
  const raw: TdObject[] = asArray(block.buttons)
  const row = raw
    .map((button) => inlineButtonOf(button, richText(button?.text).text))
    .filter((button): button is NonNullable<typeof button> => button !== null)
  return row.length ? { type: 'buttons', rows: [row] } : null
}

function galleryBlock(block: TdObject): RichBlock | null {
  const raw: TdObject[] = asArray(block.blocks)
  const items: RichMedia[] = []
  for (const child of raw) {
    const media = mediaOf(child)
    if (media) items.push(media)
  }
  if (!items.length) return null
  const caption = captionOf(block.caption)
  return { type: 'gallery', items, ...(caption ? { caption } : {}) }
}

function mediaBlock(block: TdObject): RichBlock | null {
  const media = mediaOf(block)
  if (!media) return null
  const caption = captionOf(block.caption)
  return {
    type: 'media',
    ...media,
    ...(caption ? { caption } : {}),
    ...(block.has_spoiler ? { spoiler: true } : {}),
  }
}

/** The media half of a block; shared by single blocks and collages. */
function mediaOf(block: TdObject | undefined): RichMedia | null {
  if (!block) return null
  switch (block._) {
    case 'pageBlockPhoto':
      return asMedia('photo', photoMedia(block.photo))
    case 'pageBlockVideo':
      return asMedia('video', videoMedia(block.video, 'video'))
    case 'pageBlockAnimation':
      return asMedia('video', videoMedia(block.animation, 'animation'))
    case 'pageBlockAudio':
      return asMedia('file', documentMedia(block.audio))
    case 'pageBlockDocument':
      return asMedia('file', documentMedia(block.document))
    case 'pageBlockVoiceNote':
      return asMedia('voice', voiceMedia(block.voice_note))
    default:
      return null
  }
}

function captionOf(caption: TdObject | undefined): RichFormatted | undefined {
  if (!caption) return undefined
  const text = richText(caption.text)
  return text.text.trim() ? text : undefined
}

/** A mapped media is a rich item only when it points at a real file. */
function asMedia(kind: RichMedia['kind'], media: MessageMedia): RichMedia | null {
  return media.fileId ? { kind, media } : null
}

/* ---------- flattening ---------- */

/** Plain text of a page, in reading order; previews and quotes use it. */
export function flattenBlocks(blocks: RichBlock[]): string {
  const lines: string[] = []
  for (const block of blocks) flattenBlock(block, lines)
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function flattenBlock(block: RichBlock, lines: string[]): void {
  switch (block.type) {
    case 'text':
      lines.push(block.text.text)
      return
    case 'list':
      for (const item of block.items) {
        const body = flattenBlocks(item.blocks)
        lines.push([item.label, body].filter(Boolean).join(' '))
      }
      return
    case 'table':
      for (const row of block.rows) {
        lines.push(row.map((cell) => cell.text?.text ?? '').join(' | '))
      }
      return
    case 'quote':
    case 'details': {
      if (block.type === 'details') lines.push(block.header.text)
      lines.push(flattenBlocks(block.blocks))
      if (block.type === 'quote' && block.credit) lines.push(block.credit.text)
      return
    }
    case 'media':
    case 'gallery':
      if (block.caption) lines.push(block.caption.text)
      return
    case 'divider':
      return
  }
}