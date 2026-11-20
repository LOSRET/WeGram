import type { ChatSummary, InvokeResponse, Message } from '@wegram/protocol'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import {
  COMMENT_PAGE,
  commentKey,
  formatCount,
  mergeComments,
  withoutCommentBar,
} from '../../lib/comments'
import { resolveCommentLanding } from '../../lib/commentAnchor'
import { messagePreview } from '../../lib/format'
import { selfIdentity } from '../../lib/self'
import { useComposerInput } from '../../lib/useComposerInput'
import { errorMessage, invoke } from '../../lib/ipc'
import { useAppStore } from '../../store/useAppStore'
import { Avatar } from '../Avatar'
import { MessageRow } from '../message-list/MessageRow'
import { senderAvatarUrl } from '../message-list/senderAvatar'
import { OverlayScrollbar } from '../OverlayScrollbar'
import { RichText } from '../RichText'
import { useCommentAnchor } from './useCommentAnchor'

type CommentAccess = InvokeResponse<'messages:commentInfo'>

interface ThreadPage {
  messages: Message[]
  hasMore: boolean
}

/**
 * Fetched threads survive closing the panel, so reopening is instant. A page is
 * still refreshed when the panel opens for a message nothing has fetched yet.
 */
const threadCache = new Map<string, ThreadPage>()

/** Pixels from the top that trigger loading an older page, like the transcript. */
const LOAD_OLDER_AT = 90

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M12.5 4.5 7 10l5.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Telegram's discussion view for one message: the full pane, sliding in from the
 * right over the transcript (design doc §9.8).
 *
 * The comments are drawn with the transcript's own `MessageRow`, so they read like
 * any other conversation (avatar, sender, bubble, hover timestamp, media, stickers);
 * a comment is never allowed to open another discussion view, so its comment bar is
 * stripped. The input at the bottom is the chat composer's card: Enter sends through
 * `messages:sendComment`, which posts into the thread's own supergroup.
 *
 * The panel owns its own transcript: it opens at the top of the thread — the oldest
 * comment loaded, like a channel's comments in WeChat — loads older pages when the
 * reader reaches the top (preserving their position), and keeps fetched pages in a
 * session cache. A position this reader left is restored from `ui.db` like a chat's
 * (`useCommentAnchor`). `open` drives the animation; the parent keeps the panel
 * mounted until the slide-out has finished and then unmounts it.
 */
export function CommentPanel({
  message,
  open,
  onClose,
}: {
  message: Message
  open: boolean
  onClose: () => void
}) {
  const key = commentKey(message.chatId, message.id)
  /**
   * A thread that exists but has no comments yet. TDLib answers
   * `getMessageThreadHistory` for such a thread with "Receive messages in an
   * unexpected chat" (measured on a channel whose posts open with 0 comments),
   * so the empty page is known up front instead of fetched — the panel then says
   * 还没有评论 and offers the composer, which is the point of opening it.
   */
  const threadIsEmpty = message.interaction !== undefined && message.interaction.comments === 0
  const [page, setPage] = useState<ThreadPage | null>(
    () => threadCache.get(key) ?? (threadIsEmpty ? { messages: [], hasMore: false } : null),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [entered, setEntered] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  /**
   * The official client's comment gate (design doc §9.8): whether the account
   * may post in the discussion group, whether a join button is the next step,
   * and the slow-mode countdown. `null` means "still checking".
   */
  const [access, setAccess] = useState<CommentAccess | null>(null)
  const [accessError, setAccessError] = useState<string | null>(null)
  const [joinBusy, setJoinBusy] = useState(false)
  const [requestSent, setRequestSent] = useState(false)
  const [slowLeft, setSlowLeft] = useState(0)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const backRef = useRef<HTMLButtonElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const requestRef = useRef(0)
  const loadingRef = useRef(false)
  /** Scroll geometry captured before an older page is prepended. */
  const pendingRestoreRef = useRef<{ height: number; top: number } | null>(null)
  const landedRef = useRef(false)

  const auth = useAppStore((state) => state.auth)
  const userAvatars = useAppStore((state) => state.userAvatars)

  const self = useMemo(() => selfIdentity(auth), [auth])

  /** The stored reading position of this thread, and its default-on-scroll writer. */
  const { anchor, anchorKnown, scheduleSave } = useCommentAnchor({
    chatId: message.chatId,
    messageId: message.id,
    scrollRef,
    listRef,
  })

  /**
   * One pseudo chat for every row: the comments live in the discussion group, not
   * in the chat the reader opened, but the transcript only needs a kind and an id
   * to lay a group message out.
   */
  const discussionChatId = page?.messages[0]?.chatId ?? message.chatId
  const discussionChat = useMemo<ChatSummary>(
    () => ({
      id: discussionChatId,
      title: '',
      kind: 'group',
      unread: 0,
      pinned: false,
      muted: false,
    }),
    [discussionChatId],
  )

  /** Rows in the panel never open a return trip: no message menu, no nested thread. */
  const noopMenu = useCallback((): void => undefined, [])
  const noopComments = useCallback((): void => undefined, [])

  const total = message.interaction?.comments ?? page?.messages.length ?? 0

  const loadAccess = useCallback(async (): Promise<void> => {
    try {
      const info = await invoke('messages:commentInfo', {
        chatId: message.chatId,
        messageId: message.id,
      })
      setAccess(info)
      setAccessError(null)
      setSlowLeft(info.slowModeSeconds)
      if (info.canComment) setRequestSent(false)
    } catch (err) {
      setAccessError(errorMessage(err))
    }
  }, [message.chatId, message.id])

  useEffect(() => {
    void loadAccess()
  }, [loadAccess])

  // The server counts the remaining slow-mode seconds down; mirror it locally
  // so the send button re-enables without polling.
  useEffect(() => {
    if (slowLeft <= 0) return
    const timer = window.setTimeout(() => setSlowLeft(slowLeft - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [slowLeft])

  const joinGroup = async (): Promise<void> => {
    if (joinBusy) return
    setJoinBusy(true)
    try {
      const result = await invoke('messages:joinCommentGroup', {
        chatId: message.chatId,
        messageId: message.id,
      })
      setRequestSent(result.requestSent)
      await loadAccess()
    } catch (err) {
      useAppStore.getState().setError(errorMessage(err))
    } finally {
      setJoinBusy(false)
    }
  }

  const load = useCallback(
    async (from?: number) => {
      if (loadingRef.current) return
      const ticket = ++requestRef.current
      loadingRef.current = true
      setLoading(true)
      setError(null)
      const scroller = scrollRef.current
      const pending =
        from !== undefined && scroller
          ? { height: scroller.scrollHeight, top: scroller.scrollTop }
          : null
      if (pending) pendingRestoreRef.current = pending
      try {
        const answer = await invoke('messages:comments', {
          chatId: message.chatId,
          messageId: message.id,
          ...(from === undefined ? {} : { fromMessageId: from }),
          limit: COMMENT_PAGE,
        })
        if (ticket !== requestRef.current) return
        setPage((current) => {
          const incoming = answer.messages.map(withoutCommentBar)
          const next: ThreadPage =
            from === undefined
              ? { messages: incoming, hasMore: answer.hasMore }
              : {
                  messages: mergeComments(current?.messages ?? [], incoming),
                  hasMore: answer.hasMore,
                }
          threadCache.set(key, next)
          return next
        })
      } catch (err) {
        pendingRestoreRef.current = null
        if (ticket === requestRef.current) setError(errorMessage(err))
      } finally {
        if (ticket === requestRef.current) {
          loadingRef.current = false
          setLoading(false)
        }
      }
    },
    [key, message.chatId, message.id],
  )

  // The first page: the cache answers instantly, otherwise one request. Where the
  // list lands is decided once, in the layout effect below (a saved row or the top).
  useEffect(() => {
    if (page === null && !loadingRef.current && error === null) void load()
  }, [error, load, page])

  // Slide in: mount closed (translateX(100 %)), open on the next paint. The
  // timeout is the fallback for an occluded window, where rAF is throttled.
  useEffect(() => {
    if (!open) {
      setEntered(false)
      return
    }
    const timer = window.setTimeout(() => setEntered(true), 20)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    backRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Prepend compensation and the initial landing both live here: after the DOM
  // has the new rows, not before.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const pending = pendingRestoreRef.current
    if (pending) {
      pendingRestoreRef.current = null
      el.scrollTop = pending.top + (el.scrollHeight - pending.height)
      return
    }
    if (landedRef.current || page === null || !anchorKnown) return
    landedRef.current = true
    /**
     * Default landing: the top of the thread. A channel's comments are read from
     * there, unlike a chat, which opens on its newest message. A stored row wins
     * while it is still inside the loaded window (`resolveCommentLanding`).
     */
    const landing = resolveCommentLanding(page.messages, anchor)
    const row =
      landing && listRef.current
        ? listRef.current.querySelector<HTMLElement>(`[data-message-id="${landing.messageId}"]`)
        : null
    if (!landing || !row) {
      el.scrollTop = 0
      return
    }
    el.scrollTop = Math.max(
      0,
      el.scrollTop +
        row.getBoundingClientRect().top -
        el.getBoundingClientRect().top -
        landing.offset,
    )
  }, [anchor, anchorKnown, page])

  const onScroll = (): void => {
    scheduleSave()
    const el = scrollRef.current
    if (!el || !page?.hasMore || loadingRef.current) return
    if (el.scrollTop > LOAD_OLDER_AT) return
    const oldest = page.messages[0]?.id
    if (oldest !== undefined) void load(oldest)
  }

  /** Appends the comment the input just posted and keeps the reader at the bottom. */
  const appendSent = (sent: Message): void => {
    const prepared = withoutCommentBar(sent)
    setPage((current) => {
      const next: ThreadPage = current
        ? { messages: [...current.messages, prepared], hasMore: current.hasMore }
        : { messages: [prepared], hasMore: false }
      threadCache.set(key, next)
      return next
    })
    window.setTimeout(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    }, 0)
  }

  const send = async (): Promise<void> => {
    const value = draft.trim()
    if (!value || sending) return
    setSending(true)
    try {
      const answer = await invoke('messages:sendComment', {
        chatId: message.chatId,
        messageId: message.id,
        text: value,
      })
      setDraft('')
      appendSent(answer.message)
      // Slow mode restarts after every message; re-read the countdown.
      void loadAccess()
    } catch (err) {
      useAppStore.getState().setError(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  /** Same Enter rule as the chat composer (§8.4). */
  const { inputHandlers } = useComposerInput({ onSend: () => void send() })

  const post = message.text ? message.text : messagePreview(message)
  const stats = [
    message.interaction?.views ? `阅读 ${formatCount(message.interaction.views)}` : '',
    message.interaction?.forwards ? `转发 ${formatCount(message.interaction.forwards)}` : '',
  ].filter(Boolean)
  const shown = page?.messages ?? []
  const sendReady = !sending && slowLeft <= 0 && draft.trim().length > 0

  return (
    <section
      className={`wx-comments-panel${entered ? ' is-open' : ''}`}
      role="dialog"
      aria-label={`评论，共 ${total} 条`}
      aria-hidden={!open}
    >
      <header className="wx-comments-panel__header">
        <button
          ref={backRef}
          className="wx-ghost-btn wx-comments-panel__back"
          onClick={onClose}
          title="返回"
          aria-label="返回"
        >
          <BackIcon />
        </button>
        <div className="wx-comments-panel__titles">
          <h2 className="wx-comments-panel__title">评论</h2>
          <span className="wx-comments-panel__subtitle">{formatCount(total)} 条评论</span>
        </div>
      </header>

      <div className="wx-comments-panel__body" ref={hostRef}>
        <div className="wx-comments-panel__post">
          <Avatar
            className="wx-comments-panel__post-avatar"
            url={message.senderAvatarUrl}
            name={message.senderName}
            colorId={message.senderChatId || message.senderId || message.chatId}
          />
          <div className="wx-comments-panel__post-main">
            <span className="wx-comments-panel__post-name">{message.senderName}</span>
            <div className="wx-comments-panel__post-text">
              <RichText text={post} entities={message.entities} />
            </div>
            {stats.length > 0 ? (
              <span className="wx-comments-panel__stats">{stats.join(' · ')}</span>
            ) : null}
          </div>
        </div>

        <div className="wx-comments-panel__scroll" ref={scrollRef} onScroll={onScroll}>
          <div className="wx-comments-panel__list" ref={listRef}>
            {error ? (
              <div className="wx-comments-panel__hint">
                <span>{error}</span>
                <button
                  className="wx-comments-panel__retry"
                  onClick={() => void load(shown[0]?.id)}
                >
                  重试
                </button>
              </div>
            ) : page === null || (loading && shown.length === 0) ? (
              <div className="wx-comments-panel__hint">正在加载评论…</div>
            ) : shown.length === 0 ? (
              <div className="wx-comments-panel__hint">还没有评论</div>
            ) : (
              <>
                {page.hasMore && loading ? (
                  <div className="wx-comments-panel__hint">正在加载更早的评论…</div>
                ) : null}
                {shown.map((comment) => (
                  /**
                   * The wrapper is the anchor slot: `useCommentAnchor` measures the
                   * first visible `data-message-id` row, so it must exist for every
                   * comment (a service row carries none and is simply skipped).
                   */
                  <div key={comment.id} data-message-id={comment.id}>
                    <MessageRow
                      chat={discussionChat}
                      messages={[comment]}
                      repliedTo={null}
                      self={self}
                      avatarUrl={senderAvatarUrl(comment, discussionChat, self, userAvatars)}
                      readOutboxMaxId={Number.MAX_SAFE_INTEGER}
                      onOpenMenu={noopMenu}
                      onOpenComments={noopComments}
                    />
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <OverlayScrollbar scrollerRef={scrollRef} hostRef={hostRef} />

        {/* The footer follows the official client's comment gate: composer,
            join button, or a read-only hint (design doc §9.8). */}
        {access === null ? (
          <div className="wx-comments-panel__footer">
            <span className="wx-comments-panel__hint">{accessError ?? '正在确认评论权限…'}</span>
          </div>
        ) : requestSent ? (
          <div className="wx-comments-panel__footer">
            <span className="wx-comments-panel__hint">已申请加入讨论组，等待管理员通过</span>
          </div>
        ) : access.canComment ? (
          <div className="wx-composer wx-comments-panel__composer">
            {slowLeft > 0 ? (
              <div className="wx-comments-panel__slow">慢速模式：{slowLeft} 秒后可发送</div>
            ) : null}
            <div className="wx-composer__card">
              <textarea
                ref={textareaRef}
                className="wx-composer__input"
                placeholder="写评论…"
                title="Enter 发送 · Shift+Enter 换行"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                {...inputHandlers}
              />
              <div className="wx-composer__actions">
                <div className="wx-composer__tools" />
                <button
                  className={`wx-send-button${sendReady ? ' wx-send-button--ready' : ''}`}
                  onClick={() => void send()}
                  disabled={!sendReady}
                >
                  {sending ? '发送中' : '发送'}
                </button>
              </div>
            </div>
          </div>
        ) : access.canJoin ? (
          <div className="wx-comments-panel__footer">
            <button
              className="wx-comments-panel__join"
              onClick={() => void joinGroup()}
              disabled={joinBusy}
            >
              {joinBusy ? '正在加入…' : access.joinByRequest ? '申请加入讨论组' : '加入讨论组'}
            </button>
          </div>
        ) : (
          <div className="wx-comments-panel__footer">
            <span className="wx-comments-panel__hint">你无法在这个讨论组发言</span>
          </div>
        )}
      </div>
    </section>
  )
}
