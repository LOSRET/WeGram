import { AppError } from '@wegram/protocol'
import type {
  AuthState,
  ChatSummary,
  ConnectionState,
  Message,
  ProxyConfig,
  ProxyTestResult,
  Self,
  StickerSet,
  StickerSetSummary,
} from '@wegram/protocol'
import { createClient } from 'tdl'

import { createLogger, toAdapterError } from '../../util'
import { AdapterEmitter } from '../adapter'
import type { MediaKind, TelegramAdapter } from '../adapter'
import * as actions from './actions'
import type { ActionDeps } from './actions'
import { AvatarCache } from './avatar-cache'
import { configureTdlib, safeVersion } from './client'
import type { TdClientLike, TdObject } from './client'
import type { MapperContext } from './map/context'
import { mapUser } from './map/user'
import { applyProxy, setProxy as applyProxyConfig, testProxy as testProxyConfig } from './proxy'
import type { ProxyDeps } from './proxy'
import * as stickers from './stickers'
import { createUpdateHandler } from './updates'

export interface TdlibAdapterOptions {
  apiId: number
  apiHash: string
  databaseDirectory: string
  filesDirectory: string
  initialProxy: ProxyConfig | null
}

/**
 * Real protocol adapter. Only this folder may import `tdl` (design doc §2).
 *
 * Authorization is driven manually instead of `client.login()`, because the UI
 * needs explicit steps (`auth:start` → `auth:code` → `auth:password`).
 *
 * This file owns lifecycle, the auth state machine, connection state and the
 * `invoke` wrapper; the protocol work itself lives in the sibling modules
 * (`actions`, `updates`, `avatar-cache`, `stickers`, `proxy`, `map/*`).
 */
export class TdlibAdapter extends AdapterEmitter implements TelegramAdapter {
  readonly kind = 'tdlib' as const
  readonly label = 'TDLib'

  private readonly logger = createLogger('tdlib')
  private client: TdClientLike | null = null
  private auth: AuthState = { kind: 'idle' }
  private connection: ConnectionState = 'offline'
  private proxy: ProxyConfig | null = null
  private readonly userNames = new Map<number, string>()
  /** Chat titles, used for `messageSenderChat` (channel posts, anonymous admins). */
  private readonly chatTitles = new Map<number, string>()
  /** Sticker file id → pixel size, so the picker can send without a lookup. */
  private readonly stickerSizes = new Map<number, { width: number; height: number }>()
  /** Our own user id, learnt from `getMe`; drives the rail avatar. */
  private selfUserId: number | null = null

  private readonly avatars: AvatarCache
  private readonly mapper: MapperContext
  private readonly actionDeps: ActionDeps
  private readonly proxyDeps: ProxyDeps
  private readonly handleUpdate: (update: TdObject) => Promise<void>

  constructor(private readonly options: TdlibAdapterOptions) {
    super()

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
      onSelfAvatar: (url) => {
        if (this.auth.kind === 'ready') {
          this.setAuth({ kind: 'ready', me: { ...this.auth.me, avatarUrl: url } })
        }
      },
    })

    this.mapper = {
      chatTitles: this.chatTitles,
      chatAvatarUrls: this.avatars.urls,
      stickerSizes: this.stickerSizes,
      resolveUserName: (userId) => this.resolveUserName(userId),
      resolveChatTitle: (chatId) => this.resolveChatTitle(chatId),
    }

    this.actionDeps = {
      invoke: (method) => this.invoke(method),
      mapper: this.mapper,
      logger: this.logger,
      emit: (event) => this.emit(event),
      prefetchChatAvatars: (chatIds) => this.avatars.prefetch(chatIds),
    }

    this.proxyDeps = {
      invoke: (method) => this.invoke(method),
      logger: this.logger,
      getProxy: () => this.proxy,
      setProxyState: (config) => {
        this.proxy = config
      },
      isOnline: () => this.isOnline(),
    }

    this.handleUpdate = createUpdateHandler({
      invoke: (method) => this.invoke(method),
      emit: (event) => this.emit(event),
      mapper: this.mapper,
      logger: this.logger,
      setAuth: (state) => this.setAuth(state),
      setConnection: (state) => this.setConnection(state),
      me: () => this.me(),
      fetchChatSummary: (chatId) => actions.fetchChatSummary(this.actionDeps, chatId),
      avatars: {
        prefetch: (chatIds) => this.avatars.prefetch(chatIds),
        invalidate: (chatId) => this.avatars.invalidate(chatId),
        loadSelf: (fileId) => {
          void this.avatars.loadSelf(fileId)
        },
      },
      getSelfUserId: () => this.selfUserId,
      safeVersion: () => safeVersion(this.client),
    })
  }

  async start(): Promise<void> {
    if (this.client) return
    configureTdlib(this.logger)

    // `restartAuth()` drops this client and creates another one; every callback
    // checks identity first so a dying client cannot touch the adapter.
    const client = createClient({
      apiId: this.options.apiId,
      apiHash: this.options.apiHash,
      databaseDirectory: this.options.databaseDirectory,
      filesDirectory: this.options.filesDirectory,
      tdlibParameters: {
        use_message_database: true,
        use_secret_chats: false,
        system_language_code: 'zh-hans',
        application_version: '0.1.0',
        device_model: 'WeGram Desktop',
        system_version: 'Windows',
      },
    }) as unknown as TdClientLike
    this.client = client

    client.on('update', (update) => {
      if (this.client !== client) return
      void this.handleUpdate(update).catch((error) => {
        this.logger.warn('update handler failed:', error instanceof Error ? error.message : error)
      })
    })
    client.on('error', (error) => {
      if (this.client !== client) return
      this.logger.warn('client error:', error.message)
    })
    client.on('close', () => {
      if (this.client !== client) return
      this.setAuth({ kind: 'closed' })
    })

    // Proxy must be in place before any network request (§6.4). tdl queues
    // requests until it has sent the TDLib parameters, so calling it here is
    // both safe and early enough.
    if (this.options.initialProxy) {
      const proxy = this.options.initialProxy
      void applyProxy(this.proxyDeps, proxy)
        .then(() =>
          this.logger.info(`initial proxy applied: ${proxy.type} ${proxy.host}:${proxy.port}`),
        )
        .catch((error) =>
          this.logger.warn(
            'initial proxy failed:',
            error instanceof Error ? error.message : String(error),
          ),
        )
    }

    // Version is only known once TDLib emits its first update, so it is not
    // available here; report it when authorization settles instead.
    this.logger.info('TDLib client created')
  }

  async stop(): Promise<void> {
    if (!this.client) return
    try {
      await this.client.close()
    } finally {
      this.client = null
    }
  }

  getAuthState(): AuthState {
    return this.auth
  }

  getConnectionState(): ConnectionState {
    return this.connection
  }

  async submitPhone(phone: string): Promise<AuthState> {
    await this.invoke({ _: 'setAuthenticationPhoneNumber', phone_number: phone, settings: null })
    return this.auth
  }

  async submitCode(code: string): Promise<AuthState> {
    await this.invoke({ _: 'checkAuthenticationCode', code })
    return this.auth
  }

  async submitPassword(password: string): Promise<AuthState> {
    await this.invoke({ _: 'checkAuthenticationPassword', password })
    return this.auth
  }

  /**
   * TDLib's QR login: valid in `waitPhoneNumber`; the answer arrives as an
   * `updateAuthorizationState` with `authorizationStateWaitOtherDeviceConfirmation`
   * and a fresh `tg://login?token=…` link, which the mapper turns into `waitQr`.
   */
  async requestQrCode(): Promise<AuthState> {
    await this.invoke({ _: 'requestQrCodeAuthentication' })
    return this.auth
  }

  /**
   * Switch from QR to the phone form. TDLib has no call to cancel a pending
   * `waitOtherDeviceConfirmation` (setAuthenticationPhoneNumber refuses that
   * state), so the only way is to destroy the instance and start a fresh one.
   * Nothing is stored yet at this point, so destroying the database is safe.
   */
  async restartAuth(): Promise<AuthState> {
    if (this.auth.kind === 'ready') {
      throw new AppError('invalid_payload', 'Already signed in')
    }

    const client = this.client
    if (client) {
      // Detach first: the old client's close/update callbacks must not fire into
      // this adapter while the replacement is starting.
      this.client = null
      const closed = new Promise<void>((resolve) => {
        client.on('close', () => resolve())
      })
      try {
        await client.invoke({ _: 'destroy' })
      } catch (error) {
        this.logger.warn('destroy failed:', error instanceof Error ? error.message : String(error))
      }
      // `destroy` deletes the local database; wait for TDLib to close the
      // instance before a new client opens the same directories.
      await Promise.race([closed, delay(5_000)])
    }

    this.selfUserId = null
    this.setAuth({ kind: 'idle' })
    await this.start()
    return this.auth
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

  async listChats(input: { limit: number; offset: number }): Promise<ChatSummary[]> {
    return actions.listChats(this.actionDeps, input)
  }

  async getChat(chatId: number): Promise<ChatSummary> {
    return actions.getChat(this.actionDeps, chatId)
  }

  async openChat(chatId: number): Promise<void> {
    return actions.openChat(this.actionDeps, chatId)
  }

  async history(input: {
    chatId: number
    fromMessageId?: number
    limit: number
  }): Promise<{ messages: Message[]; hasMore: boolean }> {
    return actions.history(this.actionDeps, input)
  }

  async sendText(input: {
    chatId: number
    text: string
    replyTo?: number
  }): Promise<{ localId: string; message: Message }> {
    return actions.sendText(this.actionDeps, input)
  }

  async editText(input: { chatId: number; messageId: number; text: string }): Promise<Message> {
    return actions.editText(this.actionDeps, input)
  }

  async deleteMessages(input: {
    chatId: number
    messageIds: number[]
    forBoth: boolean
  }): Promise<void> {
    return actions.deleteMessages(this.actionDeps, input)
  }

  async forwardMessages(input: {
    fromChatId: number
    messageIds: number[]
    toChatId: number
  }): Promise<void> {
    return actions.forwardMessages(this.actionDeps, input)
  }

  async markRead(input: { chatId: number; upToMessageId: number }): Promise<void> {
    return actions.markRead(this.actionDeps, input)
  }

  async searchGlobal(input: { q: string; limit: number }): Promise<ChatSummary[]> {
    return actions.searchGlobal(this.actionDeps, input)
  }

  async searchInChat(input: {
    chatId: number
    q: string
    fromMessageId?: number
  }): Promise<Message[]> {
    return actions.searchInChat(this.actionDeps, input)
  }

  async downloadFile(input: {
    fileId: number
    priority: number
  }): Promise<{ path: string; url: string }> {
    return actions.downloadFile(this.actionDeps, input)
  }

  async sendMedia(input: {
    chatId: number
    filePath: string
    kind: MediaKind
    caption?: string
    replyTo?: number
  }): Promise<{ localId: string; message: Message }> {
    return actions.sendMedia(this.actionDeps, input)
  }

  async sendSticker(input: {
    chatId: number
    fileId: number
    replyTo?: number
  }): Promise<{ localId: string; message: Message }> {
    return actions.sendSticker(this.actionDeps, input)
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

  async setProxy(config: ProxyConfig | null): Promise<void> {
    return applyProxyConfig(this.proxyDeps, config)
  }

  async testProxy(config: ProxyConfig): Promise<ProxyTestResult> {
    return testProxyConfig(this.proxyDeps, config)
  }

  private async resolveUserName(userId: number): Promise<string> {
    const cached = this.userNames.get(userId)
    if (cached) return cached
    try {
      const user = await this.invoke({ _: 'getUser', user_id: userId })
      const name = mapUser(user)
      const label =
        [name.firstName, name.lastName].filter(Boolean).join(' ') || name.username || '未知'
      this.userNames.set(userId, label)
      return label
    } catch {
      return '未知'
    }
  }

  private async resolveChatTitle(chatId: number): Promise<string> {
    const cached = this.chatTitles.get(chatId)
    if (cached) return cached
    try {
      const chat = await this.invoke({ _: 'getChat', chat_id: chatId })
      const title: string = chat?.title ?? ''
      if (title) this.chatTitles.set(chatId, title)
      return title || '未知'
    } catch {
      return '未知'
    }
  }

  private async invoke(method: TdObject): Promise<any> {
    const client = this.client
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

  private isOnline(): boolean {
    return this.connection === 'online'
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
