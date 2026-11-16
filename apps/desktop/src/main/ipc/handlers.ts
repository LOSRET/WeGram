import { AppError } from '@wechatgram/protocol'
import type { AppInfo, ProxyConfig } from '@wechatgram/protocol'
import { BrowserWindow, dialog, shell } from 'electron'

import { resolveProxySecrets, toProxyView, toStoredProxy } from '../proxy'
import type { SettingsStore } from '../store/settings'
import type { UiDatabase } from '../store/ui-db'
import type { TelegramAdapter } from '../telegram/adapter'
import type { IpcHandlerMap } from './router'

export interface HandlerDeps {
  adapter: TelegramAdapter
  store: SettingsStore
  uiDb: UiDatabase
  info: AppInfo
  /** Lets the shell repaint the native window-controls overlay on theme change. */
  onThemeChange?: (theme: 'light' | 'dark') => void
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
}: HandlerDeps): IpcHandlerMap {
  return {
    'app:info': () => info,

    'auth:state': () => adapter.getAuthState(),
    'auth:start': (payload) => adapter.submitPhone((payload as { phone: string }).phone),
    'auth:code': (payload) => adapter.submitCode((payload as { code: string }).code),
    'auth:password': (payload) => adapter.submitPassword((payload as { password: string }).password),
    'auth:logout': () => adapter.logout(),
    'auth:me': () => adapter.me(),

    'chats:list': (payload) => adapter.listChats(payload as { limit: number; offset: number }),
    'chats:get': (payload) => adapter.getChat((payload as { chatId: number }).chatId),
    'chats:open': (payload) => adapter.openChat((payload as { chatId: number }).chatId),

    'messages:history': (payload) =>
      adapter.history(payload as { chatId: number; fromMessageId?: number; limit: number }),
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
  }
}
