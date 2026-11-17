import type { ChatSummary } from '@wegram/protocol'
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'

import { AppMenu } from './AppMenu'
import { ChatList } from './ChatList'
import { ChatPane } from './chat-pane'
import { PlusMenu } from './PlusMenu'
import { ProxyPanel } from './ProxyPanel'
import { SideRail } from './SideRail'
import { errorMessage, invoke } from '../lib/ipc'
import { useAppStore } from '../store/useAppStore'

interface Anchor {
  x: number
  y: number
}

export function MainShell() {
  const chats = useAppStore((state) => state.chats)
  const activeChatId = useAppStore((state) => state.activeChatId)
  const error = useAppStore((state) => state.error)
  const setError = useAppStore((state) => state.setError)
  const toast = useAppStore((state) => state.toast)
  const setToast = useAppStore((state) => state.setToast)

  const [query, setQuery] = useState('')
  /**
   * The field stays responsive while the list recomputes: typing filters synchronously
   * today, which on a full page of chats means every keystroke waits for the render of
   * every row. `query` still feeds the input and the "no matches" copy.
   */
  const deferredQuery = useDeferredValue(query)
  const [proxyOpen, setProxyOpen] = useState(false)
  /** The rail's "≡" menu (settings / theme / sign out). */
  const [menu, setMenu] = useState<Anchor | null>(null)
  /** The list header's "+" menu (发起群聊 / 添加朋友 / 写笔记). */
  const [plusMenu, setPlusMenu] = useState<Anchor | null>(null)

  // Toasts are fire-and-forget and owned here: the rail can raise one before a
  // conversation is even open.
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => useAppStore.getState().setToast(null), 2200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const filteredChats = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase()
    if (!needle) return chats
    return chats.filter((chat) => chat.title.toLowerCase().includes(needle))
  }, [chats, deferredQuery])

  /**
   * Selecting the row that is already open toggles the conversation shut: the
   * right pane goes back to its initial watermark state and the list keeps its
   * filter, so the reader can pick the same or another chat again.
   */
  /**
   * Stable for the life of the shell, so memoised rows keep their identity when the
   * selection changes: everything it needs is read from the store at call time
   * (`activeChatId` included — reading the prop would rebuild the callback on every
   * selection and re-render the whole list).
   */
  const openChat = useCallback((chat: ChatSummary): void => {
    const store = useAppStore.getState()
    if (chat.id === store.activeChatId) {
      store.setActiveChat(null)
      return
    }

    // Snapshot before `chats:open` reports the chat as read, or the unread
    // divider would disappear before the list ever mounts.
    store.setUnreadMarker(
      chat.id,
      chat.unread > 0
        ? { lastReadInboxMessageId: chat.lastReadInboxMessageId ?? null, unread: chat.unread }
        : null,
    )
    store.setActiveChat(chat.id)
    // History is loaded by ChatPane; this only triggers read state.
    void invoke('chats:open', { chatId: chat.id }).catch((cause) => {
      useAppStore.getState().setError(errorMessage(cause))
    })
  }, [])

  return (
    <div className="wx-app">
      {/* WeChat paints one flat strip above all three columns; the native window
          controls are drawn over its right end by titleBarOverlay. */}
      <div className="wx-titlebar" />

      {error ? (
        <div className="wx-error-bar">
          <span>{error}</span>
          <button className="wx-icon-button" onClick={() => setError(null)} title="关闭">
            ×
          </button>
        </div>
      ) : null}

      <div className="wx-body">
        <SideRail
          onOpenMenu={(anchor) => setMenu(anchor)}
          onUnavailable={(label) => setToast(`${label}还没有接入，先看聊天吧`)}
        />
        <ChatList
          chats={filteredChats}
          activeChatId={activeChatId}
          query={query}
          onQueryChange={setQuery}
          onSelect={openChat}
          onOpenPlus={(anchor) => setPlusMenu(anchor)}
        />
        <ChatPane />
      </div>

      {plusMenu ? (
        <PlusMenu
          x={plusMenu.x}
          y={plusMenu.y}
          onClose={() => setPlusMenu(null)}
          onUnavailable={(label) => setToast(`${label}还没有接入，先看聊天吧`)}
        />
      ) : null}

      {menu ? (
        <AppMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onOpenSettings={() => setProxyOpen(true)}
        />
      ) : null}

      {proxyOpen ? (
        <ProxyPanel
          onClose={() => {
            setProxyOpen(false)
            void refreshChats()
          }}
        />
      ) : null}

      {toast ? <div className="wx-toast">{toast}</div> : null}
    </div>
  )
}

async function refreshChats(): Promise<void> {
  try {
    const chats = await invoke('chats:list', { limit: 100, offset: 0 })
    useAppStore.getState().setChats(chats)
  } catch {
    // A failed refresh after the settings dialog is not worth interrupting the user.
  }
}
