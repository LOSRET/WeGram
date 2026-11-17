import type { ChatOp, ChatSummary } from '@wechatgram/protocol'

import { registerMediaFile } from '../../media/registry'
import type { Logger } from '../../util'
import type { TdObject } from './client'

/** Parallel chat-photo downloads; TDLib serialises internals anyway. */
const AVATAR_WORKERS = 4
/** Coalescing window for pushing finished avatars back to the renderer. */
const AVATAR_FLUSH_MS = 120

/** What the photo cache needs from the adapter; all state stays in this class. */
export interface AvatarCacheOptions {
  invoke(method: TdObject): Promise<any>
  logger: Logger
  /** Raw download, no event: a hundred thumbnails must not flood `evt:file`. */
  downloadFilePath(fileId: number, priority: number): Promise<{ path: string }>
  /** Announced download, used for our own photo so the UI sees it arrive. */
  downloadFile(fileId: number, priority: number): Promise<{ url: string }>
  fetchChatSummary(chatId: number): Promise<ChatSummary>
  /** One batched `chats` upsert per flush window. */
  emitChats(ops: ChatOp[]): void
  /** Our own avatar finished downloading. */
  onSelfAvatar(url: string): void
}

/**
 * Chat-photo cache.
 *
 * Downloads profile pictures with a small worker pool and pushes the finished
 * ones back as batched `chats` upserts. Only the small (thumbnail) size is
 * fetched; failures are remembered so a chat without a usable photo is not
 * retried.
 */
export class AvatarCache {
  /** chat id → `wx-media://` URL; read by `mapChat` through the mapper context. */
  readonly urls = new Map<number, string>()

  private readonly files = new Map<number, number>()
  /** Chats whose photo is known to be absent — never asked again. */
  private readonly misses = new Set<number>()
  /** Our own profile photo (the small size the rail uses). */
  private selfFileId: number | null = null
  private selfUrl: string | null = null
  private readonly queue: number[] = []
  /** Chats whose photo download is running — keeps list and updates from duplicating. */
  private readonly inFlight = new Set<number>()
  private workers = 0
  private flushTimer: NodeJS.Timeout | null = null
  private readonly pendingUpserts = new Set<number>()

  constructor(private readonly options: AvatarCacheOptions) {}

  /**
   * Downloads our own profile photo and reports it. Best effort: the account
   * still works without a picture.
   */
  async loadSelf(fileId: number): Promise<void> {
    if (this.selfFileId === fileId && this.selfUrl) return
    try {
      const { url } = await this.options.downloadFile(fileId, 32)
      this.selfFileId = fileId
      this.selfUrl = url
      this.options.onSelfAvatar(url)
    } catch (error) {
      this.options.logger.warn(
        `profile photo ${fileId} could not be downloaded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /** The cached own avatar for `fileId`, or undefined when it still has to be fetched. */
  selfAvatar(fileId: number): string | undefined {
    return this.selfFileId === fileId && this.selfUrl ? this.selfUrl : undefined
  }

  /** Queues photos for chats that do not have one yet and tops the pool up. */
  prefetch(chatIds: number[]): void {
    for (const chatId of chatIds) {
      if (this.urls.has(chatId)) continue
      if (this.misses.has(chatId)) continue
      if (this.inFlight.has(chatId)) continue
      if (this.queue.includes(chatId)) continue
      this.queue.push(chatId)
    }
    while (this.workers < AVATAR_WORKERS && this.queue.length > 0) {
      this.workers += 1
      void this.runWorker()
    }
  }

  /** A new photo replaces the old one: drop the cache, the caller prefetches again. */
  invalidate(chatId: number): void {
    this.files.delete(chatId)
    this.urls.delete(chatId)
    this.misses.delete(chatId)
  }

  private async runWorker(): Promise<void> {
    try {
      for (;;) {
        const chatId = this.queue.shift()
        if (chatId === undefined) return
        this.inFlight.add(chatId)
        try {
          await this.resolve(chatId)
        } finally {
          this.inFlight.delete(chatId)
        }
      }
    } finally {
      this.workers -= 1
    }
  }

  private async resolve(chatId: number): Promise<void> {
    try {
      const chat = await this.options.invoke({ _: 'getChat', chat_id: chatId })
      const fileId: number | undefined = chat.photo?.small?.id ?? chat.photo?.big?.id
      if (!fileId) {
        this.misses.add(chatId)
        return
      }
      if (this.files.get(chatId) === fileId && this.urls.has(chatId)) return
      const { path } = await this.options.downloadFilePath(fileId, 1)
      this.files.set(chatId, fileId)
      this.urls.set(chatId, registerMediaFile(path))
      this.queueUpsert(chatId)
    } catch (error) {
      this.misses.add(chatId)
      this.options.logger.warn(
        `chat ${chatId} photo could not be downloaded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /** Batches finished avatars into one `chats` event instead of one per chat. */
  private queueUpsert(chatId: number): void {
    this.pendingUpserts.add(chatId)
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flushUpserts()
    }, AVATAR_FLUSH_MS)
  }

  private async flushUpserts(): Promise<void> {
    const chatIds = [...this.pendingUpserts]
    this.pendingUpserts.clear()
    const ops: ChatOp[] = []
    for (const chatId of chatIds) {
      try {
        ops.push({ op: 'upsert', chat: await this.options.fetchChatSummary(chatId) })
      } catch {
        // Removed between download and flush.
      }
    }
    if (ops.length > 0) this.options.emitChats(ops)
  }
}
