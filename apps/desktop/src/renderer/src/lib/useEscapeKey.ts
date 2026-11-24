import { useEffect, useRef } from 'react'

/**
 * Esc, once (renderer/AGENTS.md).
 *
 * The app has several layers that all want Escape — a modal, the sticker box, 聊天
 * information, the discussion view — and the topmost one must be the only one that
 * acts, or one Esc closes a dialog *and* the sheet under it. A plain window
 * listener cannot tell them apart: `stopPropagation` does not stop other listeners
 * on the same target, and listener order is mount order, not stacking order.
 *
 * So the mounted listeners form a stack and only the newest one runs. Mount order
 * is the order layers open (a dialog opens after its panel), which is the order
 * Escape should unwind them in.
 */

interface EscapeKeyOptions {
  /** Off while the layer is closed, so it leaves the stack. */
  enabled?: boolean
  /** Keep the key from reaching other handlers (React's included) when it acts. */
  stopPropagation?: boolean
  /** Suppress the browser's own Esc behaviour (a window closing itself). */
  preventDefault?: boolean
}

/** The mounted Escape listeners, newest last. */
const stack: symbol[] = []

export function useEscapeKey(handler: () => void, options: EscapeKeyOptions = {}): void {
  const { enabled = true, stopPropagation = false, preventDefault = false } = options
  /** The handler is read from a ref: a re-render must not re-order the stack. */
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  const idRef = useRef<symbol | null>(null)

  useEffect(() => {
    if (!enabled) return
    const id = Symbol('escape')
    idRef.current = id
    stack.push(id)

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Only the topmost layer answers; the ones below it stay open.
      if (stack[stack.length - 1] !== id) return
      if (preventDefault) event.preventDefault()
      if (stopPropagation) event.stopPropagation()
      handlerRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const index = stack.indexOf(id)
      if (index >= 0) stack.splice(index, 1)
      idRef.current = null
    }
  }, [enabled, preventDefault, stopPropagation])
}
