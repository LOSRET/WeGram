import type { InvokeRequest } from '@wegram/protocol'

/** What the picker was asked for (the WeChat 图片与视频 entry, or a document). */
export type PickedMediaKind = InvokeRequest<'media:pick'>['kind']
/** What one picked file becomes when it is sent. */
export type AttachMediaKind = InvokeRequest<'media:send'>['kind']

/**
 * Extensions that become a video *message*. The picker filters to these, and a
 * file the reader chose through 发送文件 is always a document — picking a clip
 * there means "keep it as a file", which is what WeChat's 文件 does too.
 */
const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv'])

/**
 * Which send a picked path becomes.
 *
 * The OS dialog cannot say what a file is beyond its name, so the extension is
 * the whole rule — and TDLib's own fallback covers it: a clip whose metadata
 * cannot be read (an MKV, a damaged MP4) is sent as a document rather than a
 * broken video bubble, so a mislabelled file degrades instead of failing.
 */
export function sendKindForPath(filePath: string, picked: PickedMediaKind): AttachMediaKind {
  if (picked === 'file') return 'file'
  const dot = filePath.lastIndexOf('.')
  const extension = dot >= 0 ? filePath.slice(dot).toLowerCase() : ''
  return VIDEO_EXTENSIONS.has(extension) ? 'video' : 'photo'
}
