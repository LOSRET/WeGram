import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

import {
  anchorOf,
  placeAgainstAnchor,
  type PopupAnchor,
  type PopupPosition,
} from '../../lib/popupPlacement'
import { moveActiveOption } from '../../lib/selectKey'
import { useEscapeKey } from '../../lib/useEscapeKey'

interface Option<T extends string> {
  value: T
  label: string
}

interface SettingsSelectProps<T extends string> {
  /** Accessible name; the row's label is the visible one. */
  label: string
  value: T
  options: readonly Option<T>[]
  onChange: (next: T) => void
  /** Holds the control while a write it belongs to is in flight. */
  disabled?: boolean
}

/**
 * The client's dropdown (design doc §9.11.2): a bordered trigger carrying the
 * selected label and a green badge with up/down chevrons, and — once opened — a
 * listbox card of its own. A native <select> was used before, but its list is
 * drawn by the OS: it cannot follow the theme, the measured 12 px row type or the
 * client's selected-in-green rule, so only the closed state looked right.
 *
 * The list is portalled to the body and placed with `lib/popupPlacement`, because
 * the settings body scrolls and would clip an in-flow card. Focus stays on the
 * trigger (combobox pattern): arrows / Home / End move `aria-activedescendant`,
 * Enter or Space picks, Escape closes only the list — `useEscapeKey` keeps the
 * settings window from closing with it.
 */
export function SettingsSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: SettingsSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<PopupAnchor | null>(null)
  const [position, setPosition] = useState<PopupPosition | null>(null)
  const [active, setActive] = useState(0)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const listId = useId()

  const selectedIndex = options.findIndex((option) => option.value === value)
  // -1 until the reader moves: the client opens the list on the selected row with
  // its green ink, not with a grey highlight nobody put there.
  const activeOption = active >= 0 && active < options.length ? options[active] : undefined
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  useEscapeKey(() => setOpen(false), {
    enabled: open,
    preventDefault: true,
    stopPropagation: true,
  })

  // A control that goes disabled mid-open (数据与存储 while a trim runs) must not
  // leave its list hanging over the panel.
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useLayoutEffect(() => {
    const popup = popupRef.current
    if (!open || !anchor || !popup) return

    const place = (): void => {
      const rect = popup.getBoundingClientRect()
      setPosition(
        placeAgainstAnchor(
          anchor,
          { width: rect.width, height: rect.height },
          { align: 'right', gap: 4 },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      )
    }
    place()
    // The card's height is content-driven (a longer option wraps nowhere but a
    // larger font would grow every row); re-clamp when it lands.
    const observer = new ResizeObserver(place)
    observer.observe(popup)
    return () => observer.disconnect()
  }, [open, anchor])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) || popupRef.current?.contains(target)) return
      setOpen(false)
    }
    const onBlur = (): void => setOpen(false)
    // The card is fixed to the viewport while its trigger lives in the settings
    // scroller; a wheel that moves the panel would leave it hanging over another
    // row. Scrolling the list itself is still allowed.
    const onScroll = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && popupRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('blur', onBlur)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  const openList = (): void => {
    const trigger = triggerRef.current
    if (disabled || !trigger || options.length === 0) return
    setActive(-1)
    setAnchor(anchorOf(trigger.getBoundingClientRect()))
    setPosition(null)
    setOpen(true)
  }

  const choose = (option: Option<T> | undefined): void => {
    if (option && option.value !== value) onChange(option.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) return
    const key = event.key

    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault()
        openList()
      }
      return
    }

    if (key === 'Tab') {
      setOpen(false)
      return
    }
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
      event.preventDefault()
      setActive((index) => moveActiveOption(index, options.length, key))
      return
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault()
      choose(activeOption)
    }
  }

  const left = position?.left ?? anchor?.left ?? 0
  const top = position?.top ?? (anchor ? anchor.bottom + 4 : 0)

  return (
    <span className="wx-set-select">
      <button
        ref={triggerRef}
        type="button"
        className="wx-set-select__input"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeOption ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onClick={() => {
          if (open) setOpen(false)
          else openList()
        }}
        onKeyDown={onKeyDown}
      >
        <span className="wx-set-select__label">{selected?.label ?? ''}</span>
        <span className="wx-set-select__badge" aria-hidden="true">
          <svg
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.3"
          >
            <path d="M3 4.2 6 1.2l3 3" />
            <path d="M3 7.8 6 10.8l3-3" />
          </svg>
        </span>
      </button>

      {open && anchor
        ? createPortal(
            <div
              ref={popupRef}
              id={listId}
              className="wx-set-select__popup"
              role="listbox"
              aria-label={label}
              style={{
                left,
                top,
                minWidth: Math.round(anchor.right - anchor.left),
                visibility: position ? 'visible' : 'hidden',
              }}
            >
              {options.map((option, index) => (
                <div
                  key={option.value}
                  id={`${listId}-${index}`}
                  className={`wx-set-select__option${index === active ? ' is-active' : ''}`}
                  role="option"
                  aria-selected={option.value === value}
                  // Keep the trigger focused: the listbox is the combobox's popup,
                  // and arrow keys must keep reaching it after a pointer picks a row.
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                  onPointerEnter={() => setActive(index)}
                >
                  {option.label}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}
