import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'

interface OverlayScrollbarProps {
  /** The element that actually scrolls. */
  scrollerRef: RefObject<HTMLElement | null>
  /** Positioned ancestor the thumb is drawn in; also the hover target. */
  hostRef: RefObject<HTMLElement | null>
  /** Keep the bar hidden, e.g. while the pane is not painted yet. */
  hidden?: boolean
}

interface Geometry {
  trackTop: number
  trackHeight: number
  /** Both in track coordinates, so the thumb can be translated inside it. */
  thumbTop: number
  thumbHeight: number
}

/** Short lists still get a grabbable pill, like WeChat's minimum thumb. */
const MIN_THUMB = 26
/** How long the bar stays up after a wheel scroll when the pointer is elsewhere. */
const IDLE_HIDE_MS = 900

/**
 * Scrollbar drawn on top of the scroll container instead of in it.
 *
 * WeChat's list has no reserved gutter: its bar is a translucent pill that
 * floats over the rows and fades in on hover, so the rows never re-flow when
 * the bar appears and the badges keep their width. A native `::-webkit-scrollbar`
 * cannot do that in Chromium (it always takes layout space), so the container
 * hides its own bar and this component mirrors the scroll position into an
 * absolutely positioned thumb, draggable like the real thing.
 */
export function OverlayScrollbar({ scrollerRef, hostRef, hidden = false }: OverlayScrollbarProps) {
  const [geometry, setGeometry] = useState<Geometry | null>(null)
  const [hovered, setHovered] = useState(false)
  const [flashing, setFlashing] = useState(false)
  const [dragging, setDragging] = useState(false)

  const dragRef = useRef<{
    startY: number
    startScrollTop: number
    trackTravel: number
    scrollable: number
  } | null>(null)
  const hideTimerRef = useRef<number | null>(null)

  const measure = useCallback(() => {
    const el = scrollerRef.current
    const host = hostRef.current
    if (!el || !host) return

    const viewport = el.clientHeight
    const content = el.scrollHeight
    const scrollable = content - viewport
    if (viewport <= 0 || scrollable <= 1) {
      setGeometry(null)
      return
    }

    const trackHeight = viewport
    const thumbHeight = Math.min(
      trackHeight,
      Math.max(MIN_THUMB, Math.round((viewport * viewport) / content)),
    )
    const travel = trackHeight - thumbHeight
    const ratio = Math.min(1, Math.max(0, el.scrollTop / scrollable))
    const trackTop = el.getBoundingClientRect().top - host.getBoundingClientRect().top

    setGeometry({
      trackTop,
      trackHeight,
      thumbTop: trackTop + ratio * travel,
      thumbHeight,
    })
  }, [hostRef, scrollerRef])

  // Mirror the scroller: position on scroll, size on resize, and re-measure
  // whenever the rows themselves change (a fresh page of chats, older messages).
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return

    let frame = 0
    const schedule = (): void => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }

    const onScroll = (): void => {
      measure()
      setFlashing(true)
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null
        setFlashing(false)
      }, IDLE_HIDE_MS)
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(el)
    const mutationObserver = new MutationObserver(schedule)
    mutationObserver.observe(el, { childList: true, subtree: true })

    schedule()
    return () => {
      el.removeEventListener('scroll', onScroll)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      if (frame) cancelAnimationFrame(frame)
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
    }
  }, [measure, scrollerRef])

  // Hover is tracked on the host: the thumb sits on top of the scroller, so
  // listening to the scroller alone would hide the bar the moment it is used.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const enter = (): void => {
      setHovered(true)
      measure()
    }
    const leave = (): void => setHovered(false)
    host.addEventListener('pointerenter', enter)
    host.addEventListener('pointerleave', leave)
    return () => {
      host.removeEventListener('pointerenter', enter)
      host.removeEventListener('pointerleave', leave)
    }
  }, [hostRef, measure])

  const onThumbPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const el = scrollerRef.current
    if (!el || !geometry) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      startY: event.clientY,
      startScrollTop: el.scrollTop,
      trackTravel: Math.max(1, geometry.trackHeight - geometry.thumbHeight),
      scrollable: Math.max(0, el.scrollHeight - el.clientHeight),
    }
    setDragging(true)
  }

  const onThumbPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    const el = scrollerRef.current
    if (!drag || !el) return
    const moved = event.clientY - drag.startY
    el.scrollTop = drag.startScrollTop + (moved * drag.scrollable) / drag.trackTravel
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  if (!geometry) return null

  const visible = !hidden && (hovered || flashing || dragging)

  return (
    <div
      className="wx-scrollbar"
      aria-hidden="true"
      data-visible={visible ? 'true' : 'false'}
      style={{ top: geometry.trackTop, height: geometry.trackHeight }}
    >
      <div
        className="wx-scrollbar__thumb"
        data-dragging={dragging ? 'true' : 'false'}
        style={{
          top: geometry.thumbTop - geometry.trackTop,
          height: geometry.thumbHeight,
        }}
        onPointerDown={onThumbPointerDown}
        onPointerMove={onThumbPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </div>
  )
}
