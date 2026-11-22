import type { ChatReport, ChatSummary, PeerStatus, UserProfile } from '@wegram/protocol'

import type { TdObject } from '../client'
import { asArray } from '../json'
import { mapReportResult } from '../map/report'
import { mapPeerStatus } from '../map/status'
import { mapUserProfile } from '../map/user'
import { fetchChatSummary } from './chats'
import type { ActionDeps } from './deps'
import { formattedText } from './message-input'

/**
 * 在线 / 最后上线 for one person.
 *
 * TDLib keeps the current status on the basic user object, so this is an offline
 * call in the normal case. A status the server has not told us about yet maps to
 * `null`: the header then shows nothing rather than a wrong sentence.
 */
export async function userStatus(
  deps: Pick<ActionDeps, 'invoke'>,
  userId: number,
): Promise<PeerStatus | null> {
  const user = await deps.invoke({ _: 'getUser', user_id: userId })
  return mapPeerStatus(user?.status)
}

/**
 * 资料卡: the person's identity plus the full-info half (简介, 备注, 拉黑, 共同群聊).
 *
 * Two calls because TDLib splits the person over two objects; both are local
 * cache reads once the client has synced, so the card opens without a network
 * round trip. The photo is queued in the background like every other avatar:
 * a card that has to wait for a download would open blank.
 */
export async function userProfile(deps: ActionDeps, userId: number): Promise<UserProfile> {
  const [user, full] = await Promise.all([
    deps.invoke({ _: 'getUser', user_id: userId }) as Promise<TdObject>,
    deps.invoke({ _: 'getUserFullInfo', user_id: userId }) as Promise<TdObject | undefined>,
  ])
  deps.mapper.prefetchUserAvatars([userId])
  return mapUserProfile(deps.mapper, user, full)
}

/**
 * 共同群聊: TDLib's `getGroupsInCommon`, one page at a time.
 *
 * The answer is a `Chats` object of ids (the same shape `getChats` answers), so
 * every id is mapped into the summary the chat list draws; the photos come second
 * exactly like `listChats`, because a card that had to wait for downloads would
 * open blank.
 */
export async function userCommonChats(
  deps: ActionDeps,
  input: { userId: number; offset?: number; limit?: number },
): Promise<ChatSummary[]> {
  const response = await deps.invoke({
    _: 'getGroupsInCommon',
    user_id: input.userId,
    // 0 is TDLib's "first page", not a chat id that exists.
    offset_chat_id: input.offset ?? 0,
    limit: input.limit ?? 50,
  })
  const ids = asArray<number>(response.chat_ids)
  const summaries = await Promise.all(ids.map((id) => fetchChatSummary(deps, id)))
  deps.prefetchChatAvatars(ids)
  return summaries
}

/**
 * 备注: Telegram's cloud-synced note (`setUserNote`), answered as the refreshed
 * card so the row redraws without a second request. An empty note clears it —
 * TDLib reads an empty `formattedText` as "no note".
 */
export async function setUserNote(
  deps: ActionDeps,
  input: { userId: number; note: string },
): Promise<UserProfile> {
  await deps.invoke({
    _: 'setUserNote',
    user_id: input.userId,
    note: formattedText(input.note),
  })
  return userProfile(deps, input.userId)
}

/**
 * 添加为联系人 / 删除联系人.
 *
 * `addContact` takes an imported contact *and* a user id: the id is what ties the
 * person to Telegram, the imported fields are what the address book stores. The
 * phone number may be empty when the id is known (the official clients do the
 * same for someone you found by username), and the names come from the profile
 * because TDLib wants them non-empty.
 */
export async function setUserContact(
  deps: ActionDeps,
  input: { userId: number; contact: boolean; sharePhone?: boolean },
): Promise<UserProfile> {
  if (input.contact) {
    const user = (await deps.invoke({ _: 'getUser', user_id: input.userId })) as TdObject
    await deps.invoke({
      _: 'addContact',
      user_id: input.userId,
      contact: {
        _: 'importedContact',
        phone_number: '',
        first_name: user.first_name ?? '',
        last_name: user.last_name ?? '',
        note: null,
      },
      share_phone_number: input.sharePhone === true,
    })
  } else {
    await deps.invoke({ _: 'removeContacts', user_ids: [input.userId] })
  }
  return userProfile(deps, input.userId)
}

/**
 * 拉黑 / 取消拉黑.
 *
 * `setMessageSenderBlockList` takes a *sender*, not a user id, and a null list
 * means "unblock" — the same call both ways. The card is answered refreshed so
 * the button flips without a second request.
 */
export async function setUserBlocked(
  deps: ActionDeps,
  input: { userId: number; blocked: boolean },
): Promise<UserProfile> {
  await deps.invoke({
    _: 'setMessageSenderBlockList',
    sender_id: { _: 'messageSenderUser', user_id: input.userId },
    block_list: input.blocked ? { _: 'blockListMain' } : null,
  })
  return userProfile(deps, input.userId)
}

/**
 * 举报 a person (`reportChat`).
 *
 * The report is filed against the *chat*, so the private chat is resolved first
 * (`createPrivateChat` is a local call — nothing is sent and no message appears).
 * `optionId` is a TDLib `bytes` id that came back from a previous answer and is
 * passed back verbatim; an empty one is the "which reason?" first phase. The
 * comment Telegram asks for travels with it in `text`.
 */
export async function reportUser(
  deps: ActionDeps,
  input: { userId: number; optionId?: string; text?: string },
): Promise<ChatReport> {
  const chat = (await deps.invoke({
    _: 'createPrivateChat',
    user_id: input.userId,
    force: false,
  })) as TdObject
  const result = await deps.invoke({
    _: 'reportChat',
    chat_id: Number(chat.id),
    option_id: input.optionId ?? '',
    message_ids: [],
    text: input.text ?? '',
  })
  return mapReportResult(result as TdObject | undefined)
}
