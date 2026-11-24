import type { InstantViewWindowState } from '@wegram/protocol'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

import { errorMessage, invoke } from '@renderer/lib/ipc'
import { OverlayScrollbar } from '@renderer/components/OverlayScrollbar'
import { InstantViewPage } from '@renderer/components/instant-view/InstantViewPage'

const ZOOM_MIN = 50
const ZOOM_MAX = 200
const ZOOM_STEP = 10

/**
 * 即时预览's own window (design doc §8.9), like the client's Instant View window.
 *
 * The window owns no shell state (like the login, viewer and QR windows): it reads
 * one target through `web:state` and the page through `web:instantView`. Its
 * toolbar carries the preview's title and site, the page zoom the client shows in
 * its ⋮ menu (`zoom` scales the article, not the window), and 在浏览器打开 for a
 * page this client cannot render.
 */
export function InstantViewWindow() {
  const [state, setState] = useState<InstantViewWindowState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(100)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void invoke('web:state')
      .then((next) => {
        if (cancelled) return
        setState(next)
        document.documentElement.dataset['theme'] = next.theme
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(errorMessage(failure))
      })
    // The shell's theme is the DB's; reading it here too keeps this window in step
    // even when it was opened across a theme change (the two values agree, and the
    // DB read cannot be stale).
    void invoke('settings:get')
      .then((settings) => {
        if (!cancelled) document.documentElement.dataset['theme'] = settings.theme
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  // The shell broadcasts 设置's theme; this window is not the shell, so it follows.
  useEffect(
    () =>
      window.tg.on('evt:theme', (event) => {
        document.documentElement.dataset['theme'] = event.payload.theme
      }),
    [],
  )

  const changeZoom = useCallback((delta: number): void => {
    setZoom((current) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + delta)))
  }, [])

  if (error) {
    return (
      <div className="wx-iv-win wx-iv-win--empty">
        <span>{error}</span>
      </div>
    )
  }

  return (
    <div className="wx-iv-win">
      {/* Row 1 is the window's title strip (native controls sit at its right); row 2
          carries the page controls, so nothing is crammed into the 40 px strip. */}
      <header className="wx-iv-win__bar">
        <div className="wx-iv-win__titles">
          <h1 className="wx-iv-win__title">{state?.title ?? '即时预览'}</h1>
          <span className="wx-iv-win__site">{state?.siteName ?? state?.url ?? ''}</span>
        </div>
      </header>
      <div className="wx-iv-win__tools">
        <div className="wx-iv-win__zoom">
          <button
            className="wx-iv-win__zoom-button"
            title="缩小"
            onClick={() => changeZoom(-ZOOM_STEP)}
            disabled={zoom <= ZOOM_MIN}
          >
            −
          </button>
          <span className="wx-iv-win__zoom-value">{zoom}%</span>
          <button
            className="wx-iv-win__zoom-button"
            title="放大"
            onClick={() => changeZoom(ZOOM_STEP)}
            disabled={zoom >= ZOOM_MAX}
          >
            +
          </button>
          <button
            className="wx-iv-win__zoom-reset"
            title="重置"
            onClick={() => setZoom(100)}
            disabled={zoom === 100}
          >
            重置
          </button>
        </div>
        {state ? (
          <a
            className="wx-iv-win__open"
            href={state.url}
            target="_blank"
            rel="noreferrer"
            title="在浏览器打开"
          >
            在浏览器打开
          </a>
        ) : null}
      </div>
      <div className="wx-iv-win__host" ref={hostRef}>
        <div className="wx-iv-win__scroll" ref={scrollRef}>
          {state ? (
            <div
              className="wx-iv-win__page"
              style={{ '--wx-iv-zoom': zoom / 100 } as CSSProperties}
            >
              <InstantViewPage url={state.url} />
            </div>
          ) : null}
        </div>
        <OverlayScrollbar scrollerRef={scrollRef} hostRef={hostRef} />
      </div>
    </div>
  )
}