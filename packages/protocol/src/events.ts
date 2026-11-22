import { z } from 'zod'

import { bootStateSchema } from './boot'
import { chatOpSchema } from './chat'
import { authStateSchema, connectionStateSchema, userAvatarSchema } from './dto'
import { messageOpSchema } from './message-ops'
import { peerStatusSchema } from './presence'
import { proxyStateSchema, sendKeySchema } from './settings'
import { appErrorSchema } from './errors'

/**
 * The event half of the IPC contract (design doc §7.2).
 *
 * Split out of `channels.ts` when that table reached its 550-line budget: the
 * command tables and the event tables are two concerns, and every event still has
 * to be declared here with its schema (the `satisfies` clause below is the
 * compile-time gate). The package index re-exports this module, so consumers keep
 * importing `EventChannel` / `eventChannels` from `@wegram/protocol`.
 */

/** Every event main pushes to the renderer is sequenced, so gaps are detectable (§7.2). */
const envelope = <S extends z.ZodType>(payload: S) => z.object({ seq: z.number().int(), payload })

export const eventChannels = [
  'evt:auth',
  /** The startup phase changed; terminal kinds stop the login spinner. */
  'evt:boot',
  'evt:connection',
  /**
   * The resolved theme changed: 设置 → 外观, or the OS while the preference is
   * "follow the system". Every window repaints from it (design doc §9.11.4).
   */
  'evt:theme',
  /** 发送消息's Enter rule changed; the shell's composers read it from here. */
  'evt:settings',
  'evt:chats',
  'evt:messages',
  /**
   * Profile photos of other people that finished downloading after their
   * messages were mapped (a group's senders, the peer of a private chat).
   */
  'evt:avatars',
  /** Someone's online / last-seen state changed (a private chat's header). */
  'evt:status',
  'evt:typing',
  'evt:file',
  /** TDLib reloaded the installed sticker sets; the picker refetches them. */
  'evt:stickerSets',
  /**
   * The viewer asked the shell to show a message (定位到聊天位置). Main raises the
   * shell window first, then publishes this; the viewer window stays open.
   */
  'evt:locate',
  'evt:error',
  /**
   * The proxy in force changed by itself — the operating system's proxy appeared,
   * disappeared or started answering again. 网络与代理 and the login modal repaint
   * from it; a manual change answers its own IPC call instead.
   */
  'evt:proxy',
] as const

export type EventChannel = (typeof eventChannels)[number]

export const eventSchemas = {
  'evt:auth': envelope(authStateSchema),
  'evt:boot': envelope(bootStateSchema),
  'evt:connection': envelope(connectionStateSchema),
  'evt:theme': envelope(z.object({ theme: z.enum(['light', 'dark']) })),
  'evt:settings': envelope(z.object({ sendKey: sendKeySchema })),
  'evt:chats': envelope(z.object({ ops: z.array(chatOpSchema) })),
  'evt:messages': envelope(z.object({ chatId: z.number().int(), ops: z.array(messageOpSchema) })),
  'evt:avatars': envelope(z.object({ avatars: z.array(userAvatarSchema) })),
  'evt:status': envelope(z.object({ userId: z.number().int(), status: peerStatusSchema })),
  'evt:typing': envelope(
    z.object({
      chatId: z.number().int(),
      userId: z.number().int(),
      action: z.string(),
      until: z.number(),
    }),
  ),
  'evt:file': envelope(
    z.object({
      fileId: z.number().int(),
      downloaded: z.number(),
      total: z.number(),
      /** Set once the file is fully local; a `wx-media://` URL for the renderer. */
      url: z.string().optional(),
      /** Bytes are going up rather than down (media being sent). */
      uploading: z.boolean().optional(),
      completed: z.boolean().optional(),
    }),
  ),
  'evt:stickerSets': envelope(z.object({})),
  'evt:locate': envelope(z.object({ chatId: z.number().int(), messageId: z.number().int() })),
  'evt:error': envelope(appErrorSchema),
  'evt:proxy': envelope(proxyStateSchema),
} satisfies Record<EventChannel, z.ZodType>

export type EventEnvelope<C extends EventChannel> = z.output<(typeof eventSchemas)[C]>
export type EventPayload<C extends EventChannel> = EventEnvelope<C>['payload']
