import type { Message } from '@wegram/protocol'

import type { AlbumLayout } from '../../lib/albumLayout'
import { MediaBubble } from '../MediaBubble'

/**
 * One Telegram album (design doc §8.6). The composition is not a grid: the cells
 * are placed by `lib/albumLayout.ts`, the port of tdesktop's album geometry, so
 * a tall first picture takes the left column and five items pick the row split
 * that best fills the box.
 *
 * Every item keeps its own message id, so a click still opens that item in the
 * client's 图片和视频 window, and the meta line (time / 已读) belongs to the row,
 * not to one cell.
 */
export function AlbumBubble({
  chatId,
  messages,
  layout,
}: {
  chatId: number
  messages: Message[]
  layout: AlbumLayout
}) {
  return (
    <div className="wx-album" style={{ width: layout.width, height: layout.height }}>
      {messages.map((message, index) => {
        const media = message.media
        const cell = layout.cells[index]
        const kind = message.kind === 'photo' || message.kind === 'video' ? message.kind : null
        if (!media || !cell || !kind) return null
        return (
          <div
            className="wx-album__cell"
            key={message.id}
            style={{ left: cell.x, top: cell.y, width: cell.width, height: cell.height }}
          >
            <MediaBubble
              media={media}
              kind={kind}
              chatId={chatId}
              messageId={message.id}
              variant="album"
              // The cell's own box is what the picture must cover, so the variant
              // asked for is the size actually drawn (not the full 240 px bubble).
              maxWidth={cell.width}
              maxHeight={cell.height}
            />
          </div>
        )
      })}
    </div>
  )
}
