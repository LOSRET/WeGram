import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

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

/**
 * Anchored popup in the shape of a WeChat right-click menu: white card, hairline
 * border, 6 px radius. It closes on Escape, on a pointer-down anywhere outside,
 * and when the window loses focus.
 */
export function Popup({ x, y, onClose, children, centerX = false }: PopupProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const wanted = centerX ? x - rect.width / 2 : x
    const left = Math.max(8, Math.min(wanted, window.innerWidth - rect.width - 8))
    const top =
      y + rect.height > window.innerHeight - 8
        ? Math.max(8, y - rect.height)
        : Math.min(y, window.innerHeight - rect.height - 8)
    setPos({ left, top })
  }, [x, y, centerX])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
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

  return (
    <div
      ref={ref}
      className="wx-context-menu"
      style={{ left: pos.left, top: pos.top }}
      onPointerDown={(event) => event.stopPropagation()}
      role="menu"
    >
      {children}
    </div>
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
