import type { InvokeChannel } from '@wegram/protocol'

import { previewFiles } from './fixtures'

/**
 * The media channels of the browser preview, split out of `preview/index.ts`
 * when that file reached its 550-line budget.
 *
 * The preview has no filesystem and no `wx-media://`: every fixture file is a
 * data URL, so a download "returns" that URL and streaming plays the whole clip.
 * `media:open` is the only side effect, and it is injected so this module stays
 * free of `window`.
 */
type PreviewMediaPayload = Record<string, unknown>

export function handlePreviewMedia(
  channel: InvokeChannel,
  payload: PreviewMediaPayload,
  openExternal: (url: string) => void,
): unknown {
  const fileId = Number(payload['fileId'])
  switch (channel) {
    case 'media:pick':
      // The browser cannot hand us a local path; sending files needs Electron.
      return { paths: [] }
    case 'media:download': {
      const url = previewFiles()[fileId]
      if (!url) throw { code: 'internal', message: 'unknown preview file' }
      return { path: url, url }
    }
    case 'media:cancel':
      // Nothing to stop: the preview's files are data URLs.
      return undefined
    case 'media:stream': {
      // The preview cannot tail a download; it plays the whole fixture.
      const url = previewFiles()[fileId]
      if (!url) throw { code: 'internal', message: 'unknown preview file' }
      return { url }
    }
    case 'media:open': {
      const url = previewFiles()[fileId]
      if (url) openExternal(url)
      return undefined
    }
    case 'media:send':
    case 'media:sendAlbum':
      throw { code: 'not_implemented', message: '浏览器预览不能发送本地文件' }
    default:
      return undefined
  }
}
