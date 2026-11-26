import { Fragment, useEffect, useState } from 'react'

import type { MiniAppMenu as MiniAppMenuState } from '@wegram/protocol'

import { AnchoredPopup } from '@renderer/components/ContextMenu'
import { invoke } from '@renderer/lib/ipc'

/**
 * The Mini App strip's ⋯ card (design doc §9.4.1).
 *
 * This route is loaded into a transparent `WebContentsView` that main layers
 * over the guest page, because the guest paints above the window's own DOM — a
 * card drawn in the strip's page would sit behind the app. The view's page is
 * see-through (its `index.html` route clears the body background), so the strip
 * and the page still show around the card.
 *
 * Main owns the rows and the side effect behind each one: this page asks what to
 * draw once, then follows `evt:miniappMenu` — the layer lives for the whole window,
 * so every later press is a re-render, never a reload — reports the pick (or that
 * it was dismissed), and paints nothing else.
 */
export function MiniAppMenu() {
  const [state, setState] = useState<MiniAppMenuState | null>(null)

  useEffect(() => {
    let cancelled = false
    void invoke('miniapp:menuState')
      .then((next) => {
        if (cancelled) return
        // Set the theme before the card mounts: the first paint must already be
        // the right palette, or a dark client flashes a white card.
        document.documentElement.dataset['theme'] = next.theme
        setState(next)
      })
      .catch(() => {
        // No rows yet: the layer can be alive without a menu open (main reveals
        // it only for a press), so there is simply nothing to draw.
        if (!cancelled) setState(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Every later press reuses this page: main sends the new rows instead of a reload.
  useEffect(
    () =>
      window.tg.on('evt:miniappMenu', (event) => {
        document.documentElement.dataset['theme'] = event.payload.theme
        setState(event.payload)
      }),
    [],
  )

  if (!state) return null

  // The layer is reused for the next press, so the card is taken down here as
  // well: a stale card must not be the first frame of the next reveal.
  const dismiss = (): void => {
    setState(null)
    void invoke('miniapp:menuPick', { id: null }).catch(() => undefined)
  }

  return (
    <AnchoredPopup
      anchor={state.anchor}
      placement={{ align: 'right', gap: 8 }}
      onClose={dismiss}
    >
      {state.items.map((item) => (
        <Fragment key={item.id}>
          {item.dividerBefore ? <div className="wx-context-menu__separator" /> : null}
          <button
            type="button"
            className="wx-context-menu__item"
            role="menuitem"
            onClick={() => {
              setState(null)
              void invoke('miniapp:menuPick', { id: item.id }).catch(() => undefined)
            }}
          >
            {item.label}
          </button>
        </Fragment>
      ))}
    </AnchoredPopup>
  )
}
