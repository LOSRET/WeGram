import type { Message } from '@wegram/protocol'

import { MediaBubble } from '../MediaBubble'

/**
 * The grid of one album (design doc §8.6). Every item keeps its own message id, so
 * a click still opens that item in the client's 图片和视频 window, and the meta
 * line (time / 已读) belongs to the row, not to one cell.
 */
export function AlbumBubble({ chatId, messages }: { chatId: number; messages: Message[] }) {
  return (
    <div className="wx-album">
      {messages.map((message) => {
        const media = message.media
        if (!media) return null
        const kind = message.kind === 'photo' || message.kind === 'video' ? message.kind : null
        if (!kind) return null
        return (
          <div className="wx-album__cell" key={message.id}>
            <MediaBubble
              media={media}
              kind={kind}
              chatId={chatId}
              messageId={message.id}
              variant="album"
            />
          </div>
        )
      })}
    </div>
  )
}
