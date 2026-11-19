import type { MessageMedia } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import type { AdapterEvent } from '../adapter'
import { commentAccessOf, commentsOf, joinGroupIn, postComment } from './comments'
import { buildFixtures } from './fixtures'

/** Only the media shim matters here; the threads are plain messages. */
const mediaOf = (fileId: number): MessageMedia => ({ fileId })

describe('mock fixtures with comment threads', () => {
  const fixtures = buildFixtures(mediaOf)

  it('attaches the thread count to the commented message', () => {
    const group = fixtures.get(2)
    const post = group?.messages.find((message) => message.id === 203)
    expect(post?.interaction).toEqual({ comments: 7, canOpen: true })
    expect(group?.comments?.[203]).toHaveLength(7)
    // The replies stay out of the transcript, like a TDLib discussion group.
    expect(group?.messages.some((message) => message.id >= 900_000)).toBe(false)
  })

  it('gives a channel post views, forwards and its 78-comment thread', () => {
    const channel = fixtures.get(5)
    const post = channel?.messages.find((message) => message.id === 502)
    expect(post?.interaction).toMatchObject({ comments: 78, views: 12_400, forwards: 96 })
  })

  it('pages a fixture thread through the adapter helper', () => {
    const group = fixtures.get(2)
    const page = commentsOf(fixtures, { chatId: 2, messageId: 203, limit: 10 })
    expect(page.messages).toHaveLength(7)
    expect(page.hasMore).toBe(false)
    expect(group?.comments?.[203]).toBeDefined()
  })

  it('starts the channel discussion group unjoined and joins on demand', () => {
    const own = buildFixtures(mediaOf)
    expect(commentAccessOf(own, { chatId: 5, messageId: 502 })).toMatchObject({
      canComment: false,
      joined: false,
      canJoin: true,
    })

    expect(joinGroupIn(own, { chatId: 5, messageId: 502 })).toEqual({
      joined: true,
      requestSent: false,
    })
    expect(commentAccessOf(own, { chatId: 5, messageId: 502 })).toMatchObject({
      canComment: true,
      joined: true,
    })
  })

  it('answers the default access for a joined group thread', () => {
    const own = buildFixtures(mediaOf)
    expect(commentAccessOf(own, { chatId: 2, messageId: 203 })).toMatchObject({
      canComment: true,
      joined: true,
      canJoin: false,
    })
  })

  it('posts a comment into the thread and patches the counter', () => {
    // A fresh fixture map: this test mutates the thread it reads back.
    const own = buildFixtures(mediaOf)
    const events: AdapterEvent[] = []
    const { message } = postComment(
      {
        fixtures: own,
        emit: (event) => {
          events.push(event)
        },
      },
      { chatId: 2, messageId: 203, text: '我也来说两句' },
    )

    expect(message).toMatchObject({ chatId: 2, outgoing: true, text: '我也来说两句' })
    expect(own.get(2)?.comments?.[203]).toHaveLength(8)
    expect(own.get(2)?.messages.find((item) => item.id === 203)?.interaction?.comments).toBe(8)
    const batch = events[0]
    expect(batch?.type).toBe('messages')
    const op = batch?.type === 'messages' ? batch.ops[0] : undefined
    expect(op).toMatchObject({ op: 'interaction', messageId: 203, interaction: { comments: 8 } })
    // Newest last, so the panel appends it where a chat appends a message.
    const page = commentsOf(own, { chatId: 2, messageId: 203, limit: 10 })
    expect(page.messages.at(-1)?.id).toBe(message.id)
  })

  it('refuses to comment on a message without a thread', () => {
    const own = buildFixtures(mediaOf)
    expect(() =>
      postComment(
        { fixtures: own, emit: () => undefined },
        { chatId: 2, messageId: 201, text: 'x' },
      ),
    ).toThrow(/讨论群组/)
  })

  it('rejects an unknown chat instead of answering empty', () => {
    expect(() => commentsOf(fixtures, { chatId: 4242, messageId: 1, limit: 5 })).toThrow(
      /Unknown mock chat/,
    )
  })
})
