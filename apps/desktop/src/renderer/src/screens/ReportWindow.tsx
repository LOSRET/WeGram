import type { ReportWindowState } from '@wegram/protocol'
import { useEffect, useState } from 'react'

import { ReportSheet } from '@renderer/components/ReportSheet'
import { invoke } from '@renderer/lib/ipc'

/**
 * 举报's own window (design doc §9.4.1): a frameless 380 x 560 sheet.
 *
 * The window is opened by main from three places — a Mini App's ⋯ card (the app
 * stays open), a person's 资料卡, and one message's menu — so it may only learn
 * what it is reporting, never who opened it. "report:state" answers that; the
 * phased reportChat calls are the ordinary "users:report" / "messages:report"
 * channels, which is what keeps this window free of shell state.
 */
export function ReportWindow() {
  const [state, setState] = useState<ReportWindowState | null>(null)

  useEffect(() => {
    let cancelled = false
    void invoke('report:state')
      .then((next) => {
        if (cancelled) return
        // Set the theme before the sheet mounts, so the first paint is already the
        // right palette (a dark client must not flash a light sheet).
        document.documentElement.dataset['theme'] = next.theme
        // A frameless window still shows this in the task bar and Alt+Tab; the
        // page would otherwise keep index.html's "WeGram".
        document.title = '举报'
        setState(next)
      })
      .catch(() => {
        // Without a target there is nothing to report on: go away rather than
        // leave an empty window.
        void invoke('report:close').catch(() => undefined)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 设置 → 外观 broadcasts to every window; this one is not the shell, so it follows.
  useEffect(
    () =>
      window.tg.on('evt:theme', (event) => {
        document.documentElement.dataset['theme'] = event.payload.theme
      }),
    [],
  )

  if (!state) return null

  return (
    <ReportSheet
      target={state.target}
      onClose={() => {
        void invoke('report:close').catch(() => undefined)
      }}
    />
  )
}
