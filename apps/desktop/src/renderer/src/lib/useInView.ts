import { useEffect, useRef, useState, type RefObject } from 'react'

/** How far outside the scroller a cell still counts as "about to be read". */
const PRELOAD_PX = 200

export interface InView {
  /** On screen right now — it decides whether an animation plays. */
  visible: boolean
  /** Latched: once seen, the download may stay; it stays even after scrolling away. */
  armed: boolean
}

/**
 * The nearest scrolling ancestor, or null for a panel that scrolls the page itself.
 *
 * Comparing against the window is wrong for a cell inside a panel: a row scrolled
 * out of the 表情 panel's body still has a rect inside the window, so a WebM cell
 * would keep decoding while clipped. The observer needs the actual scroller.
 */
function scrollParent(node: Element): Element | null {
  let parent = node.parentElement
  while (parent && parent !== document.body) {
    const overflowY = getComputedStyle(parent).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      return parent
    }
    parent = parent.parentElement
  }
  return null
}

/**
 * Visibility gate for one cell. `marginPx` preloads that far outside the scroller
 * so a sticker does not visibly start from nothing when it scrolls into view; a
 * photo bubble asks for about half a screen, because a picture that arrives while
 * the reader is still scrolling reads as "instant".
 *
 * Shared by the sticker renderer, a premium sticker's effect and the media
 * bubbles: each draws a file only once its box is about to be read, and each must
 * keep playing while its box is on screen. A cell that is scrolled out of its
 * panel's body is not visible even though the window still contains its rect.
 */
export function useInView<T extends Element>(marginPx = PRELOAD_PX): [RefObject<T | null>, InView] {
  const ref = useRef<T | null>(null)
  const [state, setState] = useState<InView>({ visible: false, armed: false })

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const root = scrollParent(node)
    const bounds = (): { top: number; bottom: number } => {
      if (!root) return { top: 0, bottom: window.innerHeight }
      const rect = root.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom }
    }

    const apply = (onScreen: boolean): void => {
      setState((current) =>
        current.visible === onScreen && (current.armed || !onScreen)
          ? current
          : { visible: onScreen, armed: current.armed || onScreen },
      )
    }
    const check = (): void => {
      const rect = node.getBoundingClientRect()
      const limits = bounds()
      apply(rect.bottom > limits.top - marginPx && rect.top < limits.bottom + marginPx)
    }

    // Geometry first: IntersectionObserver delivery rides the rendering pipeline and
    // Electron throttles that while the window is occluded — the trap that once left
    // the transcript invisible. A cell already on screen must not wait for a frame
    // that may never come, so it is measured directly and once more after mount (the
    // picker scrolls its body to the top in an effect that runs after this one).
    check()
    const retry = window.setTimeout(check, 250)

    const observer = new IntersectionObserver(
      (entries) => apply(Boolean(entries[0]?.isIntersecting)),
      { root, rootMargin: `${marginPx}px 0px` },
    )
    observer.observe(node)
    return () => {
      window.clearTimeout(retry)
      observer.disconnect()
    }
  }, [marginPx])

  return [ref, state]
}
