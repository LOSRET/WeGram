/**
 * The 转发来源 a forward produces, shared by the two fakes.
 *
 * TDLib fills `message.forward_info.origin` on the new message: the author of the
 * message being forwarded, or — when that message was itself forwarded — the
 * original source Telegram already remembers. The fakes copy the row, so they
 * have to compose the same field themselves or a forward in the demo would look
 * like the sender wrote it (and a forward of a forward would lose its channel).
 */
export interface ForwardedOrigin {
  fromName: string
  fromUserId?: number
  fromChatId?: number
  fromMessageId?: number
  date?: number
}

/** The fields of a row this rule reads; both fakes' messages satisfy them. */
export interface ForwardableRow {
  senderId: number
  senderChatId?: number
  senderName: string
  date: number
  forward?: ForwardedOrigin
}

/**
 * The origin a forwarded copy carries: the original's own forward when it has
 * one, else this sender (a person by id, or a chat/channel by chat id).
 */
export function forwardedOrigin(row: ForwardableRow): ForwardedOrigin {
  if (row.forward) return row.forward
  const base = { fromName: row.senderName, date: row.date }
  if (row.senderChatId) return { ...base, fromChatId: row.senderChatId }
  if (row.senderId) return { ...base, fromUserId: row.senderId }
  return base
}
