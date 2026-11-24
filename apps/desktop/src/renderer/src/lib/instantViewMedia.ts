import type { MessageMedia, RichBlock, RichMediaKind, ViewerItem } from '@wegram/protocol'

import { viewerItemFromMedia } from './viewer'

/**
 * The viewer strip of 即时预览's page (design doc §8.9), in document order.
 *
 * A page's pictures belong to no message, so buildViewerStrip — which reads Message
 * rows — cannot build its strip. The same block tree is walked here instead: every
 * media block and every gallery item becomes one item, so clicking any picture of a
 * page opens the one 图片和视频 window on the page's own gallery, and 上一张/下一张
 * stay inside the page.
 */
export function pageViewerItems(blocks: readonly RichBlock[]): ViewerItem[] {
  const items: ViewerItem[] = []
  collect(blocks, items)
  return items
}

/**
 * Blocks nest: a list item, a quote and a collapsible block each hold blocks again.
 * A gallery is one block with several items, so its cells are separate pictures.
 */
function collect(blocks: readonly RichBlock[], out: ViewerItem[]): void {
  for (const block of blocks) {
    switch (block.type) {
      case 'media':
        pushMedia(out, block.kind, block.media)
        break
      case 'gallery':
        for (const item of block.items) pushMedia(out, item.kind, item.media)
        break
      case 'quote':
      case 'details':
        collect(block.blocks, out)
        break
      case 'list':
        for (const item of block.items) collect(item.blocks, out)
        break
      default:
        break
    }
  }
}

/** Only the two kinds the viewer pages through; a page's file or voice is not one. */
function pushMedia(out: ViewerItem[], kind: RichMediaKind, media: MessageMedia): void {
  if (kind !== 'photo' && kind !== 'video') return
  if (media.fileId <= 0) return
  out.push(viewerItemFromMedia(kind, media))
}
