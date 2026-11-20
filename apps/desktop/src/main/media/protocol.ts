import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'

import { protocol } from 'electron'

import { createLogger } from '../util'
import { resolveMediaToken } from './registry'

const logger = createLogger('media-protocol')

export const MEDIA_SCHEME = 'wx-media'

/**
 * Must run before `app.whenReady()`: a custom scheme that is not privileged
 * cannot be fetched by `<img>`/`<video>` or by `fetch()` from the renderer.
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        /**
         * TGS is `fetch()`ed by the renderer (then gunzipped in `lib/tgs.ts`), and a
         * renderer loaded from `file://` is a different origin. Without this Chromium
         * refuses the request outright ("Cross origin requests are only supported for
         * protocol schemes…") and every TGS sticker — animated emoji included — falls
         * back to its emoji glyph.
         */
        corsEnabled: true,
      },
    },
  ])
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.tgs': 'application/gzip',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
}

/**
 * Serves already-downloaded media at `wx-media://f/<token>`.
 *
 * Streams instead of buffering: a video or a large document is never copied into
 * memory just because the renderer asks for it, and Range requests let `<video>`
 * seek. Anything outside the token map is a 404 — there is no path arithmetic on
 * the request URL at all.
 */
export function installMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const token = new URL(request.url).pathname.replace(/^\/+/, '')
    const filePath = resolveMediaToken(token)
    if (!filePath) return new Response('Unknown media file', { status: 404 })

    try {
      const info = await stat(filePath)
      if (!info.isFile()) return new Response('Not a file', { status: 404 })

      const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
      const range = request.headers.get('range')
      const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null

      if (match) {
        const start = match[1] ? Number(match[1]) : 0
        const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1
        if (start > end || start >= info.size) {
          return new Response('Range not satisfiable', {
            status: 416,
            headers: { 'content-range': `bytes */${info.size}` },
          })
        }
        const stream = Readable.toWeb(createReadStream(filePath, { start, end }))
        return new Response(stream as ReadableStream, {
          status: 206,
          headers: {
            'content-type': type,
            'accept-ranges': 'bytes',
            'content-length': String(end - start + 1),
            'content-range': `bytes ${start}-${end}/${info.size}`,
            'cache-control': 'no-cache',
            // The scheme is CORS-enabled so the renderer may fetch TGS bytes.
            'access-control-allow-origin': '*',
          },
        })
      }

      const stream = Readable.toWeb(createReadStream(filePath))
      return new Response(stream as ReadableStream, {
        status: 200,
        headers: {
          'content-type': type,
          'accept-ranges': 'bytes',
          'content-length': String(info.size),
          'cache-control': 'no-cache',
          // The scheme is CORS-enabled so the renderer may fetch TGS bytes.
          'access-control-allow-origin': '*',
        },
      })
    } catch (error) {
      logger.warn(
        `failed to serve media: ${error instanceof Error ? error.message : String(error)}`,
      )
      return new Response('Failed to read media file', { status: 500 })
    }
  })
}
