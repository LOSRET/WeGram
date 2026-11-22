import type {
  AppSettings,
  ChatPinnedMessage,
  AuthState,
  BootState,
  EventChannel,
  EventEnvelope,
  InvokeChannel,
  InvokeRequest,
  InvokeResponse,
  ProxyConfig,
  ProxyMode,
  ProxyState,
  ProxyTestResult,
  StickerSetSummary,
  TgBridge,
  ViewerItem,
} from '@wegram/protocol'

import { handlePreviewComments } from './comments'
import { handlePreviewMedia } from './media'
import { openPreviewViewer, previewViewerState, previewViewerUnsupported } from './viewer'
import {
  previewAround,
  previewHistory,
  previewMarkRead,
  previewNewer,
  type PreviewMessagesStore,
} from './messages'
import { handlePreviewSend, type PreviewSendContext } from './sends'
import { handlePreviewPoll } from './polls'
import { createPreviewProfileState, handlePreviewProfile, isProfileChannel } from './profile'
import { handlePreviewUi } from './ui'
import { handlePreviewQr, type PreviewQrStore } from './qr'
import {
  clearPreviewHistory,
  deletePreviewChat,
  joinPreviewChannel,
  leavePreviewChat,
  previewChatMembers,
  previewInviteLink,
  previewJoinState,
  previewOpenUsername,
  handlePreviewPins,
  searchPreviewAllMessages,
  searchPreviewChats,
  searchPreviewMessages,
  setPreviewMuted,
  setPreviewPinned,
  setPreviewUnread,
  setPreviewTitle,
  type PreviewChatStore,
} from './chats'
import {
  ME,
  chats,
  contacts,
  info,
  messagesByChat,
  msg,
  now,
  previewCommonChatsFor,
  previewCustomEmoji,
  previewStickerSet,
  channelNotJoined,
  channelPostRights,
} from './fixtures'

/**
 * Development-only bridge used when the renderer runs in a plain browser
 * (`pnpm web`). It mirrors just enough of the mock adapter to click through the
 * UI; the real source of truth is `@wegram/mock-adapter` + TDLib.
 *
 * The fixture data lives in `preview/fixtures.ts`; this file keeps the mutable
 * session (auth, drafts, anchors, viewer), the invoke switch and the installer.
 *
 * Never install this when `window.tg` exists.
 */

let seq = 0
const listeners = new Map<string, Set<(event: EventEnvelope<EventChannel>) => void>>()

function emit(channel: EventChannel, payload: unknown): void {
  seq += 1
  const envelope = { seq, payload } as EventEnvelope<EventChannel>
  for (const listener of listeners.get(channel) ?? []) listener(envelope)
}

/** The chat handlers' view of this session; their rules live in ./chats.ts. */
const previewChats: PreviewChatStore = { chats, messagesByChat, emit }

/**
 * The shell is the default browser-preview route. `#login` previews the login
 * window, which must start signed out so the phone form (not the profile step)
 * is what you land on.
 */
let auth: AuthState = window.location.hash.startsWith('#login')
  ? { kind: 'waitPhoneNumber' }
  : { kind: 'ready', me: ME }

function setAuth(next: AuthState): AuthState {
  auth = next
  emit('evt:auth', next)
  return next
}

/** Fake QR confirmation; the mock adapter does the same in the main process. */
let qrTimer: number | null = null

function clearQrTimer(): void {
  if (qrTimer !== null) window.clearTimeout(qrTimer)
  qrTimer = null
}

/** The message rules' view of this session; see ./messages.ts. */
const previewMessagesStore: PreviewMessagesStore = { chats, messagesByChat, emit }

let nextId = 9000
/** The sends' view of this session; their rules live in ./sends.ts. */
const previewSendContext: PreviewSendContext = {
  chats,
  messagesByChat,
  messages: previewMessagesStore,
  emit,
  takeId: () => nextId++,
}
/** 资料卡's in-session 备注 / 联系人 overrides (the preview has no store to write). */
const previewProfile = createPreviewProfileState()
/** chatId → the one message this session pinned (the fixture ships none). */
const previewPins = new Map<number, ChatPinnedMessage>()
/** The chat the UI last opened; the dev injector below delivers arrivals into it. */
let openChatId: number | null = null
let proxy: ProxyConfig | null = null
/** The preview has no operating system to read, so 跟随系统代理 resolves to direct. */
let proxyMode: ProxyMode = 'system'
let preferIpv6 = false

function previewProxyState(): ProxyState {
  const active = proxyMode === 'manual' && proxy ? proxy : null
  return {
    mode: proxyMode,
    config: proxy,
    system: null,
    active,
    source: active ? 'manual' : 'direct',
    detail: active ? undefined : '浏览器预览没有系统代理，直连',
  }
}
let settings: AppSettings = {
  theme: 'light',
  themePreference: 'light',
  closeBehavior: 'quit',
  sendKey: 'enter',
}

/** What the 群二维码 handlers read; their rules live in ./qr.ts. */
const previewQrStore: PreviewQrStore = {
  chats,
  members: (chatId) => previewChatMembers(previewChats, chatId, 12),
  invite: (chatId, temporary) => previewInviteLink(chatId, temporary),
  get theme() {
    return settings.theme
  },
}

async function handle(channel: InvokeChannel, payload: unknown): Promise<unknown> {
  const store = payload as Record<string, any>

  // 资料卡 and its 举报 writes: one guard, so a channel costs an array entry in
  // `profile.ts` instead of another block in this file.
  if (isProfileChannel(channel)) {
    return handlePreviewProfile(channel, store, previewProfile, contacts, previewCommonChatsFor)
  }

  switch (channel) {
    case 'app:info':
      return info
    case 'auth:state':
      return auth
    // The preview never has a client to start; the login window is already past
    // the boot panel by the time it mounts.
    case 'boot:state':
      return { kind: 'ready' } satisfies BootState
    case 'auth:start':
      return setAuth({ kind: 'waitCode', hint: store.phone, codeLength: 5 })
    case 'auth:code': {
      if (store.code !== '12345') throw { code: 'auth_failed', message: '验证码是 12345' }
      return setAuth({ kind: 'waitPassword', hint: 'mock 密码 wegram' })
    }
    case 'auth:password': {
      if (store.password !== 'wegram') throw { code: 'auth_failed', message: '密码是 wegram' }
      clearQrTimer()
      const next: AuthState = { kind: 'ready', me: ME }
      setAuth(next)
      emit('evt:connection', 'online')
      return next
    }
    case 'auth:qr': {
      if (auth.kind !== 'waitPhoneNumber') return auth
      const next = setAuth({
        kind: 'waitQr',
        link: `tg://login?token=preview-${Math.random().toString(36).slice(2, 10)}`,
      })
      clearQrTimer()
      qrTimer = window.setTimeout(() => {
        qrTimer = null
        setAuth({ kind: 'ready', me: ME })
        emit('evt:connection', 'online')
      }, 10_000)
      return next
    }
    case 'auth:reset':
      clearQrTimer()
      return setAuth({ kind: 'waitPhoneNumber' })
    case 'auth:logout':
      clearQrTimer()
      emit('evt:connection', 'offline')
      setAuth({ kind: 'waitPhoneNumber' })
      return undefined
    case 'auth:me':
      return ME
    case 'chats:list':
      return chats
    case 'chats:get': {
      const chat = chats.find((item) => item.id === store.chatId)
      if (!chat) throw { code: 'invalid_payload', message: `找不到会话 ${String(store.chatId)}` }
      return { ...chat }
    }
    case 'chats:open': {
      // Reading is reported per viewport via `messages:read`; opening a chat must
      // not mark it read (same rule as the real adapter, see tdlib/actions.ts).
      // 标为未读 is a hand-set flag and is consumed by opening, though.
      openChatId = Number(store.chatId)
      const opened = chats.find((item) => item.id === openChatId)
      if (opened?.markedUnread) {
        opened.markedUnread = false
        emit('evt:chats', { ops: [{ op: 'upsert', chat: { ...opened } }] })
      }
      return undefined
    }
    case 'chats:canPost': {
      const chat = chats.find((item) => item.id === store.chatId)
      return chat?.kind === 'channel' ? Boolean(channelPostRights[chat.id]) : true
    }
    case 'chats:canGetMembers': {
      // A managed fixture channel is the administrator case (see the mock adapter).
      const chat = chats.find((item) => item.id === store.chatId)
      return chat?.kind === 'channel' ? Boolean(channelPostRights[chat.id]) : chat?.kind === 'group'
    }
    case 'chats:joinState': {
      const chat = chats.find((item) => item.id === store.chatId)
      if (!chat) throw { code: 'internal', message: 'unknown preview chat' }
      return previewJoinState(chat, channelNotJoined)
    }
    case 'chats:join':
      return joinPreviewChannel(channelNotJoined, Number(store.chatId))
    case 'chats:setMuted':
      return setPreviewMuted(previewChats, Number(store.chatId), Boolean(store.muted))
    case 'chats:setPinned':
      return setPreviewPinned(previewChats, Number(store.chatId), Boolean(store.pinned))
    case 'chats:clearHistory':
      return clearPreviewHistory(previewChats, Number(store.chatId))
    case 'chats:delete':
      return deletePreviewChat(previewChats, Number(store.chatId))
    case 'chats:setUnread':
      return setPreviewUnread(previewChats, Number(store.chatId), Boolean(store.unread))
    case 'chats:members':
      return previewChatMembers(
        previewChats,
        Number(store.chatId),
        Number(store.limit ?? 12),
        String(store.query ?? ''),
      )
    case 'chats:setTitle':
      return setPreviewTitle(previewChats, Number(store.chatId), String(store.title ?? ''))
    case 'chats:leave':
      return leavePreviewChat(previewChats, Number(store.chatId))
    case 'chats:pinned':
    case 'chats:setPinnedMessage':
      return handlePreviewPins(channel, previewChats, previewPins, store)
    case 'chats:inviteLink':
      return previewInviteLink(Number(store.chatId), Boolean(store.temporary))
    /** 群二维码: the preview boots the same renderer on `#qr` (see ./qr.ts). */
    case 'qr:open':
    case 'qr:info':
    case 'qr:copy':
    case 'qr:save':
    case 'qr:share':
    case 'qr:close':
      return handlePreviewQr(channel, store, previewQrStore)
    case 'search:global':
      return searchPreviewChats(chats, String(store.q ?? ''), Number(store.limit ?? 20))
    case 'search:inChat':
      return searchPreviewMessages(previewChats, Number(store.chatId), String(store.q ?? ''))
    case 'search:messages':
      return searchPreviewAllMessages(previewChats, {
        q: String(store.q ?? ''),
        scope: store.scope === 'channel' ? 'channel' : 'chat',
        limit: Number(store.limit ?? 20),
        ...(store.cursor === undefined ? {} : { cursor: store.cursor }),
      })
    case 'chats:openPrivate': {
      const chat = chats.find((item) => item.kind === 'private' && item.userId === store.userId)
      if (!chat) throw { code: 'internal', message: 'unknown preview contact' }
      return { ...chat }
    }
    case 'chats:openUsername':
      return previewOpenUsername(chats, contacts, String(store.username ?? ''))
    case 'contacts:list':
      return contacts
    case 'users:status': {
      const chat = chats.find((item) => item.userId === Number(store.userId))
      return chat ? { kind: 'offline', wasOnline: now() - 5_400 } : null
    }
    /** Poll voting; its rules live in ./polls.ts. */
    case 'messages:vote':
    case 'messages:addPollOption':
      return handlePreviewPoll(channel, store, previewMessagesStore)
    case 'messages:typing':
      // The preview has no peer to show an indicator.
      return undefined
    case 'messages:resend': {
      // Clear the failure on the fixture row, like `resendMessages` on the mock.
      const ids = (store.messageIds as number[]) ?? []
      for (const id of ids) {
        const row = (messagesByChat[store.chatId] ?? []).find((item) => item.id === id)
        if (!row) continue
        delete row.sendingState
        delete row.sendError
        delete row.canRetry
        emit('evt:messages', {
          chatId: store.chatId,
          ops: [{ op: 'replace', message: { ...row } }],
        })
      }
      return undefined
    }
    case 'messages:read': {
      const upTo = Number(store.upToMessageId)
      return previewMarkRead(
        previewMessagesStore,
        Number(store.chatId),
        Number.isFinite(upTo) ? upTo : null,
      )
    }
    case 'messages:history':
      return previewHistory(previewMessagesStore, {
        chatId: Number(store.chatId),
        ...(store.fromMessageId === undefined
          ? {}
          : { fromMessageId: Number(store.fromMessageId) }),
        limit: Number(store.limit ?? 50),
      })
    case 'messages:around':
      return previewAround(previewMessagesStore, {
        chatId: Number(store.chatId),
        messageId: Number(store.messageId),
        limit: Number(store.limit ?? 25),
      })
    case 'messages:newer':
      return previewNewer(previewMessagesStore, {
        chatId: Number(store.chatId),
        fromMessageId: Number(store.fromMessageId),
        limit: Number(store.limit ?? 50),
      })
    /** The discussion channels; their rules live in ./comments.ts. */
    case 'messages:comments':
    case 'messages:commentInfo':
    case 'messages:joinCommentGroup':
    case 'messages:sendComment':
      return handlePreviewComments(channel, store, messagesByChat, emit)
    /** Sending, editing and row mutations; their rules live in ./sends.ts. */
    case 'messages:send':
    case 'messages:edit':
    case 'messages:editCaption':
    case 'messages:transcribe':
    case 'messages:properties':
    case 'messages:delete':
    case 'messages:forward':
    case 'messages:sendSticker':
    case 'messages:sendVoice':
      return handlePreviewSend(channel, store, previewSendContext)
    case 'media:pick':
    case 'media:download':
    case 'media:cancel':
    case 'media:stream':
    case 'media:open':
    case 'media:send':
    case 'media:sendAlbum':
      return handlePreviewMedia(channel, store, (url) => window.open(url, '_blank', 'noopener'))
    case 'stickers:sets': {
      const set = previewStickerSet()
      return [
        { id: set.id, title: set.title, ...(set.thumbnail ? { thumbnail: set.thumbnail } : {}) },
      ] satisfies StickerSetSummary[]
    }
    case 'stickers:set':
      return previewStickerSet()
    case 'stickers:customEmoji': {
      const ids: unknown = store.ids
      return previewCustomEmoji(
        Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
      )
    }
    case 'ui:getDraft':
    case 'ui:saveDraft':
    case 'ui:getAnchor':
    case 'ui:saveAnchor':
    case 'ui:getCommentAnchor':
    case 'ui:saveCommentAnchor':
    case 'ui:getRecentEmoji':
    case 'ui:saveRecentEmoji':
      return handlePreviewUi(channel, store)
    case 'settings:get':
      return settings
    case 'settings:set': {
      const patch = store.patch as Partial<AppSettings>
      settings = { ...settings, ...patch }
      // The preview has no OS theme source, so 跟随系统 resolves to light there.
      if (patch.themePreference) {
        settings.theme = patch.themePreference === 'dark' ? 'dark' : 'light'
      }
      return undefined
    }
    case 'settings:open':
    case 'settings:close':
      return undefined
    case 'proxy:get':
      return previewProxyState()
    case 'proxy:set': {
      if (store.config !== undefined) {
        proxy = (store.config as ProxyConfig | null) ?? null
        proxyMode = proxy ? 'manual' : 'off'
      }
      const mode = store.mode as ProxyMode | undefined
      if (mode) proxyMode = mode
      return previewProxyState()
    }
    case 'proxy:refresh':
      return previewProxyState()
    case 'proxy:test':
      return { ok: true, latencyMs: 3 } satisfies ProxyTestResult
    case 'network:get':
      return { preferIpv6 }
    case 'network:set':
      preferIpv6 = Boolean(store.preferIpv6)
      return undefined
    /**
     * The viewer is its own Electron window, so the browser preview can only
     * record the request (a photo or video click is a no-op there).
     */
    case 'viewer:open':
      openPreviewViewer(payload as { items: ViewerItem[]; index: number; title?: string })
      return undefined
    case 'viewer:init':
      return previewViewerState(settings.theme)
    case 'viewer:save':
    case 'viewer:copy':
    case 'viewer:reveal':
      return previewViewerUnsupported()
    // The browser preview has no shell window to raise above the viewer.
    case 'viewer:locate':
      return undefined
    case 'viewer:pin':
      return { onTop: false }
    case 'viewer:close':
      return undefined
    /**
     * Window hand-over is Electron main's job. In the browser preview the
     * "windows" are routes, so these two are no-ops.
     */
    case 'login:enter':
    case 'login:close':
      return undefined
    default:
      throw { code: 'not_implemented', message: `${channel} is not wired in the browser preview` }
  }
}

export function installPreviewBridge(): void {
  if (window.tg) return

  const bridge: TgBridge = {
    async invoke<C extends InvokeChannel>(
      channel: C,
      payload?: InvokeRequest<C>,
    ): Promise<InvokeResponse<C>> {
      return (await handle(channel, payload)) as InvokeResponse<C>
    },
    on<C extends EventChannel>(
      channel: C,
      callback: (event: EventEnvelope<C>) => void,
    ): () => void {
      const set = listeners.get(channel) ?? new Set()
      set.add(callback as (event: EventEnvelope<EventChannel>) => void)
      listeners.set(channel, set)
      return () => {
        set.delete(callback as (event: EventEnvelope<EventChannel>) => void)
      }
    },
  }

  window.tg = bridge

  /**
   * Dev-only arrival injector for the browser preview.
   *
   * The mock adapter's traffic is random (one chat every 12 s) and never lands in
   * the 5000-message fixture, the only chat tall enough to scroll up in — so
   * arrival behaviour (the buoy's count, unread badges, auto-scroll) could not be
   * exercised on demand. Console: `__wxPreviewIncoming('文案')`.
   */
  const previewWindow: Window & { __wxPreviewIncoming?: (text?: string) => void } = window
  previewWindow.__wxPreviewIncoming = (text = '预览：新消息') => {
    if (openChatId === null) return
    const chatId = openChatId
    const message = msg(chatId, nextId++, text, false, 0)
    messagesByChat[chatId] = [...(messagesByChat[chatId] ?? []), message]
    emit('evt:messages', { chatId, ops: [{ op: 'new', message }] })
    // Mirror the adapter: an arrival bumps the unread count the row reads.
    const chat = chats.find((item) => item.id === chatId)
    if (chat) {
      chat.unread += 1
      chat.lastMessageText = message.text
      chat.lastMessageAt = message.date
      emit('evt:chats', { ops: [{ op: 'upsert', chat: { ...chat } }] })
    }
  }
}
