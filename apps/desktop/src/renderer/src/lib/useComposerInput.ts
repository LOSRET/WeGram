import type { KeyboardEvent } from 'react'
import { useRef } from 'react'

import { useAppStore } from '../store/useAppStore'
import { shouldSend } from './composerInput'

export interface ComposerKeyHandlers {
  onSend: () => void
  /** Escape, only while the box is editing an existing message. */
  onEscape?: () => void
  /**
   * A first look at the key, before the Escape and send rules. The chat composer's
   * "/" command list takes the arrows, Enter/Tab and Escape here. Return true when
   * the key was handled, false to let the usual rules run.
   */
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean
}

/**
 * The textarea half of a composer: composition tracking plus the Enter rule.
 *
 * The two composers (transcript and comment panel) had the same four handlers
 * copied; the comment one had already lost the Shift+Enter comment. What cannot
 * be shared is the JSX — the tool rows differ — so this returns props to spread
 * onto the textarea instead of a component.
 *
 * 发送消息 is read at keydown time, not captured per render: the setting can change
 * while a composer is mounted (evt:settings), and a stale rule is the kind of bug
 * that only shows up after the second visit to 设置.
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
        if (handlers.onKeyDown?.(event)) return
        if (handlers.onEscape && event.key === 'Escape') {
          event.preventDefault()
          handlers.onEscape()
          return
        }
        const send = shouldSend(
          {
            key: event.key,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            nativeComposing: event.nativeEvent.isComposing,
          },
          composingRef.current,
          useAppStore.getState().sendKey,
        )
        if (!send) return
        event.preventDefault()
        handlers.onSend()
      },
    },
  }
}
