import { createHash } from 'node:crypto'

/**
 * Maps opaque tokens to local files so the renderer never sees a filesystem path.
 *
 * Every path handed to `registerMediaFile` has been produced by the protocol
 * layer (a downloaded TDLib file) or by the mock adapter. The `wx-media://`
 * handler only resolves tokens from this map, so a crafted URL cannot read an
 * arbitrary file (§10: renderer file access stays behind a whitelist).
 */
const filesByToken = new Map<string, string>()

function tokenFor(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 32)
}

/** Registers a local file and returns its `wx-media://` URL. */
export function registerMediaFile(path: string): string {
  const token = tokenFor(path)
  filesByToken.set(token, path)
  return `wx-media://f/${token}`
}

export function resolveMediaToken(token: string): string | undefined {
  return filesByToken.get(token)
}
