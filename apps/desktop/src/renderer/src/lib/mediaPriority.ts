/**
 * TDLib download priorities (1–32, higher first) for everything the renderer
 * asks for.
 *
 * The official client's downloader is ordered by what the reader is looking at,
 * not by arrival order: the picture under the pointer must not wait behind a
 * thumbnail a screen away, and a thumbnail must not wait behind the full file it
 * is the placeholder for. Every value the renderer passes to `media:download`
 * comes from this ladder, so the order is read (and tested) in one place.
 */
export const MEDIA_PRIORITY = {
  /** 保存 / 复制 / 在文件夹中显示: the transfer the reader is acting on. */
  viewer: 32,
  /** A video being watched: main passes this to the streaming handler. */
  streaming: 28,
  /** A bubble's thumbnail: a few kilobytes, always first. */
  thumbVisible: 24,
  thumbNear: 18,
  /** A bubble's own picture, on screen / one screen away. */
  bubbleVisible: 16,
  bubbleNear: 8,
  /** Voice notes and effects that nothing on screen is waiting for. */
  idle: 8,
  /** An emoji's click sound: a few kilobytes, fetched on the first click. */
  sound: 4,
  /** The 预览 board, only opened on demand. */
  deck: 2,
} as const

/** A photo or video bubble's picture: on screen, or one screen away. */
export function bubblePriority(visible: boolean): number {
  return visible ? MEDIA_PRIORITY.bubbleVisible : MEDIA_PRIORITY.bubbleNear
}

/** Its thumbnail, which goes before the picture it stands in for. */
export function thumbPriority(visible: boolean): number {
  return visible ? MEDIA_PRIORITY.thumbVisible : MEDIA_PRIORITY.thumbNear
}
