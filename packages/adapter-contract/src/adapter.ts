import type {
  AuthState,
  BootState,
  ChatInviteLink,
  ChatJoinResult,
  ChatJoinState,
  ChatMember,
  ChatOp,
  ChatPinnedMessage,
  ChatSummary,
  ConnectionState,
  Contact,
  CustomEmojiSticker,
  Message,
  MessageOp,
  MessageProperties,
  PeerStatus,
  ProxyConfig,
  ProxyTestResult,
  Self,
  StickerSet,
  StickerSetSummary,
  UserAvatar,
  UserProfile,
  InvokeRequest,
  InvokeResponse,
} from '@wegram/protocol'

export type AdapterKind = 'mock' | 'tdlib'

export type MediaKind = 'photo' | 'file'

/**
 * The comment contract lives in packages/protocol (`comment.ts`); the adapter
 * re-exports it so the rest of main keeps importing its vocabulary from the seam.
 */
import type {
  CommentAccess,
  CommentJoinResult,
  CommentPage,
  CommentQuery,
  CommentSendQuery,
  CommentTarget,
} from '@wegram/protocol'

export type {
  CommentAccess,
  CommentJoinResult,
  CommentPage,
  CommentQuery,
  CommentSendQuery,
  CommentTarget,
}

/**
 * Domain events the adapter may emit. The IPC layer maps these onto `evt:*`
 * channels (§7.2) and batches them before they reach the renderer.
 */
export type AdapterEvent =
  | { type: 'auth'; state: AuthState }
  /**
   * Startup progress, distinct from authorization: the login window shows this
   * while TDLib is loading, opening its database or failing to start at all.
   */
  | { type: 'boot'; state: BootState }
  | { type: 'connection'; state: ConnectionState }
  | { type: 'chats'; ops: ChatOp[] }
  | { type: 'messages'; chatId: number; ops: MessageOp[] }
  | { type: 'avatars'; avatars: UserAvatar[] }
  /** A peer's online / last-seen state (TDLib `updateUserStatus`). */
  | { type: 'status'; userId: number; status: PeerStatus }
  /**
   * A notification TDLib decided the user should see (`updateNotification` /
   * `updateNotificationGroup`). Main turns it into an OS notification; it never
   * crosses IPC to the renderer, so it has no `evt:*` channel. TDLib has already
   * applied the chat's mute rules, mentions and preview privacy.
   */
  | {
      type: 'notification'
      chatId: number
      messageId: number
      title: string
      text: string
      isSilent: boolean
      date: number
    }
  | { type: 'typing'; chatId: number; userId: number; action: string; until: number }
  /** TDLib reloaded the installed sticker sets (cache first, then server). */
  | { type: 'stickerSets' }
  | {
      type: 'file'
      fileId: number
      downloaded: number
      total: number
      url?: string
      uploading?: boolean
      completed?: boolean
    }

export type AdapterListener = (event: AdapterEvent) => void

/**
 * The only interface the rest of main knows about. Swapping TDLib for another
 * protocol library must stay inside `telegram/` (design doc §2).
 */
export interface TelegramAdapter {
  readonly kind: AdapterKind
  readonly label: string

  start(): Promise<void>
  stop(): Promise<void>
  onEvent(listener: AdapterListener): () => void

  getAuthState(): AuthState
  /** Snapshot for a window that opened after the last `boot` event. */
  getBootState(): BootState
  getConnectionState(): ConnectionState
  submitPhone(phone: string): Promise<AuthState>
  submitCode(code: string): Promise<AuthState>
  submitPassword(password: string): Promise<AuthState>
  /**
   * Registers a number Telegram does not know yet: TDLib answers the code step
   * with `waitRegistration` and only creates the account once a name is sent.
   * The test data centers hit this on every new `99966XYYYY` number.
   */
  signUp(input: { firstName: string; lastName?: string }): Promise<AuthState>
  /** Requests QR-code login; the `waitQr` state arrives through the event stream. */
  requestQrCode(): Promise<AuthState>
  /**
   * Cancels a pending QR confirmation and rebuilds the auth client. TDLib has
   * no cancel call, so switching back to the phone form needs a fresh client.
   */
  restartAuth(): Promise<AuthState>
  logout(): Promise<void>
  me(): Promise<Self>

  listChats(input: InvokeRequest<'chats:list'>): Promise<ChatSummary[]>
  getChat(chatId: number): Promise<ChatSummary>
  openChat(chatId: number): Promise<void>
  /**
   * Opens (creating it if needed) the private chat of a user: the contact card's
   * 发消息 button. TDLib answers with the chat, which also joins the chat list.
   */
  openPrivateChat(userId: number): Promise<ChatSummary>
  /**
   * The chat behind an `@username` mention (`searchPublicChat`): the transcript's
   * mentions jump there. A name nobody owns is an `AppError` for the renderer to
   * report, not a failure of the whole pane.
   */
  openUsernameChat(username: string): Promise<ChatSummary>
  /**
   * Whether this account may post in the chat. Channels are the only kind the UI
   * asks about: posting there is an administrator right, so a channel without it
   * is rendered read-only and never offers a composer.
   */
  canPost(chatId: number): Promise<boolean>
  /**
   * Whether this account may read the chat's member list. A group answers true;
   * a channel's subscribers are visible to its administrators only, so the
   * 聊天信息 panel asks before it draws the member grid.
   */
  canGetMembers(chatId: number): Promise<boolean>
  /**
   * 频道底栏: whether this account belongs to the channel, and whether joining
   * would file a request. Non-channels answer "joined" — only a previewed
   * channel can be read without subscribing.
   */
  chatJoinState(chatId: number): Promise<ChatJoinState>
  /** 加入 / 申请加入 for the channel bar (TDLib `joinChat`). */
  joinChannel(chatId: number): Promise<ChatJoinResult>
  /** Mutes / unmutes a chat and answers the refreshed summary. */
  setChatMuted(chatId: number, muted: boolean): Promise<ChatSummary>
  /** 置顶聊天 / 取消置顶; answers the refreshed summary. */
  setChatPinned(chatId: number, pinned: boolean): Promise<ChatSummary>
  /**
   * 清空聊天记录: TDLib deletes this account's copy of the history
   * (`revoke: false`), which is what WeChat's own clear does — the peers keep
   * theirs.
   */
  clearHistory(chatId: number): Promise<void>
  /**
   * 删除聊天: removes the chat from this account's list and its copy of the
   * history behind it (TDLib `deleteChatHistory` with
   * `remove_from_chat_list: true`, `revoke: false`). Never "delete for
   * everyone": that is `deleteChat`, which deletes the history for every member.
   */
  deleteChat(chatId: number): Promise<void>
  /** 标为未读 / 标为已读; answers the refreshed summary (the row reads the flag). */
  setChatUnread(chatId: number, unread: boolean): Promise<ChatSummary>
  /**
   * The 聊天信息 panel's member grid. Private chats answer with an empty list
   * (the panel draws the chat's own face); a channel's member list needs
   * administrator rights, so it degrades to an empty grid instead of failing.
   * `query` is 搜索群成员: the server searches the whole member table, not the page.
   */
  chatMembers(chatId: number, limit: number, query?: string): Promise<ChatMember[]>
  /** 群聊名称: renames the group; answers the refreshed summary. */
  setChatTitle(chatId: number, title: string): Promise<ChatSummary>
  /** 退出群聊: removes this account from the group and drops the chat. */
  leaveChat(chatId: number): Promise<void>
  /** 群公告: the newest pinned message, or `null` when the group has none. */
  pinnedMessage(chatId: number): Promise<ChatPinnedMessage | null>
  /**
   * 群二维码: a link a phone can open. `temporary` asks for the client's
   * short-lived code (a fresh 7-day link, where the account may create one);
   * otherwise a public username — or an existing permanent link — is reused.
   */
  inviteLink(chatId: number, temporary?: boolean): Promise<ChatInviteLink | null>
  /**
   * The account's Telegram address book (`getContacts`), one row per person.
   *
   * The 通讯录 is built from this, not from the chat list: a contact you never
   * wrote to has no private chat yet, and `openPrivateChat` creates it when the
   * card's 发消息 is pressed.
   */
  listContacts(): Promise<Contact[]>
  /** Online / last seen for one user; `null` when TDLib has no status to show. */
  userStatus(userId: number): Promise<PeerStatus | null>
  /** 资料卡: identity, 简介, 备注, 共同群聊 and the 拉黑 flag for one person. */
  userProfile(userId: number): Promise<UserProfile>
  /** 备注: writes Telegram's cloud-synced note and answers the refreshed card. */
  setUserNote(userId: number, note: string): Promise<UserProfile>
  /** 添加为联系人 / 删除联系人; answers the refreshed card. */
  setUserContact(userId: number, contact: boolean, sharePhone?: boolean): Promise<UserProfile>

  history(
    input: InvokeRequest<'messages:history'>,
  ): Promise<{ messages: Message[]; hasMore: boolean }>
  /**
   * A window centred on one message. Used instead of paging back from the newest
   * page when the target (a saved reading position or the unread boundary) is
   * deep: it reaches the row in one round trip instead of walking the gap.
   */
  historyAround(
    input: InvokeRequest<'messages:around'>,
  ): Promise<{ messages: Message[]; hasMore: boolean; hasNewer: boolean }>
  /** One page below an anchored window that does not reach the newest message. */
  historyNewer(
    input: InvokeRequest<'messages:newer'>,
  ): Promise<{ messages: Message[]; hasNewer: boolean }>
  /**
   * One page of a message's comment thread (design doc §9.8). `fromMessageId`
   * walks towards older comments; the page comes back ascending, like history.
   */
  comments(input: CommentQuery): Promise<CommentPage>
  /**
   * Whether the composer can be used for this thread's group. Mirrors the
   * official client, which composes it from membership + permissions instead of
   * asking the server (see `comment-access.ts`).
   */
  commentInfo(input: CommentTarget): Promise<CommentAccess>
  /** Joins the thread's discussion group, or sends a join request. */
  joinCommentGroup(input: CommentTarget): Promise<CommentJoinResult>
  /** Posts a comment into the message's thread and answers the sent row. */
  sendComment(input: CommentSendQuery): Promise<{ message: Message }>
  /** Changes this account's answer to a poll; an empty list retracts it. */
  votePoll(input: InvokeRequest<'messages:vote'>): Promise<void>
  /** Adds an answer option, when the poll says it may be added. */
  addPollOption(input: InvokeRequest<'messages:addPollOption'>): Promise<void>
  sendText(input: InvokeRequest<'messages:send'>): Promise<{ localId: string; message: Message }>
  editText(input: InvokeRequest<'messages:edit'>): Promise<Message>
  /**
   * 编辑说明: rewrites a media message's caption (TDLib `editMessageCaption`) and
   * answers the message the server stored. An empty caption removes it.
   */
  editCaption(input: InvokeRequest<'messages:editCaption'>): Promise<Message>
  deleteMessages(input: InvokeRequest<'messages:delete'>): Promise<void>
  forwardMessages(input: InvokeRequest<'messages:forward'>): Promise<void>
  markRead(input: InvokeRequest<'messages:read'>): Promise<void>
  /**
   * 对方正在输入: one `sendChatAction` for the chat. A failure is swallowed on
   * purpose — a typing ping must never raise the error bar.
   */
  sendTyping(chatId: number, typing: boolean): Promise<void>
  /**
   * 重试 a failed message (`messages:resend` → TDLib `resendMessages`). The new
   * states arrive as message ops; the answer carries nothing else.
   */
  resendMessages(chatId: number, messageIds: number[]): Promise<void>
  /**
   * TDLib's per-message capabilities (`getMessageProperties`, an offline call).
   * The context menu asks when it opens: the edit window, protected content and
   * the delete-for-me / delete-for-everyone split are TDLib's rules, not ours.
   */
  messageProperties(input: InvokeRequest<'messages:properties'>): Promise<MessageProperties>

  /** Sends a local file as a photo or a document (design doc §1: media upload). */
  sendMedia(input: InvokeRequest<'media:send'>): Promise<{ localId: string; message: Message }>
  /**
   * 相册: several local photos in one Telegram album (TDLib `sendMessageAlbum`).
   * The answer carries every item, in transcript order, each mapped like any
   * other message — the album id is what makes the transcript fold them.
   */
  sendAlbum(
    input: InvokeRequest<'media:sendAlbum'>,
  ): Promise<{ localIds: string[]; messages: Message[] }>
  sendSticker(input: InvokeRequest<'messages:sendSticker'>): Promise<{
    localId: string
    message: Message
  }>

  listStickerSets(): Promise<StickerSetSummary[]>
  getStickerSet(setId: string): Promise<StickerSet>
  /**
   * Custom emoji (Telegram Premium's inline sticker art) by the id its text
   * entity carries. Ids TDLib does not know are left out of the answer.
   */
  customEmojiStickers(ids: string[]): Promise<CustomEmojiSticker[]>

  searchGlobal(input: InvokeRequest<'search:global'>): Promise<ChatSummary[]>
  searchInChat(input: InvokeRequest<'search:inChat'>): Promise<Message[]>
  /**
   * Message text across chats, split by chat type: 'chat' asks TDLib for private
   * chats and groups (two streams merged), 'channel' for channels. The returned
   * cursor continues the page; empty offsets mean that stream is exhausted.
   */
  searchMessages(
    input: InvokeRequest<'search:messages'>,
  ): Promise<InvokeResponse<'search:messages'>>

  downloadFile(input: InvokeRequest<'media:download'>): Promise<{ path: string; url: string }>
  /**
   * Starts (or re-targets) a download at `offset` and answers where TDLib keeps
   * the bytes plus the size the file will have. This is the streaming half of
   * the `wx-media://` handler: video playback starts long before completion
   * (design doc §8.7), so the renderer needs a URL for a file that is not here
   * yet.
   */
  beginStream(input: { fileId: number; offset: number; priority: number }): Promise<{
    path: string
    size: number
  }>
  /** Contiguous bytes already on disk from `offset`; 0 while nothing arrived. */
  downloadedPrefix(input: { fileId: number; offset: number }): Promise<number>
  /** Stops a transfer no window is waiting for any more. */
  cancelDownload(fileId: number): Promise<void>

  setProxy(config: ProxyConfig | null): Promise<void>
  testProxy(config: ProxyConfig): Promise<ProxyTestResult>
}

/** Shared emitter plumbing for the concrete adapters. */
export class AdapterEmitter {
  private readonly listeners = new Set<AdapterListener>()

  onEvent(listener: AdapterListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  protected emit(event: AdapterEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // A broken listener must never take the protocol stream down.
      }
    }
  }
}
