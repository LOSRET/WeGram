import { createContext, useContext, type ReactNode } from 'react'

/**
 * The comment thread a row belongs to (design doc §9.8, §9.10).
 *
 * A comment's own chat is the discussion group, but its thread is anchored on the
 * commented post in the channel — and that anchor is what TDLib's thread read
 * needs. The panel provides it; `PollBubble` reads it so a poll in the comments is
 * re-read from the server rather than from the local store.
 */
export interface CommentThreadAnchor {
  /** Chat of the commented post (a channel). */
  chatId: number
  /** The commented post. */
  messageId: number
}

const CommentThreadContext = createContext<CommentThreadAnchor | null>(null)

export function CommentThreadSource({
  value,
  children,
}: {
  value: CommentThreadAnchor
  children: ReactNode
}) {
  return <CommentThreadContext.Provider value={value}>{children}</CommentThreadContext.Provider>
}

/** The thread a row is drawn in, or null in an ordinary transcript. */
export function useCommentThread(): CommentThreadAnchor | null {
  return useContext(CommentThreadContext)
}
