import type { ChatTopic, TopicCursor } from '@wegram/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'

import { errorMessage, invoke } from '../../../lib/ipc'
import { useAppStore } from '../../../store/useAppStore'

/** One page of topics; TDLib answers fewer than asked for quite often. */
const PAGE_SIZE = 50
/** A rename or a pin arrives as one event; collapse a burst into one re-read. */
const REFRESH_DEBOUNCE_MS = 300
/** 搜索话题 is server-side; one keystroke burst should cost one request. */
const SEARCH_DEBOUNCE_MS = 260

/**
 * 话题列表's data (design doc §9.12): the first page, its cursor and 搜索话题.
 *
 * The list is cached in the store so switching between the topic page and a topic
 * does not refetch, and `evt:topics` (via `topicsVersion`) re-reads the page —
 * TDLib's topic updates carry only part of a topic, so patching a row would be a
 * guess.
 */
export function useChatTopics(
  chatId: number | null,
  query: string,
): {
  topics: ChatTopic[]
  loading: boolean
  hasMore: boolean
  loadMore: () => Promise<void>
  reload: () => Promise<void>
} {
  const topics = useAppStore((state) => (chatId === null ? undefined : state.topicsByChat[chatId]))
  const version = useAppStore((state) => state.topicsVersion)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const cursorRef = useRef<TopicCursor | null>(null)
  /** Only the newest request may land; a slow search must not overwrite a newer one. */
  const requestRef = useRef(0)
  const chatIdRef = useRef(chatId)
  chatIdRef.current = chatId

  const loadFirstPage = useCallback(async (): Promise<void> => {
    const id = chatIdRef.current
    if (id === null) return
    const ticket = ++requestRef.current
    setLoading(true)
    try {
      const page = await invoke('chats:topics', {
        chatId: id,
        ...(query.trim() ? { query: query.trim() } : {}),
        limit: PAGE_SIZE,
      })
      if (ticket !== requestRef.current) return
      cursorRef.current = page.next
      setHasMore(page.next !== null)
      useAppStore.getState().setTopics(id, page.topics)
    } catch (error) {
      if (ticket === requestRef.current) useAppStore.getState().setError(errorMessage(error))
    } finally {
      if (ticket === requestRef.current) setLoading(false)
    }
  }, [query])

  useEffect(() => {
    if (chatId === null) return
    const timer = window.setTimeout(
      () => {
        void loadFirstPage()
      },
      query.trim() ? SEARCH_DEBOUNCE_MS : REFRESH_DEBOUNCE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [chatId, query, version, loadFirstPage])

  const loadMore = useCallback(async (): Promise<void> => {
    const id = chatIdRef.current
    const cursor = cursorRef.current
    if (id === null || cursor === null || loading) return
    const ticket = requestRef.current
    setLoading(true)
    try {
      const page = await invoke('chats:topics', {
        chatId: id,
        cursor,
        ...(query.trim() ? { query: query.trim() } : {}),
        limit: PAGE_SIZE,
      })
      if (ticket !== requestRef.current) return
      cursorRef.current = page.next
      setHasMore(page.next !== null)
      useAppStore.getState().mergeTopics(id, page.topics)
    } catch (error) {
      if (ticket === requestRef.current) useAppStore.getState().setError(errorMessage(error))
    } finally {
      if (ticket === requestRef.current) setLoading(false)
    }
  }, [loading, query])

  return {
    topics: topics ?? [],
    loading,
    hasMore,
    loadMore,
    reload: loadFirstPage,
  }
}