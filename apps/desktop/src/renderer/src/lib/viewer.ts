import type { Message, MessageMedia, ViewerItem } from '@wegram/protocol'

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
      ...viewerItemFromMedia(kind, media),
      messageId: message.id,
      ...(message.canBeSaved === undefined ? {} : { canBeSaved: message.canBeSaved }),
    })
  }

  if (items.length === 0 || index < 0) return null
  return { items, index }
}

/**
 * The viewer's item for one media file, from the DTO alone.
 *
 * A chat bubble's item also carries the message it came from (its message id) and
 * its save capability; a page's media belongs to no message (§8.9), so what the
 * window actually needs — the file, its size table, its thumbnail and the animation
 * flag — is mapped here once, for both callers.
 */
export function viewerItemFromMedia(kind: ViewerKind, media: MessageMedia): ViewerItem {
  return {
    fileId: media.fileId,
    kind,
    ...(media.fileName ? { fileName: media.fileName } : {}),
    ...(media.width ? { width: media.width } : {}),
    ...(media.height ? { height: media.height } : {}),
    ...(media.size ? { size: media.size } : {}),
    ...(kind === 'video' && media.duration ? { duration: media.duration } : {}),
    // The viewer loops animation media instead of painting a transport bar.
    ...(kind === 'video' && media.isAnimation ? { isAnimation: true } : {}),
    ...(media.minithumbnail ? { minithumbnail: media.minithumbnail } : {}),
    ...(media.thumbFileId ? { thumbFileId: media.thumbFileId } : {}),
    // The window picks its own variant: the box it paints into is not the
    // bubble's, so the choice must travel with the item, not be made here.
    ...(media.sizes ? { sizes: media.sizes } : {}),
  }
}

/**
 * `source` is the pane's own list when the clicked row is not part of the open
 * chat's transcript (the comment panel — see `lib/viewerSource.ts`); `null` or
 * omitted keeps the usual "the chat store's history" reading.
 */
function openViewer(
  chatId: number | undefined,
  messageId: number,
  kind: ViewerKind,
  source?: readonly Message[] | null,
): void {
  const store = useAppStore.getState()
  const messages = source ?? (chatId === undefined ? [] : (store.messagesByChat[chatId] ?? []))
  const strip = buildViewerStrip(messages, kind, messageId)
  if (!strip) return
  // The conversation travels with the strip: 定位到聊天位置 in the viewer hands it
  // back to the shell, which has to know which chat to open.
  void invoke('viewer:open', { chatId, ...strip }).catch((error) =>
    store.setError(errorMessage(error)),
  )
}

/**
 * The part of a strip one viewer window takes, centred on the clicked item.
 *
 * A chat's strip is bounded by what the transcript has loaded; a 即时预览 page is not
 * — a gallery page can hold hundreds of pictures, and `viewerItemsSchema` caps one
 * window at 200 items. Keeping the clicked picture inside the window is the point, so
 * a long page still opens on the picture the reader clicked.
 */
export function viewerWindow<T>(
  items: readonly T[],
  index: number,
  max = 200,
): { items: T[]; index: number } {
  if (items.length <= max) return { items: [...items], index }
  const start = Math.min(Math.max(0, index - Math.floor(max / 2)), items.length - max)
  return { items: items.slice(start, start + max), index: index - start }
}

/**
 * Opens the viewer on a strip that belongs to no chat: 即时预览's page media (§8.9).
 *
 * A page's blocks carry no message id, and the same file appears once, so the
 * clicked picture is resolved by its file id. Sending no chatId is what tells the
 * viewer there is no 定位到聊天位置 — the alternative, a magic 0, would try to open
 * conversation 0.
 */
export function openPageViewer(items: readonly ViewerItem[], fileId: number): void {
  const clicked = items.findIndex((item) => item.fileId === fileId)
  if (clicked < 0) return
  const strip = viewerWindow(items, clicked)
  void invoke('viewer:open', { items: strip.items, index: strip.index }).catch((error) =>
    useAppStore.getState().setError(errorMessage(error)),
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
