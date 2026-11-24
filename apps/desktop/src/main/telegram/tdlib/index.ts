import { AppError } from '@wegram/protocol'
import type {
  AuthState,
  BootState,
  ChatSummary,
  ConnectionState,
  Contact,
  CustomEmojiSticker,
  InvokeRequest,
  InvokeResponse,
  Message,
  MessageProperties,
  NotificationScope,
  NotificationScopes,
  ProxyConfig,
  ProxyTestResult,
  ScopeNotificationSettings,
  Self,
  StickerSet,
  StickerSetSummary,
} from '@wegram/protocol'

import { createLogger, toAdapterError } from '../../util'
import { AdapterEmitter } from '../adapter'
import type { TelegramAdapter } from '../adapter'
import * as actions from './actions'
import type { ActionDeps } from './actions'
import * as auth from './auth'
import type { AuthDeps } from './auth'
import { AvatarCache } from './avatar-cache'
import type { TdObject } from './client'
import { TdlibLifecycle } from './lifecycle'
import type { MapperContext } from './map/context'
import { createResolvers } from './map/resolvers'
import { mapUser } from './map/user'
import { setProxy as applyProxyConfig, testProxy as testProxyConfig } from './proxy'
import type { ProxyDeps } from './proxy'
import * as stickers from './stickers'
import { createBotApi } from './bot-api'
import { createChatApi } from './chat-api'
import { createSendApi } from './send-api'
import { createTopicApi } from './topic-api'
import { createUserApi } from './user-api'
import { createWebApi } from './web-api'
import { createUpdateHandler } from './updates'

export interface TdlibAdapterOptions {
  apiId: number
  apiHash: string
  databaseDirectory: string
  filesDirectory: string
  initialProxy: ProxyConfig | null
  /** TDLib's `prefer_ipv6` as stored in settings.json. */
  initialPreferIpv6?: boolean
  /** Sent as TDLib's `application_version`; main passes app.getVersion(). */
  applicationVersion?: string
  /**
   * TDLib's `use_test_dc`: Telegram's separate test account space, where the
   * write paths are proven. Its database directory must be its own.
   */
  useTestDc?: boolean
}

/**
 * Real protocol adapter. Only this folder may import `tdl` (design doc §2).
 *
 * Authorization is driven manually instead of `client.login()`, because the UI
 * needs explicit steps (`auth:start` → `auth:code` → `auth:password`).
 *
 * This file owns connection state and the `invoke` wrapper; the client lifecycle
 * (create, crash, restart) is `lifecycle.ts`, and the protocol work itself lives
 * in the sibling modules (`auth` for the sign-in steps, `actions`, `updates`,
 * `avatar-cache`, `stickers`, `proxy`, `map/*`).
 */
export class TdlibAdapter extends AdapterEmitter implements TelegramAdapter {
  readonly kind = 'tdlib' as const
  readonly label = 'TDLib'

  private readonly logger = createLogger('tdlib')
  private auth: AuthState = { kind: 'idle' }
  private connection: ConnectionState = 'offline'
  /** TDLib's prefer_ipv6; re-applied to every client the lifecycle creates. */
  private preferIpv6 = false
  private readonly userNames = new Map<number, string>()
  /** Chat titles, used for `messageSenderChat` (channel posts, anonymous admins). */
  private readonly chatTitles = new Map<number, string>()
  /** Sticker file id → pixel size, so the picker can send without a lookup. */
  private readonly stickerSizes = new Map<number, { width: number; height: number }>()
  /** Our own user id, learnt from `getMe`; drives the rail avatar. */
  private selfUserId: number | null = null

  /** Cached name/title lookups; built from the two maps above. */
  private readonly resolvers = createResolvers({
    invoke: (method) => this.invoke(method),
    userNames: this.userNames,
    chatTitles: this.chatTitles,
  })

  private readonly avatars: AvatarCache
  private readonly mapper: MapperContext
  private readonly actionDeps: ActionDeps
  private readonly authDeps: AuthDeps
  private readonly proxyDeps: ProxyDeps
  private readonly handleUpdate: (update: TdObject) => Promise<void>
  private readonly lifecycle: TdlibLifecycle

  constructor(private readonly options: TdlibAdapterOptions) {
    super()

    // Remembered before any client exists: the lifecycle applies it at start.
    this.preferIpv6 = this.options.initialPreferIpv6 === true

    // Built first: its photo cache is part of the mapper context.
    this.avatars = new AvatarCache({
      invoke: (method) => this.invoke(method),
      logger: this.logger,
      downloadFilePath: (fileId, priority) =>
        actions.fetchFilePath({ invoke: (method) => this.invoke(method) }, fileId, priority),
      downloadFile: (fileId, priority) =>
        actions.downloadFile(this.actionDeps, { fileId, priority }),
      fetchChatSummary: (chatId) => actions.fetchChatSummary(this.actionDeps, chatId),
      emitChats: (ops) => this.emit({ type: 'chats', ops }),
      emitAvatars: (avatars) => this.emit({ type: 'avatars', avatars }),
      onSelfAvatar: (url) => {
        if (this.auth.kind === 'ready') {
          this.setAuth({ kind: 'ready', me: { ...this.auth.me, avatarUrl: url } })
        }
      },
    })

    this.mapper = {
      chatTitles: this.chatTitles,
      chatAvatarUrls: this.avatars.urls,
      userAvatarUrls: this.avatars.userUrls,
      stickerSizes: this.stickerSizes,
      resolveUserName: (userId) => this.resolvers.resolveUserName(userId),
      resolveChatTitle: (chatId) => this.resolvers.resolveChatTitle(chatId),
      prefetchUserAvatars: (userIds) => this.avatars.prefetchUsers(userIds),
      resolveFullRichMessage: async (chatId, messageId) => {
        try {
          return await this.invoke({
            _: 'getFullRichMessage',
            chat_id: chatId,
            message_id: messageId,
          })
        } catch (error) {
          // A deleted or edited-away page is not worth failing the row for.
          this.logger.warn(
            `rich message ${chatId}/${messageId} kept its excerpt:`,
            error instanceof Error ? error.message : String(error),
          )
          return undefined
        }
      },
    }

    this.actionDeps = {
      invoke: (method) => this.invoke(method),
      mapper: this.mapper,
      logger: this.logger,
      emit: (event) => this.emit(event),
      prefetchChatAvatars: (chatIds) => this.avatars.prefetch(chatIds),
    }

    this.authDeps = {
      invoke: (method) => this.invoke(method),
      getAuth: () => this.auth,
      resetClient: () => this.lifecycle.restart(),
    }

    this.proxyDeps = {
      invoke: (method) => this.invoke(method),
      logger: this.logger,
    }

    this.handleUpdate = createUpdateHandler({
      invoke: (method) => this.invoke(method),
      emit: (event) => this.emit(event),
      mapper: this.mapper,
      logger: this.logger,
      setAuth: (state) => this.setAuth(state),
      setBoot: (state) => this.lifecycle.setBoot(state),
      setConnection: (state) => this.setConnection(state),
      setConnectionBoot: (state) => this.lifecycle.noteConnectionBoot(state),
      me: () => this.me(),
      fetchChatSummary: (chatId) => actions.fetchChatSummary(this.actionDeps, chatId),
      avatars: {
        prefetch: (chatIds) => this.avatars.prefetch(chatIds),
        invalidate: (chatId) => this.avatars.invalidate(chatId),
        loadSelf: (fileId) => {
          void this.avatars.loadSelf(fileId)
        },
        syncUserPhoto: (userId, fileId) => this.avatars.syncUserPhoto(userId, fileId),
      },
      getSelfUserId: () => this.selfUserId,
      safeVersion: () => this.lifecycle.version(),
    })

    // Built last: it needs `handleUpdate`, and every other dep above reaches it
    // lazily anyway.
    this.lifecycle = new TdlibLifecycle({
      apiId: this.options.apiId,
      apiHash: this.options.apiHash,
      databaseDirectory: this.options.databaseDirectory,
      filesDirectory: this.options.filesDirectory,
      useTestDc: this.options.useTestDc === true,
      applicationVersion: this.options.applicationVersion ?? 'dev',
      initialProxy: this.options.initialProxy,
      logger: this.logger,
      emit: (event) => this.emit(event),
      handleUpdate: (update) => this.handleUpdate(update),
      setAuth: (state) => this.setAuth(state),
      proxy: this.proxyDeps,
      preferIpv6: () => this.preferIpv6,
      onReset: () => {
        this.selfUserId = null
        this.setAuth({ kind: 'idle' })
      },
    })
  }

  start(): Promise<void> {
    return this.lifecycle.start()
  }

  stop(): Promise<void> {
    return this.lifecycle.stop()
  }

  getAuthState(): AuthState {
    return this.auth
  }

  getBootState(): BootState {
    return this.lifecycle.getBootState()
  }

  getConnectionState(): ConnectionState {
    return this.connection
  }

  async submitPhone(phone: string): Promise<AuthState> {
    return auth.submitPhone(this.authDeps, phone)
  }

  async submitCode(code: string): Promise<AuthState> {
    return auth.submitCode(this.authDeps, code)
  }

  async submitPassword(password: string): Promise<AuthState> {
    return auth.submitPassword(this.authDeps, password)
  }

  async signUp(input: { firstName: string; lastName?: string }): Promise<AuthState> {
    return auth.signUp(this.authDeps, input)
  }

  async requestQrCode(): Promise<AuthState> {
    return auth.requestQrCode(this.authDeps)
  }

  async restartAuth(): Promise<AuthState> {
    return auth.restartAuth(this.authDeps)
  }

  async logout(): Promise<void> {
    await this.invoke({ _: 'logOut' })
    this.userNames.clear()
  }

  async me(): Promise<Self> {
    const raw = await this.invoke({ _: 'getMe' })
    this.selfUserId = raw.id
    const fileId: number | undefined = raw.profile_photo?.small?.id ?? raw.profile_photo?.big?.id
    const avatarUrl = fileId ? this.avatars.selfAvatar(fileId) : undefined
    // Already fetched: hand the renderer the picture with the profile in one go.
    if (avatarUrl) return { ...mapUser(raw), avatarUrl }
    // Otherwise fetch it in the background and announce it with a fresh auth
    // event — authorisation must not wait for a network round trip.
    if (fileId) void this.avatars.loadSelf(fileId)
    return mapUser(raw)
  }

  /**
   * The chat endpoints. Their TDLib calls live in `chat-api.ts`; the lazy deps
   * keep this initializer safe before the constructor has built `actionDeps`
   * (it is read on the first call, not at construction).
   */
  private readonly chatApi = createChatApi(() => ({
    actionDeps: this.actionDeps,
    getSelfUserId: () => this.selfUserId,
  }))

  readonly listChats = this.chatApi.listChats
  /**
   * Photos for the rows the list is showing (`chats:prefetchAvatars`). The pool
   * owns the queue and the misses, so asking twice costs nothing, and each
   * finished photo is pushed as a `chats` upsert carrying its URL.
   */
  async prefetchChatAvatars(chatIds: number[]): Promise<void> {
    this.avatars.prefetch(chatIds)
  }
  readonly getChat = this.chatApi.getChat
  readonly openChat = this.chatApi.openChat
  readonly openPrivateChat = this.chatApi.openPrivateChat
  readonly openUsernameChat = this.chatApi.openUsernameChat
  readonly canPost = this.chatApi.canPost
  readonly canGetMembers = this.chatApi.canGetMembers
  readonly chatJoinState = this.chatApi.chatJoinState
  readonly joinChannel = this.chatApi.joinChannel
  readonly setChatMuted = this.chatApi.setChatMuted
  readonly setChatPinned = this.chatApi.setChatPinned
  readonly setChatArchived = this.chatApi.setChatArchived
  readonly clearHistory = this.chatApi.clearHistory
  readonly deleteChat = this.chatApi.deleteChat
  readonly setChatUnread = this.chatApi.setChatUnread
  readonly chatMembers = this.chatApi.chatMembers
  readonly setChatTitle = this.chatApi.setChatTitle
  readonly leaveChat = this.chatApi.leaveChat
  readonly pinnedMessage = this.chatApi.pinnedMessage
  readonly setPinnedMessage = this.chatApi.setPinnedMessage
  readonly inviteLink = this.chatApi.inviteLink

  /** 话题 (design doc §9.12); `topic-api.ts`, deps read lazily. */
  private readonly topicApi = createTopicApi(() => ({
    actionDeps: this.actionDeps,
    fetchChatSummary: (chatId) => actions.fetchChatSummary(this.actionDeps, chatId),
  }))
  readonly topics = this.topicApi.topics
  readonly createTopic = this.topicApi.createTopic
  readonly editTopic = this.topicApi.editTopic
  readonly setTopicPinned = this.topicApi.setTopicPinned
  readonly setTopicClosed = this.topicApi.setTopicClosed
  readonly setTopicMuted = this.topicApi.setTopicMuted
  readonly topicIcons = this.topicApi.topicIcons
  readonly forumLayout = this.topicApi.forumLayout
  readonly deleteTopic = this.topicApi.deleteTopic
  readonly topicLink = this.topicApi.topicLink
  readonly setViewAsTopics = this.topicApi.setViewAsTopics

  /** The account's Telegram address book (通讯录); see `actions.listContacts`. */
  async listContacts(): Promise<Contact[]> {
    return actions.listContacts(this.actionDeps)
  }

  async history(input: {
    chatId: number
    topicId?: number
    fromMessageId?: number
    limit: number
  }): Promise<{ messages: Message[]; hasMore: boolean }> {
    return actions.history(this.actionDeps, input)
  }

  async historyAround(input: {
    chatId: number
    topicId?: number
    messageId: number
    limit: number
  }): Promise<{ messages: Message[]; hasMore: boolean; hasNewer: boolean }> {
    return actions.historyAround(this.actionDeps, input)
  }

  async historyNewer(input: {
    chatId: number
    topicId?: number
    fromMessageId: number
    limit: number
  }): Promise<{ messages: Message[]; hasNewer: boolean }> {
    return actions.historyNewer(this.actionDeps, input)
  }

  /** One page of a message's comment thread; see `actions/comments.ts`. */
  async comments(input: Parameters<typeof actions.comments>[1]) {
    return actions.comments(this.actionDeps, input)
  }

  /** Whether this account may comment on the message; see `actions/comments.ts`. */
  async commentInfo(input: Parameters<typeof actions.commentInfo>[1]) {
    return actions.commentInfo(this.actionDeps, input)
  }

  /** Joins the thread's discussion group, or sends a join request. */
  async joinCommentGroup(input: Parameters<typeof actions.joinCommentGroup>[1]) {
    return actions.joinCommentGroup(this.actionDeps, input)
  }

  /** Posts a comment into a message's thread; see `actions/comments.ts`. */
  async sendComment(input: Parameters<typeof actions.sendComment>[1]) {
    return actions.sendComment(this.actionDeps, input)
  }

  async votePoll(input: InvokeRequest<'messages:vote'>): Promise<void> {
    return actions.votePoll(this.actionDeps, input)
  }

  async addPollOption(input: InvokeRequest<'messages:addPollOption'>): Promise<void> {
    return actions.addPollOption(this.actionDeps, input)
  }

  /** Sends, edits and deletes; `send-api.ts`, deps read lazily. */
  private readonly sendApi = createSendApi(() => this.actionDeps)
  readonly sendText = this.sendApi.sendText
  readonly editText = this.sendApi.editText
  readonly editCaption = this.sendApi.editCaption
  readonly deleteMessages = this.sendApi.deleteMessages
  readonly forwardMessages = this.sendApi.forwardMessages
  readonly markRead = this.sendApi.markRead
  readonly sendTyping = this.sendApi.sendTyping
  readonly resendMessages = this.sendApi.resendMessages
  readonly sendMedia = this.sendApi.sendMedia
  readonly sendAlbum = this.sendApi.sendAlbum
  readonly sendSticker = this.sendApi.sendSticker
  readonly sendVoiceNote = this.sendApi.sendVoiceNote

  async messageProperties(input: InvokeRequest<'messages:properties'>): Promise<MessageProperties> {
    return actions.messageProperties(this.actionDeps, input)
  }

  /** 转文字; the transcript arrives as a content update. */
  async transcribeMessage(input: { chatId: number; messageId: number }): Promise<void> {
    return actions.transcribeMessage(this.actionDeps, input)
  }

  /** 在线/最后上线, 资料卡 and 共同群聊; `user-api.ts`, deps read lazily. */
  private readonly userApi = createUserApi(() => this.actionDeps)
  readonly userStatus = this.userApi.userStatus
  readonly userProfile = this.userApi.userProfile
  readonly commonChats = this.userApi.commonChats
  readonly setUserNote = this.userApi.setUserNote
  readonly setUserContact = this.userApi.setUserContact
  readonly setUserBlocked = this.userApi.setUserBlocked
  readonly reportUser = this.userApi.reportUser
  readonly reportMessage = this.userApi.reportMessage

  /** Bots: the command list and inline-button callbacks; `bot-api.ts`. */
  private readonly botApi = createBotApi(() => this.actionDeps)
  readonly botCommands = this.botApi.botCommands
  readonly pressCallback = this.botApi.pressCallback

  private readonly webApi = createWebApi(() => this.actionDeps)
  readonly instantView = this.webApi.instantView

  async searchGlobal(input: { q: string; limit: number }): Promise<ChatSummary[]> {
    return actions.searchGlobal(this.actionDeps, input)
  }

  async searchInChat(input: {
    chatId: number
    topicId?: number
    q: string
    fromMessageId?: number
  }): Promise<Message[]> {
    return actions.searchInChat(this.actionDeps, input)
  }

  async searchMessages(
    input: InvokeRequest<'search:messages'>,
  ): Promise<InvokeResponse<'search:messages'>> {
    return actions.searchMessages(this.actionDeps, input)
  }

  async downloadFile(input: {
    fileId: number
    priority: number
  }): Promise<{ path: string; url: string }> {
    return actions.downloadFile(this.actionDeps, input)
  }

  beginStream(input: { fileId: number; offset: number; priority: number }) {
    return actions.beginStream(this.actionDeps, input)
  }

  downloadedPrefix(input: { fileId: number; offset: number }): Promise<number> {
    return actions.downloadedPrefix(this.actionDeps, input)
  }

  cancelDownload(fileId: number): Promise<void> {
    return actions.cancelDownload(this.actionDeps, fileId)
  }

  async listStickerSets(): Promise<StickerSetSummary[]> {
    return stickers.listStickerSets({
      invoke: (method) => this.invoke(method),
      mapper: this.mapper,
    })
  }

  async getStickerSet(setId: string): Promise<StickerSet> {
    return stickers.getStickerSet(
      { invoke: (method) => this.invoke(method), mapper: this.mapper },
      setId,
    )
  }

  async changeStickerSet(
    setId: string,
    change: { installed: boolean; archived?: boolean },
  ): Promise<void> {
    await stickers.changeStickerSet(
      { invoke: (method) => this.invoke(method), mapper: this.mapper },
      setId,
      change,
    )
    // The panel refetches on this. TDLib's updateInstalledStickerSets may come a
    // beat later; emitting here is what lets the pack page close with its tab
    // already gone.
    this.emit({ type: 'stickerSets' })
  }

  async customEmojiStickers(ids: string[]): Promise<CustomEmojiSticker[]> {
    return stickers.listCustomEmojiStickers(
      { invoke: (method) => this.invoke(method), mapper: this.mapper },
      ids,
    )
  }

  async setProxy(config: ProxyConfig | null): Promise<void> {
    return applyProxyConfig(this.proxyDeps, config)
  }

  async testProxy(config: ProxyConfig): Promise<ProxyTestResult> {
    return testProxyConfig(this.proxyDeps, config)
  }

  async setPreferIpv6(prefer: boolean): Promise<void> {
    this.preferIpv6 = prefer
    // Before `start()` the value is only remembered; the lifecycle applies it.
    if (!this.lifecycle.getClient()) return
    await this.invoke({
      _: 'setOption',
      name: 'prefer_ipv6',
      value: { _: 'optionValueBoolean', value: prefer },
    })
  }

  async notificationScopes(): Promise<NotificationScopes> {
    return actions.notificationScopes(this.actionDeps)
  }

  async setNotificationScope(
    scope: NotificationScope,
    settings: ScopeNotificationSettings,
  ): Promise<void> {
    return actions.setNotificationScope(this.actionDeps, scope, settings)
  }

  /**
   * Test-DC scripts only: one TDLib method that has no seam method (a forum
   * created for the probe, its tabs/sidebar switch). Production code goes through
   * the interface; this exists so the write matrix can be exercised headlessly.
   */
  async rawInvoke(method: TdObject): Promise<any> {
    return this.invoke(method)
  }

  private async invoke(method: TdObject): Promise<any> {
    const client = this.lifecycle.getClient()
    if (!client) throw new AppError('internal', 'TDLib client is not started')
    try {
      return await client.invoke(method)
    } catch (error) {
      throw toAdapterError(error, `TDLib call ${String(method._)} failed`)
    }
  }

  private setAuth(state: AuthState): void {
    this.auth = state
    this.emit({ type: 'auth', state })
  }

  private setConnection(state: ConnectionState): void {
    if (this.connection === state) return
    this.connection = state
    this.emit({ type: 'connection', state })
  }
}
