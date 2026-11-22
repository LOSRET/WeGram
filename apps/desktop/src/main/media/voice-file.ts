import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createLogger } from '../util'

const logger = createLogger('voice')

/**
 * Where a recorded 语音消息 lives between the renderer and TDLib.
 *
 * TDLib uploads from a path, so main materialises the base64 the renderer sent.
 * The file has to outlive `sendMessage`'s answer: that answer is the *pending*
 * row and the upload reads the file while it runs. Deleting it immediately would
 * race the upload, so recordings stay in `userData/voice` and are pruned at the
 * next start once they are old enough that no live upload can still want them —
 * the 群二维码 转发 path can delete at once only because a small picture finishes
 * uploading inside the call's shadow.
 */

/** Files older than this are pruned at startup; far past any upload. */
export const VOICE_FILE_MAX_AGE_MS = 6 * 60 * 60 * 1000

export function voiceFilePath(dir: string, now = Date.now()): string {
  const unique = Math.random().toString(36).slice(2, 10)
  return join(dir, `voice-${now}-${unique}.ogg`)
}

/** Writes one recording and answers the path TDLib will be given. */
export async function writeVoiceNote(dir: string, audioBase64: string): Promise<string> {
  const path = voiceFilePath(dir)
  await mkdir(dir, { recursive: true })
  await writeFile(path, Buffer.from(audioBase64, 'base64'))
  return path
}

/**
 * Which files the prune deletes: anything with our extension older than the
 * limit. Pure, so the age rule is testable without a filesystem.
 */
export function staleVoiceFiles(
  entries: Array<{ name: string; mtimeMs: number }>,
  now: number,
): string[] {
  return entries
    .filter((entry) => entry.name.endsWith('.ogg') && now - entry.mtimeMs > VOICE_FILE_MAX_AGE_MS)
    .map((entry) => entry.name)
}

/**
 * Deletes the recordings no upload can still be reading. Best-effort at startup:
 * a missing directory (nobody has recorded anything yet) and an unreadable entry
 * are both fine and must not stop the app from booting.
 */
export async function pruneVoiceNotes(dir: string, now = Date.now()): Promise<number> {
  try {
    const names = (await readdir(dir)).filter((name) => name.endsWith('.ogg'))
    const entries: Array<{ name: string; mtimeMs: number }> = []
    for (const name of names) {
      entries.push({ name, mtimeMs: (await stat(join(dir, name))).mtimeMs })
    }
    let removed = 0
    for (const name of staleVoiceFiles(entries, now)) {
      await rm(join(dir, name), { force: true })
      removed += 1
    }
    return removed
  } catch (error) {
    logger.warn(
      'voice recording cleanup skipped:',
      error instanceof Error ? error.message : String(error),
    )
    return 0
  }
}
