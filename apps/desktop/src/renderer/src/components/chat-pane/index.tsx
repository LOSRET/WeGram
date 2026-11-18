import type { Message } from '@wegram/protocol'
import { useEffect, useState } from 'react'

import { invoke } from '../../lib/ipc'
import { mayMarkRead } from '../../lib/readGate'
import { useAppStore } from '../../store/useAppStore'
import { Composer } from '../Composer'
import { ConfirmDialog } from '../ConfirmDialog'
import { ForwardDialog } from '../ForwardDialog'
import { MessageList } from '../message-list'
import { ChatHeader } from './ChatHeader'
import { ChatInfoPopover } from './ChatInfoPopover'
import {
  AnchorPendingPlaceholder,
  EmptyTranscriptPlaceholder,
  LoadingPlaceholder,
  NoChatPlaceholder,
} from './Placeholders'
import { createMessageActions } from './messageActions'
import { useChatHistory } from './useChatHistory'

/**
 * How long the newest message may sit in an open, focused window before it is
 * reported as read. Long enough to coalesce a burst of arriving messages into
 * one call, short enough that the badge clears while the reader is still there.
 */
const MARK_READ_DELAY_MS = 350

/**
 * The conversation pane: header, transcript, composer and the modals they open.
 *
 * Data comes from two places on purpose: `useChatHistory` owns fetching and the
 * saved reading position, `createMessageActions` owns writes. This component keeps
 * only rendering and the modal/popover state.
 *
 * One ordering rule to preserve: the list must not mount before the landing position
 * is known (`anchorKnown`), because `MessageList` captures its position once, on the
 * first paint. See `useChatHistory` and `docs/HANDOFF.md` (#2).
 */
export function ChatPane() {
  const activeChatId = useAppStore((state) => state.activeChatId)
  const chats = useAppStore((state) => state.chats)
  const messagesByChat = useAppStore((state) => state.messagesByChat)
  const hasMoreByChat = useAppStore((state) => state.hasMoreByChat)
  const replyToByChat = useAppStore((state) => state.replyToByChat)
  const editing = useAppStore((state) => state.editing)
  const typingByChat = useAppStore((state) => state.typingByChat)
  const unreadMarkers = useAppStore((state) => state.unreadMarkers)

  /**
   * Reported by the transcript: the newest message that has actually been on
   * screen. Kept with its chat id because the pane outlives the switch between
   * conversations, while the report belongs to one of them.
   */
  const [seen, setSeen] = useState<{ chatId: number; messageId: number } | null>(null)

  const [forwarding, setForwarding] = useState<Message | null>(null)
  const [deleting, setDeleting] = useState<Message | null>(null)
  /** Chat-info popover (the "…" button in the header). */
  const [infoAt, setInfoAt] = useState<{ x: number; y: number } | null>(null)

  const { pendingLanding, anchorKnown, restoring, loadingHistory, loadingOlder, reload, loadOlder } =
    useChatHistory(activeChatId)

  const chat = chats.find((item) => item.id === activeChatId) ?? null
  const messages = activeChatId ? (messagesByChat[activeChatId] ?? []) : []
  const seenUpToMessageId = seen && seen.chatId === activeChatId ? seen.messageId : null

  /**
   * Reading happens while the chat is open, and it happens *message by message*:
   * the report moves to whatever the reader has actually had on screen, so the
   * server's unread count — and with it the chat row and the rail badge — falls as
   * they scroll through the new messages instead of only when they hit the bottom.
   *
   * `messages:read` is idempotent and TDLib's marker is monotonic, so the unread
   * snapshot taken when the chat opened, a burst of scroll positions and this
   * effect may all overlap. The delay coalesces a burst of arrivals into one call.
   *
   * The gate is `mayMarkRead` (`lib/readGate.ts`): a message that never appeared
   * on screen must not be reported as read, however far the marker could move.
   */
  useEffect(() => {
    if (activeChatId === null || seenUpToMessageId === null) return
    const markRead = (): void => {
      const allowed = mayMarkRead({
        seenUpToMessageId,
        visible: document.visibilityState === 'visible',
        focused: document.hasFocus(),
      })
      if (!allowed) return
      void invoke('messages:read', {
        chatId: activeChatId,
        upToMessageId: seenUpToMessageId,
      }).catch(() => undefined)
    }
    const timer = window.setTimeout(markRead, MARK_READ_DELAY_MS)
    // Reopening the window (or the pane) re-checks: the reader may have been
    // looking at these messages all along while the app was behind another window.
    window.addEventListener('focus', markRead)
    document.addEventListener('visibilitychange', markRead)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', markRead)
      document.removeEventListener('visibilitychange', markRead)
    }
  }, [activeChatId, seenUpToMessageId])

  const replyToId = activeChatId ? (replyToByChat[activeChatId] ?? null) : null
  const replyTo = replyToId ? (messages.find((item) => item.id === replyToId) ?? null) : null
  const editingForChat = editing && editing.chatId === activeChatId ? editing : null
  const typing = activeChatId ? Boolean(typingByChat[activeChatId]) : false

  if (!chat || !activeChatId) return <NoChatPlaceholder />

  const actions = createMessageActions(activeChatId)

  return (
    <main className="wx-chat">
      <ChatHeader title={chat.title} typing={typing} onOpenInfo={setInfoAt} />

      {loadingHistory && messages.length === 0 ? (
        <LoadingPlaceholder restoring={restoring} />
      ) : !anchorKnown ? (
        <AnchorPendingPlaceholder />
      ) : messages.length === 0 ? (
        <EmptyTranscriptPlaceholder onReload={reload} unsynced={chat.lastMessageAt !== undefined} />
      ) : (
        <MessageList
          key={activeChatId}
          chat={chat}
          messages={messages}
          hasMore={Boolean(hasMoreByChat[activeChatId])}
          loadingOlder={loadingOlder}
          landing={pendingLanding?.chatId === activeChatId ? pendingLanding.position : null}
          unreadMarker={
            unreadMarkers[activeChatId]?.unread ? (unreadMarkers[activeChatId] ?? null) : null
          }
          onSeenUpToChange={(messageId) =>
            setSeen(messageId === null ? null : { chatId: activeChatId, messageId })
          }
          onLoadOlder={loadOlder}
          onReply={(message) => useAppStore.getState().setReplyTo(activeChatId, message.id)}
          onEdit={(message) =>
            useAppStore
              .getState()
              .setEditing({ chatId: activeChatId, messageId: message.id, text: message.text })
          }
          onDelete={setDeleting}
          onForward={setForwarding}
          onCopy={actions.copy}
        />
      )}

      <Composer
        chatId={activeChatId}
        replyTo={replyTo}
        editing={editingForChat}
        onSend={actions.send}
        onSaveEdit={actions.saveEdit}
        onCancelReply={() => useAppStore.getState().setReplyTo(activeChatId, null)}
        onCancelEdit={() => useAppStore.getState().setEditing(null)}
      />

      {forwarding ? (
        <ForwardDialog
          chats={chats}
          message={forwarding}
          onForward={(toChatId) => {
            const message = forwarding
            setForwarding(null)
            void actions.forward(message, toChatId)
          }}
          onClose={() => setForwarding(null)}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="删除这条消息？"
          description="会同时从所有设备删除（for both sides）。"
          confirmLabel="删除"
          danger
          onConfirm={() => {
            const message = deleting
            setDeleting(null)
            void actions.removeMessage(message)
          }}
          onCancel={() => setDeleting(null)}
        />
      ) : null}

      {infoAt ? (
        <ChatInfoPopover
          chat={chat}
          loadedCount={messages.length}
          position={infoAt}
          onClose={() => setInfoAt(null)}
        />
      ) : null}
    </main>
  )
}
