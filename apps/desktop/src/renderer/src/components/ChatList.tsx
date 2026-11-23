import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatSummary } from '@wegram/protocol'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'

import { ArchiveEntry } from './chat-list/ArchiveEntry'
import { ArchivePage } from './chat-list/ArchivePage'
import { TopicsSidebar } from './chat-list/TopicsSidebar'
import { ChatRow } from './chat-list/ChatRow'
import { buildChatMenuItems, runChatMenuAction } from './chat-list/chatMenu'
import { SearchHitRow } from './chat-search/SearchHitRow'
import { ContextMenu } from './ContextMenu'
import { SearchTabs } from './chat-search/SearchTabs'
import { OverlayScrollbar } from './OverlayScrollbar'
import { PlusIcon } from './Icon'
import { SearchField } from './SearchField'
import { ARCHIVE_PAGE_ANIM_MS } from '../lib/archivePage'
import { TOPICS_PAGE_ANIM_MS } from '../lib/topics'
import { CHAT_ROW_H, LIST_OVERSCAN } from '../lib/listMetrics'
import type { MessageHit, SearchScope } from '../lib/messageSearch'
import { normalizeQuery } from '../lib/search'
import { useChatAvatarPrefetch } from '../lib/useChatAvatarPrefetch'
import { useChatPaging } from '../lib/useChatPaging'
import { useAppStore } from '../store/useAppStore'
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
 * 已归档会话 is a second page rather than a third face: `ArchiveEntry` (the list's
 * own first row, above the first conversation) opens `ArchivePage`, which slides
 * in from the right over the column. The list below keeps its rows and its scroll
 * position, so coming back needs no reload — see `chat-list/ArchivePage.tsx`.
 *
 * That row scrolls with the rows instead of being pinned above them, and the list
 * rests one row further down (`CHAT_ROW_H`), so the row starts just out of view
 * and the reader scrolls up to find it.
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
  /**
   * 话题 (design doc §9.12): while the open chat is a forum, this column shows its
   * topic list — the 已归档会话 gesture one column to the left. The message pane
   * keeps the transcript, so picking a topic swaps it instead of covering it.
   */
  const [topicsPage, setTopicsPage] = useState<{ open: boolean; chat: ChatSummary } | null>(null)
  const topicsTimerRef = useRef<number | null>(null)
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
      if (topicsTimerRef.current !== null) window.clearTimeout(topicsTimerRef.current)
    },
    [],
  )

  /**
   * The row whose conversation the pane is showing. It can be in either list, like
   * the pane's own lookup: an archived forum opens its topics too.
   */
  const activeChat =
    chats.find((chat) => chat.id === activeChatId) ??
    archivedChats.find((chat) => chat.id === activeChatId) ??
    null
  /** A tabs forum draws its topics above the messages, so this column stays a list. */
  const forumLayout = useAppStore((state) =>
    activeChatId === null ? undefined : state.forumLayoutByChat[activeChatId],
  )
  const forumActive = activeChat?.forum === true && forumLayout !== 'tabs'
  /** Close the page with its slide; the column unmounts it afterwards. */
  const closeTopicsPage = useCallback((): void => {
    setTopicsPage((current) => (current ? { ...current, open: false } : null))
    if (topicsTimerRef.current !== null) window.clearTimeout(topicsTimerRef.current)
    topicsTimerRef.current = window.setTimeout(() => {
      topicsTimerRef.current = null
      setTopicsPage((current) => (current !== null && !current.open ? null : current))
    }, TOPICS_PAGE_ANIM_MS)
  }, [])

  /**
   * A forum's page slides in as soon as the chat opens (the official client opens
   * a forum on its topics) and slides out when the chat closes. It keeps its own
   * copy of the chat, so the slide still has a title to draw after `activeChatId`
   * has been cleared.
   */
  useEffect(() => {
    if (!forumActive || activeChat === null) {
      closeTopicsPage()
      return
    }
    if (topicsTimerRef.current !== null) {
      window.clearTimeout(topicsTimerRef.current)
      topicsTimerRef.current = null
    }
    setTopicsPage({ open: true, chat: activeChat })
  }, [forumActive, activeChat, activeChatId, closeTopicsPage])

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

  /**
   * 已归档会话's row is the conversation list's **first row** rather than a bar
   * pinned above the scroller, so it scrolls away like any other row and the list
   * can move on without it.
   */
  const archiveRowShown = !searching && archivedChats.length > 0
  /** The content above the virtualised rows: the entry's own height, or nothing. */
  const listOffset = archiveRowShown ? CHAT_ROW_H : 0
  /** The reader has scrolled the row into view once: never hide it again after that. */
  const archiveRowFoundRef = useRef(false)
  /** Set while this component writes `scrollTop` itself, so the scroll event it
   *  dispatches is not mistaken for the reader moving the list. */
  const selfScrollRef = useRef(false)

  /**
   * One programmatic scroll. The virtualiser re-reads its offset only on a real
   * scroll event (renderer/AGENTS.md), and the flag keeps that event out of the
   * reader-driven logic below.
   */
  const scrollTo = useCallback((top: number) => {
    const scroller = scrollRef.current
    if (!scroller) return
    selfScrollRef.current = true
    scroller.scrollTop = top
    scroller.dispatchEvent(new Event('scroll'))
    selfScrollRef.current = false
  }, [])

  // Both faces (and both search tabs) open at the top of the rows, and the
  // virtualiser has to be told through a real scroll event: a programmatic
  // `scrollTop` write bypasses its own listener (renderer/AGENTS.md). A reset is
  // also a fresh look at the list, so 已归档会话's row goes back to being out of
  // view and the effect below puts the list at its resting position again. A layout
  // effect so it runs before that one, and before the paint: a passive effect runs
  // after every layout effect, which would leave the row visible for a frame and,
  // worse, let the resting effect decide on the stale "row already found" flag.
  useLayoutEffect(() => {
    archiveRowFoundRef.current = false
    scrollTo(0)
  }, [searching, tab, scrollTo])

  // 已归档会话's row starts out of view: while the list still rests at its very top
  // (mount, the first page of conversations landing, back from search) it is moved
  // down one row. A reader who has already scrolled is never yanked, and once the
  // row has been seen the list stops doing this for good. A layout effect because
  // the move must happen before the paint — otherwise the row flashes into view on
  // the frame the first page lands.
  useLayoutEffect(() => {
    if (archiveRowFoundRef.current) return
    if (!archiveRowShown) return
    const scroller = scrollRef.current
    if (!scroller || scroller.scrollTop > 0) return
    // Nothing to scroll yet — the first page of conversations has not landed.
    if (scroller.scrollHeight <= scroller.clientHeight) return
    scrollTo(listOffset)
  }, [archiveRowShown, listOffset, chats.length, scrollTo])

  const virtualizer = useVirtualizer({
    count: searching ? 0 : chats.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CHAT_ROW_H,
    overscan: LIST_OVERSCAN,
    // 已归档会话's row sits in the scroller above the sizer, so the rows start one
    // row further down than the row index says; `scrollMargin` is the virtualiser's
    // own accounting for content before the list.
    scrollMargin: listOffset,
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

  /**
   * A scroll of the reader's own that brings 已归档会话's row into view means the
   * row has been found — from then on the list never moves itself back down.
   * Then: reaching the end of the results asks for the next page of the active
   * scope.
   */
  const onScroll = (): void => {
    const scroller = scrollRef.current
    if (!scroller) return
    // `- 1`: a write that lands exactly on the rest position must not count as
    // the reader finding the row.
    if (!selfScrollRef.current && scroller.scrollTop < CHAT_ROW_H - 1) {
      archiveRowFoundRef.current = true
    }
    if (!searching) return
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
        <div
          className="wx-list__view"
          ref={scrollRef}
          data-testid="chat-scroller"
          onScroll={onScroll}
        >
          {archiveRowShown ? <ArchiveEntry chats={archivedChats} onOpen={openArchive} /> : null}
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
                    // `start` already carries `scrollMargin`, and the sizer itself
                    // begins below the entry row, so the offset is subtracted back.
                    style={{ transform: `translateY(${virtualItem.start - listOffset}px)` }}
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

      {topicsPage !== null ? (
        <TopicsSidebar
          key={topicsPage.chat.id}
          chat={topicsPage.chat}
          open={topicsPage.open}
          // 返回 closes the forum: the topic list IS this column's page while the
          // chat is open, so going back means going back to the conversations.
          onBack={() => useAppStore.getState().setActiveChat(null)}
        />
      ) : null}

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
