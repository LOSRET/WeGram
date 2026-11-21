import type { Message } from '@wegram/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'

import { loadLatestWindow } from '../../lib/anchoredWindow'
import { INFO_PANEL_ANIM_MS } from '../../lib/chatInfo'
import { errorMessage, invoke } from '../../lib/ipc'
import { mayMarkRead } from '../../lib/readGate'
import { useAppStore } from '../../store/useAppStore'
import { Composer } from '../Composer'
import { ConfirmDialog } from '../ConfirmDialog'
import { ForwardDialog } from '../ForwardDialog'
import { MessageList } from '../message-list'
import { ChannelBar } from './ChannelBar'
import { ChatHeader } from './ChatHeader'
import { ChatInfoPanel } from './ChatInfoPanel'
import { COMMENT_PANEL_ANIM_MS } from '../../lib/comments'
import { CommentPanel } from './CommentPanel'
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
  /**
   * 聊天信息 (design doc §9.9). Like the discussion view it keeps its content while
   * it slides out, so the open flag lives next to the unmount timer rather than in
   * the panel itself.
   */
  const [info, setInfo] = useState<{ open: boolean } | null>(null)
  const infoTimerRef = useRef<number | null>(null)
  /** 清空聊天记录 asks first: the history of a chat cannot be undeleted. */
  const [clearConfirm, setClearConfirm] = useState(false)
  /**
   * Channels: whether this account may post there. Asked once per chat and kept
   * for the session — switching back must not let the keyboard button flicker
   * through a round trip.
   */
  const [postRights, setPostRights] = useState<Record<number, boolean>>({})
  /** The channel whose composer was opened from the bar's keyboard switch. */
  const [channelInputChatId, setChannelInputChatId] = useState<number | null>(null)
  /** A mute call is in flight, so the bar cannot be double-toggled. */
  const [muteBusy, setMuteBusy] = useState(false)
  /** The same guard for 置顶聊天. */
  const [pinBusy, setPinBusy] = useState(false)

  /**
   * The full-pane discussion view (design doc §9.8). It stays mounted while it
   * slides out, which is why the message is kept next to the open flag and the
   * unmount is scheduled after the animation.
   */
  const [comments, setComments] = useState<{ message: Message; open: boolean } | null>(null)
  const commentTimerRef = useRef<number | null>(null)

  const openInfo = useCallback((): void => {
    if (infoTimerRef.current !== null) {
      window.clearTimeout(infoTimerRef.current)
      infoTimerRef.current = null
    }
    setInfo({ open: true })
  }, [])

  const closeInfo = useCallback((): void => {
    setInfo((current) => (current ? { ...current, open: false } : null))
    if (infoTimerRef.current !== null) window.clearTimeout(infoTimerRef.current)
    infoTimerRef.current = window.setTimeout(() => {
      infoTimerRef.current = null
      setInfo((current) => (current && !current.open ? null : current))
    }, INFO_PANEL_ANIM_MS)
  }, [])

  const infoOpen = info?.open ?? false
  const toggleInfo = useCallback((): void => {
    if (infoOpen) closeInfo()
    else openInfo()
  }, [infoOpen, closeInfo, openInfo])

  /**
   * Opening a discussion view closes 聊天信息: both claim the pane's right-hand
   * column, and stacking them would leave the transcript a sliver wide.
   */
  const openComments = useCallback(
    (message: Message): void => {
      if (commentTimerRef.current !== null) {
        window.clearTimeout(commentTimerRef.current)
        commentTimerRef.current = null
      }
      closeInfo()
      setComments({ message, open: true })
    },
    [closeInfo],
  )

  const closeComments = useCallback((): void => {
    setComments((current) => (current ? { ...current, open: false } : null))
    if (commentTimerRef.current !== null) window.clearTimeout(commentTimerRef.current)
    commentTimerRef.current = window.setTimeout(() => {
      commentTimerRef.current = null
      setComments((current) => (current && !current.open ? null : current))
    }, COMMENT_PANEL_ANIM_MS)
  }, [])

  useEffect(
    () => () => {
      if (commentTimerRef.current !== null) window.clearTimeout(commentTimerRef.current)
      if (infoTimerRef.current !== null) window.clearTimeout(infoTimerRef.current)
    },
    [],
  )

  /**
   * Another conversation owns another discussion view or another 聊天信息 panel:
   * switching chats closes both (the panel belongs to the chat that opened it).
   */
  useEffect(() => {
    setComments(null)
    setInfo(null)
    if (infoTimerRef.current !== null) {
      window.clearTimeout(infoTimerRef.current)
      infoTimerRef.current = null
    }
  }, [activeChatId])

  const {
    pendingLanding,
    anchorKnown,
    restoring,
    loadingHistory,
    located,
    loadingOlder,
    prefetchOlder,
    hasNewer,
    reload,
    loadOlder,
    loadNewer,
  } = useChatHistory(activeChatId)

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

  /**
   * "跳转到最新消息": replace an anchored window with the newest page (a no-op
   * when it already reaches the newest message), then let the list scroll to its
   * end through the per-chat jump signal. A failed reload does not scroll: the
   * reader gets the error bar and stays where they were.
   */
  const returnToLatest = useCallback(async (): Promise<void> => {
    if (activeChatId === null) return
    try {
      await loadLatestWindow(activeChatId)
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
      return
    }
    useAppStore.getState().requestJumpToLatest(activeChatId)
  }, [activeChatId])

  const replyToId = activeChatId ? (replyToByChat[activeChatId] ?? null) : null
  const replyTo = replyToId ? (messages.find((item) => item.id === replyToId) ?? null) : null
  const editingForChat = editing && editing.chatId === activeChatId ? editing : null
  const typing = activeChatId ? Boolean(typingByChat[activeChatId]) : false

  const isChannel = chat?.kind === 'channel'

  /**
   * Channel posting is an administrator right, and only the main process can ask
   * TDLib for it (it is not on the chat summary). Groups and private chats skip
   * the round trip entirely: they always keep the composer.
   */
  useEffect(() => {
    if (activeChatId === null || !isChannel) return
    if (postRights[activeChatId] !== undefined) return
    let cancelled = false
    void invoke('chats:canPost', { chatId: activeChatId })
      .then((allowed) => {
        if (!cancelled) setPostRights((current) => ({ ...current, [activeChatId]: allowed }))
      })
      .catch(() => {
        // Kept unknown on purpose: a failed lookup retries the next time the
        // channel opens, and the bar simply stays without the keyboard.
      })
    return () => {
      cancelled = true
    }
  }, [activeChatId, isChannel, postRights])

  const canPost = !isChannel || (activeChatId !== null && postRights[activeChatId] === true)
  /** A channel's composer is closed until the bar's keyboard button opens it. */
  const channelInputOpen = isChannel && channelInputChatId === activeChatId

  const toggleMute = useCallback(async (): Promise<void> => {
    if (!chat || muteBusy) return
    setMuteBusy(true)
    try {
      const updated = await invoke('chats:setMuted', { chatId: chat.id, muted: !chat.muted })
      useAppStore.getState().applyChatOps([{ op: 'upsert', chat: updated }])
      useAppStore.getState().setToast(updated.muted ? '已静音' : '已取消静音')
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      setMuteBusy(false)
    }
  }, [chat, muteBusy])

  const togglePinned = useCallback(async (): Promise<void> => {
    if (!chat || pinBusy) return
    setPinBusy(true)
    try {
      const updated = await invoke('chats:setPinned', { chatId: chat.id, pinned: !chat.pinned })
      useAppStore.getState().applyChatOps([{ op: 'upsert', chat: updated }])
      useAppStore.getState().setToast(updated.pinned ? '已置顶' : '已取消置顶')
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      setPinBusy(false)
    }
  }, [chat, pinBusy])

  /**
   * 清空聊天记录 removes this account's copy (the adapter sends `revoke: false`),
   * so the other members keep theirs — WeChat's meaning of the row. The transcript
   * is emptied in place rather than refetched: there is nothing left to fetch, and
   * an empty page must not be mistaken for a cold cache.
   */
  const clearHistory = useCallback(async (): Promise<void> => {
    if (activeChatId === null) return
    try {
      await invoke('chats:clearHistory', { chatId: activeChatId })
      useAppStore.getState().setHistory(activeChatId, [], false)
      useAppStore.getState().setToast('聊天记录已清空')
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    }
  }, [activeChatId])

  if (!chat || !activeChatId) return <NoChatPlaceholder />

  const actions = createMessageActions(activeChatId)

  return (
    <main className={`wx-chat${comments ? ' wx-chat--comments' : ''}`}>
      <ChatHeader
        title={chat.title}
        typing={typing}
        infoOpen={infoOpen}
        onToggleInfo={toggleInfo}
      />

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
          hasNewer={hasNewer}
          loadingOlder={loadingOlder}
          onLoadNewer={() => {
            void loadNewer()
          }}
          onReturnToLatest={returnToLatest}
          landing={pendingLanding?.chatId === activeChatId ? pendingLanding.position : null}
          located={located?.chatId === activeChatId ? located.messageId : null}
          unreadMarker={
            unreadMarkers[activeChatId]?.unread ? (unreadMarkers[activeChatId] ?? null) : null
          }
          onSeenUpToChange={(messageId) =>
            setSeen(messageId === null ? null : { chatId: activeChatId, messageId })
          }
          onLoadOlder={loadOlder}
          onPrefetchOlder={prefetchOlder}
          canReply={canPost}
          onReply={(message) => {
            useAppStore.getState().setReplyTo(activeChatId, message.id)
            // A channel replies through its composer, which the bar keeps closed
            // until the keyboard switch is pressed.
            if (isChannel) setChannelInputChatId(activeChatId)
          }}
          onEdit={(message) =>
            useAppStore
              .getState()
              .setEditing({ chatId: activeChatId, messageId: message.id, text: message.text })
          }
          onDelete={setDeleting}
          onForward={setForwarding}
          onCopy={actions.copy}
          onOpenComments={openComments}
        />
      )}

      {!isChannel || (canPost && channelInputOpen) ? (
        <Composer
          chatId={activeChatId}
          replyTo={replyTo}
          editing={editingForChat}
          onSend={actions.send}
          onSaveEdit={actions.saveEdit}
          onCancelReply={() => useAppStore.getState().setReplyTo(activeChatId, null)}
          onCancelEdit={() => useAppStore.getState().setEditing(null)}
          {...(isChannel ? { onCollapse: () => setChannelInputChatId(null) } : {})}
        />
      ) : (
        // A channel's bottom edge is WeChat's 服务号 card instead of a composer:
        // 静音 always, and the keyboard switch only when posting is allowed.
        <ChannelBar
          muted={chat.muted}
          canPost={canPost}
          busy={muteBusy}
          onToggleMute={() => {
            void toggleMute()
          }}
          onOpenInput={() => setChannelInputChatId(activeChatId)}
        />
      )}

      {info ? (
        <ChatInfoPanel
          chat={chat}
          open={info.open}
          muting={muteBusy}
          pinning={pinBusy}
          onToggleMuted={() => {
            void toggleMute()
          }}
          onTogglePinned={() => {
            void togglePinned()
          }}
          onRequestClear={() => setClearConfirm(true)}
          onClose={closeInfo}
          onLocate={(messageId) => {
            closeInfo()
            useAppStore.getState().requestLocate(chat.id, messageId)
          }}
        />
      ) : null}

      {comments ? (
        <CommentPanel
          /* The live store row, not the snapshot taken on open: posting a comment
             patches `interaction.comments` through an `interaction` op, and the
             panel's header follows it. */
          message={messages.find((item) => item.id === comments.message.id) ?? comments.message}
          open={comments.open}
          onClose={closeComments}
        />
      ) : null}

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

      {clearConfirm ? (
        <ConfirmDialog
          title="清空聊天记录？"
          description="将删除此聊天中你可见的全部消息，其他成员不受影响。"
          confirmLabel="清空"
          danger
          onConfirm={() => {
            setClearConfirm(false)
            void clearHistory()
          }}
          onCancel={() => setClearConfirm(false)}
        />
      ) : null}
    </main>
  )
}
