import { errorMessage, invoke } from '@renderer/lib/ipc'
import { MainShell } from '@renderer/components/MainShell'
import { PerfPanel } from '@renderer/components/PerfPanel'
import { useAppStore } from '@renderer/store/useAppStore'
import type { MessageOp } from '@wegram/protocol'
import { useEffect } from 'react'

import { classifySeq, needsResync } from './lib/eventSeq'
import { activateChat } from './lib/openChat'

/** Page sizes for the re-sync reads — the same ones the panes open with. */
const RESYNC_CHAT_LIMIT = 100
const RESYNC_MESSAGE_LIMIT = 50
/** Collapse a burst of holes into one repair. */
const RESYNC_DELAY_MS = 250

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

    /**
     * Event-order guard (design doc §7.3, "every event carries `seq`; the renderer is
     * expected to detect gaps and re-sync").
     *
     * Every `evt:*` channel draws from one counter, so a hole means state the
     * renderer will never be told about again: a dropped `evt:chats` batch leaves the
     * list's preview and unread counts stale, a dropped `evt:messages` batch leaves a
     * message missing until the chat is reopened. Instead of pretending, the repair
     * re-reads what the stream mutates and merges it through the same reducer.
     */
    let lastSeq: number | null = null
    let resyncTimer: number | null = null
    let resyncing = false

    const resync = async (): Promise<void> => {
      // Signing in or out resets every collection the repair would touch, and the
      // shell fetches the list itself the moment it becomes ready.
      if (useAppStore.getState().auth.kind !== 'ready' || resyncing) return
      resyncing = true
      try {
        const [chats, archivedChats] = await Promise.all([
          invoke('chats:list', { limit: RESYNC_CHAT_LIMIT, offset: 0 }),
          invoke('chats:list', { limit: RESYNC_CHAT_LIMIT, offset: 0, list: 'archive' }),
        ])
        useAppStore.getState().setChats(chats)
        useAppStore.getState().setArchivedChats(archivedChats)

        const activeChatId = useAppStore.getState().activeChatId
        if (activeChatId !== null) {
          const page = await invoke('messages:history', {
            chatId: activeChatId,
            limit: RESYNC_MESSAGE_LIMIT,
          })
          /**
           * Applied as ops, not written with `setHistory`: `setHistory` replaces the
           * whole list with one page, which would throw away every older page a reader
           * paged back to. `upsertMessage` appends what is missing and overwrites what
           * changed, which is exactly "repair without moving the viewport".
           */
          const ops: MessageOp[] = page.messages.map((message) => ({ op: 'replace', message }))
          useAppStore.getState().applyMessageOps(activeChatId, ops)
        }
      } catch (cause) {
        useAppStore.getState().setError(`事件流断档，重新同步失败：${errorMessage(cause)}`)
      } finally {
        resyncing = false
      }
    }

    const scheduleResync = (): void => {
      if (resyncTimer !== null) return
      resyncTimer = window.setTimeout(() => {
        resyncTimer = null
        void resync()
      }, RESYNC_DELAY_MS)
    }

    const track = (seq: number): void => {
      const verdict = classifySeq(lastSeq, seq)
      // A duplicate keeps the baseline where it is: moving it would turn the next
      // genuinely contiguous event into a "gap".
      if (verdict === 'duplicate') return
      lastSeq = seq
      if (needsResync(verdict)) scheduleResync()
    }

    const unsubscribers = [
      window.tg.on('evt:auth', (event) => {
        track(event.seq)
        store.setAuth(event.payload)
      }),
      window.tg.on('evt:connection', (event) => {
        track(event.seq)
        store.setConnection(event.payload)
      }),
      /**
       * 设置 → 外观 (or the OS, while 跟随系统 is on) repaints the shell from here.
       * The settings window sends the change, so without this event the shell would
       * keep the old theme until the next restart (design doc §9.11.4).
       */
      window.tg.on('evt:theme', (event) => {
        track(event.seq)
        useAppStore.getState().setTheme(event.payload.theme)
      }),
      window.tg.on('evt:settings', (event) => {
        track(event.seq)
        useAppStore.getState().setSendKey(event.payload.sendKey)
      }),
      window.tg.on('evt:chats', (event) => {
        track(event.seq)
        store.applyChatOps(event.payload.ops)
      }),
      window.tg.on('evt:messages', (event) => {
        track(event.seq)
        store.applyMessageOps(event.payload.chatId, event.payload.ops)
      }),
      window.tg.on('evt:avatars', (event) => {
        track(event.seq)
        store.setUserAvatars(event.payload.avatars)
      }),
      window.tg.on('evt:status', (event) => {
        track(event.seq)
        store.setPeerStatus(event.payload.userId, event.payload.status)
      }),
      window.tg.on('evt:typing', (event) => {
        track(event.seq)
        // `updateChatAction` is a one-shot event: without an expiry timer the
        // header would claim "typing" forever (§6.1).
        const { chatId, until } = event.payload
        if (until > Date.now()) {
          store.setTyping(chatId, true)
          scheduleTypingExpiry(chatId, until)
        } else {
          store.setTyping(chatId, false)
        }
      }),
      window.tg.on('evt:file', (event) => {
        track(event.seq)
        const payload = event.payload
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
      window.tg.on('evt:stickerSets', (event) => {
        track(event.seq)
        store.noteStickerSetsChanged()
      }),
      /**
       * 定位到聊天位置: the viewer hands one message back, main has already raised
       * the shell above it. The request goes into the store *before* the
       * conversation activates, because the first-page fetch reads it to page
       * around that row instead of opening on the newest message.
       */
      window.tg.on('evt:locate', (event) => {
        track(event.seq)
        const { chatId, messageId } = event.payload
        const state = useAppStore.getState()
        const chat =
          state.chats.find((item) => item.id === chatId) ??
          state.archivedChats.find((item) => item.id === chatId)
        if (chat) {
          state.requestLocate(chatId, messageId)
          if (state.activeChatId !== chatId) activateChat(chat)
          return
        }
        // A notification can name a chat the list has not paged in yet: ask for
        // its summary, then land on the message the toast was about.
        void invoke('chats:get', { chatId })
          .then((fresh) => {
            const next = useAppStore.getState()
            next.applyChatOps([{ op: 'upsert', chat: fresh }])
            next.requestLocate(chatId, messageId)
            activateChat(fresh)
          })
          .catch((cause) => useAppStore.getState().setError(errorMessage(cause)))
      }),
      window.tg.on('evt:error', (event) => {
        track(event.seq)
        store.setError(event.payload.message)
      }),
    ]
    return () => {
      if (resyncTimer !== null) window.clearTimeout(resyncTimer)
      for (const timer of typingTimers.values()) window.clearTimeout(timer)
      typingTimers.clear()
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const store = useAppStore.getState()
      try {
        const [info, authState, settings, connection] = await Promise.all([
          invoke('app:info'),
          invoke('auth:state'),
          invoke('settings:get'),
          /**
           * The shell is created after the login window, so TDLib may already be
           * online and `evt:connection` (a change-only stream) would never say so:
           * the rail would read 离线 on a perfectly connected client.
           */
          invoke('network:connection'),
        ])
        store.setInfo(info)
        store.setAuth(authState)
        store.setTheme(settings.theme)
        store.setSendKey(settings.sendKey)
        store.setConnection(connection)
      } catch (error) {
        store.setError(errorMessage(error))
      }
    })()
  }, [])

  useEffect(() => {
    if (!ready) return
    void (async () => {
      try {
        // Both lists, because 已归档会话 is a row above the conversation list and
        // has to be there on the first paint. `Promise.all` keeps one error path.
        const [chats, archivedChats] = await Promise.all([
          invoke('chats:list', { limit: 100, offset: 0 }),
          invoke('chats:list', { limit: 100, offset: 0, list: 'archive' }),
        ])
        const store = useAppStore.getState()
        store.setChats(chats)
        store.setArchivedChats(archivedChats)
      } catch (error) {
        useAppStore.getState().setError(errorMessage(error))
      }
    })()
  }, [ready])

  /**
   * The shell window only exists once an account is signed in (`login:enter`),
   * and the main process closes it the moment authorization leaves `ready`. The
   * short gap while `auth:state` is in flight paints the window background
   * instead of an empty three-column shell.
   */
  if (!ready) return null

  return (
    <>
      <MainShell />
      {showPerfPanel ? <PerfPanel /> : null}
    </>
  )
}

const showPerfPanel =
  import.meta.env.DEV && typeof window !== 'undefined' && window.location.search.includes('perf=1')
