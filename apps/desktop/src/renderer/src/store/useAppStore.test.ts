import type { Message, MessageOp } from '@wegram/protocol'
import { beforeEach, describe, expect, it } from 'vitest'

import { useAppStore } from './useAppStore'

/**
 * Store-level invariants. These are the ones that have already shipped a bug
 * ("groups open empty and never page back"), and they cannot be caught by a
 * component test: they are about which field may be created by whom.
 *
 * The store is a module singleton, so every test starts from `reset()`.
 */

const CHAT_ID = 42

function message(id: number, text = `m${id}`): Message {
  return {
    id,
    chatId: CHAT_ID,
    senderId: 1000,
    senderName: '测试',
    outgoing: false,
    date: 1_700_000_000 + id,
    kind: 'text',
    text,
  }
}

const newOp = (id: number): MessageOp => ({ op: 'new', message: message(id) })
const readOp = (): MessageOp => ({ op: 'read', chatId: CHAT_ID, upToMessageId: 5 })

beforeEach(() => {
  useAppStore.getState().reset()
})

describe('applyMessageOps', () => {
  it('does NOT create a messages entry for a chat that was never loaded', () => {
    useAppStore.getState().applyMessageOps(CHAT_ID, [newOp(1)])

    const state = useAppStore.getState()
    // `ChatPane` reads "an entry exists" as "history is cached" and would then
    // skip the first-page fetch for good.
    expect(state.messagesByChat[CHAT_ID]).toBeUndefined()
    expect(state.pendingOps[CHAT_ID]).toHaveLength(1)
  })

  it('does not queue a batch that only carries read markers', () => {
    useAppStore.getState().applyMessageOps(CHAT_ID, [readOp()])

    const state = useAppStore.getState()
    expect(state.pendingOps[CHAT_ID]).toBeUndefined()
    expect(state.messagesByChat[CHAT_ID]).toBeUndefined()
  })

  it('patches a loaded chat directly and leaves the queue alone', () => {
    const store = useAppStore.getState()
    store.setHistory(CHAT_ID, [message(1)], true)
    store.applyMessageOps(CHAT_ID, [newOp(2)])

    const state = useAppStore.getState()
    expect(state.messagesByChat[CHAT_ID]?.map((item) => item.id)).toEqual([1, 2])
    expect(state.pendingOps[CHAT_ID]).toBeUndefined()
  })

  it('drops the reply target and the edit banner when that message is deleted', () => {
    const store = useAppStore.getState()
    store.setHistory(CHAT_ID, [message(1), message(2)], false)
    store.setReplyTo(CHAT_ID, 1)
    store.setEditing({ chatId: CHAT_ID, messageId: 2, text: 'editing' })

    useAppStore
      .getState()
      .applyMessageOps(CHAT_ID, [{ op: 'delete', chatId: CHAT_ID, messageIds: [1, 2] }])

    const state = useAppStore.getState()
    expect(state.replyToByChat[CHAT_ID]).toBeNull()
    expect(state.editing).toBeNull()
  })
})

describe('setHistory', () => {
  it('replays the ops that arrived while the first page was in flight', () => {
    const store = useAppStore.getState()
    // The page snapshot was taken before these events landed.
    store.applyMessageOps(CHAT_ID, [newOp(2)])
    store.applyMessageOps(CHAT_ID, [newOp(3)])

    useAppStore.getState().setHistory(CHAT_ID, [message(1)], false)

    const state = useAppStore.getState()
    expect(state.messagesByChat[CHAT_ID]?.map((item) => item.id)).toEqual([1, 2, 3])
    // The queue is consumed, so a later page does not replay it twice.
    expect(state.pendingOps[CHAT_ID]).toBeUndefined()
  })

  it('caps the replay queue so a cold chat cannot grow it without limit', () => {
    const store = useAppStore.getState()
    for (let index = 0; index < 250; index += 1) store.applyMessageOps(CHAT_ID, [newOp(index)])

    expect(useAppStore.getState().pendingOps[CHAT_ID]?.length).toBeLessThanOrEqual(200)
  })
})

describe('prependHistory', () => {
  it('prepends older messages and skips ids that are already there', () => {
    const store = useAppStore.getState()
    store.setHistory(CHAT_ID, [message(5), message(6)], true)
    store.prependHistory(CHAT_ID, [message(3), message(4), message(5)], false)

    const state = useAppStore.getState()
    expect(state.messagesByChat[CHAT_ID]?.map((item) => item.id)).toEqual([3, 4, 5, 6])
    expect(state.hasMoreByChat[CHAT_ID]).toBe(false)
  })
})

describe('reset', () => {
  it('clears every piece of session data but keeps the actions', () => {
    const store = useAppStore.getState()
    store.setActiveChat(CHAT_ID)
    store.setHistory(CHAT_ID, [message(1)], true)
    store.setMediaUrl(7, 'wx-media://f/abc')
    store.setToast('saved')

    useAppStore.getState().reset()

    const state = useAppStore.getState()
    expect(state.activeChatId).toBeNull()
    expect(state.messagesByChat).toEqual({})
    expect(state.mediaUrls).toEqual({})
    expect(state.toast).toBeNull()
    expect(typeof state.setHistory).toBe('function')
  })
})
