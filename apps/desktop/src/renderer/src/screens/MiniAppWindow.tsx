import type {
  MiniAppButton,
  MiniAppControls,
  MiniAppPressRequest,
  MiniAppState,
} from '@wegram/protocol'
import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'

import { ChevronLeftWideIcon } from '@renderer/components/Icon'
import { errorMessage, invoke } from '@renderer/lib/ipc'

/**
 * A Mini App's own window (design doc §9.4): the strip above the guest web view.
 *
 * This route draws the client chrome only — the 48 px strip and the optional
 * native bottom-button bar. The page itself is a `WebContentsView` owned by
 * main, because a Mini App may refuse to be framed and must never see the
 * host's preload. The window is frameless and this strip is its drag region:
 * the × is ours, and ⋮ opens main's native menu (a renderer popover would be
 * covered by the guest, which always paints above the window's own DOM).
 */
export function MiniAppWindow() {
  const [state, setState] = useState<MiniAppState | null>(null)
  const [controls, setControls] = useState<MiniAppControls | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void invoke('miniapp:init')
      .then((next) => {
        if (cancelled) return
        setState(next)
        setControls(next.controls)
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

  // Main sends this only to the Mini App host, with the window's own sequence.
  useEffect(() => window.tg.on('evt:miniappControls', (event) => setControls(event.payload)), [])

  /**
   * The ⋯ card (⋮ → 重载页面 / 使用条款 / 隐私政策 / 举报) is main's own
   * transparent view: it hangs right-aligned under this button, so the only
   * thing it needs from here is the button's rectangle.
   */
  const openMenu = (event: MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    void invoke('miniapp:menu', {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
    }).catch((failure: unknown) => setError(errorMessage(failure)))
  }

  const press = (target: MiniAppPressRequest['target']): void => {
    void invoke('miniapp:press', { target }).catch((failure: unknown) =>
      setError(errorMessage(failure)),
    )
  }

  const nativeButton = (target: 'main' | 'secondary', button: MiniAppButton): ReactNode => {
    if (!button.isVisible) return null
    const style: CSSProperties = {
      ...(button.color === null ? {} : { backgroundColor: button.color }),
      ...(button.textColor === null ? {} : { color: button.textColor }),
    }
    return (
      <button
        type="button"
        className={`wx-miniapp__native wx-miniapp__native--${target}${
          button.hasShineEffect && button.isActive && !button.isProgressVisible
            ? ' wx-miniapp__native--shine'
            : ''
        }`}
        style={style}
        disabled={!button.isActive}
        onClick={() => press(target)}
      >
        {button.isProgressVisible ? <span className="wx-spinner" aria-hidden /> : null}
        <span className="wx-miniapp__native-text">{button.text}</span>
      </button>
    )
  }

  const main = controls?.main
  const secondary = controls?.secondary
  const actionBarHeight = controls?.actionBarHeight ?? 0
  const secondaryFirst =
    controls?.secondary.position === 'left' || controls?.secondary.position === 'top'

  return (
    <div className="wx-miniapp">
      <header className="wx-miniapp__bar">
        {controls?.backVisible ? (
          <button
            type="button"
            className="wx-miniapp__button wx-miniapp__button--back"
            title="返回"
            aria-label="返回"
            onClick={() => press('back')}
          >
            <ChevronLeftWideIcon size={18} />
          </button>
        ) : null}
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
      {actionBarHeight > 0 && main && secondary ? (
        <footer
          className={`wx-miniapp__native-bar wx-miniapp__native-bar--${secondary.position}`}
          style={{
            height: actionBarHeight,
            ...(controls.bottomBarColor === null
              ? {}
              : { backgroundColor: controls.bottomBarColor }),
          }}
        >
          {secondaryFirst ? (
            <>
              {nativeButton('secondary', secondary)}
              {nativeButton('main', main)}
            </>
          ) : (
            <>
              {nativeButton('main', main)}
              {nativeButton('secondary', secondary)}
            </>
          )}
        </footer>
      ) : null}
    </div>
  )
}
