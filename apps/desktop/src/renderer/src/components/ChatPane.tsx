import type { Message, ScrollAnchor } from '@wechatgram/protocol'
import { useEffect, useState } from 'react'

import { errorMessage, invoke } from '../lib/ipc'
import { useAppStore } from '../store/useAppStore'
import { Composer } from './Composer'
import { ConfirmDialog } from './ConfirmDialog'
import { ForwardDialog } from './ForwardDialog'
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
  const toast = useAppStore((state) => state.toast)

  const [forwarding, setForwarding] = useState<Message | null>(null)
  const [deleting, setDeleting] = useState<Message | null>(null)
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
    const cached = store.messagesByChat[activeChatId]
    if (cached) {
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
    void (async () => {
      try {
        const anchor = await resolveAnchor()
        const first = await invoke('messages:history', { chatId: activeChatId, limit: 50 })
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
      } catch (error) {
        if (!cancelled) useAppStore.getState().setError(errorMessage(error))
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
  }, [activeChatId])

  // Toasts are fire-and-forget.
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => useAppStore.getState().setToast(null), 2200)
    return () => window.clearTimeout(timer)
  }, [toast])

  if (!chat || !activeChatId) {
    return (
      <main className="wx-chat">
        <div className="wx-empty-chat">
          <div style={{ fontSize: 40 }}>💬</div>
          <div>选择一个会话开始聊天</div>
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
      <div className="wx-chat__header">
        <div>
          <div className="wx-chat__title">{chat.title}</div>
          <div className="wx-chat__subtitle">{chatSubtitle(chat.kind, chat.muted, typing)}</div>
        </div>
        <div className="wx-chat__header-actions">
          <span className="wx-hint">{messages.length} 条已加载</span>
        </div>
      </div>

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
      ) : (
        <MessageList
          key={activeChatId}
          chat={chat}
          messages={messages}
          hasMore={Boolean(hasMoreByChat[activeChatId])}
          loadingOlder={Boolean(loadingOlderByChat[activeChatId])}
          initialAnchor={pendingAnchor?.chatId === activeChatId ? pendingAnchor : null}
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

      {toast ? <div className="wx-toast">{toast}</div> : null}
    </main>
  )
}

function chatSubtitle(kind: string, muted: boolean, typing: boolean): string {
  if (typing) return '对方正在输入…'
  const label = kind === 'group' ? '群聊' : kind === 'channel' ? '频道' : '私聊'
  return muted ? `${label} · 消息免打扰` : label
}
