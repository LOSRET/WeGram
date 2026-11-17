import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
  danger?: boolean
  onSelect: () => void
}

interface PopupProps {
  x: number
  y: number
  onClose: () => void
  children: ReactNode
  /**
   * Treat `x` as the anchor's centre instead of its left edge. WeChat's "+" card
   * hangs centred under the round button rather than left-aligned to it.
   */
  centerX?: boolean
}

/** Gap between the card and the window edge. */
const EDGE = 8

/**
 * Anchored popup in the shape of a WeChat right-click menu: white card, hairline
 * border, 6 px radius. It closes on Escape, on a pointer-down anywhere outside,
 * and when the window loses focus.
 *
 * Rendered into `document.body`, not where the caller sits in the tree.
 * `position: fixed` is laid out against the nearest transformed / filtered /
 * contained ancestor rather than the viewport, and the transcript's rows carry
 * `transform: translateY(...)`, so a menu opened from a row was clamped against
 * the wrong rectangle. As a direct child of the body the clamp below is the
 * viewport's, which is what the numbers are compared against.
 */
export function Popup({ x, y, onClose, children, centerX = false }: PopupProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  /**
   * Clamped from a ResizeObserver, not once on mount: the first pass measures
   * whatever the content happened to be, and a card whose items change (or whose
   * font lands late) would otherwise hang off the edge it was fitted to.
   */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const clamp = (): void => {
      const rect = el.getBoundingClientRect()
      const wanted = centerX ? x - rect.width / 2 : x
      const left = Math.max(EDGE, Math.min(wanted, window.innerWidth - rect.width - EDGE))
      const top =
        y + rect.height > window.innerHeight - EDGE
          ? Math.max(EDGE, y - rect.height)
          : Math.min(y, window.innerHeight - rect.height - EDGE)
      setPos((previous) =>
        previous.left === left && previous.top === top ? previous : { left, top },
      )
    }

    clamp()
    const observer = new ResizeObserver(clamp)
    observer.observe(el)
    return () => observer.disconnect()
  }, [x, y, centerX])

  useEffect(() => {
    /**
     * Keyboard navigation lives here because every popup in the app is built on this
     * component and already declares `role="menu"` with `role="menuitem"` children.
     * The listener is on the window: nothing inside a freshly opened menu has focus
     * yet, so a listener scoped to the card would never see the first arrow press.
     */
    const menuItems = (): HTMLElement[] => [
      ...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    ]

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
        return
      }
      const items = menuItems()
      if (items.length === 0) return
      event.preventDefault()
      const current = items.findIndex((item) => item === document.activeElement)
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : event.key === 'ArrowDown'
              ? (current + 1) % items.length
              : (current - 1 + items.length) % items.length
      items[next]?.focus()
    }
    const onPointerDown = (): void => onClose()
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      className="wx-context-menu"
      style={{ left: pos.left, top: pos.top }}
      onPointerDown={(event) => event.stopPropagation()}
      role="menu"
    >
      {children}
    </div>,
    document.body,
  )
}

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/** WeChat-style long-press / right-click menu (design doc §9.3). */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  return (
    <Popup x={x} y={y} onClose={onClose}>
      {items.map((item) => (
        <button
          key={item.label}
          className={`wx-context-menu__item${item.danger ? ' wx-context-menu__item--danger' : ''}`}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
          role="menuitem"
        >
          {item.label}
        </button>
      ))}
    </Popup>
  )
}
