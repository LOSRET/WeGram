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

  it('keeps a known comment count when an update only carries views', () => {
    const store = useAppStore.getState()
    store.setHistory(CHAT_ID, [{ ...message(1), interaction: { comments: 78, canOpen: true } }], false)
    store.applyMessageOps(CHAT_ID, [
      { op: 'interaction', chatId: CHAT_ID, messageId: 1, interaction: { views: 12_400 } },
    ])

    const row = useAppStore.getState().messagesByChat[CHAT_ID]?.[0]
    // TDLib omits reply_info from a view-only update; that must not wipe the bar.
    expect(row?.interaction).toEqual({ comments: 78, canOpen: true, views: 12_400 })
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

describe('anchored windows', () => {
  it('replays only the ops inside a window that stops short of the newest message', () => {
    const store = useAppStore.getState()
    store.applyMessageOps(CHAT_ID, [newOp(2), newOp(9)])

    useAppStore.getState().setHistory(CHAT_ID, [message(1), message(2)], true, true)

    const state = useAppStore.getState()
    expect(state.messagesByChat[CHAT_ID]?.map((item) => item.id)).toEqual([1, 2])
    // 9 is beyond the window: it must not be spliced under row 2.
    expect(state.pendingOps[CHAT_ID]?.map((op) => (op.op === 'new' ? op.message.id : 0))).toEqual([
      9,
    ])
    expect(state.hasNewerByChat[CHAT_ID]).toBe(true)
  })

  it('holds live arrivals until the window reaches them, then appends them', () => {
    const store = useAppStore.getState()
    store.setHistory(CHAT_ID, [message(1), message(2)], false, true)
    store.applyMessageOps(CHAT_ID, [newOp(5)])

    expect(useAppStore.getState().messagesByChat[CHAT_ID]?.map((item) => item.id)).toEqual([1, 2])
    expect(useAppStore.getState().pendingOps[CHAT_ID]).toHaveLength(1)

    useAppStore.getState().appendNewer(CHAT_ID, [message(3), message(4)], true)
    expect(useAppStore.getState().messagesByChat[CHAT_ID]?.map((item) => item.id)).toEqual([
      1, 2, 3, 4,
    ])
    expect(useAppStore.getState().pendingOps[CHAT_ID]).toHaveLength(1)

    useAppStore.getState().appendNewer(CHAT_ID, [message(5)], false)
    const state = useAppStore.getState()
    expect(state.messagesByChat[CHAT_ID]?.map((item) => item.id)).toEqual([1, 2, 3, 4, 5])
    expect(state.pendingOps[CHAT_ID]).toBeUndefined()
    expect(state.hasNewerByChat[CHAT_ID]).toBe(false)
  })

  it('applies a queued live arrival when the window finally reaches latest', () => {
    const store = useAppStore.getState()
    store.setHistory(CHAT_ID, [message(1), message(2)], false, true)
    // Arrived while the window was anchored, so it was held back.
    store.applyMessageOps(CHAT_ID, [newOp(4)])

    useAppStore.getState().appendNewer(CHAT_ID, [message(3)], false)

    const state = useAppStore.getState()
    expect(state.messagesByChat[CHAT_ID]?.map((item) => item.id)).toEqual([1, 2, 3, 4])
    expect(state.pendingOps[CHAT_ID]).toBeUndefined()
    expect(state.hasNewerByChat[CHAT_ID]).toBe(false)
  })

  it('still applies deletes while anchored', () => {
    const store = useAppStore.getState()
    store.setHistory(CHAT_ID, [message(1), message(2)], false, true)
    store.applyMessageOps(CHAT_ID, [{ op: 'delete', chatId: CHAT_ID, messageIds: [1] }])
    expect(useAppStore.getState().messagesByChat[CHAT_ID]?.map((item) => item.id)).toEqual([2])
  })

  it('bumps a per-chat jump signal for the list to consume', () => {
    useAppStore.getState().requestJumpToLatest(CHAT_ID)
    const first = useAppStore.getState().jumpToLatest
    expect(first).toMatchObject({ chatId: CHAT_ID, tick: 1 })
    useAppStore.getState().requestJumpToLatest(CHAT_ID)
    expect(useAppStore.getState().jumpToLatest?.tick).toBe(2)
  })

  it('keeps a locate request until the list hands it back, bumping its tick', () => {
    useAppStore.getState().requestLocate(CHAT_ID, 42)
    expect(useAppStore.getState().locate).toMatchObject({ chatId: CHAT_ID, messageId: 42, tick: 1 })
    useAppStore.getState().requestLocate(CHAT_ID, 42)
    expect(useAppStore.getState().locate?.tick).toBe(2)

    useAppStore.getState().clearLocate()
    expect(useAppStore.getState().locate).toBeNull()
  })
})

/**
 * The page fetched ahead of the reader (`useChatHistory.prefetchOlder`).
 *
 * TDLib's first server answer for an older page takes seconds, so the app keeps
 * one page in hand. What matters here is that the snapshot can never be inserted
 * into a transcript it no longer matches: that would resurrect a deleted row or
 * draw an old caption.
 */
describe('prefetched older pages', () => {
  const bufferedPage = () => {
    const page = useAppStore.getState().olderPagesByChat[CHAT_ID]
    if (!page) throw new Error('expected a buffered older page')
    return page
  }

  it('keeps a page fetched below the current oldest row', () => {
    const store = useAppStore.getState()
    store.setHistory(CHAT_ID, [message(10)], true)
    store.bufferOlderPage(CHAT_ID, 10, [message(8), message(9)], true)

    expect(bufferedPage().afterId).toBe(10)
    expect(bufferedPage().messages.map((item) => item.id)).toEqual([8, 9])
  })

  it('refuses a page that is no longer contiguous with the transcript', () => {
    const store = useAppStore.getState()
    store.setHistory(CHAT_ID, [message(10), message(11)], true)
    // Fetched below row 9 while the transcript starts at 10: a different window.
    store.bufferOlderPage(CHAT_ID, 9, [message(8)], true)

    expect(useAppStore.getState().olderPagesByChat[CHAT_ID]).toBeUndefined()
  })

  it('refuses an empty page, which a cold TDLib cache answers', () => {
    const store = useAppStore.getState()
    store.setHistory(CHAT_ID, [message(10)], true)
    store.bufferOlderPage(CHAT_ID, 10, [], true)

    expect(useAppStore.getState().olderPagesByChat[CHAT_ID]).toBeUndefined()
  })

  it('is inserted by prependHistory and dropped afterwards', () => {
    const store = useAppStore.getState()
    store.setHistory(CHAT_ID, [message(10)], true)
    store.bufferOlderPage(CHAT_ID, 10, [message(8), message(9)], false)

    const page = bufferedPage()
    useAppStore.getState().prependHistory(CHAT_ID, page.messages, page.hasMore)

    const state = useAppStore.getState()
    expect(state.messagesByChat[CHAT_ID]?.map((item) => item.id)).toEqual([8, 9, 10])
    expect(state.hasMoreByChat[CHAT_ID]).toBe(false)
    expect(state.olderPagesByChat[CHAT_ID]).toBeUndefined()
  })

  it('is dropped when a buffered row is deleted, so it cannot come back', () => {
    const store = useAppStore.getState()
    store.setHistory(CHAT_ID, [message(10)], true)
    store.bufferOlderPage(CHAT_ID, 10, [message(8), message(9)], true)

    useAppStore
      .getState()
      .applyMessageOps(CHAT_ID, [{ op: 'delete', chatId: CHAT_ID, messageIds: [9] }])

    expect(useAppStore.getState().olderPagesByChat[CHAT_ID]).toBeUndefined()
  })

  it('survives a read marker and a live arrival', () => {
    const store = useAppStore.getState()
    store.setHistory(CHAT_ID, [message(10)], true)
    store.bufferOlderPage(CHAT_ID, 10, [message(8), message(9)], true)

    useAppStore.getState().applyMessageOps(CHAT_ID, [readOp(), newOp(11)])

    expect(bufferedPage().messages.map((item) => item.id)).toEqual([8, 9])
  })

  it('is dropped when the window is replaced', () => {
    const store = useAppStore.getState()
    store.setHistory(CHAT_ID, [message(10)], true)
    store.bufferOlderPage(CHAT_ID, 10, [message(8), message(9)], true)

    useAppStore.getState().setHistory(CHAT_ID, [message(10)], true)

    expect(useAppStore.getState().olderPagesByChat[CHAT_ID]).toBeUndefined()
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
    expect(state.olderPagesByChat).toEqual({})
    expect(state.mediaUrls).toEqual({})
    expect(state.toast).toBeNull()
    expect(typeof state.setHistory).toBe('function')
  })
})
