import { createReadStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'

import { protocol } from 'electron'

import type { TelegramAdapter } from '../telegram/adapter'
import { createLogger } from '../util'
import { resolveMediaToken } from './registry'
import { createRangeStream, type StreamFeed } from './stream'

const logger = createLogger('media-protocol')

export const MEDIA_SCHEME = 'wx-media'

/**
 * Downloads started by the scheme handler (video playback) sit just below the
 * viewer's own requests (保存 / 复制 ask at 32): the clip being watched outranks
 * the transcript's bubbles, and a save outranks the clip.
 */
const STREAM_PRIORITY = 28

/** What the handler needs from the rest of the app. */
export interface MediaProtocolDeps {
  /**
   * The adapter, once authorization created it. The scheme is registered before
   * that, so it is read through a getter instead of captured.
   */
  adapter: () => TelegramAdapter | null
}

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
 * Serves media at `wx-media://f/<token>`.
 *
 * Two kinds of token (see `registry.ts`):
 * - a finished file streams straight from disk, with Range support so `<video>`
 *   can seek (this is the old, unchanged path);
 * - a file TDLib is still downloading is *tail*ed: the handler reads the bytes
 *   that have arrived, waits for the rest and answers a normal 206, so playback
 *   starts seconds after the click instead of after the whole clip (§8.7).
 *
 * Nothing in here resolves a path from the request URL: a token that is not in
 * the registry is a 404, so a crafted URL cannot read an arbitrary file.
 */
export function installMediaProtocol(deps: MediaProtocolDeps): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const token = new URL(request.url).pathname.replace(/^\/+/, '')
    const entry = resolveMediaToken(token)
    if (!entry) return new Response('Unknown media file', { status: 404 })

    try {
      return entry.kind === 'stream'
        ? await streamResponse(request, entry.fileId, deps)
        : await fileResponse(request, entry.path)
    } catch (error) {
      logger.warn(
        `failed to serve media: ${error instanceof Error ? error.message : String(error)}`,
      )
      return new Response('Failed to read media file', { status: 500 })
    }
  })
}

interface ByteRange {
  /** Inclusive. */
  start: number
  /** Inclusive. */
  end: number
}

/** A Range a client asked for, before the size is known. */
interface RawRange {
  start?: number
  end?: number
}

/**
 * `bytes=<start>-<end>`. A missing start is a suffix range (the last N bytes,
 * how a browser fetches an mp4's index at the end of the file); a missing end
 * means "to the end of the file". Anything more exotic (a multi-range request)
 * is answered with the whole file, which is always valid.
 */
function parseRangeHeader(header: string | null): RawRange | 'invalid' | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const start = match[1] === '' ? undefined : Number(match[1])
  const end = match[2] === '' ? undefined : Number(match[2])
  if (start === undefined && end === undefined) return 'invalid'
  return {
    ...(start === undefined ? {} : { start }),
    ...(end === undefined ? {} : { end }),
  }
}

function resolveRange(
  raw: RawRange | 'invalid' | null,
  size: number,
): ByteRange | 'invalid' | null {
  if (!raw) return null
  if (raw === 'invalid' || size <= 0) return 'invalid'
  if (raw.start === undefined) {
    const suffix = raw.end ?? 0
    const start = Math.max(0, size - suffix)
    return start >= size ? 'invalid' : { start, end: size - 1 }
  }
  if (raw.start >= size) return 'invalid'
  const end = raw.end === undefined ? size - 1 : Math.min(raw.end, size - 1)
  return raw.start > end ? 'invalid' : { start: raw.start, end }
}

function mimeOf(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/** The headers every response carries; the scheme is CORS-enabled for TGS. */
function headersFor(type: string, extra: Record<string, string>): Record<string, string> {
  return {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'no-cache',
    'access-control-allow-origin': '*',
    ...extra,
  }
}

function unsatisfiable(size: number): Response {
  return new Response('Range not satisfiable', {
    status: 416,
    headers: { 'content-range': `bytes */${size}` },
  })
}

/**
 * A finished file: streams from disk instead of buffering it into memory, and
 * Range requests let `<video>` seek.
 */
async function fileResponse(request: Request, filePath: string): Promise<Response> {
  const info = await stat(filePath)
  if (!info.isFile()) return new Response('Not a file', { status: 404 })

  const type = mimeOf(filePath)
  const range = resolveRange(parseRangeHeader(request.headers.get('range')), info.size)
  if (range === 'invalid') return unsatisfiable(info.size)

  if (range) {
    const stream = Readable.toWeb(
      createReadStream(filePath, { start: range.start, end: range.end }),
    )
    return new Response(stream as ReadableStream, {
      status: 206,
      headers: headersFor(type, {
        'content-length': String(range.end - range.start + 1),
        'content-range': `bytes ${range.start}-${range.end}/${info.size}`,
      }),
    })
  }

  const stream = Readable.toWeb(createReadStream(filePath))
  return new Response(stream as ReadableStream, {
    status: 200,
    headers: headersFor(type, { 'content-length': String(info.size) }),
  })
}

/**
 * A file TDLib has not finished downloading. The range is answered with a
 * stream that follows the download: TDLib is told to fetch from the requested
 * offset (a seek starts a new read there), and the pump hands over every byte
 * that lands on disk, in order.
 */
async function streamResponse(
  request: Request,
  fileId: number,
  deps: MediaProtocolDeps,
): Promise<Response> {
  const adapter = deps.adapter()
  if (!adapter) return new Response('Media is not ready', { status: 503 })

  const raw = parseRangeHeader(request.headers.get('range'))
  const offset = raw && raw !== 'invalid' ? (raw.start ?? 0) : 0
  const { path, size } = await adapter.beginStream({ fileId, offset, priority: STREAM_PRIORITY })

  const range = resolveRange(raw, size)
  if (range === 'invalid') return unsatisfiable(size)
  const from = range ?? { start: 0, end: size - 1 }

  const handle = await open(path, 'r')
  const feed: StreamFeed = {
    size,
    available: (at) => adapter.downloadedPrefix({ fileId, offset: at }),
    read: async (at, length) => {
      const buffer = Buffer.allocUnsafe(length)
      const { bytesRead } = await handle.read(buffer, 0, length, at)
      return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead)
    },
    nudge: async (at) => {
      await adapter.beginStream({ fileId, offset: at, priority: STREAM_PRIORITY })
    },
  }

  const stream = createRangeStream(feed, from.start, from.end, request.signal, {
    onDone: () => {
      void handle.close().catch(() => undefined)
    },
  })

  // A Range request gets 206 (what the media element expects); a full read gets
  // a 200 of the still-arriving file.
  return new Response(stream, {
    status: range ? 206 : 200,
    headers: headersFor(mimeOf(path), {
      'content-length': String(from.end - from.start + 1),
      ...(range ? { 'content-range': `bytes ${from.start}-${from.end}/${size}` } : {}),
    }),
  })
}
