import type {
  AuthState,
  BootState,
  ChatSummary,
  ConnectionState,
  MessageInteraction,
  Self,
} from '@wegram/protocol'

import { registerMediaFile } from '../../media/registry'
import type { Logger } from '../../util'
import type { AdapterEvent } from '../adapter'
import type { TdObject } from './client'
import { asArray } from './json'
import { previewContent } from './map/content'
import { mapConnectionBoot, mapConnectionState } from './map/chat'
import type { MapperContext } from './map/context'
import { isTranscriptRemoval } from './map/deletion'
import { mapMessage, mapReactions } from './map/message'
import { mapPeerStatus } from './map/status'

/** What the update stream needs from the adapter. */
export interface UpdateDeps {
  invoke(method: TdObject): Promise<any>
  emit(event: AdapterEvent): void
  mapper: MapperContext
  logger: Logger
  setAuth(state: AuthState): void
  setBoot(state: BootState): void
  setConnection(state: ConnectionState): void
  /** Connection-derived boot stage; ignored once the boot settled. */
  setConnectionBoot(state: BootState): void
  me(): Promise<Self>
  fetchChatSummary(chatId: number): Promise<ChatSummary>
  avatars: {
    prefetch(chatIds: number[]): void
    /** Refetch somebody else's photo, but only when it actually changed. */
    syncUserPhoto(userId: number, fileId: number | undefined): void
    invalidate(chatId: number): void
    loadSelf(fileId: number): void
  }
  /** Our own user id, learnt from `getMe`; drives the rail avatar. */
  getSelfUserId(): number | null
  safeVersion(): string
}

/**
 * Builds the TDLib update handler.
 *
 * The dispatch table is intentionally flat: every case either maps an update into
 * one domain `AdapterEvent` (the IPC layer batches those) or refreshes a chat
 * summary. Anything unrecognised is ignored — TDLib sends a lot of updates this
 * adapter does not care about.
 */
export function createUpdateHandler(deps: UpdateDeps): (update: TdObject) => Promise<void> {
  return async function handleUpdate(update: TdObject): Promise<void> {
    switch (update._) {
      case 'updateAuthorizationState':
        await handleAuthorizationState(deps, update.authorization_state)
        return
      case 'updateConnectionState':
        deps.setConnection(mapConnectionState(update.state))
        deps.setConnectionBoot(mapConnectionBoot(update.state))
        return
      case 'updateNewMessage': {
        const raw = update.message
        if (!raw) return
        const message = await mapMessage(deps.mapper, raw.chat_id, raw)
        deps.emit({ type: 'messages', chatId: raw.chat_id, ops: [{ op: 'new', message }] })
        await emitChatUpsert(deps, raw.chat_id)
        return
      }
      case 'updateMessageContent':
      case 'updateMessageEdited': {
        // Remap the whole message instead of patching the text: an edit can change
        // media and a media upload completion can change a caption (§6.1).
        const chatId: number = update.chat_id
        const messageId: number = update.message_id
        try {
          const raw = await deps.invoke({
            _: 'getMessage',
            chat_id: chatId,
            message_id: messageId,
          })
          if (!raw || raw._ === 'error') return
          const message = await mapMessage(deps.mapper, chatId, raw)
          deps.emit({ type: 'messages', chatId, ops: [{ op: 'replace', message }] })
        } catch {
          // The message may have been deleted in the same batch.
        }
        return
      }
      /**
       * Engagement counters moved (views, forwards, replies). The update carries
       * no message content and fires on every view, so the whole message is not
       * remapped: a cheap `interaction` op patches the row instead.
       *
       * The patch carries only what the update actually says. TDLib leaves
       * `reply_info` out whenever it has no reply data at hand, and the old
       * `?? { comments: 0 }` fallback then wrote 0 over a count the history page
       * had delivered — a channel post lost its 评论 N 条 bar on the first view
       * after it was opened, and got it back only on a reload.
       */
      case 'updateMessageInteractionInfo': {
        const info = update.interaction_info
        if (!info || typeof info !== 'object') return
        const patch: Partial<MessageInteraction> = {}
        const views = Number(info.view_count ?? 0)
        const forwards = Number(info.forward_count ?? 0)
        const reply = info.reply_info
        if (Number.isFinite(views) && views > 0) patch.views = views
        if (Number.isFinite(forwards) && forwards > 0) patch.forwards = forwards
        if (reply && typeof reply === 'object') {
          const comments = Number(reply.reply_count ?? 0)
          if (Number.isFinite(comments) && comments >= 0) patch.comments = comments
          // The thread exists, so the row keeps (or gains) its 写评论 handle.
          patch.canOpen = true
        }
        if (Object.keys(patch).length === 0) return
        deps.emit({
          type: 'messages',
          chatId: update.chat_id,
          ops: [
            {
              op: 'interaction',
              chatId: update.chat_id,
              messageId: update.message_id,
              interaction: patch,
            },
          ],
        })
        return
      }
      /**
       * 表情回应 changed. The update carries the complete list (`reactions[]`) and
       * only this row's message id, so the row is patched rather than remapped —
       * a message with a busy reaction list would otherwise be re-fetched and
       * re-mapped on every chip somebody else taps.
       */
      case 'updateMessageReactions': {
        const reactions = mapReactions({ interaction_info: { reactions: update } }) ?? []
        deps.emit({
          type: 'messages',
          chatId: update.chat_id,
          ops: [
            {
              op: 'reactions',
              chatId: update.chat_id,
              messageId: update.message_id,
              reactions,
            },
          ],
        })
        return
      }
      case 'updateDeleteMessages': {
        const messageIds: number[] = asArray<number>(update.message_ids)
        if (messageIds.length === 0) return
        /**
         * TDLib also reports *cache evictions* here: while the app sat idle in the
         * background it dropped all 50 cached messages of the open chat with
         * `from_cache: true`, and mapping that to a `delete` emptied the transcript
         * even though the server still served every message (重新加载 brought them
         * back). Cache-only events must not remove rows — see `map/deletion.ts`.
         */
        if (!isTranscriptRemoval(update)) {
          deps.logger.info(
            `history: chat ${update.chat_id} dropped ${messageIds.length} message(s) from the local cache — kept in the transcript`,
          )
          return
        }
        deps.emit({
          type: 'messages',
          chatId: update.chat_id,
          ops: [{ op: 'delete', chatId: update.chat_id, messageIds }],
        })
        return
      }
      case 'updateChatReadInbox':
        deps.emit({
          type: 'messages',
          chatId: update.chat_id,
          ops: [
            {
              op: 'read',
              chatId: update.chat_id,
              upToMessageId: update.last_read_inbox_message_id ?? 0,
            },
          ],
        })
        await emitChatUpsert(deps, update.chat_id)
        return
      case 'updateChatReadOutbox':
        // Read receipts for our own messages: last_read_outbox_message_id moves.
        await emitChatUpsert(deps, update.chat_id)
        return
      /**
       * The server acknowledged a send. It may have renumbered the message: the
       * answer of `sendMessage` carried a pending id, and every later edit /
       * delete / read receipt must name the server id instead. The row is re-keyed
       * in place, never re-appended — its position is already the reader's.
       */
      case 'updateMessageSendSucceeded': {
        const raw = update.message
        if (!raw) return
        const chatId: number = raw.chat_id
        const message = await mapMessage(deps.mapper, chatId, raw)
        const oldId = Number(update.old_message_id ?? raw.id)
        const ops =
          oldId > 0 && oldId !== message.id
            ? [{ op: 'replaceId' as const, chatId, oldId, message }]
            : [{ op: 'replace' as const, message }]
        deps.emit({ type: 'messages', chatId, ops })
        await emitChatUpsert(deps, chatId)
        return
      }
      /**
       * The send failed: the message keeps its pending id and gains 未发送 plus the
       * reason. `can_retry` decides whether the row offers 重试; a failure with
       * `retry_after` is still retryable, TDLib enforces the delay on resend.
       */
      case 'updateMessageSendFailed': {
        const raw = update.message
        if (!raw) return
        const chatId: number = raw.chat_id
        const state = raw.sending_state ?? {}
        const reason = state.error?.message ?? update.error?.message
        deps.emit({
          type: 'messages',
          chatId,
          ops: [
            {
              op: 'sendState',
              chatId,
              messageId: Number(update.old_message_id ?? raw.id),
              sendingState: 'failed',
              ...(typeof reason === 'string' && reason ? { sendError: reason } : {}),
              canRetry: Boolean(state.can_retry),
            },
          ],
        })
        return
      }
      /** The server took the message; the success/failure update follows. */
      case 'updateMessageSendAcknowledged':
        return
      case 'updateChatIsMarkedAsUnread':
        // 标为未读 is a flag, not a counter: the row redraws its dot from the summary.
        await emitChatUpsert(deps, update.chat_id)
        return
      /**
       * TDLib answers `getInstalledStickerSets` from its local cache first and
       * replaces the list once the server copy arrives (measured: 14 cached sets,
       * then 192 a minute later). The picker has to refetch on this update or it
       * keeps the partial list for the rest of the session.
       */
      case 'updateInstalledStickerSets':
        if (update.sticker_type?._ === 'stickerTypeRegular') deps.emit({ type: 'stickerSets' })
        return
      case 'updateChatPosition':
      case 'updateNewChat':
        await emitChatUpsert(deps, update.chat?.id ?? update.chat_id)
        return
      case 'updateChatTitle':
        if (typeof update.title === 'string') {
          deps.mapper.chatTitles.set(update.chat_id, update.title)
        }
        await emitChatUpsert(deps, update.chat_id)
        return
      case 'updateChatPhoto': {
        // A new photo replaces the old one; drop the cache and refetch.
        const chatId: number = update.chat_id
        deps.avatars.invalidate(chatId)
        deps.avatars.prefetch([chatId])
        return
      }
      case 'updateUser': {
        const user = update.user
        if (!user) return
        const fileId: number | undefined =
          user.profile_photo?.small?.id ?? user.profile_photo?.big?.id
        if (user.id === deps.getSelfUserId()) {
          // Our own profile changed (new photo): refresh the rail avatar.
          if (fileId) deps.avatars.loadSelf(fileId)
          return
        }
        // Somebody in a transcript changed their picture (or their name only,
        // which `syncUserPhoto` answers with a no-op).
        deps.avatars.syncUserPhoto(user.id, fileId)
        return
      }
      /**
       * Desktop notifications. TDLib has already decided *whether* this is worth
       * notifying (mute state, mentions, preview privacy), so the adapter forwards
       * its notification objects instead of deriving them from every new message.
       * Both update shapes carry them: `updateNotification` for a single-chat
       * group, `updateNotificationGroup` for the batched ones.
       */
      case 'updateNotification':
        await emitNotification(deps, update.notification)
        return
      case 'updateNotificationGroup': {
        for (const notification of asArray<TdObject>(update.added_notifications)) {
          await emitNotification(deps, notification)
        }
        return
      }
      /**
       * 在线 / 最后上线. The update carries only the user and the new status, and a
       * private chat's header redraws from it — no chat summary is refetched, since
       * presence changes far more often than the row does.
       */
      case 'updateUserStatus': {
        const status = mapPeerStatus(update.status)
        if (!status) return
        deps.emit({ type: 'status', userId: Number(update.user_id), status })
        return
      }
      case 'updateChatAction':
        deps.emit({
          type: 'typing',
          chatId: update.chat_id,
          userId: update.sender_id?.user_id ?? 0,
          action: update.action?._ ?? 'typing',
          until:
            update.action?._ === 'chatActionCancel' || update.action?._ === 'chatActionTypingCancel'
              ? Date.now()
              : Date.now() + 5_000,
        })
        return
      case 'updateFile': {
        const file = update.file
        if (!file) return
        const local = file.local ?? {}
        const completed = Boolean(local.is_downloading_completed)
        const uploading = Boolean(file.remote?.is_uploading_active)
        deps.emit({
          type: 'file',
          fileId: file.id,
          downloaded: uploading ? (file.remote?.uploaded_size ?? 0) : (local.downloaded_size ?? 0),
          total: file.expected_size ?? file.size ?? 0,
          ...(completed && local.path ? { url: registerMediaFile(local.path) } : {}),
          ...(uploading ? { uploading: true } : {}),
          ...(completed || file.remote?.is_uploading_completed ? { completed: true } : {}),
        })
        return
      }
      default:
        return
    }
  }
}

async function handleAuthorizationState(
  deps: UpdateDeps,
  state: TdObject | undefined,
): Promise<void> {
  // Any authorization state except the two lifecycle ones means the client is up:
  // the boot panel's job is done and the sign-in steps take over.
  if (
    state?._ !== 'authorizationStateWaitTdlibParameters' &&
    state?._ !== 'authorizationStateClosed'
  ) {
    deps.setBoot({ kind: 'ready' })
  }
  switch (state?._) {
    case 'authorizationStateWaitTdlibParameters':
      deps.setBoot({ kind: 'opening' })
      return
    case 'authorizationStateWaitPhoneNumber':
      deps.setAuth({ kind: 'waitPhoneNumber' })
      deps.logger.info(`TDLib ${deps.safeVersion()} ready for phone login`)
      return
    case 'authorizationStateWaitCode': {
      const info = state.code_info ?? {}
      const codeLength: number | undefined = info.type?.code_length
      deps.setAuth({
        kind: 'waitCode',
        ...(typeof info.phone_number === 'string' ? { hint: `sent to ${info.phone_number}` } : {}),
        ...(typeof codeLength === 'number' ? { codeLength } : {}),
      })
      return
    }
    case 'authorizationStateWaitRegistration':
      // A number with no account behind it: the login window asks for a name.
      deps.setAuth({ kind: 'waitRegistration' })
      return
    case 'authorizationStateWaitPassword':
      deps.setAuth({
        kind: 'waitPassword',
        ...(typeof state.password_hint === 'string' && state.password_hint
          ? { hint: state.password_hint }
          : {}),
      })
      return
    case 'authorizationStateWaitOtherDeviceConfirmation': {
      /**
       * QR login. TDLib re-sends this state with a fresh link every few seconds,
       * so the login window can simply re-render the QR. The link is an external
       * string that ends up encoded as a QR — only `tg://` links may pass.
       */
      const link = typeof state.link === 'string' ? state.link : ''
      if (!link.startsWith('tg://')) {
        deps.logger.warn('ignoring a malformed QR login link from TDLib')
        return
      }
      deps.setAuth({ kind: 'waitQr', link })
      return
    }
    case 'authorizationStateReady': {
      deps.setConnection('online')
      deps.logger.info(`TDLib ${deps.safeVersion()} authorized, loading self`)
      const me = await deps.me()
      deps.setAuth({ kind: 'ready', me })
      return
    }
    case 'authorizationStateClosed':
      deps.setAuth({ kind: 'closed' })
      return
    default:
      // authorizationStateLoggingOut / authorizationStateClosing keep the
      // previous state visible; nothing actionable for the UI.
      return
  }
}

/**
 * One TDLib notification → the title and preview the OS shows.
 *
 * Only `notificationTypeNewMessage` becomes a toast for now (calls and push
 * messages have no UI to open yet). The chat title needs a `getChat`, which
 * TDLib serves from its cache; a chat that vanished is not worth a failure.
 */
async function emitNotification(
  deps: UpdateDeps,
  notification: TdObject | undefined,
): Promise<void> {
  if (!notification) return
  const type = notification.type
  if (type?._ !== 'notificationTypeNewMessage' || !type.message) return
  const message = type.message
  const chatId = Number(message.chat_id)
  if (!Number.isFinite(chatId) || chatId <= 0) return
  let title = ''
  try {
    const chat = await deps.invoke({ _: 'getChat', chat_id: chatId })
    title = typeof chat?.title === 'string' ? chat.title : ''
  } catch {
    return
  }
  deps.emit({
    type: 'notification',
    chatId,
    messageId: Number(message.id),
    title,
    text: previewContent(message.content),
    isSilent: Boolean(notification.is_silent),
    date: Number(notification.date ?? Math.floor(Date.now() / 1000)),
  })
}

async function emitChatUpsert(deps: UpdateDeps, chatId: number | undefined): Promise<void> {
  if (typeof chatId !== 'number') return
  try {
    const chat = await deps.fetchChatSummary(chatId)
    deps.emit({ type: 'chats', ops: [{ op: 'upsert', chat }] })
    // New or updated chat: its photo may not be downloaded yet.
    deps.avatars.prefetch([chatId])
  } catch {
    // Chat may have been deleted between update and fetch.
  }
}
