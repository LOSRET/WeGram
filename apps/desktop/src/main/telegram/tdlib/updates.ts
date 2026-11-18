import type { AuthState, ChatSummary, ConnectionState, Self } from '@wegram/protocol'

import { registerMediaFile } from '../../media/registry'
import type { Logger } from '../../util'
import type { AdapterEvent } from '../adapter'
import type { TdObject } from './client'
import { mapConnectionState } from './map/chat'
import type { MapperContext } from './map/context'
import { isTranscriptRemoval } from './map/deletion'
import { mapMessage } from './map/message'

/** What the update stream needs from the adapter. */
export interface UpdateDeps {
  invoke(method: TdObject): Promise<any>
  emit(event: AdapterEvent): void
  mapper: MapperContext
  logger: Logger
  setAuth(state: AuthState): void
  setConnection(state: ConnectionState): void
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
      case 'updateDeleteMessages': {
        const messageIds: number[] = Array.isArray(update.message_ids) ? update.message_ids : []
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
  switch (state?._) {
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
      // authorizationStateLoggingOut / waitTdlibParameters etc. keep the
      // previous state visible; nothing actionable for the UI.
      return
  }
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
