import { AppError } from '@wegram/protocol'
import type { ChatSummary, Message } from '@wegram/protocol'

import { probeImageSize } from '../../media/image-size'
import { registerMediaFile } from '../../media/registry'
import type { Logger } from '../../util'
import type { AdapterEvent, MediaKind } from '../adapter'
import type { TdObject } from './client'
import { mapChat } from './map/chat'
import type { MapperContext } from './map/context'
import { mapMessage } from './map/message'

/** Everything the transcript actions need from the adapter. */
export interface ActionDeps {
  invoke(method: TdObject): Promise<any>
  mapper: MapperContext
  logger: Logger
  /** Pushes one adapter event; `downloadFile` announces progress and completion. */
  emit(event: AdapterEvent): void
  /** Downloads the chat photos of a page in the background. */
  prefetchChatAvatars(chatIds: number[]): void
}

function replyTo(messageId?: number): TdObject | null {
  return messageId === undefined ? null : { _: 'inputMessageReplyToMessage', message_id: messageId }
}

function formattedText(text: string | undefined): TdObject {
  return { _: 'formattedText', text: text ?? '', entities: [] }
}

/**
 * Downloads a file raw, without announcing it. Attachments go through
 * `downloadFile()` below (which emits `evt:file` for the progress UI); avatars
 * use this one so a hundred preview pictures do not flood the store.
 */
export async function fetchFilePath(
  deps: Pick<ActionDeps, 'invoke'>,
  fileId: number,
  priority: number,
): Promise<{ path: string; file: TdObject }> {
  const file = await deps.invoke({
    _: 'downloadFile',
    file_id: fileId,
    priority,
    offset: 0,
    limit: 0,
    synchronous: true,
  })
  const path: string | undefined = file?.local?.path
  if (!path) throw new AppError('internal', `File ${fileId} downloaded but path is empty`)
  return { path, file }
}

export async function fetchChatSummary(deps: ActionDeps, chatId: number): Promise<ChatSummary> {
  const chat = await deps.invoke({ _: 'getChat', chat_id: chatId })
  return mapChat(deps.mapper, chat)
}

export async function getChat(deps: ActionDeps, chatId: number): Promise<ChatSummary> {
  return fetchChatSummary(deps, chatId)
}

export async function listChats(
  deps: ActionDeps,
  input: { limit: number; offset: number },
): Promise<ChatSummary[]> {
  // TDLib has no offset for getChats: fetch enough ids and slice (§6.3).
  const response = await deps.invoke({
    _: 'getChats',
    chat_list: { _: 'chatListMain' },
    limit: input.offset + input.limit,
  })
  const ids: number[] = Array.isArray(response.chat_ids) ? response.chat_ids : []
  const page = ids.slice(input.offset, input.offset + input.limit)
  const summaries = await Promise.all(page.map((id) => fetchChatSummary(deps, id)))
  // Photos come second: the rows must not wait for one network round trip per
  // chat, so they are downloaded in the background and pushed as `chats` ops.
  deps.prefetchChatAvatars(page)
  return summaries
}

/**
 * The reader opened the conversation.
 *
 * Opening must NOT mark it read. Reading is reported per viewport by
 * `messages:read` (gated by the renderer's `lib/readGate.ts`, 350 ms debounce)
 * and moves the server marker one screen at a time. Marking everything read here
 * undid that rule on the only path that matters — a click: a group with 300
 * unread messages went to zero before the transcript had even landed on its
 * "以下是新消息" line, so the badge, the rail total and every other device said
 * "read" while the reader was still looking at the unread block, and the chat
 * reopened on a divider that no longer meant anything.
 *
 * What is left is the warm-up: `getChat` loads the chat into TDLib's cache, which
 * is what the history request that follows reads from. (The newest id cannot be
 * taken from a history page in any case: `getChatHistory` treats
 * `from_message_id` as *exclusive*, measured 2026-11-17.)
 */
export async function openChat(deps: ActionDeps, chatId: number): Promise<void> {
  await deps.invoke({ _: 'getChat', chat_id: chatId })
}

/** TDLib's "muted forever"; `mute_for` is a signed 32-bit seconds field. */
const MUTE_FOREVER = 2_147_483_647

export interface PostPermissionDeps {
  invoke(method: TdObject): Promise<any>
  /** Our own user id, learnt from `getMe`; nothing can be checked before that. */
  getSelfUserId(): number | null
}

/**
 * Whether this account may post in a chat.
 *
 * Only channels need the question: groups and private chats always keep the
 * composer, because a server-side restriction surfaces as an `AppError` on send.
 * Channel posting, on the other hand, is an administrator right that TDLib keeps
 * on the member object — `chat.permissions` describes *non-administrators* — so
 * the current user's own membership has to be asked for.
 */
export async function canPost(deps: PostPermissionDeps, chatId: number): Promise<boolean> {
  const userId = deps.getSelfUserId()
  if (userId === null) return false
  const chat = await deps.invoke({ _: 'getChat', chat_id: chatId })
  const type = chat?.type
  if (type?._ !== 'chatTypeSupergroup' || !type.is_channel) return true
  const member = await deps.invoke({
    _: 'getChatMember',
    chat_id: chatId,
    member_id: { _: 'messageSenderUser', user_id: userId },
  })
  const status = member?.status
  if (status?._ === 'chatMemberStatusCreator') return true
  if (status?._ === 'chatMemberStatusAdministrator') {
    return Boolean(status.rights?.can_post_messages)
  }
  return false
}

/**
 * Mutes or unmutes a chat.
 *
 * TDLib has no mute toggle: `setChatNotificationSettings` replaces the whole
 * object, so the stored settings are read back and only the mute pair is
 * changed — otherwise toggling mute would also reset sounds and previews.
 */
export async function setChatMuted(
  deps: ActionDeps,
  chatId: number,
  muted: boolean,
): Promise<ChatSummary> {
  const chat = await deps.invoke({ _: 'getChat', chat_id: chatId })
  const settings = chat?.notification_settings
  if (!settings) throw new AppError('internal', `Chat ${chatId} has no notification settings`)
  await deps.invoke({
    _: 'setChatNotificationSettings',
    chat_id: chatId,
    notification_settings: {
      ...settings,
      use_default_mute_for: false,
      mute_for: muted ? MUTE_FOREVER : 0,
    },
  })
  const summary = await fetchChatSummary(deps, chatId)
  deps.emit({ type: 'chats', ops: [{ op: 'upsert', chat: summary }] })
  return summary
}

/**
 * One page of history, ascending, plus whether older messages may exist.
 *
 * Measured quirk that made groups look unloadable: `getChatHistory` happily
 * answers from the local database and then returns only the handful of
 * messages it has cached — 1 to 5 for a cold group, in ~2 ms — even when the
 * chat has thousands of messages. Anchoring *below* that short answer is the
 * request TDLib does take to the server, and it comes back full. So a short
 * answer is topped up here, and only an empty round counts as "the chat
 * begins here".
 *
 * The old `hasMore: rawMessages.length >= limit` read every short answer as
 * "no more history", which stopped MessageList from paging at all.
 */
export async function history(
  deps: ActionDeps,
  input: { chatId: number; fromMessageId?: number; limit: number },
): Promise<{ messages: Message[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(input.limit, 1), 100)

  // Measured behaviour (probe in RESULTS.md): from_message_id = 0 does not
  // trigger a server fetch — it only returns the locally cached last message.
  // A real page needs an existing message id as anchor, so the first page
  // anchors on chat.last_message.
  let anchor = input.fromMessageId
  if (anchor === undefined) {
    const chat = await deps.invoke({ _: 'getChat', chat_id: input.chatId })
    const lastId: number | undefined = chat.last_message?.id
    if (!lastId) {
      // The whole conversation renders empty when this happens, and the
      // renderer caches the empty page, so it never retries — log which half
      // of the chain produced it.
      deps.logger.warn(
        `history: chat ${input.chatId} has no last_message (${
          chat.last_message === null ? 'null' : typeof chat.last_message
        }) — returning an empty first page`,
      )
      return { messages: [], hasMore: false }
    }
    // `getChatHistory` returns messages *older than* `from_message_id` (it is
    // exclusive; measured 2026-11-17: from=4975493120 answered 4974444544…).
    // Anchoring exactly on the last message therefore dropped the newest message
    // from the first page — one message was never loaded, and `openChat` marked
    // the wrong id as read, so the unread badge never cleared. One past the last
    // message is the request that includes it.
    anchor = lastId + 1
  }

  const collected: TdObject[] = []
  const seen = new Set<number>()
  let cursor: number = anchor
  // The first page includes its anchor, because the implicit anchor above is one
  // past the last message; every later round is strictly older.
  let below = input.fromMessageId
  let exhausted = false
  // A short answer is topped up over a few rounds; bounded so a slow link
  // cannot stall the first paint.
  const MAX_ROUNDS = 3

  for (let round = 0; round < MAX_ROUNDS && collected.length < limit; round += 1) {
    const response = await deps.invoke({
      _: 'getChatHistory',
      chat_id: input.chatId,
      from_message_id: cursor,
      offset: 0,
      limit: limit - collected.length,
      only_local: false,
    })
    const rawMessages: TdObject[] = Array.isArray(response.messages) ? response.messages : []
    const fresh = rawMessages.filter((raw) => {
      const id = Number(raw.id)
      if (!Number.isFinite(id) || seen.has(id)) return false
      return below === undefined || id < below
    })
    if (fresh.length === 0) {
      exhausted = true
      break
    }
    for (const raw of fresh) {
      seen.add(Number(raw.id))
      collected.push(raw)
    }
    const oldest = Math.min(...fresh.map((raw) => Number(raw.id)))
    cursor = oldest
    below = oldest
  }

  // getChatHistory returns newest first; the UI wants ascending order, and a
  // top-up round can overshoot, so keep the newest `limit` of what we have.
  const ordered = [...collected].sort((a, b) => Number(a.id) - Number(b.id))
  const page = ordered.length > limit ? ordered.slice(ordered.length - limit) : ordered
  if (page.length === 0) {
    // Only the *first* page is a problem here: an empty "older" page is the
    // normal end of history. An empty first page renders as a silent blank
    // transcript and gets cached by the renderer.
    deps.logger.warn(
      `history: getChatHistory returned nothing for chat ${input.chatId} from ${cursor} (anchor ${
        input.fromMessageId ?? 'last_message'
      }, limit ${limit})`,
    )
  }
  const mapped = await Promise.all(page.map((raw) => mapMessage(deps.mapper, input.chatId, raw)))
  return { messages: mapped, hasMore: !exhausted && mapped.length > 0 }
}

/** One side of an around window; the protocol caps it at 50 as well. */
const AROUND_LIMIT = 50

/** Newest message id the chat knows about, or 0 when it has no messages yet. */
async function newestMessageId(deps: Pick<ActionDeps, 'invoke'>, chatId: number): Promise<number> {
  const chat = await deps.invoke({ _: 'getChat', chat_id: chatId })
  return Number(chat?.last_message?.id ?? 0)
}

/** Raw messages -> mapped, ascending, de-duplicated by id. */
async function mapRawPage(
  deps: Pick<ActionDeps, 'invoke' | 'mapper'>,
  chatId: number,
  rawMessages: TdObject[] | undefined,
): Promise<Message[]> {
  const byId = new Map<number, TdObject>()
  for (const raw of rawMessages ?? []) {
    const id = Number(raw.id)
    if (Number.isFinite(id)) byId.set(id, raw)
  }
  const ordered = [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id))
  return Promise.all(ordered.map((raw) => mapMessage(deps.mapper, chatId, raw)))
}

/**
 * A contiguous window centred on one message, for a reading position or an
 * unread boundary that is older than the newest page.
 *
 * This is what makes a deep position reachable without walking the gap first:
 * messages:history can only page back from the newest message, so restoring a
 * position 5 000 messages up used to cost fifty round trips (the renderer gave
 * up after six pages). Two requests are enough here:
 *
 *  - older: history() (the robust top-up pager) anchored on the message;
 *  - newer: getChatHistory with a *negative* offset, which returns messages
 *    newer than the anchor (measured in Spike 2, RESULTS.md #2.3);
 *  - the anchor itself: getChatHistory is exclusive, so getMessage supplies it.
 *
 * hasNewer means the window does not reach the newest message; the renderer
 * then appends via messages:newer as the reader scrolls down instead of
 * pretending the window ends at the latest message.
 */
export async function historyAround(
  deps: ActionDeps,
  input: { chatId: number; messageId: number; limit: number },
): Promise<{ messages: Message[]; hasMore: boolean; hasNewer: boolean }> {
  const size = Math.min(Math.max(input.limit, 1), AROUND_LIMIT)
  const [lastId, older] = await Promise.all([
    newestMessageId(deps, input.chatId),
    history(deps, {
      chatId: input.chatId,
      fromMessageId: input.messageId,
      limit: size,
    }),
  ])

  const newerResponse = await deps.invoke({
    _: 'getChatHistory',
    chat_id: input.chatId,
    from_message_id: input.messageId,
    offset: -size,
    limit: size,
    only_local: false,
  })
  const rawNewer = (Array.isArray(newerResponse.messages) ? newerResponse.messages : []).filter(
    (raw: TdObject) => Number(raw.id) > input.messageId,
  )
  const newer = await mapRawPage(deps, input.chatId, rawNewer)

  let anchor: Message | null = null
  try {
    const raw = await deps.invoke({
      _: 'getMessage',
      chat_id: input.chatId,
      message_id: input.messageId,
    })
    if (raw && raw._ !== 'error' && Number(raw.id) === input.messageId) {
      anchor = await mapMessage(deps.mapper, input.chatId, raw)
    }
  } catch {
    // A deleted anchor is normal: the window still carries its neighbours.
  }

  const byId = new Map<number, Message>()
  for (const message of older.messages) byId.set(message.id, message)
  if (anchor) byId.set(anchor.id, anchor)
  for (const message of newer) byId.set(message.id, message)
  const messages = [...byId.values()].sort((a, b) => a.id - b.id)
  const newest = messages.at(-1)?.id ?? 0
  return {
    messages,
    hasMore: older.hasMore,
    hasNewer: lastId > 0 && newest < lastId,
  }
}

/**
 * The page immediately below an anchored window. Needed because an around
 * window does not reach the newest message; the reader scrolls down and the
 * transcript extends instead of jumping.
 */
export async function historyNewer(
  deps: ActionDeps,
  input: { chatId: number; fromMessageId: number; limit: number },
): Promise<{ messages: Message[]; hasNewer: boolean }> {
  const size = Math.min(Math.max(input.limit, 1), 100)
  const lastId = await newestMessageId(deps, input.chatId)
  const response = await deps.invoke({
    _: 'getChatHistory',
    chat_id: input.chatId,
    from_message_id: input.fromMessageId,
    offset: -size,
    limit: size,
    only_local: false,
  })
  const rawNewer = (Array.isArray(response.messages) ? response.messages : []).filter(
    (raw: TdObject) => Number(raw.id) > input.fromMessageId,
  )
  const messages = await mapRawPage(deps, input.chatId, rawNewer)
  const newest = messages.at(-1)?.id ?? input.fromMessageId
  return { messages, hasNewer: lastId > 0 && newest < lastId }
}

export async function sendText(
  deps: ActionDeps,
  input: { chatId: number; text: string; replyTo?: number },
): Promise<{ localId: string; message: Message }> {
  const response = await deps.invoke({
    _: 'sendMessage',
    chat_id: input.chatId,
    reply_to:
      input.replyTo === undefined
        ? null
        : { _: 'inputMessageReplyToMessage', message_id: input.replyTo },
    input_message_content: {
      _: 'inputMessageText',
      text: { _: 'formattedText', text: input.text },
      clear_draft: true,
    },
  })
  const message = await mapMessage(deps.mapper, input.chatId, response)
  return { localId: `td-${message.id}`, message }
}

export async function editText(
  deps: ActionDeps,
  input: { chatId: number; messageId: number; text: string },
): Promise<Message> {
  await deps.invoke({
    _: 'editMessageText',
    chat_id: input.chatId,
    message_id: input.messageId,
    input_message_content: {
      _: 'inputMessageText',
      text: { _: 'formattedText', text: input.text },
    },
  })
  const page = await history(deps, {
    chatId: input.chatId,
    fromMessageId: input.messageId + 1,
    limit: 1,
  })
  const updated = page.messages.find((m) => m.id === input.messageId)
  if (!updated) throw new AppError('internal', `Message ${input.messageId} not found after edit`)
  return updated
}

export async function deleteMessages(
  deps: ActionDeps,
  input: { chatId: number; messageIds: number[]; forBoth: boolean },
): Promise<void> {
  await deps.invoke({
    _: 'deleteMessages',
    chat_id: input.chatId,
    message_ids: input.messageIds,
    revoke: input.forBoth,
  })
}

export async function forwardMessages(
  deps: ActionDeps,
  input: { fromChatId: number; messageIds: number[]; toChatId: number },
): Promise<void> {
  await deps.invoke({
    _: 'forwardMessages',
    chat_id: input.toChatId,
    from_chat_id: input.fromChatId,
    message_ids: input.messageIds,
    options: null,
  })
}

export async function markRead(
  deps: ActionDeps,
  input: { chatId: number; upToMessageId: number },
): Promise<void> {
  await deps.invoke({
    _: 'viewMessages',
    chat_id: input.chatId,
    message_ids: [input.upToMessageId],
    force_read: true,
  })
}

export async function searchGlobal(
  deps: ActionDeps,
  input: { q: string; limit: number },
): Promise<ChatSummary[]> {
  const response = await deps.invoke({ _: 'searchChats', query: input.q, limit: input.limit })
  const ids: number[] = Array.isArray(response.chat_ids) ? response.chat_ids : []
  return Promise.all(ids.map((id) => fetchChatSummary(deps, id)))
}

export async function searchInChat(
  deps: ActionDeps,
  input: { chatId: number; q: string; fromMessageId?: number },
): Promise<Message[]> {
  const response = await deps.invoke({
    _: 'searchChatMessages',
    chat_id: input.chatId,
    query: input.q,
    sender_id: null,
    from_message_id: input.fromMessageId ?? 0,
    offset: 0,
    limit: 50,
    filter: { _: 'searchMessagesFilterEmpty' },
  })
  const rawMessages: TdObject[] = Array.isArray(response.messages) ? response.messages : []
  return Promise.all(rawMessages.map((raw) => mapMessage(deps.mapper, input.chatId, raw)))
}

export async function downloadFile(
  deps: ActionDeps,
  input: { fileId: number; priority: number },
): Promise<{ path: string; url: string }> {
  const { path, file } = await fetchFilePath(deps, input.fileId, input.priority)
  const url = registerMediaFile(path)
  deps.emit({
    type: 'file',
    fileId: input.fileId,
    downloaded: file?.local?.downloaded_size ?? 0,
    total: file?.expected_size ?? file?.size ?? 0,
    url,
    completed: true,
  })
  return { path, url }
}

/**
 * Sends a local file. Photos go through `inputMessagePhoto` so the server builds
 * the usual size ladder; everything else is a document. The pixel size must be
 * known before a photo can be sent (TDLib wants it), so an unparsable image falls
 * back to a document instead of producing a broken bubble.
 */
export async function sendMedia(
  deps: ActionDeps,
  input: {
    chatId: number
    filePath: string
    kind: MediaKind
    caption?: string
    replyTo?: number
  },
): Promise<{ localId: string; message: Message }> {
  const size = input.kind === 'photo' ? await probeImageSize(input.filePath) : null
  const content =
    input.kind === 'photo' && size
      ? {
          _: 'inputMessagePhoto',
          photo: {
            _: 'inputPhoto',
            photo: { _: 'inputFileLocal', path: input.filePath },
            thumbnail: null,
            video: null,
            added_sticker_file_ids: [],
            width: size.width,
            height: size.height,
          },
          caption: formattedText(input.caption),
          show_caption_above_media: false,
          self_destruct_type: null,
          has_spoiler: false,
        }
      : {
          _: 'inputMessageDocument',
          document: {
            _: 'inputDocument',
            document: { _: 'inputFileLocal', path: input.filePath },
            thumbnail: null,
            disable_content_type_detection: false,
          },
          caption: formattedText(input.caption),
        }

  const response = await deps.invoke({
    _: 'sendMessage',
    chat_id: input.chatId,
    reply_to: replyTo(input.replyTo),
    options: null,
    input_message_content: content,
  })
  const message = await mapMessage(deps.mapper, input.chatId, response)
  return { localId: `td-${message.id}`, message }
}

/** Sends an existing sticker by file id, as the picker does (design doc §9.4). */
export async function sendSticker(
  deps: ActionDeps,
  input: { chatId: number; fileId: number; replyTo?: number },
): Promise<{ localId: string; message: Message }> {
  // Dimensions were cached when the set was mapped; 512 is the sticker default.
  const size = deps.mapper.stickerSizes.get(input.fileId) ?? { width: 512, height: 512 }
  const response = await deps.invoke({
    _: 'sendMessage',
    chat_id: input.chatId,
    reply_to: replyTo(input.replyTo),
    options: null,
    input_message_content: {
      _: 'inputMessageSticker',
      sticker: {
        _: 'inputSticker',
        sticker: { _: 'inputFileId', id: input.fileId },
        thumbnail: null,
        width: size.width,
        height: size.height,
      },
      emoji: '',
    },
  })
  const message = await mapMessage(deps.mapper, input.chatId, response)
  return { localId: `td-${message.id}`, message }
}
