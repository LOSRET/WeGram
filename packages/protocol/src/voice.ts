import { z } from 'zod'

import { messageSchema } from './dto'

/**
 * 语音消息: a clip the renderer just recorded, on its way to Telegram.
 *
 * The bytes travel instead of a path (unlike `media:*`, whose files come from a
 * native dialog): the recorder lives in the renderer, and only main may touch the
 * filesystem. Main writes them to a temporary OGG, hands that path to TDLib as
 * `inputVoiceNote` and keeps the file until the upload has read it (see
 * `media/voice-file.ts`).
 *
 * The clip is OGG/Opus, the one container TDLib accepts for a *voice note*: a
 * WebM or an M4A would arrive as an ordinary audio message. Chromium records
 * WebM/Opus or nothing, so the renderer encodes Opus with WebCodecs (`AudioEncoder`)
 * and muxes the packets itself (`renderer/lib/voice/`) — no new dependency.
 */
export const voiceSendSchema = z.object({
  chatId: z.number().int(),
  /** base64 of the whole OGG file, ~4 KB per second at the recorder's bitrate. */
  audio: z.string().min(1).max(6_000_000),
  /** Whole seconds (TDLib `duration`); the recorder rounds up, never sends 0. */
  duration: z.number().int().min(1).max(60),
  replyTo: z.number().int().optional(),
})
export type VoiceSend = z.infer<typeof voiceSendSchema>

/** The row TDLib stored, mapped like any other send (the local id is main's). */
export const voiceSentSchema = z.object({
  localId: z.string(),
  message: messageSchema,
})
export type VoiceSent = z.infer<typeof voiceSentSchema>

export const voiceInvokeChannels = ['messages:sendVoice'] as const

export const voiceInvokeSchemas = {
  'messages:sendVoice': { request: voiceSendSchema, response: voiceSentSchema },
}
