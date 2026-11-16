import type {
  AuthState,
  ChatOp,
  ChatSummary,
  ConnectionState,
  Message,
  MessageOp,
  ProxyConfig,
  ProxyTestResult,
  Self,
} from '@wechatgram/protocol'

export type AdapterKind = 'mock' | 'tdlib'

/**
 * Domain events the adapter may emit. The IPC layer maps these onto `evt:*`
 * channels (§7.2) and batches them before they reach the renderer.
 */
export type AdapterEvent =
  | { type: 'auth'; state: AuthState }
  | { type: 'connection'; state: ConnectionState }
  | { type: 'chats'; ops: ChatOp[] }
  | { type: 'messages'; chatId: number; ops: MessageOp[] }
  | { type: 'typing'; chatId: number; userId: number; action: string; until: number }
  | { type: 'file'; fileId: number; downloaded: number; total: number; path?: string }

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
  getConnectionState(): ConnectionState
  submitPhone(phone: string): Promise<AuthState>
  submitCode(code: string): Promise<AuthState>
  submitPassword(password: string): Promise<AuthState>
  logout(): Promise<void>
  me(): Promise<Self>

  listChats(input: { limit: number; offset: number }): Promise<ChatSummary[]>
  getChat(chatId: number): Promise<ChatSummary>
  openChat(chatId: number): Promise<void>

  history(input: {
    chatId: number
    fromMessageId?: number
    limit: number
  }): Promise<{ messages: Message[]; hasMore: boolean }>
  sendText(input: {
    chatId: number
    text: string
    replyTo?: number
  }): Promise<{ localId: string; message: Message }>
  editText(input: { chatId: number; messageId: number; text: string }): Promise<Message>
  deleteMessages(input: { chatId: number; messageIds: number[]; forBoth: boolean }): Promise<void>
  forwardMessages(input: {
    fromChatId: number
    messageIds: number[]
    toChatId: number
  }): Promise<void>
  markRead(input: { chatId: number; upToMessageId: number }): Promise<void>

  searchGlobal(input: { q: string; limit: number }): Promise<ChatSummary[]>
  searchInChat(input: { chatId: number; q: string; fromMessageId?: number }): Promise<Message[]>

  downloadFile(input: { fileId: number; priority: number }): Promise<{ path: string }>
  uploadFile(input: { chatId: number; filePath: string }): Promise<{ fileId: number }>

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
