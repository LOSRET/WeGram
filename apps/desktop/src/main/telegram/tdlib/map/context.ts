/**
 * The cached lookups a mapper may read.
 *
 * TDLib reuses ids everywhere (`messageSenderChat` is a chat id, a chat title is
 * only known from `getChat`) and avatars arrive after the message does, so the
 * mappers read from the adapter's caches. Passing that state explicitly keeps
 * them testable: a unit test can hand in plain maps and stub resolvers — no
 * TDLib client, no Electron.
 */
export interface MapperContext {
  /** Chat titles, used for `messageSenderChat` (channel posts, anonymous admins). */
  readonly chatTitles: Map<number, string>
  /** Chat photos: chat id → `wx-media://` URL. */
  readonly chatAvatarUrls: Map<number, string>
  /** Sticker file id → pixel size, so the picker can send without a lookup. */
  readonly stickerSizes: Map<number, { width: number; height: number }>
  /** Cached sender name; falls back to one `getUser` round trip. */
  resolveUserName(userId: number): Promise<string>
  /** Cached chat title; falls back to one `getChat` round trip. */
  resolveChatTitle(chatId: number): Promise<string>
}
