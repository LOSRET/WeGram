import type { ChatSummary, Message, Self } from '@wegram/protocol'

export const ME: Self = {
  id: 1000,
  firstName: '本地',
  lastName: '账号',
  username: 'wegram_demo',
  phone: '+86 000 0000 0000',
}

export const MOCK_CODE = '12345'
export const MOCK_PASSWORD = 'wegram'
export const MOCK_STICKER_SET_ID = 'mock-stickers'

/** Gradient pairs for the generated chat photos, picked by chat id. */
export const MOCK_AVATAR_COLORS: readonly (readonly [
  [number, number, number],
  [number, number, number],
])[] = [
  [
    [7, 193, 96],
    [12, 122, 78],
  ],
  [
    [96, 140, 250],
    [38, 62, 168],
  ],
  [
    [250, 128, 81],
    [188, 52, 92],
  ],
  [
    [168, 106, 232],
    [82, 48, 148],
  ],
  [
    [64, 178, 196],
    [24, 96, 128],
  ],
  [
    [236, 178, 74],
    [176, 96, 30],
  ],
]

export interface Fixture {
  chat: ChatSummary
  messages: Message[]
  /** Channels only: whether this account may post there (TDLib: admin right). */
  canPost?: boolean
  /**
   * Private chats only: the person's address-book identity (微信号 / phone).
   * The real adapter reads the same fields from TDLib's `getContacts` + `user`.
   */
  contact?: { username?: string; phone?: string; dcId?: number }
  /**
   * Comment threads by message id (design doc §9.8). TDLib keeps them in the
   * message thread — a channel's linked discussion group — not in the transcript,
   * so the mock does too; `messages:comments` serves them.
   */
  comments?: Record<number, Message[]>
  /**
   * Comment permissions for the mock's discussion groups (design doc §9.8).
   * Defaults to "joined and allowed"; a thread can require a join first.
   */
  commentAccess?: {
    joined?: boolean
    canComment?: boolean
    joinByRequest?: boolean
    slowModeSeconds?: number
    banned?: boolean
  }
}

export interface MockFile {
  fileId: number
  path: string
  url: string
  name: string
  size: number
  mimeType: string
  width?: number
  height?: number
}

export function at(minutesAgo: number): number {
  return Math.floor(Date.now() / 1000) - minutesAgo * 60
}

export function text(
  chatId: number,
  id: number,
  minutesAgo: number,
  body: string,
  outgoing: boolean,
): Message {
  return {
    id,
    chatId,
    senderId: outgoing ? ME.id : chatId * 10 + 7,
    senderName: outgoing ? '我' : '对方',
    outgoing,
    date: at(minutesAgo),
    kind: 'text',
    text: body,
  }
}

export function mimeFromPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'webm':
      return 'video/webm'
    case 'mp4':
      return 'video/mp4'
    case 'pdf':
      return 'application/pdf'
    case 'md':
      return 'text/markdown'
    case 'txt':
      return 'text/plain'
    default:
      return 'application/octet-stream'
  }
}
