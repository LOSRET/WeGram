import { useCallback, useRef, useState } from 'react'

import type { ChatListName } from '../store/reducers'
import { useAppStore } from '../store/useAppStore'
import { CHAT_PAGE_SIZE, nearListEnd } from './chatPaging'
import { invoke } from './ipc'

/** How long a failed background page waits before the next window change retries. */
const RETRY_MS = 5_000

export interface ChatPaging {
  loading: boolean
  /**
   * Called with the virtual window's last mounted index on every render of the
   * list; asks for the next slice when that window reaches the end.
   */
  ensureLoaded: (lastIndex: number, count: number) => void
}

/**
 * 会话列表分页 for one of the two lists.
 *
 * The shell fetches the first page and the list used to stop there, so a chat
 * ranked below it only showed up when TDLib pushed an update for it. Paging is
 * on demand now — the same trigger Telegram Desktop uses (the visible window plus
 * a margin of `CHAT_LOAD_AHEAD` rows) — and every page goes through the store's
 * `mergeChats`, which dedupes by id so a re-fetched row cannot double.
 *
 * The offset is this hook's, not `chats.length` recomputed per call: TDLib's
 * `getChats` slice is a position in the server's own ordered list, and the store
 * also holds rows that arrived as upserts. It starts at the size of the shell's
 * first page; a chat created after that shifts the server list by one, so a later
 * page can miss exactly that row — the same gap the list had before paging, and
 * the row reappears with its next update.
 */
export function useChatPaging(list: ChatListName): ChatPaging {
  const [loading, setLoading] = useState(false)
  const busy = useRef(false)
  const done = useRef(false)
  const offset = useRef<number | null>(null)
  const retryAt = useRef(0)

  const loadMore = useCallback(
    async (count: number): Promise<void> => {
      busy.current = true
      setLoading(true)
      try {
        // The first page was the shell's fetch; paging continues where it stopped.
        if (offset.current === null) offset.current = count
        const page = await invoke('chats:list', {
          list,
          limit: CHAT_PAGE_SIZE,
          offset: offset.current,
        })
        if (page.length === 0) {
          done.current = true
          return
        }
        offset.current += page.length
        if (page.length < CHAT_PAGE_SIZE) done.current = true
        useAppStore.getState().mergeChats(list, page)
      } catch {
        // A page nobody asked to see: fail quietly and let the next window change
        // try again, rather than raising the error bar over the conversation.
        retryAt.current = Date.now() + RETRY_MS
      } finally {
        busy.current = false
        setLoading(false)
      }
    },
    [list],
  )

  const ensureLoaded = useCallback(
    (lastIndex: number, count: number): void => {
      if (busy.current || done.current || Date.now() < retryAt.current) return
      if (!nearListEnd(lastIndex, count)) return
      void loadMore(count)
    },
    [loadMore],
  )

  return { loading, ensureLoaded }
}
