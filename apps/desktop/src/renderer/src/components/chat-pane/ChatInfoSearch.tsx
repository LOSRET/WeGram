import type { Message } from '@wegram/protocol'
import { useEffect, useRef, useState } from 'react'

import { formatMessageTime, messagePreview } from '../../lib/format'
import { errorMessage, invoke } from '../../lib/ipc'
import { Avatar } from '../Avatar'
import { OverlayScrollbar } from '../OverlayScrollbar'
import { SearchField } from '../SearchField'

/** How long typing pauses before the chat is searched (the picker uses the same idea). */
const SEARCH_DELAY_MS = 260

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M12.5 4.5 7 10l5.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface ChatInfoSearchProps {
  chatId: number
  onBack: () => void
  /** The reader picked a hit: the pane locates it in the transcript. */
  onPick: (messageId: number) => void
}

/**
 * 查找聊天内容 inside the 聊天信息 panel (design doc §9.9).
 *
 * WeChat opens a chat-wide search view; this build keeps the results in the panel
 * until that view exists, and searches the live history through `search:inChat`
 * (TDLib's own index) rather than filtering the loaded page. A hit closes the
 * panel and locates the row through the pane's existing locate path, which can
 * fetch a window around a message the reader has never scrolled to.
 */
export function ChatInfoSearch({ chatId, onBack, onPick }: ChatInfoSearchProps) {
  const [query, setQuery] = useState('')
  /** `null` = nothing searched yet, so an empty box does not read as "no results". */
  const [results, setResults] = useState<Message[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Only the newest request may write state; older ones stay cancelled. */
  const requestRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const q = query.trim()
    requestRef.current += 1
    const request = requestRef.current
    if (q === '') {
      setResults(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = window.setTimeout(() => {
      void invoke('search:inChat', { chatId, q })
        .then((found) => {
          if (request !== requestRef.current) return
          // Newest first, like TDLib's own search: the reader is looking for the
          // recent mention far more often than the oldest one.
          setResults([...found].sort((a, b) => b.date - a.date))
          setError(null)
          setLoading(false)
        })
        .catch((failure: unknown) => {
          if (request !== requestRef.current) return
          setError(errorMessage(failure))
          setResults([])
          setLoading(false)
        })
    }, SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [query, chatId])

  return (
    <div className="wx-info__search">
      <div className="wx-info__search-head">
        <button type="button" className="wx-info__back" aria-label="返回" onClick={onBack}>
          <BackIcon />
        </button>
        <SearchField
          value={query}
          onValueChange={setQuery}
          placeholder="搜索聊天记录"
          autoFocus
          className="wx-info__search-field"
        />
      </div>
      <div className="wx-info__search-body" ref={hostRef}>
        <div className="wx-info__search-scroll" ref={scrollRef}>
          {error !== null ? (
            <p className="wx-info__note wx-info__note--search">{error}</p>
          ) : results === null ? (
            <p className="wx-info__note wx-info__note--search">输入关键词，搜索本聊天的聊天记录</p>
          ) : loading && results.length === 0 ? (
            <p className="wx-info__note wx-info__note--search">正在搜索…</p>
          ) : results.length === 0 ? (
            <p className="wx-info__note wx-info__note--search">没有找到相关聊天记录</p>
          ) : (
            <ul className="wx-info__results">
              {results.map((message) => (
                <li key={message.id}>
                  <button
                    type="button"
                    className="wx-info__result"
                    onClick={() => onPick(message.id)}
                  >
                    <Avatar
                      url={message.senderAvatarUrl}
                      name={message.senderName}
                      colorId={message.senderId}
                      className="wx-info__result-avatar"
                    />
                    <span className="wx-info__result-main">
                      <span className="wx-info__result-head">
                        <span className="wx-info__result-name">{message.senderName}</span>
                        <span className="wx-info__result-time">
                          {formatMessageTime(message.date)}
                        </span>
                      </span>
                      <span className="wx-info__result-text">{messagePreview(message)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {loading && results !== null && results.length > 0 ? (
            <p className="wx-info__note wx-info__note--search">正在搜索…</p>
          ) : null}
        </div>
        <OverlayScrollbar scrollerRef={scrollRef} hostRef={hostRef} />
      </div>
    </div>
  )
}
