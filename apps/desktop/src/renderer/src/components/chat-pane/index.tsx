import type { Message } from '@wechatgram/protocol'
import { useState } from 'react'

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
 * The conversation pane: header, transcript, composer and the modals they open.
 *
 * Data comes from two places on purpose: `useChatHistory` owns fetching and the
 * saved reading position, `createMessageActions` owns writes. This component keeps
 * only rendering and the modal/popover state.
 *
 * One ordering rule to preserve: the list must not mount before the stored anchor
 * is known (`anchorKnown`), because `MessageList` captures its position once, on
 * the first paint. See `useChatHistory` and `docs/HANDOFF.md` (#2).
 */
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

  const { pendingAnchor, anchorKnown, restoring, reload, loadOlder } = useChatHistory(activeChatId)

  const chat = chats.find((item) => item.id === activeChatId) ?? null
  const messages = activeChatId ? (messagesByChat[activeChatId] ?? []) : []
  const replyToId = activeChatId ? (replyToByChat[activeChatId] ?? null) : null
  const replyTo = replyToId ? (messages.find((item) => item.id === replyToId) ?? null) : null
  const editingForChat = editing && editing.chatId === activeChatId ? editing : null
  const typing = activeChatId ? Boolean(typingByChat[activeChatId]) : false

  if (!chat || !activeChatId) return <NoChatPlaceholder />

  const actions = createMessageActions(activeChatId)

  return (
    <main className="wx-chat">
      <ChatHeader title={chat.title} typing={typing} onOpenInfo={setInfoAt} />

      {loadingHistoryByChat[activeChatId] && messages.length === 0 ? (
        <LoadingPlaceholder restoring={restoring} />
      ) : !anchorKnown ? (
        <AnchorPendingPlaceholder />
      ) : messages.length === 0 ? (
        <EmptyTranscriptPlaceholder onReload={reload} />
      ) : (
        <MessageList
          key={activeChatId}
          chat={chat}
          messages={messages}
          hasMore={Boolean(hasMoreByChat[activeChatId])}
          loadingOlder={Boolean(loadingOlderByChat[activeChatId])}
          initialAnchor={pendingAnchor?.chatId === activeChatId ? pendingAnchor : null}
          unreadMarker={
            unreadMarkers[activeChatId]?.unread ? (unreadMarkers[activeChatId] ?? null) : null
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
