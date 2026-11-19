import type { Message } from '@wegram/protocol'

/**
 * Comment threads for the fake account (design doc §9.8).
 *
 * TDLib keeps a post's comments in the linked discussion group, not in the
 * transcript, so the fake data does too: a thread is a separate list that the
 * parent message only *counts*. Ids start far above the transcript's so a page
 * cursor can never be ambiguous.
 */

export interface ThreadAuthor {
  id: number
  name: string
}

export const COMMENT_AUTHORS: readonly ThreadAuthor[] = [
  { id: 4101, name: '小满' },
  { id: 4102, name: '阿星' },
  { id: 4103, name: '林深' },
  { id: 4104, name: '周末不加班' },
  { id: 4105, name: 'Cathy' },
  { id: 4106, name: '老周' },
  { id: 4107, name: '海边的卡夫卡' },
  { id: 4108, name: 'K' },
]

export const COMMENT_BODIES: readonly string[] = [
  '这条我先收藏了，晚点对着改。',
  '同问 +1，我也卡在这一步。',
  '已经踩过这个坑了，按你说的顺序调整就好了。',
  '能否再展开讲讲第二种格式？',
  '实测有效，感谢分享。',
  '我把这段转给同事了，正好用得上。',
  '这个思路可以，不过要注意旧版本兼容。',
  '支持，等这个功能很久了。',
  '哈哈哈，这就是我上周的翻车现场。',
  '细节问一下：滚动条是自绘的吗？',
]

/** Ids of comments start well above the transcript's, so paging is unambiguous. */
const COMMENT_ID_BASE = 900_000

export interface ThreadOptions {
  chatId: number
  messageId: number
  count: number
  /** When the commented message was posted; comments trail it two minutes apart. */
  minutesAgo: number
  /** Unix seconds. */
  now: () => number
}

/** One thread, oldest first, always newer than the post it belongs to. */
export function buildCommentThread(options: ThreadOptions): Message[] {
  const messages: Message[] = []
  const start = COMMENT_ID_BASE + options.messageId * 100
  for (let index = 0; index < options.count; index += 1) {
    const author = COMMENT_AUTHORS[index % COMMENT_AUTHORS.length] ?? { id: 4101, name: '小满' }
    const minutes = Math.max(1, options.minutesAgo - index * 2)
    messages.push({
      id: start + index,
      chatId: options.chatId,
      senderId: author.id,
      senderName: author.name,
      outgoing: false,
      date: options.now() - minutes * 60,
      kind: 'text',
      text: COMMENT_BODIES[index % COMMENT_BODIES.length] ?? '👍',
    })
  }
  return messages
}
