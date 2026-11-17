import { formatDaySeparator } from '../../lib/format'

/** WeChat's centred day marker between two calendar days. */
export function DaySeparator({ seconds }: { seconds: number }) {
  return <div className="wx-day-separator">{formatDaySeparator(seconds)}</div>
}

/** "以下是新消息" — the line between what was read and what was not. */
export function UnreadDivider() {
  return (
    <div className="wx-unread-divider">
      <span>以下是新消息</span>
    </div>
  )
}
