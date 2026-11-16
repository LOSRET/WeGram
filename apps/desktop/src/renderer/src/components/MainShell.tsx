import { formatChatTime } from '@renderer/lib/format'
import type { ChatSummary } from '@wechatgram/protocol'
import { useMemo, useState } from 'react'

import { ChatList } from './ChatList'
import { ChatPane } from './ChatPane'
import { ProxyPanel } from './ProxyPanel'
import { TitleBar } from './TitleBar'
import { errorMessage, invoke } from '../lib/ipc'
import { useAppStore } from '../store/useAppStore'

export function MainShell() {
  const info = useAppStore((state) => state.info)
  const chats = useAppStore((state) => state.chats)
  const activeChatId = useAppStore((state) => state.activeChatId)
  const error = useAppStore((state) => state.error)
  const setError = useAppStore((state) => state.setError)

  const [query, setQuery] = useState('')
  const [proxyOpen, setProxyOpen] = useState(false)

  const filteredChats = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return chats
    return chats.filter((chat) => chat.title.toLowerCase().includes(needle))
  }, [chats, query])

  const openChat = async (chat: ChatSummary) => {
    useAppStore.getState().setActiveChat(chat.id)
    try {
      // History is loaded by ChatPane; this only triggers read state.
      await invoke('chats:open', { chatId: chat.id })
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <div className="wx-app">
      <TitleBar
        query={query}
        onQueryChange={setQuery}
        onOpenSettings={() => setProxyOpen(true)}
      />

      {error ? (
        <div className="wx-error-bar">
          <span>{error}</span>
          <button className="wx-icon-button" onClick={() => setError(null)} title="关闭">
            ×
          </button>
        </div>
      ) : null}

      <div className="wx-body">
        <ChatList
          chats={filteredChats}
          activeChatId={activeChatId}
          onSelect={(chat) => void openChat(chat)}
        />
        <ChatPane />
      </div>

      {proxyOpen ? (
        <ProxyPanel
          onClose={() => {
            setProxyOpen(false)
            void refreshChats()
          }}
        />
      ) : null}

      <div className="wx-footer">
        <span>
          {info?.adapter === 'mock'
            ? 'Mock 适配器：未配置 TELEGRAM_API_ID / TELEGRAM_API_HASH'
            : `TDLib · v${info?.appVersion ?? '0.1.0'}`}
        </span>
        <span>最近同步 {formatChatTime(Math.floor(Date.now() / 1000))}</span>
      </div>
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
