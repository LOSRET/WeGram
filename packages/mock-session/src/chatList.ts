/**
 * The order a fake chat list is served in: pinned first, then newest activity.
 *
 * Both fakes sort their own list, and they used to disagree — the browser preview
 * served insertion order while the mock adapter sorted, so the two looked like
 * different accounts. This is that rule, once.
 */
export function sortChatList<T extends { pinned: boolean; lastMessageAt?: number }>(
  chats: readonly T[],
): T[] {
  return [...chats].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)
  })
}
