import { useEffect, useRef, type RefObject } from 'react'

/**
 * The picker closes like a popover: Esc, or a click outside both the card and
 * the composer. Clicks inside the composer belong to the text field and the two
 * toggles, which own their open/closed state.
 */
export function usePickerDismiss(onClose: () => void): RefObject<HTMLDivElement | null> {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Esc belongs to the panel that is open on top: the discussion view closes
      // itself on the same key, and a closed picker must not take the whole
      // comment thread (and the draft) with it.
      event.stopPropagation()
      onClose()
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('.wx-composer')) return
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [onClose])

  return panelRef
}
