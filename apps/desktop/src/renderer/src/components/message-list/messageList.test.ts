import type { Message, MessageProperties } from '@wegram/protocol'
import { describe, expect, it } from 'vitest'

import { isEmojiOnly } from './emoji'
import { buildMessageMenuItems, type MessageMenuOptions } from './menu'
import { messagesById, pickSeenUpTo } from './seen'
import { countUnreadBelow } from './unreadBelow'
import { findUnreadMessage, locateLanding, pickPagingTarget, resolveLanding } from './unread'

function message(id: number, overrides: Partial<Message> = {}): Message {
  return {
    id,
    chatId: 1,
    senderId: 2000,
    senderName: '对方',
    outgoing: false,
    date: 1_700_000_000,
    kind: 'text',
    text: `m${id}`,
    ...overrides,
  }
}

const messages = [message(10), message(11), message(12), message(13)]

describe('findUnreadMessage', () => {
  it('returns null without a marker, without unread messages or without a transcript', () => {
    expect(findUnreadMessage(messages, null)).toBeNull()
    expect(findUnreadMessage(messages, { lastReadInboxMessageId: 10, unread: 0 })).toBeNull()
    expect(findUnreadMessage([], { lastReadInboxMessageId: 10, unread: 3 })).toBeNull()
  })

  it('lands on the first incoming message after the read marker', () => {
    expect(findUnreadMessage(messages, { lastReadInboxMessageId: 11, unread: 2 })).toBe(12)
  })

  it('skips our own outgoing messages when looking for the divider', () => {
    const withOwn = [message(10), message(11, { outgoing: true }), message(12)]
    expect(findUnreadMessage(withOwn, { lastReadInboxMessageId: 10, unread: 2 })).toBe(12)
  })

  it('falls back to the unread counter when the marker is missing', () => {
    expect(findUnreadMessage(messages, { lastReadInboxMessageId: null, unread: 2 })).toBe(12)
  })

  it('clamps a counter larger than the transcript to the first message', () => {
    expect(findUnreadMessage(messages, { lastReadInboxMessageId: null, unread: 99 })).toBe(10)
  })

  it('returns null when everything after the marker is ours', () => {
    const own = [message(10), message(11, { outgoing: true })]
    expect(findUnreadMessage(own, { lastReadInboxMessageId: 10, unread: 1 })).toBeNull()
  })
})

describe('resolveLanding', () => {
  const saved = { messageId: 13, offset: 24 }

  it('lands on the newest message when there is neither a position nor unread mail', () => {
    expect(resolveLanding(messages, null, null)).toBeNull()
    expect(resolveLanding(messages, { lastReadInboxMessageId: 10, unread: 0 }, null)).toBeNull()
  })

  it('restores the saved position when the chat has no unread messages', () => {
    expect(resolveLanding(messages, null, saved)).toEqual({
      kind: 'anchor',
      messageId: 13,
      offset: 24,
    })
  })

  it('keeps a saved position that is at or after the read boundary', () => {
    expect(resolveLanding(messages, { lastReadInboxMessageId: 11, unread: 2 }, saved)).toEqual({
      kind: 'anchor',
      messageId: 13,
      offset: 24,
    })
  })

  it('prefers the unread divider over a position in the already-read history', () => {
    expect(
      resolveLanding(
        messages,
        { lastReadInboxMessageId: 11, unread: 2 },
        {
          messageId: 10,
          offset: 0,
        },
      ),
    ).toEqual({ kind: 'unread', messageId: 12 })
  })

  it('ignores a saved position that is not in the loaded window', () => {
    expect(
      resolveLanding(
        messages,
        { lastReadInboxMessageId: 11, unread: 2 },
        {
          messageId: 99,
          offset: 0,
        },
      ),
    ).toEqual({ kind: 'unread', messageId: 12 })
    expect(resolveLanding(messages, null, { messageId: 99, offset: 0 })).toBeNull()
  })

  it('falls back to the unread counter when the boundary is unknown', () => {
    // No read marker means the divider wins over the saved position.
    expect(resolveLanding(messages, { lastReadInboxMessageId: null, unread: 2 }, saved)).toEqual({
      kind: 'unread',
      messageId: 12,
    })
  })
})

describe('locateLanding', () => {
  it('lands on the requested row at the top of the viewport', () => {
    // 定位到聊天位置 outranks both the saved position and the unread divider.
    expect(locateLanding(messages, 12)).toEqual({ kind: 'anchor', messageId: 12, offset: 0 })
  })

  it('has nothing to say without a request or when the row is not loaded', () => {
    expect(locateLanding(messages, null)).toBeNull()
    expect(locateLanding(messages, 99)).toBeNull()
  })
})

describe('pickPagingTarget', () => {
  it('pages back to the read boundary when the chat has unread messages', () => {
    expect(pickPagingTarget(null, { lastReadInboxMessageId: 11, unread: 2 })).toEqual({
      kind: 'unread',
      messageId: 11,
    })
    expect(pickPagingTarget({ messageId: 10 }, { lastReadInboxMessageId: 11, unread: 2 })).toEqual({
      kind: 'unread',
      messageId: 11,
    })
  })

  it('pages back to the saved position when it is after the read boundary', () => {
    expect(pickPagingTarget({ messageId: 13 }, { lastReadInboxMessageId: 11, unread: 2 })).toEqual({
      kind: 'anchor',
      messageId: 13,
    })
  })

  it('pages back to the saved position when nothing is unread', () => {
    expect(pickPagingTarget({ messageId: 13 }, null)).toEqual({ kind: 'anchor', messageId: 13 })
    expect(pickPagingTarget({ messageId: 13 }, { lastReadInboxMessageId: 11, unread: 0 })).toEqual({
      kind: 'anchor',
      messageId: 13,
    })
  })

  it('cannot page for the counter fallback, so a position still wins', () => {
    expect(
      pickPagingTarget({ messageId: 13 }, { lastReadInboxMessageId: null, unread: 2 }),
    ).toEqual({ kind: 'anchor', messageId: 13 })
  })

  it('has nothing to page for without a position or unread messages', () => {
    expect(pickPagingTarget(null, null)).toBeNull()
    expect(pickPagingTarget(null, { lastReadInboxMessageId: 11, unread: 0 })).toBeNull()
  })
})

describe('buildMessageMenuItems', () => {
  const handlers = {
    onReply: () => undefined,
    onCopy: () => undefined,
    onForward: () => undefined,
    onEdit: () => undefined,
    onDelete: (_message: Message, _forBoth: boolean) => undefined,
    onResend: (_message: Message) => undefined,
    onTranscribe: (_message: Message) => undefined,
    onTogglePin: (_message: Message) => undefined,
    onReport: (_message: Message) => undefined,
  }
  const props = (overrides: Partial<MessageProperties> = {}): MessageProperties => ({
    canBeEdited: false,
    canBeForwarded: true,
    canBeDeletedOnlyForSelf: true,
    canBeDeletedForAllUsers: false,
    canBeCopied: true,
    canBeReplied: true,
    ...overrides,
  })
  const labels = (
    target: Message,
    properties: MessageProperties | null = props(),
    options: Partial<MessageMenuOptions> = {},
  ): string[] =>
    buildMessageMenuItems(target, handlers, { canReply: true, properties, ...options }).map(
      (item) => item.label,
    )

  it('offers reply, copy, forward and delete on a text message', () => {
    expect(labels(message(1))).toEqual(['回复', '复制', '转发', '删除'])
  })

  it('hides copy when there is no text or TDLib forbids it', () => {
    expect(labels(message(1, { kind: 'photo', text: '', media: { fileId: 1 } }))).toEqual([
      '回复',
      '转发',
      '删除',
    ])
    expect(labels(message(1), props({ canBeCopied: false }))).not.toContain('复制')
  })

  it('offers the edit path the row can actually run', () => {
    expect(labels(message(1, { outgoing: true }), props({ canBeEdited: true }))).toContain('编辑')
    // A caption is its own call (editMessageCaption), so it has its own word.
    expect(
      labels(
        message(1, { outgoing: true, kind: 'photo', media: { fileId: 1 } }),
        props({ canBeEdited: true }),
      ),
    ).toContain('编辑说明')
    // A sticker's emoji is not a caption: no edit path exists for it here.
    expect(
      labels(
        message(1, { outgoing: true, kind: 'sticker', text: '', media: { fileId: 1 } }),
        props({ canBeEdited: true }),
      ),
    ).not.toContain('编辑说明')
    // The 48-hour window / permissions are TDLib's answer, not "it is ours".
    expect(labels(message(1, { outgoing: true }), props({ canBeEdited: false }))).not.toContain(
      '编辑',
    )
  })

  it('offers 转文字 only on a voice note TDLib can recognise', () => {
    const voice = message(1, { kind: 'voice', text: '', media: { fileId: 9 } })
    expect(labels(voice, props({ canRecognizeSpeech: true }))).toContain('转文字')
    // Without the capability (no trial left, wrong kind) the item is not offered.
    expect(labels(voice, props({ canRecognizeSpeech: false }))).not.toContain('转文字')
    expect(labels(message(1), props({ canRecognizeSpeech: true }))).not.toContain('转文字')
  })

  it('offers 举报 only where TDLib says the message may be reported', () => {
    expect(labels(message(1), props({ canReportChat: true }))).toContain('举报')
    // An omitted flag is "not allowed": the menu never guesses a moderator right.
    expect(labels(message(1))).not.toContain('举报')
    expect(labels(message(1), props({ canReportChat: false }))).not.toContain('举报')
  })

  it('offers 置顶 where TDLib allows it, and 取消置顶 on the pinned row', () => {
    const target = message(7)
    expect(labels(target, props({ canBePinned: true }))).toContain('置顶')
    expect(labels(target, props({ canBePinned: true }), { pinnedMessageId: 7 })).toContain(
      '取消置顶',
    )
    // Another row keeps 置顶: the chat pins one message at a time.
    expect(labels(target, props({ canBePinned: true }), { pinnedMessageId: 8 })).toContain('置顶')
    expect(labels(target, props({ canBePinned: false }))).not.toContain('置顶')
  })

  it('hides forward when TDLib says the content is protected', () => {
    expect(labels(message(1), props({ canBeForwarded: false }))).not.toContain('转发')
  })

  it('offers 撤回 only for our own message TDLib lets us revoke', () => {
    expect(
      labels(message(1, { outgoing: true }), props({ canBeDeletedForAllUsers: true })),
    ).toContain('撤回')
    expect(labels(message(1), props({ canBeDeletedForAllUsers: true }))).not.toContain('撤回')
  })

  it('offers 重试 first on a failed row TDLib allows retrying', () => {
    const failed = message(1, {
      outgoing: true,
      sendingState: 'failed',
      canRetry: true,
    })
    expect(labels(failed)).toEqual(['重试', '回复', '复制', '转发', '删除'])
    const unrecoverable = message(2, {
      outgoing: true,
      sendingState: 'failed',
      canRetry: false,
    })
    expect(labels(unrecoverable)).not.toContain('重试')
  })

  it('deletes locally by default and revokes only through 撤回', () => {
    const seen: Array<[Message, boolean]> = []
    const target = message(1, { outgoing: true })
    const items = buildMessageMenuItems(
      target,
      { ...handlers, onDelete: (item, forBoth) => seen.push([item, forBoth]) },
      { canReply: true, properties: props({ canBeDeletedForAllUsers: true }) },
    )
    items.find((item) => item.label === '删除')?.onSelect()
    items.find((item) => item.label === '撤回')?.onSelect()
    expect(seen).toEqual([
      [target, false],
      [target, true],
    ])
  })

  it('hides delete when neither local delete nor revoke is allowed', () => {
    expect(
      labels(message(1), props({ canBeDeletedOnlyForSelf: false, canBeDeletedForAllUsers: false })),
    ).not.toContain('删除')
  })

  it('falls back to the safe items when the properties call failed', () => {
    expect(labels(message(1), null)).toEqual(['回复', '复制', '删除'])
  })

  it('drops reply where there is no composer to reply into (a channel)', () => {
    expect(labels(message(1), props(), { canReply: false })).toEqual(['复制', '转发', '删除'])
  })

  it('marks delete as the dangerous item', () => {
    const remove = buildMessageMenuItems(message(1), handlers, {
      canReply: true,
      properties: props(),
    }).find((item) => item.label === '删除')
    expect(remove?.danger).toBe(true)
  })

  it('calls the handler with the message it was built for', () => {
    const target = message(7)
    const seen: Message[] = []
    const items = buildMessageMenuItems(
      target,
      { ...handlers, onReply: (item) => seen.push(item) },
      { canReply: true, properties: props() },
    )
    items[0]?.onSelect()
    expect(seen).toEqual([target])
  })
})

describe('isEmojiOnly', () => {
  it('accepts a single emoji and an emoji-only run', () => {
    expect(isEmojiOnly('😀')).toBe(true)
    expect(isEmojiOnly('  😀😂🎉 ')).toBe(true)
    // Skin tone + ZWJ sequence.
    expect(isEmojiOnly('👍🏽')).toBe(true)
    expect(isEmojiOnly('👨‍👩‍👧')).toBe(true)
  })

  it('rejects plain text, digits and mixed content', () => {
    expect(isEmojiOnly('')).toBe(false)
    expect(isEmojiOnly('   ')).toBe(false)
    expect(isEmojiOnly('123')).toBe(false)
    expect(isEmojiOnly('ok 😀')).toBe(false)
    expect(isEmojiOnly('😀 😀 😀 😀 😀 😀 😀')).toBe(false) // longer than the cap
  })
})

describe('countUnreadBelow', () => {
  const incoming = (id: number) => ({ id, outgoing: false })
  const outgoing = (id: number) => ({ id, outgoing: true })
  const transcript = [incoming(10), incoming(11), incoming(12), incoming(13)]

  it('counts what is newer than the marker and still below the fold', () => {
    // Marker at 11, reader looking at row 12: only 13 is left below.
    expect(countUnreadBelow(transcript, 11, 2)).toBe(1)
    expect(countUnreadBelow(transcript, 11, 1)).toBe(2)
  })

  it('is zero once the read marker reached the end', () => {
    expect(countUnreadBelow(transcript, 13, -1)).toBe(0)
    // ...or once the reader scrolled past everything.
    expect(countUnreadBelow(transcript, 11, 3)).toBe(0)
  })

  it('treats an unknown marker as "nothing is read yet"', () => {
    expect(countUnreadBelow(transcript, null, 1)).toBe(2)
    expect(countUnreadBelow(transcript, null, -1)).toBe(4)
  })

  it('ignores our own messages, like the unread badge does', () => {
    const mixed = [incoming(10), outgoing(11), incoming(12)]
    expect(countUnreadBelow(mixed, 10, -1)).toBe(1)
  })

  it('never counts messages above the viewport, however new the marker is behind', () => {
    // Scrolled down over 10 and 11 without reporting them: they are seen already.
    expect(countUnreadBelow(transcript, 9, 1)).toBe(2)
  })
})

describe('pickSeenUpTo', () => {
  const ids = [10, 11, 12, 13, 14, 15]
  const rows = (indexes: number[], starts: number[]) =>
    indexes.map((index, position) => ({ index, start: starts[position] ?? 0 }))

  it('counts every row whose top edge is above the viewport bottom', () => {
    expect(
      pickSeenUpTo({
        items: rows([0, 1, 2, 3], [0, 100, 200, 300]),
        sizerOffset: 10,
        viewportHeight: 500,
        idAt: (index) => ids[index],
      }),
    ).toEqual({ newestIndex: 3, newestId: 13 })
  })

  it('leaves the overscan rows below the fold to the pill', () => {
    // Scrolled 290px into a window 100px tall: rows 2 and 3 are on screen, and the
    // overscan rows below them are what "3 条新消息" counts.
    expect(
      pickSeenUpTo({
        items: rows([2, 3, 4, 5], [200, 300, 400, 500]),
        sizerOffset: -290,
        viewportHeight: 100,
        idAt: (index) => ids[index],
      }),
    ).toEqual({ newestIndex: 3, newestId: 13 })
  })

  it('does not count a row that starts exactly at the bottom edge', () => {
    expect(
      pickSeenUpTo({
        items: rows([0], [0]),
        sizerOffset: 10,
        viewportHeight: 10,
        idAt: (index) => ids[index],
      }),
    ).toEqual({ newestIndex: -1, newestId: null })
  })

  it('has nothing seen without rows', () => {
    expect(pickSeenUpTo({ items: [], sizerOffset: 0, viewportHeight: 400, idAt: () => 1 })).toEqual(
      { newestIndex: -1, newestId: null },
    )
  })

  it('skips a row whose message is gone (a shrunk transcript)', () => {
    expect(
      pickSeenUpTo({
        items: rows([0, 1, 2], [0, 100, 200]),
        sizerOffset: 0,
        viewportHeight: 400,
        idAt: (index) => (index === 2 ? undefined : ids[index]),
      }),
    ).toEqual({ newestIndex: 1, newestId: 11 })
  })

  it('takes the highest id and the highest index independently', () => {
    // Message ids are not guaranteed to ascend with the list index.
    expect(
      pickSeenUpTo({
        items: rows([0, 1], [0, 100]),
        sizerOffset: 0,
        viewportHeight: 400,
        idAt: (index) => (index === 0 ? 50 : 12),
      }),
    ).toEqual({ newestIndex: 1, newestId: 50 })
  })
})

describe('messagesById', () => {
  it('indexes the transcript by message id, keeping the objects', () => {
    const transcript = [message(10), message(20)]
    const byId = messagesById(transcript)
    expect(byId.size).toBe(2)
    expect(byId.get(20)).toBe(transcript[1])
    expect(byId.get(99)).toBeUndefined()
  })
})
