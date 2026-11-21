import type { Message, ViewerItem } from '@wegram/protocol'

import { useAppStore } from '../store/useAppStore'
import { errorMessage, invoke } from './ipc'

/** What the standalone viewer can show; both kinds share one window. */
export type ViewerKind = 'photo' | 'video'

/**
 * Which messages become one strip of the viewer (pure).
 *
 * The viewer pages through the media of one kind that is already loaded in the
 * pane the reader clicked in — the strip the reader can see — so it never has to
 * ask the adapter for history of its own. `messageId` names the item that was
 * clicked and becomes the start index; a message that is not in the strip means
 * "do not open".
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
      ...(message.canBeSaved === undefined ? {} : { canBeSaved: message.canBeSaved }),
      ...(kind === 'video' && media.duration ? { duration: media.duration } : {}),
      ...(media.minithumbnail ? { minithumbnail: media.minithumbnail } : {}),
      ...(media.thumbFileId ? { thumbFileId: media.thumbFileId } : {}),
      // The window picks its own variant: the box it paints into is not the
      // bubble's, so the choice must travel with the item, not be made here.
      ...(media.sizes ? { sizes: media.sizes } : {}),
    })
  }

  if (items.length === 0 || index < 0) return null
  return { items, index }
}

/**
 * `source` is the pane's own list when the clicked row is not part of the open
 * chat's transcript (the comment panel — see `lib/viewerSource.ts`); `null` or
 * omitted keeps the usual "the chat store's history" reading.
 */
function openViewer(
  chatId: number,
  messageId: number,
  kind: ViewerKind,
  source?: readonly Message[] | null,
): void {
  const store = useAppStore.getState()
  const messages = source ?? store.messagesByChat[chatId] ?? []
  const strip = buildViewerStrip(messages, kind, messageId)
  if (!strip) return
  // The conversation travels with the strip: 定位到聊天位置 in the viewer hands it
  // back to the shell, which has to know which chat to open.
  void invoke('viewer:open', { chatId, ...strip }).catch((error) =>
    store.setError(errorMessage(error)),
  )
}

/** Opens the standalone viewer on one photo of a conversation. */
export function openPhotoViewer(
  chatId: number,
  messageId: number,
  source?: readonly Message[] | null,
): void {
  openViewer(chatId, messageId, 'photo', source)
}

/** Opens the same window on one video — the client keeps both in 图片和视频. */
export function openVideoViewer(
  chatId: number,
  messageId: number,
  source?: readonly Message[] | null,
): void {
  openViewer(chatId, messageId, 'video', source)
}
