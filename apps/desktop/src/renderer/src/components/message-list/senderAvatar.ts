import type { ChatSummary, Message } from '@wegram/protocol'

/** The signed-in account as the transcript sees it. */
export interface SelfIdentity {
  id: number
  name: string
  avatarUrl: string | undefined
}

/**
 * Which profile photo a transcript row draws, or `undefined` for the initials
 * placeholder.
 *
 * Three sources, in priority order per kind of sender:
 *
 * - our own rows — the account's photo (`auth.me.avatarUrl`);
 * - a message sent *by a chat* (channel post, anonymous admin) — the chat's live
 *   photo, which also covers a photo that arrived after the page was mapped; a
 *   linked channel that is not the open chat can only use what the row carried;
 * - a person — the snapshot on the message, else the late `evt:avatars` batch.
 */
export function senderAvatarUrl(
  message: Message,
  chat: ChatSummary,
  self: SelfIdentity,
  userAvatars: Record<number, string>,
): string | undefined {
  if (message.outgoing) return self.avatarUrl
  if (message.senderChatId !== undefined) {
    return message.senderChatId === chat.id
      ? (chat.avatarUrl ?? message.senderAvatarUrl)
      : message.senderAvatarUrl
  }
  if (message.senderAvatarUrl) return message.senderAvatarUrl
  return message.senderId > 0 ? userAvatars[message.senderId] : undefined
}
