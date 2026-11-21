import { createHash } from 'node:crypto'

/**
 * Maps opaque tokens to local files so the renderer never sees a filesystem path.
 *
 * Every path handed to `registerMediaFile` has been produced by the protocol
 * layer (a downloaded TDLib file) or by the mock adapter. The `wx-media://`
 * handler only resolves tokens from this map, so a crafted URL cannot read an
 * arbitrary file (§10: renderer file access stays behind a whitelist).
 *
 * A token is one of two things:
 * - a finished file on disk — served as a plain file stream with Range support;
 * - a file TDLib is still downloading — served incrementally, so a video can
 *   start playing before it has arrived (see `stream.ts`, design doc §8.7).
 */
export type MediaEntry = { kind: 'file'; path: string } | { kind: 'stream'; fileId: number }

const filesByToken = new Map<string, MediaEntry>()

function tokenFor(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 32)
}

/** Registers a local file and returns its `wx-media://` URL. */
export function registerMediaFile(path: string): string {
  const token = tokenFor(path)
  filesByToken.set(token, { kind: 'file', path })
  return `wx-media://f/${token}`
}

/**
 * Registers a file id TDLib is downloading and returns its `wx-media://` URL.
 *
 * The token outlives the download: once the file is complete the same URL keeps
 * working, because the handler then finds the whole file on disk.
 */
export function registerStreamFile(fileId: number): string {
  const token = tokenFor(`stream:${fileId}`)
  filesByToken.set(token, { kind: 'stream', fileId })
  return `wx-media://f/${token}`
}

export function resolveMediaToken(token: string): MediaEntry | undefined {
  return filesByToken.get(token)
}
