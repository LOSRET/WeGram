import { TelegramLogo } from '../Icon'

/** Nothing is selected: WeChat's centred Telegram mark. */
export function NoChatPlaceholder() {
  return (
    <main className="wx-chat">
      <div className="wx-empty-chat">
        <TelegramLogo size={132} className="wx-empty-chat__logo" />
      </div>
    </main>
  )
}

/** First page is in flight (or we are paging back to a saved position). */
export function LoadingPlaceholder({ restoring }: { restoring: boolean }) {
  return (
    <div className="wx-empty-chat">
      <div className="wx-spinner" />
      <div>{restoring ? '正在恢复上次阅读位置…' : '正在拉取历史消息…'}</div>
    </div>
  )
}

/**
 * The list captures its reading position on the first paint, so it must not
 * mount before the stored anchor for this chat is known — otherwise a cached chat
 * lands at the bottom and misses the restore. This is the empty frame it sits in
 * meanwhile.
 */
export function AnchorPendingPlaceholder() {
  return <div className="wx-messages-wrap" />
}

/**
 * An empty page that survived the retries: say so instead of showing a silently
 * blank transcript, and let the reader ask again.
 *
 * Two very different things end up here, and they must not share a sentence: a
 * chat that has no messages at all, and a chat the chat list *knows* has messages
 * but TDLib has not served them yet (the empty answer is not cached in that case —
 * see `useChatHistory`, so this state recovers on the next open).
 */
export function EmptyTranscriptPlaceholder({
  onReload,
  unsynced = false,
}: {
  onReload: () => void
  unsynced?: boolean
}) {
  return (
    <div className="wx-empty-chat">
      <div>{unsynced ? '消息还没从服务器同步下来' : '这个会话还没有可显示的消息'}</div>
      <button className="wx-ghost-btn" onClick={onReload}>
        重新加载
      </button>
    </div>
  )
}
