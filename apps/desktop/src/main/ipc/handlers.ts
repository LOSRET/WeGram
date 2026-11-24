import { copyFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { AppError, RECENT_EMOJI_LIMIT } from '@wegram/protocol'
import type { AppInfo, ConnectionState, MessageTextSize, SendKey } from '@wegram/protocol'
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, nativeImage, shell } from 'electron'

import { canLaunchAtLogin, getLaunchAtLogin, setLaunchAtLogin } from '../autostart'
import { closeLoginWindow } from '../login-window'
import { drop, hold } from '../media/leases'
import { registerStreamFile } from '../media/registry'
import { writeVoiceNote } from '../media/voice-file'
import { resolveProxySecrets, toStoredProxy } from '../proxy'
import type { ProxyController } from '../proxy-controller'
import { closeQrWindow, getQrWindow, openQrWindow, qrTarget } from '../qr-window'
import { instantViewWindowState, openInstantViewWindow } from '../instant-view-window'
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
import { closeSettingsWindow, openSettingsWindow } from '../settings-window'
import {
  getCloseBehavior,
  getDesktopNotifications,
  getMessageTextSize,
  getSendKey,
  setCloseBehavior,
  setDesktopNotifications,
  setMessageTextSize,
  setSendKey,
} from '../store/prefs'
import { resolveTheme, storedTheme, themePreference } from '../windows'
import type { IpcHandlerMap } from './router'

export interface HandlerDeps {
  adapter: TelegramAdapter
  store: SettingsStore
  uiDb: UiDatabase
  info: AppInfo
  /** §6.4: the one place that decides which proxy is in force. */
  proxyController: ProxyController
  /** TDLib's state right now; the shell seeds its header from it (`network:connection`). */
  connection: () => ConnectionState
  /** Lets the shell repaint the native window-controls overlay on theme change. */
  onThemeChange?: (theme: 'light' | 'dark') => void
  /**
   * 发送消息 or 消息字号 changed: the shell follows them through evt:settings, so
   * the change applies to the open transcript without a restart.
   */
  onSettingsChange?: (settings: { sendKey: SendKey; messageTextSize: MessageTextSize }) => void
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
  onLocate: (target: { chatId: number; messageId: number; topicId?: number }) => void
  /**
   * Which conversation the shell shows (or null). Main uses it to suppress a
   * desktop notification for the chat the reader is already looking at.
   */
  setActiveChat: (chatId: number | null) => void
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
  proxyController,
  connection,
  onThemeChange,
  onSettingsChange,
  onLoginEnter,
  onAuthInteraction,
  onLocate,
  setActiveChat,
}: HandlerDeps): IpcHandlerMap {
  /**
   * The viewer's own downloads (open / save / copy / reveal) outrank the
   * transcript's background fetches, so the file the reader is acting on wins.
   */
  const VIEWER_DOWNLOAD_PRIORITY = 32
  /** Video playback: above the transcript, below a save the reader asked for. */
  const STREAM_DOWNLOAD_PRIORITY = 28
  /** Unique holder for a request main starts on its own (保存, 复制, 在文件夹中显示). */
  let systemOwner = 0

  /**
   * A download the reader asked for. It holds the file while it runs so a bubble
   * scrolling out of view (and cancelling its own interest in that photo) can
   * never stop it.
   */
  const localFile = async (fileId: number): Promise<string> => {
    systemOwner += 1
    const owner = `system-${systemOwner}`
    hold(fileId, owner)
    try {
      const { path } = await adapter.downloadFile({
        fileId,
        priority: VIEWER_DOWNLOAD_PRIORITY,
        owner,
      })
      return path
    } finally {
      drop(fileId, owner)
    }
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
    'boot:state': () => adapter.getBootState(),
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
    'auth:logout': async () => {
      // 设置 draws the account that is leaving; it must not stay up showing an
      // identity that no longer exists (design doc §9.11.5).
      closeSettingsWindow()
      await adapter.logout()
    },
    'auth:me': () => adapter.me(),

    'chats:list': (payload) => adapter.listChats(payload),
    'chats:prefetchAvatars': (payload) => adapter.prefetchChatAvatars(payload.chatIds),
    'chats:get': (payload) => adapter.getChat(payload.chatId),
    'chats:open': (payload) => adapter.openChat(payload.chatId),
    'chats:openPrivate': (payload) => adapter.openPrivateChat(payload.userId),
    'chats:openUsername': (payload) => adapter.openUsernameChat(payload.username),
    'chats:canPost': (payload) => adapter.canPost(payload.chatId),
    'chats:canGetMembers': (payload) => adapter.canGetMembers(payload.chatId),
    'chats:joinState': (payload) => adapter.chatJoinState(payload.chatId),
    'chats:join': (payload) => adapter.joinChannel(payload.chatId),
    'chats:setMuted': (payload) => adapter.setChatMuted(payload.chatId, payload.muted),
    'chats:setPinned': (payload) => adapter.setChatPinned(payload.chatId, payload.pinned),
    'chats:setArchived': (payload) => adapter.setChatArchived(payload.chatId, payload.archived),
    'chats:clearHistory': (payload) => adapter.clearHistory(payload.chatId),
    'chats:delete': (payload) => adapter.deleteChat(payload.chatId),
    'chats:setUnread': (payload) => adapter.setChatUnread(payload.chatId, payload.unread),
    'chats:members': (payload) =>
      adapter.chatMembers(payload.chatId, payload.limit ?? 12, payload.query),
    'chats:setTitle': (payload) => adapter.setChatTitle(payload.chatId, payload.title),
    'chats:leave': (payload) => adapter.leaveChat(payload.chatId),
    'chats:pinned': (payload) => adapter.pinnedMessage(payload.chatId, payload.topicId),
    'chats:setPinnedMessage': (payload) =>
      adapter.setPinnedMessage(payload.chatId, payload.messageId, payload.topicId),
    'chats:addMember': (payload) => adapter.addChatMember(payload.chatId, payload.username),
    'chats:inviteLink': (payload) => adapter.inviteLink(payload.chatId, payload.temporary),
    /** 话题 (design doc §9.12): the list, its cursor and the management calls. */
    'chats:topics': (payload) => adapter.topics(payload),
    'chats:topicCreate': (payload) => adapter.createTopic(payload),
    'chats:topicEdit': (payload) => adapter.editTopic(payload),
    'chats:topicSetPinned': (payload) =>
      adapter.setTopicPinned(payload.chatId, payload.topicId, payload.pinned),
    'chats:topicSetClosed': (payload) =>
      adapter.setTopicClosed(payload.chatId, payload.topicId, payload.closed),
    'chats:topicSetMuted': (payload) =>
      adapter.setTopicMuted(payload.chatId, payload.topicId, payload.muted),
    /** 话题图标: the same set every client offers (Premium may use any emoji). */
    'chats:topicIcons': async () => ({ icons: await adapter.topicIcons() }),
    'chats:forumLayout': async (payload) => ({
      layout: await adapter.forumLayout(payload.chatId),
    }),
    'chats:topicDelete': (payload) => adapter.deleteTopic(payload.chatId, payload.topicId),
    'chats:topicLink': (payload) => adapter.topicLink(payload.chatId, payload.topicId),
    'chats:setViewAsTopics': (payload) =>
      adapter.setViewAsTopics(payload.chatId, payload.viewAsTopics),
    'contacts:list': () => adapter.listContacts(),
    'users:status': (payload) => adapter.userStatus(payload.userId),
    'users:profile': (payload) => adapter.userProfile(payload.userId),
    'users:setNote': (payload) => adapter.setUserNote(payload.userId, payload.note),
    'users:setContact': (payload) =>
      adapter.setUserContact(payload.userId, payload.contact, payload.sharePhone),
    'users:setBlocked': (payload) => adapter.setUserBlocked(payload.userId, payload.blocked),
    'users:commonChats': (payload) => adapter.commonChats(payload),
    /** Bots: the "/" command list of a bot chat, and pressing an inline button. */
    'bots:commands': (payload) => adapter.botCommands(payload.chatId),
    'bots:callback': (payload) => adapter.pressCallback(payload),
    'bots:inlineQuery': (payload) => adapter.inlineQuery(payload),
    'bots:inlineSend': (payload) => adapter.sendInlineResult(payload),
    /** 即时预览: the reader window's target, and the page it draws (design doc §8.9). */
    'web:open': (payload) => {
      openInstantViewWindow(payload, BrowserWindow.getFocusedWindow())
    },
    'web:state': () => instantViewWindowState(),
    'web:instantView': (payload) => adapter.instantView(payload.url),
    'users:report': (payload) =>
      adapter.reportUser(payload.userId, {
        ...(payload.optionId === undefined ? {} : { optionId: payload.optionId }),
        ...(payload.text === undefined ? {} : { text: payload.text }),
      }),
    'ui:setActiveChat': (payload) => setActiveChat(payload.chatId),

    'messages:history': (payload) => adapter.history(payload),
    'messages:around': (payload) => adapter.historyAround(payload),
    'messages:newer': (payload) => adapter.historyNewer(payload),
    'messages:comments': (payload) => adapter.comments(payload),
    'messages:commentInfo': (payload) => adapter.commentInfo(payload),
    'messages:joinCommentGroup': (payload) => adapter.joinCommentGroup(payload),
    'messages:sendComment': (payload) => adapter.sendComment(payload),
    'messages:send': (payload) => adapter.sendText(payload),
    'messages:edit': (payload) => adapter.editText(payload),
    'messages:editCaption': (payload) => adapter.editCaption(payload),
    'messages:delete': (payload) => adapter.deleteMessages(payload),
    'messages:properties': (payload) => adapter.messageProperties(payload),
    'messages:transcribe': (payload) => adapter.transcribeMessage(payload),
    'messages:report': (payload) => adapter.reportMessage(payload),
    'messages:forward': (payload) => adapter.forwardMessages(payload),
    'messages:read': (payload) => adapter.markRead(payload),
    'messages:typing': (payload) =>
      adapter.sendTyping(payload.chatId, payload.typing, payload.action, payload.topicId),
    'messages:resend': (payload) => adapter.resendMessages(payload.chatId, payload.messageIds),
    'messages:vote': (payload) => adapter.votePoll(payload),
    'messages:addPollOption': (payload) => adapter.addPollOption(payload),

    'search:global': (payload) => adapter.searchGlobal(payload),
    'search:inChat': (payload) => adapter.searchInChat(payload),
    'search:messages': (payload) => adapter.searchMessages(payload),

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
    /**
     * One share of a file's transfer. The holder is dropped as soon as the call
     * settles, so a late `media:cancel` from the same renderer cannot stop a
     * download somebody else has taken over (the lease answers that itself).
     */
    'media:download': async (payload) => {
      hold(payload.fileId, payload.owner)
      try {
        return await adapter.downloadFile(payload)
      } finally {
        drop(payload.fileId, payload.owner)
      }
    },
    /** The reader (or their bubble) stopped waiting: stop only if nobody else does. */
    'media:cancel': async (payload) => {
      if (drop(payload.fileId, payload.owner)) {
        await adapter.cancelDownload(payload.fileId)
      }
    },
    /**
     * A URL for a video that is not downloaded yet. The scheme handler tails the
     * file (design doc §8.7), so the element starts playing while TDLib is still
     * fetching the rest.
     */
    'media:stream': async (payload) => {
      hold(payload.fileId, payload.owner)
      try {
        await adapter.beginStream({
          fileId: payload.fileId,
          offset: 0,
          priority: STREAM_DOWNLOAD_PRIORITY,
        })
      } catch (error) {
        drop(payload.fileId, payload.owner)
        throw error
      }
      return { url: registerStreamFile(payload.fileId) }
    },
    'media:open': async (payload) => {
      const path = await localFile(payload.fileId)
      // Only files the protocol layer just produced are ever opened.
      const failure = await shell.openPath(path)
      if (failure) throw new AppError('internal', `Failed to open file: ${failure}`)
    },
    'media:sendAlbum': (payload) => {
      const empty = payload.items.find((item) => !item.filePath.trim())
      if (empty) throw new AppError('invalid_payload', 'Empty file path')
      return adapter.sendAlbum(payload)
    },
    'media:send': (payload) => {
      if (!payload.filePath.trim()) throw new AppError('invalid_payload', 'Empty file path')
      return adapter.sendMedia(payload)
    },
    'messages:sendSticker': (payload) => adapter.sendSticker(payload),
    /**
     * 语音消息. The bytes come from the renderer's recorder (no native dialog is
     * involved), so main writes them to `userData/voice` first: TDLib uploads
     * from disk and the renderer never touches the filesystem. The file outlives
     * this handler on purpose — the upload starts after `sendMessage` answers —
     * and `pruneVoiceNotes` cleans it up hours later.
     */
    'messages:sendVoice': async (payload) => {
      const filePath = await writeVoiceNote(join(app.getPath('userData'), 'voice'), payload.audio)
      try {
        return await adapter.sendVoiceNote({
          chatId: payload.chatId,
          filePath,
          duration: payload.duration,
          ...(payload.replyTo === undefined ? {} : { replyTo: payload.replyTo }),
          ...(payload.topicId === undefined ? {} : { topicId: payload.topicId }),
        })
      } catch (error) {
        // Nothing will ever read this recording; a failed send must not leave it.
        await rm(filePath, { force: true })
        throw error
      }
    },
    'stickers:sets': () => adapter.listStickerSets(),
    'stickers:set': (payload) => adapter.getStickerSet(payload.setId),
    'stickers:customEmoji': (payload) => adapter.customEmojiStickers(payload.ids),

    'ui:saveDraft': (payload) => {
      if (payload.topicId !== undefined) {
        uiDb.saveTopicDraft(
          payload.chatId,
          payload.topicId,
          payload.text.trim().length
            ? {
                text: payload.text,
                ...(payload.replyTo === undefined ? {} : { replyTo: payload.replyTo }),
              }
            : null,
        )
        return
      }
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
    'ui:getDraft': (payload) =>
      payload.topicId === undefined
        ? uiDb.getDraft(payload.chatId)
        : uiDb.getTopicDraft(payload.chatId, payload.topicId),
    'ui:saveAnchor': (payload) => {
      if (payload.topicId !== undefined) {
        uiDb.saveTopicAnchor(
          payload.chatId,
          payload.topicId,
          payload.messageId,
          payload.messageId === null ? 0 : payload.offset,
        )
        return
      }
      uiDb.saveScrollAnchor(
        payload.chatId,
        payload.messageId,
        payload.messageId === null ? 0 : payload.offset,
      )
    },
    'ui:getAnchor': (payload) =>
      payload.topicId === undefined
        ? uiDb.getScrollAnchor(payload.chatId)
        : uiDb.getTopicAnchor(payload.chatId, payload.topicId),
    'ui:saveCommentAnchor': (payload) => {
      uiDb.saveCommentAnchor(
        payload.chatId,
        payload.messageId,
        payload.anchorMessageId,
        payload.offset,
      )
    },
    'ui:getCommentAnchor': (payload) => uiDb.getCommentAnchor(payload.chatId, payload.messageId),
    'ui:getRecentEmoji': () => readRecentEmoji(uiDb),
    'ui:saveRecentEmoji': (payload) => {
      uiDb.setSetting(RECENT_EMOJI_KEY, JSON.stringify(payload.emoji.slice(0, RECENT_EMOJI_LIMIT)))
    },
    'ui:getViewerVolume': () => uiDb.getViewerVolume(),
    'ui:setViewerVolume': (payload) => {
      uiDb.setViewerVolume(payload.volume)
    },

    'settings:get': () => ({
      theme: storedTheme(uiDb),
      themePreference: themePreference(uiDb),
      closeBehavior: getCloseBehavior(uiDb),
      sendKey: getSendKey(uiDb),
      messageTextSize: getMessageTextSize(uiDb),
      // Read from the operating system every time: the login item is its state,
      // and a second copy here is how the switch starts lying after a reinstall.
      launchAtLogin: getLaunchAtLogin(),
      canLaunchAtLogin: canLaunchAtLogin(),
    }),
    'settings:set': (payload) => {
      // A patch that names `theme` is an explicit choice (the rail menu's 深色模式
      // toggle); `themePreference` is the settings window's three-way control.
      const preference = payload.patch.themePreference ?? payload.patch.theme
      if (preference) {
        uiDb.setSetting('theme', preference)
        onThemeChange?.(resolveTheme(preference))
      }
      if (payload.patch.closeBehavior) setCloseBehavior(uiDb, payload.patch.closeBehavior)
      if (payload.patch.messageTextSize) setMessageTextSize(uiDb, payload.patch.messageTextSize)
      if (payload.patch.launchAtLogin !== undefined) {
        setLaunchAtLogin(payload.patch.launchAtLogin)
      }
      if (payload.patch.sendKey) setSendKey(uiDb, payload.patch.sendKey)
      // One event carries the whole shell-facing pair, so a patch that touches
      // both cannot deliver half of itself and leave the other half stale.
      if (payload.patch.sendKey || payload.patch.messageTextSize) {
        onSettingsChange?.({
          sendKey: getSendKey(uiDb),
          messageTextSize: getMessageTextSize(uiDb),
        })
      }
    },
    /**
     * 设置 is its own window, so the shell only asks for it. The anchor is whichever
     * window asked, which is what puts the sheet on the right display (§9.11.1).
     */
    'settings:open': () => openSettingsWindow(storedTheme(uiDb), BrowserWindow.getFocusedWindow()),
    'settings:close': () => closeSettingsWindow(),

    /**
     * 消息通知 (design doc §9.11.3): the local 桌面通知 switch plus the account's
     * per-scope defaults. One read for the whole panel, so the three scopes it
     * paints cannot disagree with each other.
     */
    'notifications:get': async () => ({
      desktop: getDesktopNotifications(uiDb),
      scopes: await adapter.notificationScopes(),
    }),
    /** The panel sends the whole triple it shows; the adapter preserves TDLib's rest. */
    'notifications:setScope': (payload) =>
      adapter.setNotificationScope(payload.scope, payload.settings),
    /**
     * Local state (§9.11.3): notifications.ts reads it back on every delivery, so
     * this write has no cache to invalidate.
     */
    'notifications:setDesktop': (payload) => {
      setDesktopNotifications(uiDb, payload.desktop)
    },

    'proxy:get': async () => proxyController.state() ?? proxyController.resolve({ apply: false }),
    /**
     * 设置 → 网络与代理. A manual configuration is applied before it is persisted
     * (§6.4: only a proxy the protocol layer accepted is stored), the mode change
     * is left to the controller, and the returned state is what the panel paints.
     */
    'proxy:set': async (payload) => {
      const previous = store.get().proxy
      if (payload.config !== undefined) {
        if (!payload.config) {
          // 关闭代理: forget the manual endpoint and use no proxy at all.
          await adapter.setProxy(null)
          proxyController.markApplied(null)
          store.setProxy(null)
          store.setProxyMode('off')
        } else {
          const resolved = resolveProxySecrets(payload.config, previous)
          await adapter.setProxy(resolved)
          proxyController.markApplied(resolved)
          store.setProxy(toStoredProxy(payload.config, previous))
          store.setProxyMode('manual')
        }
      }
      if (payload.mode) store.setProxyMode(payload.mode)
      return proxyController.resolve()
    },
    'proxy:test': (payload) =>
      adapter.testProxy(resolveProxySecrets(payload.config, store.get().proxy)),
    /** 重新检测: re-read the OS proxy, probe it again, apply whatever answered. */
    'proxy:refresh': () => proxyController.refresh(),

    'network:get': () => ({ preferIpv6: store.get().preferIpv6 }),
    'network:connection': () => connection(),
    'network:set': async (payload) => {
      // Same rule as the proxy: only persist what the protocol layer accepted.
      await adapter.setPreferIpv6(payload.preferIpv6)
      store.setPreferIpv6(payload.preferIpv6)
    },

    'viewer:open': (payload) => {
      const focused = BrowserWindow.getFocusedWindow()
      openViewer(payload, isViewerWindow(focused) ? null : focused)
    },
    'viewer:init': () => viewerState(),
    'viewer:save': async (payload) => {
      const item = viewerItem(payload.fileId)
      if (item?.canBeSaved === false) throw new AppError('forbidden', '受保护的内容不能保存')
      // Only files the protocol layer just produced are ever copied.
      const source = await localFile(payload.fileId)
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
      const item = viewerItem(payload.fileId)
      if (item?.canBeSaved === false) throw new AppError('forbidden', '受保护的内容不能复制')
      // The clipboard holds bitmaps only; a video would need CF_HDROP, which
      // Electron does not expose, and the client does not offer it either.
      if (item?.kind === 'video') {
        throw new AppError('not_implemented', '视频不支持复制到剪贴板')
      }
      const source = await localFile(payload.fileId)
      const image = nativeImage.createFromPath(source)
      if (image.isEmpty()) throw new AppError('internal', 'Failed to decode the image')
      // Electron 45 replaced writeImage() with the web-standard clipboard: the
      // bitmap travels as a PNG Blob inside a ClipboardItem.
      await clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([image.toPNG()], { type: 'image/png' }) }),
      ])
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
      // A strip that came from no chat (即时预览's page, §8.9) has nowhere to go.
      if (chatId === null) throw new AppError('internal', '这条媒体不来自聊天')
      onLocate({ chatId, messageId: payload.messageId })
    },
    'viewer:close': () => {
      closeViewer()
    },

    /**
     * 群二维码 is a window of its own (like the client's), opened from the panel.
     * It fetches everything in one call: the chat, the faces for the collage and
     * the 7-day invite link the code encodes.
     */
    'qr:open': (payload) => {
      openQrWindow(payload.chatId, storedTheme(uiDb), BrowserWindow.getFocusedWindow())
    },
    'qr:info': async () => {
      const chatId = qrTarget()
      if (chatId === null) throw new AppError('internal', '二维码窗口没有打开任何群')
      const [chat, members, invite] = await Promise.all([
        adapter.getChat(chatId),
        adapter.chatMembers(chatId, 12).catch(() => []),
        adapter.inviteLink(chatId, true).catch(() => null),
      ])
      return { chat, members, invite, theme: storedTheme(uiDb) }
    },
    'qr:copy': async (payload) => {
      const image = nativeImage.createFromBuffer(Buffer.from(payload.png, 'base64'))
      if (image.isEmpty()) throw new AppError('internal', 'Failed to decode the QR image')
      // Same web-standard clipboard the viewer's 复制 uses (Electron 45 has no
      // writeImage any more); main owns it, so the frameless window needs no
      // clipboard permission of its own.
      await clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([image.toPNG()], { type: 'image/png' }) }),
      ])
    },
    'qr:save': async (payload) => {
      const win = getQrWindow()
      const options: Electron.SaveDialogOptions = {
        defaultPath: join(app.getPath('pictures'), '群二维码.png'),
        filters: [{ name: '图片', extensions: ['png'] }],
      }
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      await writeFile(result.filePath, Buffer.from(payload.png, 'base64'))
      return { path: result.filePath }
    },
    'qr:share': async (payload) => {
      // 转发给朋友 sends the picture the window rasterised: write it where the
      // adapter's photo upload can read it, send, then remove the temporary file.
      const file = join(app.getPath('temp'), `wegram-qr-${Date.now()}.png`)
      await writeFile(file, Buffer.from(payload.png, 'base64'))
      try {
        await adapter.sendMedia({ chatId: payload.chatId, filePath: file, kind: 'photo' })
      } finally {
        await rm(file, { force: true })
      }
    },
    'qr:close': () => {
      closeQrWindow()
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
