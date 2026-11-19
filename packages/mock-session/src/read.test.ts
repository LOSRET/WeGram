import { describe, expect, it } from 'vitest'

import { nextReadState } from './read'

const incoming = (id: number) => ({ id, outgoing: false })
const outgoing = (id: number) => ({ id, outgoing: true })

describe('nextReadState', () => {
  it('moves the marker to the newest message and counts what is left', () => {
    const messages = [incoming(1), incoming(2), outgoing(3)]
    expect(nextReadState({}, messages, 2)).toEqual({
      lastReadInboxMessageId: 2,
      unread: 0,
    })
  })

  it('takes the newest id when no marker is given', () => {
    expect(nextReadState({}, [incoming(1), incoming(2)])).toEqual({
      lastReadInboxMessageId: 2,
      unread: 0,
    })
  })

  it('never moves the marker backwards', () => {
    expect(nextReadState({ lastReadInboxMessageId: 5 }, [incoming(1), incoming(6)], 3)).toEqual({
      lastReadInboxMessageId: 5,
      unread: 1,
    })
  })

  it('does not count our own messages as unread', () => {
    expect(nextReadState({ lastReadInboxMessageId: 1 }, [outgoing(2), incoming(3)], 1)).toEqual({
      lastReadInboxMessageId: 1,
      unread: 1,
    })
  })

  it('answers null when there is nothing to record', () => {
    expect(nextReadState({}, [])).toBeNull()
  })
})
