import { copyFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { AppError, RECENT_EMOJI_LIMIT } from '@wegram/protocol'
import type { AppInfo } from '@wegram/protocol'
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
import { storedTheme } from '../windows'
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
 * Every channel from `invokeChannels` is wired here. The router validated the
 * payload against the channel's zod schema, so `payload` already carries the
 * protocol's type — no cast, and a field renamed in the protocol breaks this file
 * at compile time instead of at runtime.
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
  /**
   * The viewer's own downloads (open / save / copy / reveal) outrank the
   * transcript's background fetches, so the file the reader is acting on wins.
   */
  const VIEWER_DOWNLOAD_PRIORITY = 32
  const localFile = async (fileId: number): Promise<string> => {
    const { path } = await adapter.downloadFile({ fileId, priority: VIEWER_DOWNLOAD_PRIORITY })
    return path
  }

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
      return adapter.submitPhone(payload.phone)
    },
    'auth:code': (payload) => {
      onAuthInteraction()
      return adapter.submitCode(payload.code)
    },
    'auth:password': (payload) => {
      onAuthInteraction()
      return adapter.submitPassword(payload.password)
    },
    'auth:signup': (payload) => {
      onAuthInteraction()
      return adapter.signUp(payload)
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

    'chats:list': (payload) => adapter.listChats(payload),
    'chats:get': (payload) => adapter.getChat(payload.chatId),
    'chats:open': (payload) => adapter.openChat(payload.chatId),
    'chats:openPrivate': (payload) => adapter.openPrivateChat(payload.userId),
    'chats:canPost': (payload) => adapter.canPost(payload.chatId),
    'chats:setMuted': (payload) => adapter.setChatMuted(payload.chatId, payload.muted),
    'contacts:list': () => adapter.listContacts(),

    'messages:history': (payload) => adapter.history(payload),
    'messages:around': (payload) => adapter.historyAround(payload),
    'messages:newer': (payload) => adapter.historyNewer(payload),
    'messages:comments': (payload) => adapter.comments(payload),
    'messages:commentInfo': (payload) => adapter.commentInfo(payload),
    'messages:joinCommentGroup': (payload) => adapter.joinCommentGroup(payload),
    'messages:sendComment': (payload) => adapter.sendComment(payload),
    'messages:send': (payload) => adapter.sendText(payload),
    'messages:edit': (payload) => adapter.editText(payload),
    'messages:delete': (payload) => adapter.deleteMessages(payload),
    'messages:forward': (payload) => adapter.forwardMessages(payload),
    'messages:read': (payload) => adapter.markRead(payload),

    'search:global': (payload) => adapter.searchGlobal(payload),
    'search:inChat': (payload) => adapter.searchInChat(payload),

    'media:pick': async (payload) => {
      const owner = BrowserWindow.getFocusedWindow()
      const options: Electron.OpenDialogOptions = {
        properties: ['openFile', 'multiSelections'],
        ...(payload.kind === 'photo'
          ? { filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }] }
          : {}),
      }
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options)
      return { paths: result.canceled ? [] : result.filePaths }
    },
    'media:download': (payload) => adapter.downloadFile(payload),
    'media:open': async (payload) => {
      const path = await localFile(payload.fileId)
      // Only files the protocol layer just produced are ever opened.
      const failure = await shell.openPath(path)
      if (failure) throw new AppError('internal', `Failed to open file: ${failure}`)
    },
    'media:send': (payload) => {
      if (!payload.filePath.trim()) throw new AppError('invalid_payload', 'Empty file path')
      return adapter.sendMedia(payload)
    },
    'messages:sendSticker': (payload) => adapter.sendSticker(payload),
    'stickers:sets': () => adapter.listStickerSets(),
    'stickers:set': (payload) => adapter.getStickerSet(payload.setId),

    'ui:saveDraft': (payload) => {
      uiDb.saveDraft(
        payload.chatId,
        payload.text.trim().length
          ? {
              text: payload.text,
              ...(payload.replyTo === undefined ? {} : { replyTo: payload.replyTo }),
            }
          : null,
      )
    },
    'ui:getDraft': (payload) => uiDb.getDraft(payload.chatId),
    'ui:saveAnchor': (payload) => {
      uiDb.saveScrollAnchor(
        payload.chatId,
        payload.messageId,
        payload.messageId === null ? 0 : payload.offset,
      )
    },
    'ui:getAnchor': (payload) => uiDb.getScrollAnchor(payload.chatId),
    'ui:getRecentEmoji': () => readRecentEmoji(uiDb),
    'ui:saveRecentEmoji': (payload) => {
      uiDb.setSetting(RECENT_EMOJI_KEY, JSON.stringify(payload.emoji.slice(0, RECENT_EMOJI_LIMIT)))
    },

    'settings:get': () => ({ theme: storedTheme(uiDb) }),
    'settings:set': (payload) => {
      if (payload.patch.theme) {
        uiDb.setSetting('theme', payload.patch.theme)
        onThemeChange?.(payload.patch.theme)
      }
    },

    'proxy:get': () => toProxyView(store.get().proxy),
    'proxy:set': async (payload) => {
      const previous = store.get().proxy
      if (!payload.config) {
        await adapter.setProxy(null)
        store.setProxy(null)
        return
      }
      // Apply first: only persist a proxy that the protocol layer accepted.
      await adapter.setProxy(resolveProxySecrets(payload.config, previous))
      store.setProxy(toStoredProxy(payload.config, previous))
    },
    'proxy:test': (payload) =>
      adapter.testProxy(resolveProxySecrets(payload.config, store.get().proxy)),

    'viewer:open': (payload) => {
      const focused = BrowserWindow.getFocusedWindow()
      openViewer(payload, isViewerWindow(focused) ? null : focused)
    },
    'viewer:init': () => viewerState(),
    'viewer:save': async (payload) => {
      // Only files the protocol layer just produced are ever copied.
      const source = await localFile(payload.fileId)
      const item = viewerItem(payload.fileId)
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
      // The clipboard holds bitmaps only; a video would need CF_HDROP, which
      // Electron does not expose, and the client does not offer it either.
      if (viewerItem(payload.fileId)?.kind === 'video') {
        throw new AppError('not_implemented', '视频不支持复制到剪贴板')
      }
      const source = await localFile(payload.fileId)
      const image = nativeImage.createFromPath(source)
      if (image.isEmpty()) throw new AppError('internal', 'Failed to decode the image')
      clipboard.writeImage(image)
    },
    'viewer:reveal': async (payload) => {
      const source = await localFile(payload.fileId)
      shell.showItemInFolder(source)
    },
    'viewer:pin': (payload) => ({ onTop: setViewerPin(payload.onTop) }),
    /**
     * 定位到聊天位置. Unlike the client this keeps the viewer window open: the
     * shell is raised above it instead (index.ts), so the reader can look at both.
     */
    'viewer:locate': (payload) => {
      const chatId = viewerChatId()
      if (chatId === null) throw new AppError('internal', 'Nothing is open in the viewer')
      onLocate({ chatId, messageId: payload.messageId })
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
