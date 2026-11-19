import type {
  AppSettings,
  AuthState,
  EventChannel,
  EventEnvelope,
  InvokeChannel,
  InvokeRequest,
  InvokeResponse,
  Message,
  ProxyConfig,
  ProxyTestResult,
  StickerSetSummary,
  TgBridge,
  ViewerItem,
} from '@wegram/protocol'

import { stickerMedia } from '../stickerMedia'
import {
  ME,
  chats,
  info,
  media,
  messagesByChat,
  msg,
  now,
  previewFiles,
  previewStickerSet,
  PREVIEW_STICKERS,
  channelPostRights,
} from './fixtures'

/**
 * Development-only bridge used when the renderer runs in a plain browser
 * (`pnpm web`). It mirrors just enough of the mock adapter to click through the
 * UI; the real source of truth is `main/telegram/mock/` + TDLib.
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


/**
 * The adapter's read rule in three lines: the marker only moves forward, and
 * `unread` is whatever is still newer than it. `upTo === null` means "the newest
 * message" (`chats:open`).
 */
function applyPreviewRead(chatId: number, upTo: number | null): void {
  const chat = chats.find((item) => item.id === chatId)
  if (!chat) return
  const list = messagesByChat[chatId] ?? []
  const marker = upTo ?? list[list.length - 1]?.id ?? null
  if (marker !== null) chat.lastReadInboxMessageId = marker
  chat.unread = list.filter(
    (message) => !message.outgoing && message.id > (chat.lastReadInboxMessageId ?? 0),
  ).length
  emit('evt:chats', { ops: [{ op: 'upsert', chat: { ...chat } }] })
}

const drafts: Record<number, string> = {}
const anchors: Record<number, { messageId: number; offset: number }> = {}
/** The picker's 最近使用 row; the shell keeps it in ui.db. */
let recentEmoji: string[] = []

let nextId = 9000
/** The chat the UI last opened; the dev injector below delivers arrivals into it. */
let openChatId: number | null = null
let proxy: ProxyConfig | null = null
let settings: AppSettings = { theme: 'light' }
let previewViewer: { items: ViewerItem[]; index: number; title?: string } | null = null

async function handle(channel: InvokeChannel, payload: unknown): Promise<unknown> {
  const store = payload as Record<string, any>

  switch (channel) {
    case 'app:info':
      return info
    case 'auth:state':
      return auth
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
    case 'chats:get':
      return chats.find((chat) => chat.id === store.chatId)
    case 'chats:open': {
      // Reading is reported per viewport via `messages:read`; opening a chat must
      // not mark it read (same rule as the real adapter, see tdlib/actions.ts).
      openChatId = Number(store.chatId)
      return undefined
    }
    case 'chats:canPost': {
      const chat = chats.find((item) => item.id === store.chatId)
      return chat?.kind === 'channel' ? Boolean(channelPostRights[chat.id]) : true
    }
    case 'chats:setMuted': {
      const chat = chats.find((item) => item.id === store.chatId)
      if (!chat) throw { code: 'internal', message: 'unknown preview chat' }
      chat.muted = Boolean(store.muted)
      emit('evt:chats', { ops: [{ op: 'upsert', chat: { ...chat } }] })
      return { ...chat }
    }
    case 'messages:read': {
      const upTo = Number(store.upToMessageId)
      if (Number.isFinite(upTo)) applyPreviewRead(Number(store.chatId), upTo)
      return undefined
    }
    case 'messages:history': {
      const all = messagesByChat[store.chatId] ?? []
      const fromId = store.fromMessageId as number | undefined
      const limit = Number(store.limit ?? 50)
      const older = fromId === undefined ? all : all.filter((item) => item.id < fromId)
      const page = older.slice(Math.max(0, older.length - limit))
      return { messages: page, hasMore: older.length > page.length }
    }
    case 'messages:around': {
      const all = messagesByChat[store.chatId] ?? []
      const messageId = Number(store.messageId)
      const limit = Number(store.limit ?? 25)
      const found = all.findIndex((item) => item.id === messageId)
      const center = found >= 0 ? found : all.findIndex((item) => item.id > messageId)
      if (center < 0) return { messages: [], hasMore: true, hasNewer: false }
      const start = Math.max(0, center - limit)
      const end = Math.min(all.length, center + limit + 1)
      return {
        messages: all.slice(start, end),
        hasMore: start > 0,
        hasNewer: end < all.length,
      }
    }
    case 'messages:newer': {
      const all = messagesByChat[store.chatId] ?? []
      const fromId = Number(store.fromMessageId)
      const limit = Number(store.limit ?? 50)
      const newer = all.filter((item) => item.id > fromId)
      return { messages: newer.slice(0, limit), hasNewer: newer.length > limit }
    }
    case 'messages:send': {
      const list = messagesByChat[store.chatId] ?? []
      const message = msg(store.chatId, nextId++, String(store.text), true, 0)
      if (typeof store.replyTo === 'number') message.replyToId = store.replyTo
      list.push(message)
      messagesByChat[store.chatId] = list
      const chat = chats.find((item) => item.id === store.chatId)
      if (chat) {
        chat.lastMessageText = message.text
        chat.lastMessageAt = message.date
        emit('evt:chats', { ops: [{ op: 'upsert', chat: { ...chat } }] })
      }
      return { localId: `web-${message.id}`, message }
    }
    case 'messages:edit': {
      const list = messagesByChat[store.chatId] ?? []
      const target = list.find((item) => item.id === store.messageId)
      if (!target) throw { code: 'internal', message: 'message not found' }
      target.text = String(store.text)
      target.edited = true
      return target
    }
    case 'messages:delete': {
      const ids = store.messageIds as number[]
      messagesByChat[store.chatId] = (messagesByChat[store.chatId] ?? []).filter(
        (item) => !ids.includes(item.id),
      )
      return undefined
    }
    case 'messages:forward': {
      const ids = store.messageIds as number[]
      const source = messagesByChat[store.fromChatId] ?? []
      const target = messagesByChat[store.toChatId] ?? []
      for (const id of ids) {
        const original = source.find((item) => item.id === id)
        if (original) target.push({ ...original, id: nextId++, chatId: store.toChatId })
      }
      messagesByChat[store.toChatId] = target
      return undefined
    }
    case 'messages:sendSticker': {
      const sticker = PREVIEW_STICKERS.find((item) => item.fileId === store.fileId)
      if (!sticker) throw { code: 'internal', message: 'unknown sticker' }
      const list = messagesByChat[store.chatId] ?? []
      const message: Message = {
        id: nextId++,
        chatId: store.chatId,
        senderId: ME.id,
        senderName: '我',
        outgoing: true,
        date: now(),
        kind: 'sticker',
        text: '',
        media: media(sticker.fileId, stickerMedia(sticker)),
      }
      list.push(message)
      messagesByChat[store.chatId] = list
      return { localId: `web-${message.id}`, message }
    }
    case 'media:pick':
      // The browser cannot hand us a local path; sending files needs Electron.
      return { paths: [] }
    case 'media:download': {
      const url = previewFiles()[Number(store.fileId)]
      if (!url) throw { code: 'internal', message: 'unknown preview file' }
      return { path: url, url }
    }
    case 'media:open': {
      const url = previewFiles()[Number(store.fileId)]
      if (url) window.open(url, '_blank', 'noopener')
      return undefined
    }
    case 'media:send':
      throw { code: 'not_implemented', message: '浏览器预览不能发送本地文件' }
    case 'stickers:sets': {
      const set = previewStickerSet()
      return [
        { id: set.id, title: set.title, ...(set.thumbnail ? { thumbnail: set.thumbnail } : {}) },
      ] satisfies StickerSetSummary[]
    }
    case 'stickers:set':
      return previewStickerSet()
    case 'ui:getDraft': {
      const text = drafts[store.chatId]
      return text ? { text } : null
    }
    case 'ui:saveDraft': {
      const text = String(store.text ?? '')
      if (text.trim().length) drafts[store.chatId] = text
      else delete drafts[store.chatId]
      return undefined
    }
    case 'ui:getAnchor':
      return anchors[store.chatId] ?? null
    case 'ui:saveAnchor': {
      const messageId = store.messageId as number | null
      if (messageId === null) delete anchors[store.chatId]
      else anchors[store.chatId] = { messageId, offset: Number(store.offset ?? 0) }
      return undefined
    }
    case 'ui:getRecentEmoji':
      return recentEmoji
    case 'ui:saveRecentEmoji': {
      const list: unknown = store.emoji
      recentEmoji = Array.isArray(list)
        ? list.filter((item): item is string => typeof item === 'string').slice(0, 10)
        : []
      return undefined
    }
    case 'settings:get':
      return settings
    case 'settings:set': {
      const patch = store.patch as Partial<AppSettings>
      settings = { ...settings, ...patch }
      return undefined
    }
    case 'proxy:get':
      return proxy
    case 'proxy:set':
      proxy = (store.config as ProxyConfig | null) ?? null
      return undefined
    case 'proxy:test':
      return { ok: true, latencyMs: 3 } satisfies ProxyTestResult
    /**
     * The viewer is its own Electron window, so the browser preview can only
     * record the request (a photo or video click is a no-op there).
     */
    case 'viewer:open':
      previewViewer = payload as { items: ViewerItem[]; index: number; title?: string }
      return undefined
    case 'viewer:init':
      if (!previewViewer) throw { code: 'internal', message: '查看器还没有打开' }
      return { items: previewViewer.items, index: previewViewer.index, theme: settings.theme }
    case 'viewer:save':
    case 'viewer:copy':
    case 'viewer:reveal':
      throw { code: 'not_implemented', message: '浏览器预览不能访问本地文件' }
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
    // Mirror the adapter: an incoming message also bumps the chat's unread count,
    // which is what the row badge and the rail total read.
    const chat = chats.find((item) => item.id === chatId)
    if (chat) {
      chat.unread += 1
      chat.lastMessageText = message.text
      chat.lastMessageAt = message.date
      emit('evt:chats', { ops: [{ op: 'upsert', chat: { ...chat } }] })
    }
  }
}
