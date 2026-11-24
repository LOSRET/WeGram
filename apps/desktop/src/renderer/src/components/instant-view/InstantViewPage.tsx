import type { InstantView } from '@wegram/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'

import { errorMessage, invoke } from '../../lib/ipc'
import { ViewerSource } from '../../lib/viewerSource'
import { RichMessage } from '../message-list/RichMessage'

/** A page's media belongs to no message of a chat: 查看大图 has nothing to page. */
const NO_ROWS: readonly never[] = []

/**
 * 即时预览's page body: one `web:instantView` call, then the rich-message renderer
 * (design doc §8.9).
 *
 * The blocks are the same `PageBlock` tree a rich channel post uses, so the reader
 * adds a frame, not a renderer. It is a separate component so the window's chrome
 * (title, zoom, 在浏览器打开) can stay out of it.
 */
export function InstantViewPage({ url }: { url: string }) {
  const [page, setPage] = useState<InstantView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Only the newest request may land: the window can be re-targeted mid-flight. */
  const requestRef = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const ticket = ++requestRef.current
    setLoading(true)
    setError(null)
    try {
      const answer = await invoke('web:instantView', { url })
      if (requestRef.current === ticket) setPage(answer)
    } catch (err) {
      if (requestRef.current !== ticket) return
      setPage(null)
      setError(errorMessage(err))
    } finally {
      if (requestRef.current === ticket) setLoading(false)
    }
  }, [url])

  useEffect(() => {
    setPage(null)
    void load()
  }, [load])

  return (
    <div className="wx-iv-page">
      {loading && !page ? <div className="wx-iv-page__hint">正在打开页面…</div> : null}
      {error ? (
        <div className="wx-iv-page__hint">
          <span>{error}</span>
          <button className="wx-iv-page__retry" onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : null}
      {page ? (
        <ViewerSource value={NO_ROWS}>
          <article className="wx-iv-page__article">
            <RichMessage
              blocks={page.blocks}
              chatId={0}
              messageId={0}
              maxMediaWidth={540}
              maxMediaHeight={420}
            />
            {page.isFull === false ? (
              <p className="wx-iv-page__note">这是网页摘要，完整版请在浏览器打开。</p>
            ) : null}
          </article>
        </ViewerSource>
      ) : null}
    </div>
  )
}
