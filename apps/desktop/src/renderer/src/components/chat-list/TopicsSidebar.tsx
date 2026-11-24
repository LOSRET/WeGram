import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatSummary, ChatTopic } from '@wegram/protocol'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { formatChatTime } from '../../lib/format'
import { errorMessage, invoke } from '../../lib/ipc'
import { topicBadge, topicSwatch } from '../../lib/topics'
import { useAppStore } from '../../store/useAppStore'
import { ChevronLeftIcon, MoreIcon, PlusIcon } from '../Icon'
import { OverlayScrollbar } from '../OverlayScrollbar'
import { ContextMenu, Popup, type MenuItem } from '../ContextMenu'
import { SearchField } from '../SearchField'
import { useChatTopics } from '../chat-pane/topics/useChatTopics'
import { useEnterOnOpen } from '../../lib/useSlidingPanel'
import { TopicDialog } from './TopicDialog'

/** A topic row is two lines of text on the 64 px rhythm of a conversation row. */
const TOPIC_ROW_H = 64
const LIST_OVERSCAN = 6

interface TopicsSidebarProps {
  chat: ChatSummary
  /** Drives the slide: the column keeps the page mounted until it has closed. */
  open: boolean
  onBack: () => void
}

/**
 * 话题 (design doc §9.12), the page the conversation column shows while a forum is
 * open.
 *
 * It is the 已归档会话 mechanism one column to the left: an OVERLAY inside the
 * conversation column, so the reader picks a topic where they pick conversations
 * and the message pane on the right keeps its transcript. The row that is open is
 * highlighted; choosing another one swaps the transcript instead of leaving the
 * page, and 返回 closes the forum and brings the conversation list back.
 */
export function TopicsSidebar({ chat, open, onBack }: TopicsSidebarProps) {
  const entered = useEnterOnOpen(open)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ topic: ChatTopic; x: number; y: number } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ChatTopic | null>(null)
  /** The create / edit sheet, shared with the tabs layout (`TopicDialog`). */
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit'; topic?: ChatTopic } | null>(
    null,
  )
  const [barMenu, setBarMenu] = useState<{ x: number; y: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const activeTopicId = useAppStore((state) => state.activeTopicId)

  const { topics, loading, hasMore, loadMore } = useChatTopics(chat.id, query)

  const virtualizer = useVirtualizer({
    count: topics.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TOPIC_ROW_H,
    overscan: LIST_OVERSCAN,
    getItemKey: (index) => topics[index]?.id ?? index,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const lastIndex = virtualItems[virtualItems.length - 1]?.index ?? -1
  useEffect(() => {
    // A page arrives as the reader reaches the end; the cursor is in the hook.
    if (hasMore && !loading && lastIndex >= topics.length - 3) void loadMore()
  }, [hasMore, loading, lastIndex, topics.length, loadMore])


  const run = async (work: () => Promise<unknown>): Promise<void> => {
    try {
      await work()
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    }
  }

  /** The official client's topic menu, in its order. */
  const menuItems = (topic: ChatTopic): MenuItem[] => {
    const items: MenuItem[] = [
      {
        label: topic.isPinned ? '取消置顶' : '置顶话题',
        onSelect: () =>
          void run(() =>
            invoke('chats:topicSetPinned', {
              chatId: chat.id,
              topicId: topic.id,
              pinned: !topic.isPinned,
            }),
          ),
      },
    ]
    if (!topic.isGeneral) {
      items.push({
        label: topic.isClosed ? '重新打开话题' : '关闭话题',
        onSelect: () =>
          void run(() =>
            invoke('chats:topicSetClosed', {
              chatId: chat.id,
              topicId: topic.id,
              closed: !topic.isClosed,
            }),
          ),
      })
    }
    items.push({
      label: '编辑话题',
      onSelect: () => setDialog({ mode: 'edit', topic }),
    })
    items.push({
      label: topic.muted ? '取消静音' : '静音',
      onSelect: () =>
        void run(() =>
          invoke('chats:topicSetMuted', {
            chatId: chat.id,
            topicId: topic.id,
            muted: !topic.muted,
          }),
        ),
    })
    if (topic.lastMessageId !== undefined && topic.unread > 0) {
      items.push({
        label: '标为已读',
        onSelect: () =>
          void run(() =>
            invoke('messages:read', {
              chatId: chat.id,
              topicId: topic.id,
              upToMessageId: topic.lastMessageId ?? 0,
            }),
          ),
      })
    }
    items.push({
      label: '复制链接',
      onSelect: () =>
        void run(async () => {
          const link = await invoke('chats:topicLink', { chatId: chat.id, topicId: topic.id })
          if (!link) {
            useAppStore.getState().setToast('这个话题没有可复制的链接')
            return
          }
          await navigator.clipboard.writeText(link.link)
          useAppStore.getState().setToast('链接已复制')
        }),
    })
    if (!topic.isGeneral) {
      items.push({ label: '删除话题', danger: true, onSelect: () => setConfirmDelete(topic) })
    }
    return items
  }


  return (
    <div className={`wx-topics-page${entered && open ? ' is-open' : ''}`}>
      <div className="wx-list__head wx-topics-bar">
        <button
          type="button"
          className="wx-archive-back"
          title="返回"
          aria-label="返回"
          onClick={onBack}
        >
          <ChevronLeftIcon size={14} />
        </button>
        <span className="wx-topics-bar__title" title={`${chat.title} · ${topics.length} 个话题`}>
          {chat.title}
        </span>
        <button
          type="button"
          className="wx-ghost-btn"
          title="更多"
          aria-label="更多"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setBarMenu({ x: rect.right - 8, y: rect.bottom + 6 })
          }}
        >
          <MoreIcon size={16} />
        </button>
        {chat.canCreateTopic === true ? (
          <button
            type="button"
            className="wx-ghost-btn"
            title="新建话题"
            aria-label="新建话题"
            onClick={() => setDialog({ mode: 'create' })}
          >
            <PlusIcon size={16} />
          </button>
        ) : null}
      </div>

      <div className="wx-topics-search">
        <SearchField value={query} onValueChange={setQuery} placeholder="搜索话题" guardPointer />
      </div>

      <div className="wx-topics-body" ref={bodyRef}>
        <div className="wx-topics-view" ref={scrollRef} data-testid="topics-scroller">
          {topics.length === 0 ? (
            <div className="wx-list__empty">
              {loading ? '正在加载话题…' : query.trim() ? '没有匹配的话题' : '还没有话题'}
            </div>
          ) : (
            <div className="wx-topics-sizer" style={{ height: virtualizer.getTotalSize() }}>
              {virtualItems.map((virtualItem) => {
                const topic = topics[virtualItem.index]
                if (!topic) return null
                return (
                  <div
                    key={virtualItem.key}
                    className="wx-topics-slot"
                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                  >
                    <TopicRow
                      topic={topic}
                      active={topic.id === activeTopicId}
                      onOpen={() => useAppStore.getState().setActiveTopic(topic.id)}
                      onContextMenu={(x, y) => setMenu({ topic, x, y })}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <OverlayScrollbar scrollerRef={scrollRef} hostRef={bodyRef} />
      </div>

      {barMenu ? (
        <Popup x={barMenu.x} y={barMenu.y} onClose={() => setBarMenu(null)}>
          <button
            type="button"
            className="wx-context-menu__item"
            role="menuitem"
            onClick={() => {
              setBarMenu(null)
              // 以聊天方式查看: TDLib `toggleChatViewAsTopics`; the chat summary comes
              // back with `forum: false`, so the column returns to the conversations
              // and the pane shows one flat transcript.
              void run(async () => {
                const updated = await invoke('chats:setViewAsTopics', {
                  chatId: chat.id,
                  viewAsTopics: false,
                })
                useAppStore.getState().applyChatOps([{ op: 'upsert', chat: updated }])
                useAppStore.getState().setToast('以聊天方式查看')
              })
            }}
          >
            以聊天方式查看
          </button>
        </Popup>
      ) : null}

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.topic)}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {confirmDelete
        ? createPortal(
            <div
              className="wx-topics-dialog-backdrop"
              onClick={() => setConfirmDelete(null)}
            >
          <div className="wx-topics-dialog" onClick={(event) => event.stopPropagation()}>
            <h2>删除话题？</h2>
            <p>「{confirmDelete.title}」里的全部消息会同时从所有成员那里删除。</p>
            <div className="wx-topics-dialog__actions">
              <button type="button" onClick={() => setConfirmDelete(null)}>
                取消
              </button>
              <button
                type="button"
                className="wx-topics-dialog__danger"
                onClick={() => {
                  const topic = confirmDelete
                  setConfirmDelete(null)
                  void run(() =>
                    invoke('chats:topicDelete', { chatId: chat.id, topicId: topic.id }),
                  )
                }}
              >
                删除
              </button>
            </div>
          </div>
            </div>,
            document.body,
          )
        : null}

      {dialog ? (
        <TopicDialog
          chat={chat}
          mode={dialog.mode}
          {...(dialog.topic ? { topic: dialog.topic } : {})}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  )
}

interface TopicRowProps {
  topic: ChatTopic
  active: boolean
  onOpen: () => void
  onContextMenu: (x: number, y: number) => void
}

/** One 话题 row: icon, name, last message preview, time, unread, pin, lock. */
function TopicRow({ topic, active, onOpen, onContextMenu }: TopicRowProps) {
  const badge = topicBadge(topic)
  return (
    <button
      type="button"
      className={`wx-topic${active ? ' is-active' : ''}`}
      onClick={onOpen}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu(event.clientX, event.clientY)
      }}
    >
      <span className="wx-topic__icon" style={{ background: topicSwatch(topic.iconColor) }}>
        {topic.isGeneral ? '#' : topic.title.slice(0, 1)}
      </span>
      <span className="wx-topic__body">
        <span className="wx-topic__line">
          <span className="wx-topic__name">{topic.title}</span>
          {topic.isPinned ? <span className="wx-topic__pin" title="已置顶">置顶</span> : null}
          {topic.isClosed ? <span className="wx-topic__lock" title="已关闭">已关闭</span> : null}
          <span className="wx-topic__time">{formatChatTime(topic.lastMessageAt)}</span>
        </span>
        <span className="wx-topic__line">
          <span className="wx-topic__preview">{topic.lastMessageText ?? '还没有消息'}</span>
          {badge !== null ? <span className="wx-badge">{badge}</span> : null}
        </span>
      </span>
    </button>
  )
}