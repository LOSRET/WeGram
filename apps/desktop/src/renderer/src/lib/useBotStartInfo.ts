import type { BotCommandsAnswer } from '@wegram/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'

import { invoke } from './ipc'

export interface BotStartInfo {
  /** The bot lookup is in flight; the pane must not flash its ordinary empty state. */
  checking: boolean
  /** True only once TDLib confirmed this private chat belongs to a bot. */
  isBot: boolean
  /** `botInfo.description`, the copy Telegram shows in an empty bot chat. */
  description: string
}

/**
 * The first-open bot screen's data (design doc §8.3).
 *
 * `bots:commands` already reads the same `userFullInfo.bot_info` object, so the
 * empty-chat description rides that answer instead of adding another IPC call.
 * The lookup happens only after a private chat's first history page is known to
 * be empty; ordinary conversations never pay for it.
 */
export function useBotStartInfo(chatId: number | null, enabled: boolean): BotStartInfo {
  const cache = useRef(new Map<number, BotCommandsAnswer>())
  const asked = useRef(new Set<number>())
  const [, setTick] = useState(0)

  const load = useCallback((): void => {
    if (chatId === null || cache.current.has(chatId) || asked.current.has(chatId)) return
    asked.current.add(chatId)
    setTick((tick) => tick + 1)
    void invoke('bots:commands', { chatId })
      .then((answer) => {
        cache.current.set(chatId, answer)
        setTick((tick) => tick + 1)
      })
      .catch(() => {
        // A failed probe leaves the ordinary empty state available. The next
        // empty-chat visit may try again; it must not raise the global error bar.
        asked.current.delete(chatId)
        setTick((tick) => tick + 1)
      })
  }, [chatId])

  useEffect(() => {
    if (enabled) load()
  }, [enabled, load])

  const answer = chatId === null ? undefined : cache.current.get(chatId)
  return {
    checking: enabled && answer === undefined && chatId !== null && asked.current.has(chatId),
    isBot: answer?.isBot === true,
    description: answer?.description ?? '',
  }
}
