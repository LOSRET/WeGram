import type { ChatSummary, Message, ScrollAnchor } from '@wechatgram/protocol'
import { useEffect, useState } from 'react'

import { errorMessage, invoke } from '../lib/ipc'
import { useAppStore } from '../store/useAppStore'
import { Composer } from './Composer'
import { ConfirmDialog } from './ConfirmDialog'
import { Popup } from './ContextMenu'
import { ForwardDialog } from './ForwardDialog'
import { CallIcon, CallMenuIcon, MoreIcon, TelegramLogo } from './Icon'
import { MessageList } from './MessageList'

/** How many extra pages may be fetched to reach a saved reading position. */
const MAX_RESTORE_PAGES = 6
/** Give up paging back (and land at the bottom) after this long. */
const RESTORE_BUDGET_MS = 10_000

export function ChatPane() {
  const activeChatId = useAppStore((state) => state.activeChatId)
  const chats = useAppStore((state) => state.chats)
  const messagesByChat = useAppStore((state) => state.messagesByChat)
  const hasMoreByChat = useAppStore((state) => state.hasMoreByChat)
  const loadingOlderByChat = useAppStore((state) => state.loadingOlderByChat)
  const loadingHistoryByChat = useAppStore((state) => state.loadingHistoryByChat)
  const replyToByChat = useAppStore((state) => state.replyToByChat)
  const editing = useAppStore((state) => state.editing)
  const typingByChat = useAppStore((state) => state.typingByChat)
  const unreadMarkers = useAppStore((state) => state.unreadMarkers)

  const [forwarding, setForwarding] = useState<Message | null>(null)
  const [deleting, setDeleting] = useState<Message | null>(null)
  /** Chat-info popover (the "…" button in the header). */
  const [infoAt, setInfoAt] = useState<{ x: number; y: number } | null>(null)
  /** Reading position to open this chat at (#2); null → land at the bottom. */
  const [pendingAnchor, setPendingAnchor] = useState<
    { chatId: number; messageId: number; offset: number } | null
  >(null)
  /**
   * The anchor has been resolved for the active chat. The list must not mount
   * before that: it captures its reading position once on the first paint, and a
   * cached chat would otherwise land at the bottom and miss the restore.
   */
  const [anchorKnown, setAnchorKnown] = useState(false)
  /** Paging back towards a saved anchor (can take a moment on the real account). */
  const [restoring, setRestoring] = useState(false)
  /** Bumped by the empty-state "reload" button to re-run the first-page fetch. */
  const [reloadNonce, setReloadNonce] = useState(0)

  const chat = chats.find((item) => item.id === activeChatId) ?? null
  const messages = activeChatId ? (messagesByChat[activeChatId] ?? []) : []
  const replyToId = activeChatId ? (replyToByChat[activeChatId] ?? null) : null
  const replyTo = replyToId ? (messages.find((item) => item.id === replyToId) ?? null) : null
  const editingForChat = editing && editing.chatId === activeChatId ? editing : null
  const typing = activeChatId ? Boolean(typingByChat[activeChatId]) : false

  // First page of history per chat (§6.3: cursor pagination, limit 50 first),
  // plus the #2 reading position: when the stored anchor is older than that page
  // the list pages back until it is loaded, so the chat reopens where it was left.
  useEffect(() => {
    if (!activeChatId) return
    let cancelled = false
    const store = useAppStore.getState()

    const resolveAnchor = async (): Promise<ScrollAnchor | null> =>
      invoke('ui:getAnchor', { chatId: activeChatId }).catch(() => null)

    // Already in memory: no fetch, the list only needs the anchor to restore.
    // An *empty* entry is not treated as cached: it is what a cold TDLib cache
    // answers with while it has not loaded the chat's last message yet, and
    // trusting it left the transcript blank for the rest of the session.
    const cached = store.messagesByChat[activeChatId]
    if (cached && cached.length > 0) {
      setPendingAnchor(null)
      setAnchorKnown(false)
      void resolveAnchor().then((anchor) => {
        if (cancelled) return
        if (anchor && cached.some((message) => message.id === anchor.messageId)) {
          setPendingAnchor({ chatId: activeChatId, ...anchor })
        }
        setAnchorKnown(true)
      })
      return () => {
        cancelled = true
      }
    }

    setAnchorKnown(false)
    store.setLoadingHistory(activeChatId, true)

    const loadFirstPage = async (): Promise<void> => {
      const anchor = await resolveAnchor()
      let first = await invoke('messages:history', { chatId: activeChatId, limit: 50 })
      // An empty first page means "TDLib has not got the chat's last message
      // yet" far more often than "this chat is empty": it happens right after a
      // start, while the local database is still syncing. Ask again before
      // caching nothing — a cached empty page is a blank transcript forever.
      for (let attempt = 0; attempt < 3 && first.messages.length === 0; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 800))
        if (cancelled) return
        first = await invoke('messages:history', { chatId: activeChatId, limit: 50 })
      }
      let messages = first.messages
      let hasMore = first.hasMore

      const deadline = Date.now() + RESTORE_BUDGET_MS
      const needsPaging =
        Boolean(anchor) && messages.length > 0 && messages[0]!.id > anchor!.messageId
      if (needsPaging && !cancelled) setRestoring(true)
      for (
        let pages = 0;
        anchor &&
        hasMore &&
        messages.length > 0 &&
        messages[0]!.id > anchor.messageId &&
        pages < MAX_RESTORE_PAGES &&
        Date.now() < deadline;
        pages += 1
      ) {
        const older = await invoke('messages:history', {
          chatId: activeChatId,
          fromMessageId: messages[0]!.id,
          limit: 50,
        })
        messages = [...older.messages, ...messages]
        hasMore = older.hasMore
      }

      if (cancelled) return
      const found = anchor
        ? messages.some((message) => message.id === anchor.messageId)
        : false
      setPendingAnchor(found && anchor ? { chatId: activeChatId, ...anchor } : null)
      useAppStore.getState().setHistory(activeChatId, messages, hasMore)
      // The position could not be reached within the budget (deep history):
      // land at the bottom and drop the anchor, so the next open stays instant
      // instead of paging back again for nothing.
      if (anchor && !found) {
        void invoke('ui:saveAnchor', {
          chatId: activeChatId,
          messageId: null,
          offset: 0,
        }).catch(() => undefined)
      }
    }

    void (async () => {
      try {
        await loadFirstPage()
      } catch (error) {
        const message = errorMessage(error)
        if (!cancelled) {
          useAppStore.getState().setError(message)
          // One quiet retry: the proxy tunnel here flaps, and a failed first
          // fetch used to leave the pane empty forever — the only way back was
          // toggling the chat closed and open again.
          await new Promise((resolve) => window.setTimeout(resolve, 1500))
          if (cancelled) return
          try {
            await loadFirstPage()
            if (useAppStore.getState().error === message) {
              useAppStore.getState().setError(null)
            }
          } catch {
            // The error bar stays; the user can close the chat and retry.
          }
        }
      } finally {
        if (!cancelled) {
          useAppStore.getState().setLoadingHistory(activeChatId, false)
          setRestoring(false)
          // Even on failure the list is mounted: it then falls back to the bottom.
          setAnchorKnown(true)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeChatId, reloadNonce])

  // Toasts are fire-and-forget; MainShell owns the dismissal timer.

  if (!chat || !activeChatId) {
    return (
      <main className="wx-chat">
        <div className="wx-empty-chat">
          <TelegramLogo size={132} className="wx-empty-chat__logo" />
        </div>
      </main>
    )
  }

  const loadOlder = async (): Promise<void> => {
    const store = useAppStore.getState()
    const list = store.messagesByChat[activeChatId] ?? []
    const oldest = list[0]
    if (!oldest) return

    store.setLoadingOlder(activeChatId, true)
    try {
      const page = await invoke('messages:history', {
        chatId: activeChatId,
        fromMessageId: oldest.id,
        limit: 50,
      })
      useAppStore.getState().prependHistory(activeChatId, page.messages, page.hasMore)
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      useAppStore.getState().setLoadingOlder(activeChatId, false)
    }
  }

  const send = async (text: string, replyToMessageId: number | undefined): Promise<void> => {
    const result = await invoke('messages:send', {
      chatId: activeChatId,
      text,
      ...(replyToMessageId === undefined ? {} : { replyTo: replyToMessageId }),
    })
    const store = useAppStore.getState()
    store.applyMessageOps(activeChatId, [{ op: 'new', message: result.message }])
    store.setReplyTo(activeChatId, null)
  }

  const saveEdit = async (messageId: number, text: string): Promise<void> => {
    const updated = await invoke('messages:edit', { chatId: activeChatId, messageId, text })
    const store = useAppStore.getState()
    store.applyMessageOps(activeChatId, [
      { op: 'edit', chatId: activeChatId, messageId, text: updated.text },
    ])
    store.setEditing(null)
  }

  const confirmDelete = async (message: Message): Promise<void> => {
    setDeleting(null)
    try {
      await invoke('messages:delete', { chatId: message.chatId, messageIds: [message.id], forBoth: true })
      useAppStore.getState().applyMessageOps(message.chatId, [
        { op: 'delete', chatId: message.chatId, messageIds: [message.id] },
      ])
      useAppStore.getState().setToast('已删除')
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    }
  }

  const forward = async (message: Message, toChatId: number): Promise<void> => {
    setForwarding(null)
    try {
      await invoke('messages:forward', {
        fromChatId: message.chatId,
        messageIds: [message.id],
        toChatId,
      })
      useAppStore.getState().setToast('已转发')
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    }
  }

  const copy = (message: Message): void => {
    void navigator.clipboard
      .writeText(message.text)
      .then(() => useAppStore.getState().setToast('已复制'))
      .catch(() => useAppStore.getState().setToast('复制失败'))
  }

  return (
    <main className="wx-chat">
      <header className="wx-chat__header">
        <h1 className="wx-chat__title">
          {chat.title}
          {typing ? <span className="wx-chat__typing">对方正在输入…</span> : null}
        </h1>
        <div className="wx-chat__header-actions">
          <button
            className="wx-ghost-btn"
            title="语音通话"
            disabled
            aria-label="语音通话"
          >
            <CallMenuIcon size={19} />
          </button>
          <button className="wx-ghost-btn" title="视频通话" disabled aria-label="视频通话">
            <CallIcon size={18} />
          </button>
          <button
            className="wx-ghost-btn"
            title="聊天信息"
            aria-label="聊天信息"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              setInfoAt({ x: rect.right - 232, y: rect.bottom + 6 })
            }}
          >
            <MoreIcon size={18} />
          </button>
        </div>
      </header>

      {loadingHistoryByChat[activeChatId] && messages.length === 0 ? (
        <div className="wx-empty-chat">
          <div className="wx-spinner" />
          <div>
            {restoring ? '正在恢复上次阅读位置…' : '正在拉取历史消息…'}
          </div>
        </div>
      ) : !anchorKnown ? (
        // The list captures its reading position on the first paint, so it must
        // not mount before the stored anchor for this chat is known.
        <div className="wx-messages-wrap" />
      ) : messages.length === 0 ? (
        // An empty page that survived the retries: say so instead of showing a
        // silently blank transcript, and let the reader ask again.
        <div className="wx-empty-chat">
          <div>这个会话还没有可显示的消息</div>
          <button
            className="wx-ghost-btn"
            onClick={() => setReloadNonce((value) => value + 1)}
          >
            重新加载
          </button>
        </div>
      ) : (
        <MessageList
          key={activeChatId}
          chat={chat}
          messages={messages}
          hasMore={Boolean(hasMoreByChat[activeChatId])}
          loadingOlder={Boolean(loadingOlderByChat[activeChatId])}
          initialAnchor={pendingAnchor?.chatId === activeChatId ? pendingAnchor : null}
          unreadMarker={
            unreadMarkers[activeChatId]?.unread
              ? (unreadMarkers[activeChatId] ?? null)
              : null
          }
          onLoadOlder={loadOlder}
          onReply={(message) => useAppStore.getState().setReplyTo(activeChatId, message.id)}
          onEdit={(message) =>
            useAppStore
              .getState()
              .setEditing({ chatId: activeChatId, messageId: message.id, text: message.text })
          }
          onDelete={(message) => setDeleting(message)}
          onForward={(message) => setForwarding(message)}
          onCopy={copy}
        />
      )}

      <Composer
        chatId={activeChatId}
        replyTo={replyTo}
        editing={editingForChat}
        onSend={send}
        onSaveEdit={saveEdit}
        onCancelReply={() => useAppStore.getState().setReplyTo(activeChatId, null)}
        onCancelEdit={() => useAppStore.getState().setEditing(null)}
      />

      {forwarding ? (
        <ForwardDialog
          chats={chats}
          message={forwarding}
          onForward={(toChatId) => void forward(forwarding, toChatId)}
          onClose={() => setForwarding(null)}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="删除这条消息？"
          description="会同时从所有设备删除（for both sides）。"
          confirmLabel="删除"
          danger
          onConfirm={() => void confirmDelete(deleting)}
          onCancel={() => setDeleting(null)}
        />
      ) : null}

      {infoAt ? (
        <Popup x={infoAt.x} y={infoAt.y} onClose={() => setInfoAt(null)}>
          <div className="wx-info-pop__row">
            <span>名称</span>
            <strong>{chat.title}</strong>
          </div>
          <div className="wx-info-pop__row">
            <span>类型</span>
            <strong>{kindLabel(chat.kind)}</strong>
          </div>
          <div className="wx-info-pop__row">
            <span>未读</span>
            <strong>{chat.unread}</strong>
          </div>
          <div className="wx-info-pop__row">
            <span>已加载</span>
            <strong>{messages.length} 条</strong>
          </div>
          <div className="wx-info-pop__row">
            <span>已读回执</span>
            <strong>
              {chat.lastReadOutboxMessageId ? `#${chat.lastReadOutboxMessageId}` : '无'}
            </strong>
          </div>
        </Popup>
      ) : null}
    </main>
  )
}

function kindLabel(kind: ChatSummary['kind']): string {
  if (kind === 'group') return '群聊'
  if (kind === 'channel') return '频道'
  return '私聊'
}
