import type { MiniAppState } from '@wegram/protocol'
import { useEffect, useState, type MouseEvent } from 'react'

import { errorMessage, invoke } from '@renderer/lib/ipc'

/**
 * A Mini App's own window (design doc §9.4): the strip above the guest web view.
 *
 * This route draws *only* the 48 px strip — the page itself is a `WebContentsView`
 * owned by main, because a Mini App may refuse to be framed and must never see
 * the host's preload. The window is frameless and this strip is its drag region:
 * the × is ours, and ⋮ opens main's native menu (a renderer popover would be
 * covered by the guest, which always paints above the window's own DOM).
 */
export function MiniAppWindow() {
  const [state, setState] = useState<MiniAppState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void invoke('miniapp:init')
      .then((next) => {
        if (cancelled) return
        setState(next)
        document.documentElement.dataset['theme'] = next.theme
        // The window is frameless, but the task bar and Alt+Tab still read the
        // page title; `index.html`'s "WeGram" would hide which bot this is.
        document.title = next.title
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(errorMessage(failure))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 设置 → 外观 broadcasts to every window; this one is not the shell, so it follows.
  useEffect(
    () =>
      window.tg.on('evt:theme', (event) => {
        document.documentElement.dataset['theme'] = event.payload.theme
      }),
    [],
  )

  /** The native menu is anchored under the ⋮, in this window's client coordinates. */
  const openMenu = (event: MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    void invoke('miniapp:menu', {
      x: Math.max(0, Math.round(rect.right - 168)),
      y: Math.round(rect.bottom + 4),
    }).catch((failure: unknown) => setError(errorMessage(failure)))
  }

  return (
    <div className="wx-miniapp">
      <header className="wx-miniapp__bar">
        <h1 className="wx-miniapp__title" title={state?.title ?? ''}>
          {state?.title ?? (error ? '小程序' : '')}
        </h1>
        <div className="wx-miniapp__actions">
          <button
            type="button"
            className="wx-miniapp__button wx-miniapp__button--menu"
            title="更多"
            aria-label="更多"
            disabled={!state}
            onClick={openMenu}
          >
            ⋮
          </button>
          <button
            type="button"
            className="wx-miniapp__button wx-miniapp__button--close"
            title="关闭"
            aria-label="关闭"
            onClick={() => void invoke('miniapp:close')}
          >
            ×
          </button>
        </div>
      </header>
      {/* The guest paints over this area; it is only the window's background and
          the message a failed `miniapp:init` leaves behind. */}
      {error ? <p className="wx-miniapp__error">{error}</p> : null}
    </div>
  )
}
