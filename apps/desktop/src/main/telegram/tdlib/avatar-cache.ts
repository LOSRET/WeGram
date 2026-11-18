import type { ChatOp, ChatSummary, UserAvatar } from '@wegram/protocol'

import { registerMediaFile } from '../../media/registry'
import type { Logger } from '../../util'
import type { TdObject } from './client'

/** Parallel photo downloads; TDLib serialises internals anyway. */
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
  /** One batched `avatars` event per flush window. */
  emitAvatars(avatars: UserAvatar[]): void
  /** Our own avatar finished downloading. */
  onSelfAvatar(url: string): void
}

/**
 * One queued photo. Chats and people share the pool on purpose: a group whose
 * senders are being resolved must not starve the chat list, nor the other way
 * round, and the tunnel is the bottleneck both are competing for.
 */
interface AvatarTask {
  kind: 'chat' | 'user'
  id: number
}

function taskKey(task: AvatarTask): string {
  return `${task.kind}:${task.id}`
}

/**
 * Profile-photo cache for chats **and** users.
 *
 * Downloads pictures with a small worker pool (small/thumbnail size only) and
 * pushes the results back: a chat photo becomes a batched `chats` upsert, a
 * person's photo a batched `avatars` event, because a sender already rendered in
 * a transcript has to gain its face without the page being refetched. Failures —
 * including "this subject has no photo" — are remembered so they are not retried
 * for the rest of the session.
 */
export class AvatarCache {
  /** chat id → `wx-media://` URL; read by `mapChat` through the mapper context. */
  readonly urls = new Map<number, string>()
  /** user id → `wx-media://` URL; read by `mapMessage` through the mapper context. */
  readonly userUrls = new Map<number, string>()

  /** `kind:id` → file id of the photo currently cached. */
  private readonly files = new Map<string, number>()
  /** Subjects whose photo is known to be absent — never asked again. */
  private readonly misses = new Set<string>()
  /** Our own profile photo (the small size the rail uses). */
  private selfFileId: number | null = null
  private selfUrl: string | null = null
  /**
   * Two queues, people first: the reader is looking at the transcript, and the
   * 40 px chat rows can wait ~2 s. Without this a group opened right after
   * start-up lines up behind the first page of chat photos (measured: 45 senders
   * behind 60 chat pictures = initials on screen for the whole download).
   */
  private readonly userQueue: AvatarTask[] = []
  private readonly chatQueue: AvatarTask[] = []
  /** Keys sitting in a queue; keeps the dedupe O(1) instead of scanning it. */
  private readonly queued = new Set<string>()
  /** Photos whose download is running — keeps list and updates from duplicating. */
  private readonly inFlight = new Set<string>()
  private workers = 0
  private flushTimer: NodeJS.Timeout | null = null
  private readonly pendingUpserts = new Set<number>()
  private readonly pendingAvatars = new Map<number, string>()

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
    this.enqueue(chatIds.map((id) => ({ kind: 'chat' as const, id })))
  }

  /** Queues photos for people who posted (or whose conversation is open). */
  prefetchUsers(userIds: number[]): void {
    this.enqueue(userIds.map((id) => ({ kind: 'user' as const, id })))
  }

  /** A new photo replaces the old one: drop the cache, the caller prefetches again. */
  invalidate(chatId: number): void {
    const key = taskKey({ kind: 'chat', id: chatId })
    this.files.delete(key)
    this.urls.delete(chatId)
    this.misses.delete(key)
  }

  /**
   * `updateUser` for somebody else: refetch only when the picture actually
   * changed. TDLib sends that update for name changes too, and a blind refetch
   * would re-download every contact's photo on a sync burst.
   */
  syncUserPhoto(userId: number, fileId: number | undefined): void {
    const key = taskKey({ kind: 'user', id: userId })
    if (fileId === undefined) {
      if (!this.userUrls.has(userId)) return
      this.userUrls.delete(userId)
      this.files.delete(key)
      this.misses.add(key)
      return
    }
    if (this.files.get(key) === fileId && this.userUrls.has(userId)) return
    this.userUrls.delete(userId)
    this.files.delete(key)
    this.misses.delete(key)
    this.enqueue([{ kind: 'user', id: userId }])
  }

  private enqueue(tasks: AvatarTask[]): void {
    for (const task of tasks) {
      const key = taskKey(task)
      if (this.misses.has(key)) continue
      if (task.kind === 'chat' ? this.urls.has(task.id) : this.userUrls.has(task.id)) continue
      if (this.inFlight.has(key) || this.queued.has(key)) continue
      if (task.kind === 'user') this.userQueue.push(task)
      else this.chatQueue.push(task)
      this.queued.add(key)
    }
    while (
      this.workers < AVATAR_WORKERS &&
      (this.userQueue.length > 0 || this.chatQueue.length > 0)
    ) {
      this.workers += 1
      void this.runWorker()
    }
  }

  private async runWorker(): Promise<void> {
    try {
      for (;;) {
        const task = this.userQueue.shift() ?? this.chatQueue.shift()
        if (task === undefined) return
        const key = taskKey(task)
        this.queued.delete(key)
        this.inFlight.add(key)
        try {
          await this.resolve(task)
        } finally {
          this.inFlight.delete(key)
        }
      }
    } finally {
      this.workers -= 1
    }
  }

  private async resolve(task: AvatarTask): Promise<void> {
    const key = taskKey(task)
    try {
      const fileId = await this.photoFileId(task)
      if (!fileId) {
        this.misses.add(key)
        return
      }
      const { path } = await this.options.downloadFilePath(fileId, 1)
      this.files.set(key, fileId)
      const url = registerMediaFile(path)
      if (task.kind === 'chat') {
        this.urls.set(task.id, url)
        this.pendingUpserts.add(task.id)
      } else {
        this.userUrls.set(task.id, url)
        this.pendingAvatars.set(task.id, url)
      }
      this.scheduleFlush()
    } catch (error) {
      this.misses.add(key)
      this.options.logger.warn(
        `${task.kind} ${task.id} photo could not be downloaded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /** Where the small photo of a chat or a user lives in TDLib's file table. */
  private async photoFileId(task: AvatarTask): Promise<number | undefined> {
    if (task.kind === 'chat') {
      const chat = await this.options.invoke({ _: 'getChat', chat_id: task.id })
      return chat?.photo?.small?.id ?? chat?.photo?.big?.id
    }
    const user = await this.options.invoke({ _: 'getUser', user_id: task.id })
    return user?.profile_photo?.small?.id ?? user?.profile_photo?.big?.id
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, AVATAR_FLUSH_MS)
  }

  /** Batches finished avatars into one event per kind instead of one per subject. */
  private async flush(): Promise<void> {
    const chatIds = [...this.pendingUpserts]
    this.pendingUpserts.clear()
    if (chatIds.length > 0) {
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

    const avatars: UserAvatar[] = [...this.pendingAvatars].map(([userId, url]) => ({ userId, url }))
    this.pendingAvatars.clear()
    if (avatars.length > 0) this.options.emitAvatars(avatars)
  }
}
