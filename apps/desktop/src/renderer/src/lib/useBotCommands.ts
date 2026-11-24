import type { BotCommand, BotCommandsAnswer } from '@wegram/protocol'
import { useCallback, useRef, useState } from 'react'

import { invoke } from './ipc'

export interface BotCommandsState {
  /** True once the chat answered as a private chat with a bot. */
  isBot: boolean
  /** The commands the bot publishes; empty before the first answer, and for people. */
  commands: BotCommand[]
  /** Asks for the list once; safe to call on every keystroke. */
  load: () => void
}

/**
 * The chat's bot commands, asked lazily.
 *
 * Nothing is requested until the box actually starts a command, so opening an
 * ordinary conversation costs nothing, and the answer is cached per chat for the
 * life of the composer (TDLib's answer is local data and does not change while
 * the reader types). A failed request stays silent: a missing command list must
 * never raise the error bar over a message the reader is writing.
 */
export function useBotCommands(chatId: number): BotCommandsState {
  const cache = useRef(new Map<number, BotCommandsAnswer>())
  const asked = useRef(new Set<number>())
  // Re-renders when a lazily fetched answer lands; the cache itself is the state.
  const [, setTick] = useState(0)

  const load = useCallback((): void => {
    if (cache.current.has(chatId) || asked.current.has(chatId)) return
    asked.current.add(chatId)
    void invoke('bots:commands', { chatId })
      .then((answer) => {
        cache.current.set(chatId, answer)
        setTick((tick) => tick + 1)
      })
      .catch(() => {
        // Let the next "/" try again; a bot without an answer draws no list.
        asked.current.delete(chatId)
      })
  }, [chatId])

  const answer = cache.current.get(chatId)
  return {
    isBot: answer?.isBot === true,
    commands: answer?.commands ?? [],
    load,
  }
}
