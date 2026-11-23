import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatSummary } from '@wegram/protocol'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'

import { ArchiveEntry } from './chat-list/ArchiveEntry'
import { ArchivePage } from './chat-list/ArchivePage'
import { ChatRow } from './chat-list/ChatRow'
import { buildChatMenuItems, runChatMenuAction } from './chat-list/chatMenu'
import { SearchHitRow } from './chat-search/SearchHitRow'
import { ContextMenu } from './ContextMenu'
import { SearchTabs } from './chat-search/SearchTabs'
import { OverlayScrollbar } from './OverlayScrollbar'
import { PlusIcon } from './Icon'
import { SearchField } from './SearchField'
import { ARCHIVE_PAGE_ANIM_MS } from '../lib/archivePage'
import { CHAT_ROW_H, LIST_OVERSCAN } from '../lib/listMetrics'
import type { MessageHit, SearchScope } from '../lib/messageSearch'
import { normalizeQuery } from '../lib/search'
import { useChatAvatarPrefetch } from '../lib/useChatAvatarPrefetch'
import { useChatPaging } from '../lib/useChatPaging'
import { useGlobalSearch } from '../lib/useGlobalSearch'
import { useMessageSearch } from '../lib/useMessageSearch'

interface ChatListProps {
  chats: ChatSummary[]
  /** 已归档会话: the second list, opened as a page over this column. */
  archivedChats: ChatSummary[]
  activeChatId: number | null
  query: string
  onQueryChange: (value: string) => void
  onSelect: (chat: ChatSummary) => void
  /** A global-search hit: it may sit outside `chats`, so the shell resolves it itself. */
  onSelectHit: (chat: ChatSummary) => void
  /** A message hit: open that chat, then locate the row inside it. */
  onOpenMessageHit: (hit: MessageHit) => void
  /** The header's circular "+" — opens the new-chat menu under the button. */
  onOpenPlus: (anchor: { x: number; y: number }) => void
}

/**
 * Middle column: search field, "new" button and the conversation rows.
 *
 * The rows are virtualised for the same reason the transcript is: the list is one
 * page away from growing past a screenful (`chats:list` already asks for 100), and
 * a full re-render of every row on each `evt:chats` batch is the difference between
 * a smooth wheel and a stutter. Rows are fixed-height, so no measurement pass.
 *
 * When the pill has text the column swaps faces (design doc §9.2): 聊天 / 频道
 * tabs, the conversations whose name matches (`search:global`), then the actual
 * messages those chats contain (`search:messages`, TDLib `searchMessages` with
 * a chat-type filter). Results are drawn plainly and pages load as the reader
 * reaches the end; Esc or the pill's × brings the conversations back.
 *
 * 已归档会话 is a second page rather than a third face: `ArchiveEntry` (the row
 * above the scroller) opens `ArchivePage`, which slides in from the right over
 * the column. The list below keeps its rows and its scroll position, so coming
 * back needs no reload — see `chat-list/ArchivePage.tsx`.
 */
export function ChatList({
  chats,
  archivedChats,
  activeChatId,
  query,
  onQueryChange,
  onSelect,
  onSelectHit,
  onOpenMessageHit,
  onOpenPlus,
}: ChatListProps) {
  // The scrolling view and the box that hosts the floating scrollbar (the
  // latter must be positioned; see `.wx-list__body`).
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  /** The row whose right-click menu is open, with the point it opened at. */
  const [menu, setMenu] = useState<{ chat: ChatSummary; x: number; y: number } | null>(null)

  /**
   * 已归档会话's page. `open` drives the slide and the page stays mounted until it
   * has slid out (`ARCHIVE_PAGE_ANIM_MS`); the timer is the parent's job because
   * only the parent can decide when the page leaves the tree.
   */
  const [archive, setArchive] = useState<{ open: boolean } | null>(null)
  const archiveTimerRef = useRef<number | null>(null)
  const archiveOpen = archive?.open === true

  const openArchive = useCallback(() => {
    if (archiveTimerRef.current !== null) {
      window.clearTimeout(archiveTimerRef.current)
      archiveTimerRef.current = null
    }
    setArchive({ open: true })
  }, [])

  const closeArchive = useCallback(() => {
    setArchive((current) => (current ? { ...current, open: false } : null))
    if (archiveTimerRef.current !== null) window.clearTimeout(archiveTimerRef.current)
    archiveTimerRef.current = window.setTimeout(() => {
      archiveTimerRef.current = null
      // A reopen during the slide-out cleared the flag already; only a closed
      // page is dropped here.
      setArchive((current) => (current !== null && !current.open ? null : current))
    }, ARCHIVE_PAGE_ANIM_MS)
  }, [])

  useEffect(
    () => () => {
      if (archiveTimerRef.current !== null) window.clearTimeout(archiveTimerRef.current)
    },
    [],
  )

  /**
   * An empty archive is not somewhere to sit: unarchiving its last chat returns
   * to the conversation list, like the client.
   */
  useEffect(() => {
    if (archiveOpen && archivedChats.length === 0) closeArchive()
  }, [archiveOpen, archivedChats.length, closeArchive])

  const openMenu = useCallback((chat: ChatSummary, x: number, y: number) => {
    setMenu({ chat, x, y })
  }, [])

  const needle = normalizeQuery(query)
  const searching = needle !== ''
  const [tab, setTab] = useState<SearchScope>('chat')
  /** Conversations whose title matches, split by the active scope. */
  const { hits: chatHits, loading: chatHitsLoading, error: chatHitsError } = useGlobalSearch(query)
  /** Message text across chats, one page per scope. */
  const { scopes, loadMore } = useMessageSearch(query)
  const conversationHits = chatHits.filter((chat) =>
    tab === 'channel' ? chat.kind === 'channel' : chat.kind !== 'channel',
  )
  const scopeState = scopes[tab]
  const loading = chatHitsLoading || scopeState.loading

  // Both faces (and both search tabs) open at the top, and the virtualiser has to
  // be told through a real scroll event: a programmatic `scrollTop` write bypasses
  // its own listener (renderer/AGENTS.md).
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    scroller.scrollTop = 0
    scroller.dispatchEvent(new Event('scroll'))
  }, [searching, tab])

  const virtualizer = useVirtualizer({
    count: searching ? 0 : chats.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CHAT_ROW_H,
    overscan: LIST_OVERSCAN,
    getItemKey: (index) => chats[index]?.id ?? index,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const firstIndex = virtualItems[0]?.index ?? 0
  const lastIndex = virtualItems[virtualItems.length - 1]?.index ?? -1

  /**
   * 分页 + 头像按需: the window the reader is looking at decides both. Paging
   * only applies to the conversation face (`searching` draws the hits instead),
   * and `-1` disables the avatar pass there for the same reason.
   */
  const paging = useChatPaging('main')
  const ensureLoaded = paging.ensureLoaded
  useEffect(() => {
    if (searching) return
    ensureLoaded(lastIndex, chats.length)
  }, [searching, lastIndex, chats.length, ensureLoaded])
  useChatAvatarPrefetch(chats, firstIndex, searching ? -1 : lastIndex)

  const openPlus = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    // WeChat hangs the card centred under the round button, 12 px below it.
    onOpenPlus({ x: rect.left + rect.width / 2, y: rect.bottom + 12 })
  }

  /** Esc leaves the archive, then clears the box — before any window-level handler sees it. */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape') return
    if (archiveOpen) {
      event.stopPropagation()
      closeArchive()
      return
    }
    if (!searching) return
    event.stopPropagation()
    onQueryChange('')
  }

  /** Reaching the end of the results asks for the next page of the active scope. */
  const onScroll = (): void => {
    if (!searching) return
    const scroller = scrollRef.current
    if (!scroller) return
    if (scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 160) return
    loadMore(tab)
  }

  return (
    <section className="wx-list" aria-label="会话列表" onKeyDown={onKeyDown}>
      <div className="wx-list__head">
        <SearchField
          value={query}
          onValueChange={onQueryChange}
          guardPointer
          trailing={
            query !== '' ? (
              <button
                type="button"
                className="wx-search__clear"
                title="清除"
                aria-label="清除"
                onClick={() => onQueryChange('')}
              >
                ×
              </button>
            ) : undefined
          }
        />
        <button
          className="wx-list__plus"
          title="更多"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={openPlus}
        >
          <PlusIcon size={24} />
        </button>
      </div>

      <div className="wx-list__body" ref={bodyRef}>
        {!searching && archivedChats.length > 0 ? (
          <ArchiveEntry chats={archivedChats} onOpen={openArchive} />
        ) : null}
        <div
          className="wx-list__view"
          ref={scrollRef}
          data-testid="chat-scroller"
          onScroll={onScroll}
        >
          {searching ? (
            <div className="wx-search-panel">
              <SearchTabs value={tab} onChange={setTab} />
              {conversationHits.length > 0 ? (
                <>
                  <div className="wx-search-section">会话</div>
                  {conversationHits.map((chat) => (
                    <ChatRow
                      key={chat.id}
                      chat={chat}
                      active={chat.id === activeChatId}
                      onSelect={onSelectHit}
                      onContextMenu={openMenu}
                      highlight={needle}
                    />
                  ))}
                </>
              ) : null}
              {scopeState.error !== null ? (
                <div className="wx-list__empty">{scopeState.error}</div>
              ) : scopeState.hits.length > 0 ? (
                <>
                  <p className="wx-search-found">找到 {scopeState.total} 条消息</p>
                  {scopeState.hits.map((hit) => (
                    <SearchHitRow
                      key={hit.chat.id + ':' + hit.message.id}
                      hit={hit}
                      onOpen={onOpenMessageHit}
                    />
                  ))}
                  {scopeState.loadingMore ? <p className="wx-search-note">正在加载…</p> : null}
                </>
              ) : loading ? (
                <div className="wx-list__empty">正在搜索…</div>
              ) : conversationHits.length === 0 && chatHitsError === null ? (
                <div className="wx-list__empty">没有找到相关内容</div>
              ) : null}
            </div>
          ) : chats.length === 0 ? (
            <div className="wx-list__empty">还没有会话</div>
          ) : (
            <div className="wx-list__sizer" style={{ height: virtualizer.getTotalSize() }}>
              {virtualItems.map((virtualItem) => {
                const chat = chats[virtualItem.index]
                if (!chat) return null
                return (
                  <div
                    key={virtualItem.key}
                    className="wx-list__slot"
                    data-index={virtualItem.index}
                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                  >
                    <ChatRow
                      chat={chat}
                      active={chat.id === activeChatId}
                      onSelect={onSelect}
                      onContextMenu={openMenu}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <OverlayScrollbar scrollerRef={scrollRef} hostRef={bodyRef} />
      </div>

      {archive !== null ? (
        <ArchivePage
          chats={archivedChats}
          activeChatId={activeChatId}
          open={archive.open}
          onSelect={onSelect}
          onContextMenu={openMenu}
          onBack={closeArchive}
        />
      ) : null}

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildChatMenuItems(menu.chat, (action) => {
            const chat = menu.chat
            setMenu(null)
            void runChatMenuAction(chat, action)
          })}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </section>
  )
}
