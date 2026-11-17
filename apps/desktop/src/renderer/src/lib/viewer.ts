import type { Message, ViewerItem } from '@wechatgram/protocol'

import { useAppStore } from '../store/useAppStore'
import { errorMessage, invoke } from './ipc'

/** What the standalone viewer can show; both kinds share one window. */
export type ViewerKind = 'photo' | 'video'

/**
 * Which messages become one strip of the viewer (pure).
 *
 * The viewer pages through the media of one kind that is already loaded in that
 * chat — the strip the reader can see — so it never has to ask the adapter for
 * history of its own. `messageId` names the item that was clicked and becomes the
 * start index; a message that is not in the strip means "do not open".
 */
export function buildViewerStrip(
  messages: readonly Message[],
  kind: ViewerKind,
  messageId: number,
): { items: ViewerItem[]; index: number } | null {
  const items: ViewerItem[] = []
  let index = -1

  for (const message of messages) {
    const media = message.media
    if (message.kind !== kind || !media || media.fileId <= 0) continue
    if (message.id === messageId) index = items.length
    items.push({
      fileId: media.fileId,
      messageId: message.id,
      kind,
      ...(media.fileName ? { fileName: media.fileName } : {}),
      ...(media.width ? { width: media.width } : {}),
      ...(media.height ? { height: media.height } : {}),
      ...(media.size ? { size: media.size } : {}),
      ...(kind === 'video' && media.duration ? { duration: media.duration } : {}),
      ...(media.minithumbnail ? { minithumbnail: media.minithumbnail } : {}),
    })
  }

  if (items.length === 0 || index < 0) return null
  return { items, index }
}

function openViewer(chatId: number, messageId: number, kind: ViewerKind): void {
  const store = useAppStore.getState()
  const strip = buildViewerStrip(store.messagesByChat[chatId] ?? [], kind, messageId)
  if (!strip) return
  void invoke('viewer:open', strip).catch((error) => store.setError(errorMessage(error)))
}

/** Opens the standalone viewer on one photo of a conversation. */
export function openPhotoViewer(chatId: number, messageId: number): void {
  openViewer(chatId, messageId, 'photo')
}

/** Opens the same window on one video — the client keeps both in 图片和视频. */
export function openVideoViewer(chatId: number, messageId: number): void {
  openViewer(chatId, messageId, 'video')
}
