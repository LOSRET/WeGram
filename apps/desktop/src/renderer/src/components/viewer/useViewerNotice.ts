import { useCallback, useEffect, useRef, useState } from 'react'

/** How long a viewer notice ("已保存", "已复制") stays on screen. */
const NOTICE_MS = 2400

/**
 * The viewer's one-line notice under the canvas. Actions that finish silently
 * (另存为 / 复制) have no other place to confirm themselves.
 */
export function useViewerNotice(): {
  notice: string | null
  showNotice: (text: string) => void
} {
  const [notice, setNotice] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  const showNotice = useCallback((text: string) => {
    setNotice(text)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      setNotice(null)
    }, NOTICE_MS)
  }, [])

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  return { notice, showNotice }
}
