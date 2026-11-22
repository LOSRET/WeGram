import type { ChatPinnedMessage } from '@wegram/protocol'

interface PinnedBarProps {
  pinned: ChatPinnedMessage
  /** Scrolls the transcript to the pinned row (the list's locate path). */
  onLocate: () => void
  onUnpin: () => void
}

/**
 * 置顶消息: the bar above the transcript while the chat has a pinned message.
 *
 * Telegram keeps one pinned message per chat and shows it this way; WeChat has no
 * such bar, which is why the whole feature sits behind a product decision and this
 * bar stays as quiet as possible — one line of text, and the × that unpins.
 *
 * The bar owns no state: the pane fetches the pin, the list locates the row, and
 * both actions go back through the pane so one place decides what "now pinned"
 * means.
 */
export function PinnedBar({ pinned, onLocate, onUnpin }: PinnedBarProps) {
  return (
    <div className="wx-pinned">
      <button type="button" className="wx-pinned__body" title="查看置顶消息" onClick={onLocate}>
        <span className="wx-pinned__label">置顶消息</span>
        <span className="wx-pinned__text">{pinned.text}</span>
      </button>
      <button type="button" className="wx-pinned__close" title="取消置顶" onClick={onUnpin}>
        ×
      </button>
    </div>
  )
}
