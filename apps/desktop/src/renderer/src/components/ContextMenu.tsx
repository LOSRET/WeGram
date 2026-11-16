import { useEffect } from 'react'

export interface MenuItem {
  label: string
  danger?: boolean
  onSelect: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/** WeChat-style long-press / right-click menu (design doc §9.3). */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
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
      className="wx-context-menu"
      style={{ left: Math.min(x, window.innerWidth - 180), top: Math.min(y, window.innerHeight - 40 - items.length * 32) }}
      onPointerDown={(event) => event.stopPropagation()}
      role="menu"
    >
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
    </div>
  )
}
