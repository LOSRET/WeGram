import type { TdObject } from '../client'
import { asArray } from '../json'

/** Where a chat sits: which list, and whether it is pinned there. */
export interface ChatPlacement {
  archived: boolean
  pinned: boolean
}

/**
 * Main or Archive, read from the field that actually says so.
 *
 * TDLib's `chat.chat_lists` is membership, while `positions` is ordering: "A chat
 * can have a non-zero position in a chat list even if it doesn't belong to the
 * chat list and have no position in a chat list even if it belongs to the chat
 * list" (td_api). So membership comes from `chat_lists`, and the pinned flag from
 * the position in the list the chat is actually in.
 *
 * A live position has `order > 0`: TDLib sends `updateChatPosition` with order 0
 * to mean "the chat needs to be removed from the list", and an entry with that
 * order can linger in the array.
 */
export function chatPlacement(chat: TdObject): ChatPlacement {
  const lists = asArray<TdObject>(chat.chat_lists)
  const archived = lists.some((list) => list?._ === 'chatListArchive')
  const wanted = archived ? 'chatListArchive' : 'chatListMain'
  const position = asArray<TdObject>(chat.positions).find((item) => item?.list?._ === wanted)
  const live = position !== undefined && Number(position.order ?? 0) > 0
  return { archived, pinned: live && position?.is_pinned === true }
}
