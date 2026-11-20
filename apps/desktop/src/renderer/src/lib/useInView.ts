import { useEffect, useRef, useState, type RefObject } from 'react'

/** How far outside the viewport a cell still counts as "about to be read". */
const PRELOAD_PX = 200

export interface InView {
  /** On screen right now — it decides whether an animation plays. */
  visible: boolean
  /** Latched: once seen, the download may stay; it stays even after scrolling away. */
  armed: boolean
}

/**
 * Visibility gate for one cell. `rootMargin` preloads a screen ahead so a sticker
 * does not visibly start from nothing when it scrolls into view.
 *
 * Shared by the sticker renderer and a premium sticker's effect: both draw a file
 * only once its box is about to be read, and both must keep playing while their
 * box is on screen.
 */
export function useInView<T extends Element>(): [RefObject<T | null>, InView] {
  const ref = useRef<T | null>(null)
  const [state, setState] = useState<InView>({ visible: false, armed: false })

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const apply = (onScreen: boolean): void => {
      setState((current) =>
        current.visible === onScreen && (current.armed || !onScreen)
          ? current
          : { visible: onScreen, armed: current.armed || onScreen },
      )
    }
    const check = (): void => {
      const rect = node.getBoundingClientRect()
      apply(rect.bottom > -PRELOAD_PX && rect.top < window.innerHeight + PRELOAD_PX)
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
      { rootMargin: `${PRELOAD_PX}px 0px` },
    )
    observer.observe(node)
    return () => {
      window.clearTimeout(retry)
      observer.disconnect()
    }
  }, [])

  return [ref, state]
}
