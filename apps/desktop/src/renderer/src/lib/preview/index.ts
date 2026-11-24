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
  NotificationScope,
  NotificationScopes,
  ProxyConfig,
  ProxyMode,
  ProxyState,
  ProxyTestResult,
  ScopeNotificationSettings,
  TgBridge,
  ViewerItem,
} from '@wegram/protocol'

import { inlineButtonCallbackSchema } from '@wegram/protocol'

import { buildInstantView } from '@wegram/mock-fixtures'

import { handlePreviewComments } from './comments'
import { handlePreviewInline } from './inline'
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
import {
  previewSetViewAsTopics,
  previewTopicCreate,
  previewTopicDelete,
  previewTopicEdit,
  previewTopicLink,
  previewTopicMarkRead,
  previewTopicIcons,
  previewTopicSetClosed,
  previewTopicSetMuted,
  previewTopicSetPinned,
  previewTopicsList,
  type PreviewTopicStore,
} from './topics'
import { handlePreviewQr, type PreviewQrStore } from './qr'
import { previewInstantViewState } from './web'
import {
  clearPreviewHistory,
  deletePreviewChat,
  joinPreviewChannel,
  leavePreviewChat,
  previewAddMember,
  previewChatMembers,
  previewInviteLink,
  previewJoinState,
  previewOpenUsername,
  handlePreviewPins,
  searchPreviewAllMessages,
  searchPreviewChats,
  searchPreviewMessages,
  setPreviewArchived,
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
  media as previewMedia,
  previewBotCommands,
  previewBotProfile,
  previewMemberByUsername,
  previewCommonChatsFor,
  previewChangeStickerSet,
  previewCustomEmoji,
  previewStickerSet,
  previewStickerSets,
  channelNotJoined,
  channelPostRights,
  topicsByChat,
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
/** 话题 (design doc §9.12); their rules live in ./topics.ts. */
const previewTopicsStore: PreviewTopicStore = { chats, topicsByChat, messagesByChat, emit }

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
const previewPins = new Map<string, ChatPinnedMessage>()
/** The chat the UI last opened; the dev injector below delivers arrivals into it. */
let openChatId: number | null = null
let proxy: ProxyConfig | null = null
/** The preview has no operating system to read, so 跟随系统代理 resolves to direct. */
let proxyMode: ProxyMode = 'system'
let preferIpv6 = false
/**
 * 消息通知 in the preview: the same three scopes, in memory. There is no account to
 * sync with, so they start at the client's defaults and 桌面通知 starts on.
 */
const previewNotificationScopes: NotificationScopes = {
  private: { muted: false, sound: true, showPreview: true },
  group: { muted: false, sound: true, showPreview: true },
  channel: { muted: false, sound: true, showPreview: true },
}
let previewDesktopNotifications = true

/** The preview validates what its own switches send, like the IPC router would. */
function isScopeNotificationSettings(value: unknown): value is ScopeNotificationSettings {
  if (typeof value !== 'object' || value === null) return false
  const record: Record<string, unknown> = { ...value }
  return (
    typeof record['muted'] === 'boolean' &&
    typeof record['sound'] === 'boolean' &&
    typeof record['showPreview'] === 'boolean'
  )
}

function isNotificationScope(value: unknown): value is NotificationScope {
  return value === 'private' || value === 'group' || value === 'channel'
}

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
  messageTextSize: 'standard',
  // The preview has no OS login item to write. Claiming the capability keeps the
  // row usable there; `launchAtLogin` then only lives in this module.
  launchAtLogin: false,
  canLaunchAtLogin: true,
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
    return handlePreviewProfile(
      channel,
      store,
      previewProfile,
      contacts,
      previewCommonChatsFor,
      previewBotProfile,
    )
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
    case 'chats:list': {
      // The Archive is the second list, exactly like TDLib's chatListArchive.
      const wantArchive = store.list === 'archive'
      return chats.filter((chat) => (chat.archived === true) === wantArchive)
    }
    case 'chats:prefetchAvatars':
      // The fixtures' rows carry their photos from the start (`ChatRow` reads
      // `chat.avatarUrl`), so there is nothing to queue in the preview.
      return undefined
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
    case 'chats:setArchived':
      return setPreviewArchived(previewChats, Number(store.chatId), Boolean(store.archived))
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
    case 'chats:addMember':
      return previewAddMember(
        previewChats,
        { chatId: Number(store.chatId), username: String(store.username ?? '') },
        previewMemberByUsername,
      )
    case 'chats:inviteLink':
      return previewInviteLink(Number(store.chatId), Boolean(store.temporary))
    /** 话题: the list, its management calls and 以聊天方式查看 (design doc §9.12). */
    case 'chats:topics':
      return previewTopicsList(previewTopicsStore, {
        chatId: Number(store.chatId),
        ...(store.query === undefined ? {} : { query: String(store.query) }),
        ...(store.cursor === undefined ? {} : { cursor: store.cursor }),
        ...(store.limit === undefined ? {} : { limit: Number(store.limit) }),
      })
    case 'chats:topicCreate':
      return previewTopicCreate(previewTopicsStore, {
        chatId: Number(store.chatId),
        title: String(store.title ?? ''),
        iconColor: Number(store.iconColor ?? 0x6fb9f0),
        ...(store.iconEmojiId === undefined ? {} : { iconEmojiId: String(store.iconEmojiId) }),
      })
    case 'chats:topicEdit':
      return previewTopicEdit(previewTopicsStore, {
        chatId: Number(store.chatId),
        topicId: Number(store.topicId),
        ...(store.title === undefined ? {} : { title: String(store.title) }),
        ...(store.iconEmojiId === undefined ? {} : { iconEmojiId: String(store.iconEmojiId) }),
      })
    case 'chats:topicSetPinned':
      return previewTopicSetPinned(
        previewTopicsStore,
        Number(store.chatId),
        Number(store.topicId),
        Boolean(store.pinned),
      )
    case 'chats:topicSetClosed':
      return previewTopicSetClosed(
        previewTopicsStore,
        Number(store.chatId),
        Number(store.topicId),
        Boolean(store.closed),
      )
    case 'chats:topicSetMuted':
      return previewTopicSetMuted(
        previewTopicsStore,
        Number(store.chatId),
        Number(store.topicId),
        Boolean(store.muted),
      )
    case 'chats:topicIcons':
      return { icons: previewTopicIcons() }
    case 'chats:forumLayout':
      // The preview draws the sidebar variant; tabs come from real supergroup info.
      return { layout: 'sidebar' as const }
    case 'chats:topicDelete':
      return previewTopicDelete(previewTopicsStore, Number(store.chatId), Number(store.topicId))
    case 'chats:topicLink':
      return previewTopicLink(Number(store.chatId), Number(store.topicId))
    case 'chats:setViewAsTopics':
      return previewSetViewAsTopics(
        previewTopicsStore,
        Number(store.chatId),
        Boolean(store.viewAsTopics),
      )
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
    case 'search:inChat': {
      const hits = searchPreviewMessages(previewChats, Number(store.chatId), String(store.q ?? ''))
      // 搜索话题内消息: the composer's search is scoped to the open topic.
      return store.topicId === undefined
        ? hits
        : hits.filter((message) => message.topicId === Number(store.topicId))
    }
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
    /** Bots: the "/" command list and a pressed inline button. */
    case 'bots:commands':
      return previewBotCommands(Number(store.chatId))
    /** inline 机器人: `@bot query` and sending one of its results; ./inline.ts. */
    case 'bots:inlineQuery':
    case 'bots:inlineSend':
      return handlePreviewInline(channel, store, previewSendContext)
    case 'bots:callback': {
      // Mirrors the mock adapter's two answers: a toast, and an alert dialog. The
      // payload is parsed, not cast: the preview stands in for the IPC boundary.
      const callback = inlineButtonCallbackSchema.safeParse(store.callback)
      if (callback.success && callback.data.type === 'data' && callback.data.data === 'alert') {
        return { text: '这是一个模拟的机器人弹窗。\n第二行说明换行也会保留。', showAlert: true }
      }
      return { text: '机器人收到了这次点击（模拟）' }
    }
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
      if (store.topicId !== undefined) {
        // 话题内已读: one topic's counter and the chat's sum, not the whole chat.
        return previewTopicMarkRead(
          previewTopicsStore,
          Number(store.chatId),
          Number(store.topicId),
          Number.isFinite(upTo) ? upTo : 0,
        )
      }
      return previewMarkRead(
        previewMessagesStore,
        Number(store.chatId),
        Number.isFinite(upTo) ? upTo : null,
      )
    }
    case 'messages:history':
      return previewHistory(previewMessagesStore, {
        chatId: Number(store.chatId),
        ...(store.topicId === undefined ? {} : { topicId: Number(store.topicId) }),
        ...(store.fromMessageId === undefined
          ? {}
          : { fromMessageId: Number(store.fromMessageId) }),
        limit: Number(store.limit ?? 50),
      })
    case 'messages:around':
      return previewAround(previewMessagesStore, {
        chatId: Number(store.chatId),
        ...(store.topicId === undefined ? {} : { topicId: Number(store.topicId) }),
        messageId: Number(store.messageId),
        limit: Number(store.limit ?? 25),
      })
    case 'messages:newer':
      return previewNewer(previewMessagesStore, {
        chatId: Number(store.chatId),
        ...(store.topicId === undefined ? {} : { topicId: Number(store.topicId) }),
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
    /**
     * 即时预览 opens its own window in the client; the browser preview has no second
     * native window, so the reader route opens as a popup whose hash carries the
     * target (see ./web.ts for `web:state`).
     */
    case 'web:open': {
      const url = typeof store['url'] === 'string' ? store['url'] : ''
      const params = new URLSearchParams({ url })
      if (typeof store['title'] === 'string') params.set('title', store['title'])
      if (typeof store['siteName'] === 'string') params.set('siteName', store['siteName'])
      window.open(`#instantview?${params.toString()}`, '_blank', 'popup,width=760,height=900')
      return undefined
    }
    case 'web:state':
      return previewInstantViewState()
    /** 即时预览: the same demo page the mock adapter serves (design doc §8.9). */
    case 'web:instantView':
      return buildInstantView(
        String((store as { url?: unknown }).url ?? 'https://telegra.ph/WeGram-v031-11-24'),
        previewMedia,
      )
    case 'stickers:sets':
      return previewStickerSets()
    case 'stickers:set':
      return previewStickerSet()
    case 'stickers:changeSet':
      previewChangeStickerSet(String(store.setId), {
        installed: Boolean(store.installed),
        ...(store.archived === undefined ? {} : { archived: Boolean(store.archived) }),
      })
      return undefined
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
    case 'ui:getViewerVolume':
    case 'ui:setViewerVolume':
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
      // main publishes this after a settings write; the preview must do the same
      // or the shell keeps the old 发送消息 / 消息字号 until it is reloaded.
      emit('evt:settings', {
        sendKey: settings.sendKey,
        messageTextSize: settings.messageTextSize,
      })
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
    /** The preview has no protocol connection; the shell boots as online. */
    case 'network:connection':
      return 'online'
    case 'network:set':
      preferIpv6 = Boolean(store.preferIpv6)
      return undefined
    case 'notifications:get':
      return { desktop: previewDesktopNotifications, scopes: previewNotificationScopes }
    case 'notifications:setDesktop':
      previewDesktopNotifications = Boolean(store.desktop)
      return undefined
    case 'notifications:setScope': {
      const scope: unknown = store.scope
      const settings: unknown = store.settings
      if (isNotificationScope(scope) && isScopeNotificationSettings(settings)) {
        previewNotificationScopes[scope] = { ...settings }
      }
      return undefined
    }
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
