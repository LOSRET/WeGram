import { copyFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { AppError } from '@wegram/protocol'
import type { AppInfo, ProxyConfig, ViewerItem } from '@wegram/protocol'
import { app, BrowserWindow, clipboard, dialog, nativeImage, shell } from 'electron'

import { closeLoginWindow } from '../login-window'
import { resolveProxySecrets, toProxyView, toStoredProxy } from '../proxy'
import type { SettingsStore } from '../store/settings'
import type { UiDatabase } from '../store/ui-db'
import type { TelegramAdapter } from '../telegram/adapter'
import {
  closeViewer,
  getViewerWindow,
  isViewerWindow,
  openViewer,
  setViewerPin,
  viewerChatId,
  viewerItem,
  viewerState,
} from '../viewer'
import type { IpcHandlerMap } from './router'

export interface HandlerDeps {
  adapter: TelegramAdapter
  store: SettingsStore
  uiDb: UiDatabase
  info: AppInfo
  /** Lets the shell repaint the native window-controls overlay on theme change. */
  onThemeChange?: (theme: 'light' | 'dark') => void
  /**
   * Opens the shell window and dismisses the login window. Called by the login
   * window's 进入 button; the caller guards that authorization finished.
   */
  onLoginEnter: () => void
  /**
   * Marks that this run's sign-in was user-driven. The shell opens by itself
   * when such a login completes; only a session restored at startup stops on
   * the profile step (see index.ts `syncWindowsToAuth`).
   */
  onAuthInteraction: () => void
  /**
   * 定位到聊天位置: raises the shell above the viewer (which stays open) and tells
   * the renderer to open that conversation on that message.
   */
  onLocate: (target: { chatId: number; messageId: number }) => void
}

/**
 * Every channel from `invokeChannels` is wired here. Payloads were validated by
 * the router, so handlers may cast to the DTO shape directly.
 */
export function createHandlers({
  adapter,
  store,
  uiDb,
  info,
  onThemeChange,
  onLoginEnter,
  onAuthInteraction,
  onLocate,
}: HandlerDeps): IpcHandlerMap {
  return {
    'app:info': () => info,

    /**
     * The login window owns the whole sign-in flow; the shell window does not
     * exist until this lands. A stale click (authorization lost in the meantime)
     * is refused rather than opening an empty shell.
     */
    'login:enter': () => {
      if (adapter.getAuthState().kind !== 'ready') {
        throw new AppError('auth_required', '还没有完成登录')
      }
      onLoginEnter()
    },
    'login:close': () => {
      closeLoginWindow()
    },

    'auth:state': () => adapter.getAuthState(),
    'auth:start': (payload) => {
      onAuthInteraction()
      return adapter.submitPhone((payload as { phone: string }).phone)
    },
    'auth:code': (payload) => {
      onAuthInteraction()
      return adapter.submitCode((payload as { code: string }).code)
    },
    'auth:password': (payload) => {
      onAuthInteraction()
      return adapter.submitPassword((payload as { password: string }).password)
    },
    'auth:qr': () => {
      onAuthInteraction()
      return adapter.requestQrCode()
    },
    'auth:reset': () => {
      onAuthInteraction()
      return adapter.restartAuth()
    },
    'auth:logout': () => adapter.logout(),
    'auth:me': () => adapter.me(),

    'chats:list': (payload) => adapter.listChats(payload as { limit: number; offset: number }),
    'chats:get': (payload) => adapter.getChat((payload as { chatId: number }).chatId),
    'chats:open': (payload) => adapter.openChat((payload as { chatId: number }).chatId),
    'chats:openPrivate': (payload) =>
      adapter.openPrivateChat((payload as { userId: number }).userId),
    'chats:canPost': (payload) => adapter.canPost((payload as { chatId: number }).chatId),
    'chats:setMuted': (payload) => {
      const { chatId, muted } = payload as { chatId: number; muted: boolean }
      return adapter.setChatMuted(chatId, muted)
    },
    'contacts:profile': (payload) => adapter.contactProfile((payload as { chatId: number }).chatId),

    'messages:history': (payload) =>
      adapter.history(payload as { chatId: number; fromMessageId?: number; limit: number }),
    'messages:around': (payload) =>
      adapter.historyAround(payload as { chatId: number; messageId: number; limit: number }),
    'messages:newer': (payload) =>
      adapter.historyNewer(payload as { chatId: number; fromMessageId: number; limit: number }),
    'messages:send': (payload) =>
      adapter.sendText(payload as { chatId: number; text: string; replyTo?: number }),
    'messages:edit': (payload) =>
      adapter.editText(payload as { chatId: number; messageId: number; text: string }),
    'messages:delete': (payload) =>
      adapter.deleteMessages(payload as { chatId: number; messageIds: number[]; forBoth: boolean }),
    'messages:forward': (payload) =>
      adapter.forwardMessages(
        payload as { fromChatId: number; messageIds: number[]; toChatId: number },
      ),
    'messages:read': (payload) =>
      adapter.markRead(payload as { chatId: number; upToMessageId: number }),

    'search:global': (payload) => adapter.searchGlobal(payload as { q: string; limit: number }),
    'search:inChat': (payload) =>
      adapter.searchInChat(payload as { chatId: number; q: string; fromMessageId?: number }),

    'media:pick': async (payload) => {
      const { kind } = payload as { kind: 'photo' | 'file' }
      const owner = BrowserWindow.getFocusedWindow()
      const options: Electron.OpenDialogOptions = {
        properties: ['openFile', 'multiSelections'],
        ...(kind === 'photo'
          ? { filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }] }
          : {}),
      }
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options)
      return { paths: result.canceled ? [] : result.filePaths }
    },
    'media:download': (payload) =>
      adapter.downloadFile(payload as { fileId: number; priority: number }),
    'media:open': async (payload) => {
      const { fileId } = payload as { fileId: number }
      const { path } = await adapter.downloadFile({ fileId, priority: 32 })
      // Only files the protocol layer just produced are ever opened.
      const failure = await shell.openPath(path)
      if (failure) throw new AppError('internal', `Failed to open file: ${failure}`)
    },
    'media:send': (payload) => {
      const input = payload as {
        chatId: number
        filePath: string
        kind: 'photo' | 'file'
        caption?: string
        replyTo?: number
      }
      if (!input.filePath.trim()) throw new AppError('invalid_payload', 'Empty file path')
      return adapter.sendMedia(input)
    },
    'messages:sendSticker': (payload) =>
      adapter.sendSticker(payload as { chatId: number; fileId: number; replyTo?: number }),
    'stickers:sets': () => adapter.listStickerSets(),
    'stickers:set': (payload) => adapter.getStickerSet((payload as { setId: string }).setId),

    'ui:saveDraft': (payload) => {
      const draft = payload as { chatId: number; text: string; replyTo?: number }
      uiDb.saveDraft(
        draft.chatId,
        draft.text.trim().length
          ? {
              text: draft.text,
              ...(draft.replyTo === undefined ? {} : { replyTo: draft.replyTo }),
            }
          : null,
      )
    },
    'ui:getDraft': (payload) => uiDb.getDraft((payload as { chatId: number }).chatId),
    'ui:saveAnchor': (payload) => {
      const anchor = payload as { chatId: number; messageId: number | null; offset: number }
      uiDb.saveScrollAnchor(
        anchor.chatId,
        anchor.messageId,
        anchor.messageId === null ? 0 : anchor.offset,
      )
    },
    'ui:getAnchor': (payload) => uiDb.getScrollAnchor((payload as { chatId: number }).chatId),
    'ui:getRecentEmoji': () => readRecentEmoji(uiDb),
    'ui:saveRecentEmoji': (payload) => {
      const { emoji } = payload as { emoji: string[] }
      uiDb.setSetting(RECENT_EMOJI_KEY, JSON.stringify(emoji.slice(0, RECENT_EMOJI_LIMIT)))
    },

    'settings:get': () => ({
      theme: uiDb.getSetting('theme') === 'dark' ? ('dark' as const) : ('light' as const),
    }),
    'settings:set': (payload) => {
      const patch = payload as { patch: { theme?: 'light' | 'dark' } }
      if (patch.patch.theme) {
        uiDb.setSetting('theme', patch.patch.theme)
        onThemeChange?.(patch.patch.theme)
      }
    },

    'proxy:get': () => toProxyView(store.get().proxy),
    'proxy:set': async (payload) => {
      const { config } = payload as { config: ProxyConfig | null }
      const previous = store.get().proxy
      if (!config) {
        await adapter.setProxy(null)
        store.setProxy(null)
        return
      }
      // Apply first: only persist a proxy that the protocol layer accepted.
      await adapter.setProxy(resolveProxySecrets(config, previous))
      store.setProxy(toStoredProxy(config, previous))
    },
    'proxy:test': (payload) => {
      const { config } = payload as { config: ProxyConfig }
      return adapter.testProxy(resolveProxySecrets(config, store.get().proxy))
    },

    'viewer:open': (payload) => {
      const request = payload as { chatId: number; items: ViewerItem[]; index: number }
      const focused = BrowserWindow.getFocusedWindow()
      openViewer(request, isViewerWindow(focused) ? null : focused)
    },
    'viewer:init': () => viewerState(),
    'viewer:save': async (payload) => {
      const { fileId } = payload as { fileId: number }
      // Only files the protocol layer just produced are ever copied.
      const { path: source } = await adapter.downloadFile({ fileId, priority: 32 })
      const item = viewerItem(fileId)
      const name = item?.fileName?.trim() || basename(source)
      const video = item?.kind === 'video'
      const options: Electron.SaveDialogOptions = {
        defaultPath: join(app.getPath(video ? 'videos' : 'pictures'), name),
        filters: [
          video
            ? { name: '视频', extensions: [extensionOf(name, 'mp4')] }
            : { name: '图片', extensions: [extensionOf(name, 'png')] },
        ],
      }
      const win = getViewerWindow()
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { canceled: true }
      await copyFile(source, result.filePath)
      return { canceled: false, path: result.filePath }
    },
    'viewer:copy': async (payload) => {
      const { fileId } = payload as { fileId: number }
      // The clipboard holds bitmaps only; a video would need CF_HDROP, which
      // Electron does not expose, and the client does not offer it either.
      if (viewerItem(fileId)?.kind === 'video') {
        throw new AppError('not_implemented', '视频不支持复制到剪贴板')
      }
      const { path: source } = await adapter.downloadFile({ fileId, priority: 32 })
      const image = nativeImage.createFromPath(source)
      if (image.isEmpty()) throw new AppError('internal', 'Failed to decode the image')
      clipboard.writeImage(image)
    },
    'viewer:reveal': async (payload) => {
      const { fileId } = payload as { fileId: number }
      const { path: source } = await adapter.downloadFile({ fileId, priority: 32 })
      shell.showItemInFolder(source)
    },
    'viewer:pin': (payload) => ({ onTop: setViewerPin((payload as { onTop: boolean }).onTop) }),
    /**
     * 定位到聊天位置. Unlike the client this keeps the viewer window open: the
     * shell is raised above it instead (index.ts), so the reader can look at both.
     */
    'viewer:locate': (payload) => {
      const { messageId } = payload as { messageId: number }
      const chatId = viewerChatId()
      if (chatId === null) throw new AppError('internal', 'Nothing is open in the viewer')
      onLocate({ chatId, messageId })
    },
    'viewer:close': () => {
      closeViewer()
    },
  }
}

/**
 * The picker's 最近使用 row. It lives in ui.db's key/value table rather than its own
 * table because it is a single small list, and a corrupt value must never keep the
 * picker from opening — an unreadable row simply reads as empty.
 */
const RECENT_EMOJI_KEY = 'emoji.recent'
/** One row of 10 in the picker; the renderer shows the same length. */
const RECENT_EMOJI_LIMIT = 10

function readRecentEmoji(uiDb: UiDatabase): string[] {
  const raw = uiDb.getSetting(RECENT_EMOJI_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 32,
      )
      .slice(0, RECENT_EMOJI_LIMIT)
  } catch {
    return []
  }
}

/** Extension of a media file name, for the Save-As filter; the fallback if unknown. */
function extensionOf(name: string, fallback: string): string {
  const extension = name.includes('.') ? (name.split('.').pop() ?? '') : ''
  return /^[a-z0-9]{2,5}$/i.test(extension) ? extension.toLowerCase() : fallback
}
