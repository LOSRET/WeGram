import type { ChatInviteLink, ChatMember, ChatSummary, QrInfo } from '@wegram/protocol'

/** What the QR handlers need from the preview session. */
export interface PreviewQrStore {
  chats: ChatSummary[]
  members(chatId: number): ChatMember[]
  invite(chatId: number, temporary: boolean): ChatInviteLink | null
  readonly theme: 'light' | 'dark'
}

/**
 * The preview's stand-in for the 群二维码 window (design doc §9.9).
 *
 * The real app opens a second BrowserWindow; a single-page preview boots the same
 * renderer on `#qr`, so `qr:open` swaps the hash and `qr:info` answers from the
 * fixture. The three actions need main (clipboard bitmap, save dialog, photo
 * send), so they resolve without side effects here — enough to click the sheet
 * through in the browser.
 */
export function handlePreviewQr(
  channel: 'qr:open' | 'qr:info' | 'qr:copy' | 'qr:save' | 'qr:share' | 'qr:close',
  query: Record<string, unknown>,
  store: PreviewQrStore,
): QrInfo | null | undefined {
  switch (channel) {
    case 'qr:open': {
      // The route is chosen once, in main.tsx: a hash change alone would not
      // re-render it, so the preview reloads into the QR route.
      window.location.hash = `qr?chat=${Number(query.chatId)}`
      window.location.reload()
      return undefined
    }
    case 'qr:close': {
      window.location.hash = ''
      window.location.reload()
      return undefined
    }
    case 'qr:info': {
      const target = /chat=(\d+)/.exec(window.location.hash)?.[1]
      const chat = store.chats.find((item) => item.id === Number(target)) ?? store.chats[0]
      if (!chat) throw { code: 'internal', message: 'preview has no chats' }
      return {
        chat,
        members: store.members(chat.id),
        invite: store.invite(chat.id, true),
        theme: store.theme,
      }
    }
    case 'qr:copy':
    case 'qr:share':
      return undefined
    case 'qr:save':
      return null
  }
}
