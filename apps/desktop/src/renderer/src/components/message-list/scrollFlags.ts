import { useRef, type MutableRefObject } from 'react'

/**
 * The four scroll-timing flags of the transcript, owned by `index.tsx` and passed
 * to the hooks that need them. They are plain refs on purpose: every one of them
 * is read inside a timer or an event callback, where state would be a render
 * behind.
 */
export interface ScrollFlags {
  /** The first-paint positioning finished; only then may anchors be saved. */
  initialised: MutableRefObject<boolean>
  /** We are restoring a saved position — our own `scrollTop` writes must not be saved. */
  restoring: MutableRefObject<boolean>
  /** A history page is being prepended (new messages then are not "new"). */
  prepending: MutableRefObject<boolean>
  /** Any other programmatic viewport move (prepend compensation). */
  programmatic: MutableRefObject<boolean>
}

export function useScrollFlags(): ScrollFlags {
  const initialised = useRef(false)
  const restoring = useRef(false)
  const prepending = useRef(false)
  const programmatic = useRef(false)
  return { initialised, restoring, prepending, programmatic }
}
