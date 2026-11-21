import type { Message } from '@wegram/protocol'

/**
 * Service rows (centered transcript notices) for the demo account: a missed call
 * and a self-destructed photo in the 妈 chat. Main composes these strings from
 * TDLib content; a fixture carries the finished text, like every other row, so
 * the UI can be checked without TDLib. Split out of data.ts for the line budget.
 */
export function serviceMessages(at: (minutesAgo: number) => number): Message[] {
  const notice = (id: number, minutesAgo: number, text: string): Message => ({
    id,
    chatId: 3,
    senderId: 37,
    senderName: '妈',
    outgoing: false,
    date: at(minutesAgo),
    kind: 'service',
    text,
  })
  return [notice(303, 24, '未接听语音通话'), notice(304, 23, '妈发送的图片已过期')]
}
