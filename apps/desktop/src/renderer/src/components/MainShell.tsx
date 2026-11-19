import type { ChatSummary, Contact } from '@wegram/protocol'
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'

import { AppMenu } from './AppMenu'
import { ChatList } from './ChatList'
import { ChatPane } from './chat-pane'
import { NoChatPlaceholder } from './chat-pane/Placeholders'
import { ContactDetail, ContactsList } from './contacts'
import { PlusMenu } from './PlusMenu'
import { ProxyPanel } from './ProxyPanel'
import { SectionPlaceholder } from './SectionPlaceholder'
import { SideRail, type ShellSection } from './SideRail'
import { errorMessage, invoke } from '../lib/ipc'
import { activateChat } from '../lib/openChat'
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
  /** Which rail section owns the middle + right columns. */
  const [section, setSection] = useState<ShellSection>('chats')
  /** The account's address book; null until the first `contacts:list` lands. */
  const [contacts, setContacts] = useState<Contact[] | null>(null)
  /** The contact whose card the right pane shows (通讯录 only). */
  const [contactUserId, setContactUserId] = useState<number | null>(null)
  /**
   * The 通讯录 search stays here, not inside the list, so switching to 聊天 and
   * back does not silently drop the filter the reader typed.
   */
  const [contactQuery, setContactQuery] = useState('')

  // Toasts are fire-and-forget and owned here: the rail can raise one before a
  // conversation is even open.
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => useAppStore.getState().setToast(null), 2200)
    return () => window.clearTimeout(timer)
  }, [toast])

  /**
   * The address book is read every time the rail switches to 通讯录, not once at
   * start-up: a contact added on another device then shows up without a restart.
   * TDLib answers from its local cache, so the repeat read is cheap.
   */
  useEffect(() => {
    if (section !== 'contacts') return
    let live = true
    void invoke('contacts:list')
      .then((list) => {
        if (live) setContacts(list)
      })
      .catch((cause) => {
        if (!live) return
        setError(errorMessage(cause))
        // Stop claiming "正在加载…": the error bar already says what went wrong.
        setContacts([])
      })
    return () => {
      live = false
    }
  }, [section, setError])

  /** The selected contact is resolved from the live list: a removed one closes the card. */
  const selectedContact = useMemo(
    () => contacts?.find((contact) => contact.userId === contactUserId) ?? null,
    [contacts, contactUserId],
  )

  /** 公众号、服务号 is still a chat-list fact, not an address-book one. */
  const channelCount = useMemo(
    () => chats.filter((chat) => chat.kind === 'channel').length,
    [chats],
  )

  const showUnavailable = useCallback((label: string) => setToast(`${label}还没有接入`), [setToast])

  /**
   * 发消息 on a contact card: TDLib creates the private chat on first use and
   * answers with it (`chats:openPrivate`), then the shell switches to 聊天.
   */
  const openContactChat = useCallback(
    (contact: Contact) => {
      void (async () => {
        try {
          const chat = await invoke('chats:openPrivate', { userId: contact.userId })
          // Put the row in the list before the pane mounts: for a contact with no
          // conversation yet this is the first time the chat exists at all, and
          // the batched `evt:chats` upsert would land a frame too late (the pane
          // would flash its placeholder).
          useAppStore.getState().applyChatOps([{ op: 'upsert', chat }])
          activateChat(chat)
          setSection('chats')
        } catch (cause) {
          setError(errorMessage(cause))
        }
      })()
    },
    [setError],
  )

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
    activateChat(chat)
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
          section={section}
          onSectionChange={(next) => {
            setSection(next)
            // The "+" card belongs to the conversation list; it must not float
            // over the contact list after the rail switched the column away.
            setPlusMenu(null)
          }}
          onOpenMenu={(anchor) => setMenu(anchor)}
          onUnavailable={showUnavailable}
        />
        {section === 'chats' ? (
          <>
            <ChatList
              chats={filteredChats}
              activeChatId={activeChatId}
              query={query}
              onQueryChange={setQuery}
              onSelect={openChat}
              onOpenPlus={(anchor) => setPlusMenu(anchor)}
            />
            <ChatPane />
          </>
        ) : section === 'contacts' ? (
          <>
            <ContactsList
              contacts={contacts ?? []}
              activeUserId={contactUserId}
              query={contactQuery}
              onQueryChange={setContactQuery}
              onSelect={(contact) => setContactUserId(contact.userId)}
              onUnavailable={showUnavailable}
              channelCount={channelCount}
              loading={contacts === null}
            />
            {selectedContact ? (
              <ContactDetail
                contact={selectedContact}
                onOpenChat={openContactChat}
                onUnavailable={showUnavailable}
              />
            ) : (
              <NoChatPlaceholder />
            )}
          </>
        ) : (
          <SectionPlaceholder section={section} />
        )}
      </div>

      {plusMenu ? (
        <PlusMenu
          x={plusMenu.x}
          y={plusMenu.y}
          onClose={() => setPlusMenu(null)}
          onUnavailable={showUnavailable}
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
