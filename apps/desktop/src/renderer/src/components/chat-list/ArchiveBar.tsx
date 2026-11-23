import { ChevronLeftIcon } from '../Icon'

interface ArchiveBarProps {
  count: number
  onBack: () => void
}

/**
 * The archive page's own header: a back chevron, the title and how many chats are
 * filed away. It takes the conversation list's head slot, so the search field and
 * the "+" are out of the way while the reader is inside the archive.
 */
export function ArchiveBar({ count, onBack }: ArchiveBarProps) {
  return (
    <div className="wx-list__head wx-archive-bar">
      <button
        type="button"
        className="wx-archive-back"
        title="返回"
        aria-label="返回"
        onClick={onBack}
      >
        <ChevronLeftIcon size={14} />
      </button>
      <span className="wx-archive-bar__title">已归档会话</span>
      <span className="wx-archive-bar__count">{count} 个会话</span>
    </div>
  )
}
