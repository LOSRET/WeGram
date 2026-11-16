import { errorMessage, invoke } from '@renderer/lib/ipc'
import { MainShell } from '@renderer/components/MainShell'
import { PerfPanel } from '@renderer/components/PerfPanel'
import { LoginScreen } from '@renderer/screens/LoginScreen'
import { useAppStore } from '@renderer/store/useAppStore'
import { useEffect } from 'react'

export function App() {
  const auth = useAppStore((state) => state.auth)
  const theme = useAppStore((state) => state.theme)
  const ready = auth.kind === 'ready'

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])

  // One subscription set for the whole app: every store mutation flows from here.
  useEffect(() => {
    const store = useAppStore.getState()
    const typingTimers = new Map<number, number>()

    const scheduleTypingExpiry = (chatId: number, until: number): void => {
      const existing = typingTimers.get(chatId)
      if (existing !== undefined) window.clearTimeout(existing)
      const delay = Math.max(0, until - Date.now()) + 250
      typingTimers.set(
        chatId,
        window.setTimeout(() => {
          typingTimers.delete(chatId)
          useAppStore.getState().setTyping(chatId, false)
        }, delay),
      )
    }

    const unsubscribers = [
      window.tg.on('evt:auth', ({ payload }) => store.setAuth(payload)),
      window.tg.on('evt:connection', ({ payload }) => store.setConnection(payload)),
      window.tg.on('evt:chats', ({ payload }) => store.applyChatOps(payload.ops)),
      window.tg.on('evt:messages', ({ payload }) =>
        store.applyMessageOps(payload.chatId, payload.ops),
      ),
      window.tg.on('evt:typing', ({ payload }) => {
        // `updateChatAction` is a one-shot event: without an expiry timer the
        // header would claim "typing" forever (§6.1).
        if (payload.until > Date.now()) {
          store.setTyping(payload.chatId, true)
          scheduleTypingExpiry(payload.chatId, payload.until)
        } else {
          store.setTyping(payload.chatId, false)
        }
      }),
      window.tg.on('evt:file', ({ payload }) => {
        useAppStore.getState().setMediaProgress(
          payload.fileId,
          {
            downloaded: payload.downloaded,
            total: payload.total,
            completed: Boolean(payload.completed),
            uploading: Boolean(payload.uploading),
          },
          payload.url,
        )
      }),
      window.tg.on('evt:error', ({ payload }) => store.setError(payload.message)),
    ]
    return () => {
      for (const timer of typingTimers.values()) window.clearTimeout(timer)
      typingTimers.clear()
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const store = useAppStore.getState()
      try {
        const [info, authState, settings] = await Promise.all([
          invoke('app:info'),
          invoke('auth:state'),
          invoke('settings:get'),
        ])
        store.setInfo(info)
        store.setAuth(authState)
        store.setTheme(settings.theme)
      } catch (error) {
        store.setError(errorMessage(error))
      }
    })()
  }, [])

  useEffect(() => {
    if (!ready) return
    void (async () => {
      try {
        const chats = await invoke('chats:list', { limit: 100, offset: 0 })
        useAppStore.getState().setChats(chats)
      } catch (error) {
        useAppStore.getState().setError(errorMessage(error))
      }
    })()
  }, [ready])

  return auth.kind === 'ready' ? (
    <>
      <MainShell />
      {showPerfPanel ? <PerfPanel /> : null}
    </>
  ) : (
    <LoginScreen />
  )
}

const showPerfPanel =
  import.meta.env.DEV && typeof window !== 'undefined' && window.location.search.includes('perf=1')
