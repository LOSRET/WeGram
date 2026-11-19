import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import {
  placeAgainstAnchor,
  placeAtPoint,
  type PopupAnchor,
  type PopupPlacement,
  type PopupPosition,
  type PopupSize,
} from '../lib/popupPlacement'

export interface MenuItem {
  label: string
  danger?: boolean
  onSelect: () => void
}

function viewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight }
}

interface PopupCardProps {
  /** Where the card wants to be, given the size it just measured. */
  compute: (size: PopupSize) => PopupPosition
  /** Re-place when the thing it is anchored to moves. */
  placementKey: string
  /** Where to paint before the first measurement lands. */
  initial: PopupPosition
  onClose: () => void
  children: ReactNode
}

/**
 * An anchored popup in the shape of a WeChat right-click menu: white card, hairline
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
function PopupCard({ compute, placementKey, initial, onClose, children }: PopupCardProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const computeRef = useRef(compute)
  computeRef.current = compute
  const [pos, setPos] = useState<PopupPosition>(initial)

  /**
   * Clamped from a ResizeObserver, not once on mount: the first pass measures
   * whatever the content happened to be, and a card whose items change (or whose
   * font lands late) would otherwise hang off the edge it was fitted to.
   */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const place = (): void => {
      const rect = el.getBoundingClientRect()
      const next = computeRef.current({ width: rect.width, height: rect.height })
      setPos((previous) =>
        previous.left === next.left && previous.top === next.top ? previous : next,
      )
    }

    place()
    const observer = new ResizeObserver(place)
    observer.observe(el)
    return () => observer.disconnect()
  }, [placementKey])

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

/** A card opened at a point: a mouse event, or a fixed spot. */
export function Popup({ x, y, onClose, children, centerX = false }: PopupProps) {
  return (
    <PopupCard
      placementKey={`${x}:${y}:${String(centerX)}`}
      initial={{ left: x, top: y }}
      compute={(size) => placeAtPoint({ x, y }, size, { centerX }, viewport())}
      onClose={onClose}
    >
      {children}
    </PopupCard>
  )
}

interface AnchoredPopupProps {
  /** The rectangle the card belongs to (its button). */
  anchor: PopupAnchor
  placement?: PopupPlacement
  onClose: () => void
  children: ReactNode
}

/**
 * A card opened against an element: "hangs below this button, right-aligned".
 *
 * The alternative — `x: rect.right - 232` — is what the call sites used to do,
 * with a constant that matched no stylesheet value.
 */
export function AnchoredPopup({ anchor, placement, onClose, children }: AnchoredPopupProps) {
  const key = [
    anchor.left,
    anchor.right,
    anchor.top,
    anchor.bottom,
    placement?.side ?? '',
    placement?.align ?? '',
    placement?.gap ?? '',
  ].join(':')

  return (
    <PopupCard
      placementKey={key}
      initial={{ left: anchor.left, top: anchor.bottom }}
      compute={(size) => placeAgainstAnchor(anchor, size, placement ?? {}, viewport())}
      onClose={onClose}
    >
      {children}
    </PopupCard>
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
