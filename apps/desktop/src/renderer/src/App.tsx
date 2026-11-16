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
    const unsubscribers = [
      window.tg.on('evt:auth', ({ payload }) => store.setAuth(payload)),
      window.tg.on('evt:connection', ({ payload }) => store.setConnection(payload)),
      window.tg.on('evt:chats', ({ payload }) => store.applyChatOps(payload.ops)),
      window.tg.on('evt:messages', ({ payload }) =>
        store.applyMessageOps(payload.chatId, payload.ops),
      ),
      window.tg.on('evt:typing', ({ payload }) =>
        store.setTyping(payload.chatId, payload.until > Date.now()),
      ),
      window.tg.on('evt:error', ({ payload }) => store.setError(payload.message)),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
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
