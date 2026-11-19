import type { KeyboardEvent } from 'react'
import { useRef } from 'react'

import { shouldSend } from './composerInput'

export interface ComposerKeyHandlers {
  onSend: () => void
  /** Escape, only while the box is editing an existing message. */
  onEscape?: () => void
}

/**
 * The textarea half of a composer: composition tracking plus the Enter rule.
 *
 * The two composers (transcript and comment panel) had the same four handlers
 * copied; the comment one had already lost the Shift+Enter comment. What cannot
 * be shared is the JSX — the tool rows differ — so this returns props to spread
 * onto the textarea instead of a component.
 */
export function useComposerInput(handlers: ComposerKeyHandlers) {
  const composingRef = useRef(false)

  return {
    inputHandlers: {
      onCompositionStart: () => {
        composingRef.current = true
      },
      onCompositionEnd: () => {
        composingRef.current = false
      },
      onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (handlers.onEscape && event.key === 'Escape') {
          event.preventDefault()
          handlers.onEscape()
          return
        }
        const send = shouldSend(
          {
            key: event.key,
            shiftKey: event.shiftKey,
            nativeComposing: event.nativeEvent.isComposing,
          },
          composingRef.current,
        )
        if (!send) return
        event.preventDefault()
        handlers.onSend()
      },
    },
  }
}
