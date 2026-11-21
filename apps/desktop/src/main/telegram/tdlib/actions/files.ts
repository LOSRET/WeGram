import { AppError } from '@wegram/protocol'

import { registerMediaFile } from '../../../media/registry'
import type { TdObject } from '../client'
import type { ActionDeps } from './deps'

/**
 * Downloads a file raw, without announcing it. Attachments go through
 * `downloadFile()` below (which emits `evt:file` for the progress UI); avatars
 * use this one so a hundred preview pictures do not flood the store.
 */
export async function fetchFilePath(
  deps: Pick<ActionDeps, 'invoke'>,
  fileId: number,
  priority: number,
): Promise<{ path: string; file: TdObject }> {
  const file = await deps.invoke({
    _: 'downloadFile',
    file_id: fileId,
    priority,
    offset: 0,
    limit: 0,
    synchronous: true,
  })
  const path: string | undefined = file?.local?.path
  if (!path) throw new AppError('internal', `File ${fileId} downloaded but path is empty`)
  return { path, file }
}

/** How long a transfer that has just been queued gets to report its bytes. */
const STREAM_READY_TIMEOUT_MS = 4_000
const STREAM_READY_POLL_MS = 100

/** What a stream needs from a `file`, or `null` while TDLib has not filled it in yet. */
function streamable(file: TdObject | undefined): { path: string; size: number } | null {
  const path: unknown = file?.local?.path
  const size = Number(file?.expected_size ?? file?.size ?? 0)
  if (typeof path !== 'string' || path.length === 0 || !(size > 0)) return null
  return { path, size }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Begins (or re-targets) a download and answers where its bytes live.
 *
 * `synchronous: false` is the point: the call returns as soon as TDLib has
 * queued the transfer. Sending it again with a different `offset` is how a seek
 * works — TDLib drops the previous range and fetches from there.
 *
 * That answer is the file *as it was before* the transfer was queued, though: a
 * clip nobody has downloaded yet comes back with an empty `local.path` (and a
 * zero `expected_size` until TDLib has read the header), and both only arrive
 * with the following `updateFile`. Failing on the first answer made every cold
 * video answer "cannot be streamed yet"; the viewer waits for the settled state
 * instead (measured on the real account: a 0:39 clip reported its path 500 ms
 * after the click, so the timeout only covers a slow round-trip).
 */
export async function beginStream(
  deps: Pick<ActionDeps, 'invoke' | 'logger'>,
  input: { fileId: number; offset: number; priority: number },
): Promise<{ path: string; size: number }> {
  let file: TdObject | undefined = await deps.invoke({
    _: 'downloadFile',
    file_id: input.fileId,
    priority: input.priority,
    offset: Math.max(0, Math.floor(input.offset)),
    limit: 0,
    synchronous: false,
  })
  let ready = streamable(file)
  if (!ready) {
    let waited = 0
    while (!ready && waited < STREAM_READY_TIMEOUT_MS) {
      await pause(STREAM_READY_POLL_MS)
      waited += STREAM_READY_POLL_MS
      file = await deps.invoke({ _: 'getFile', file_id: input.fileId })
      ready = streamable(file)
    }
    if (ready) {
      deps.logger.info(
        `file ${input.fileId} was not streamable on the first answer; TDLib reported a path after ${waited}ms`,
      )
    }
  }
  if (!ready) {
    deps.logger.warn(
      `file ${input.fileId} never became streamable: ${JSON.stringify(file)}`,
    )
    throw new AppError('internal', `File ${input.fileId} cannot be streamed yet`)
  }
  return ready
}

/**
 * How many bytes sit on disk from `offset` with no gap.
 *
 * TDLib answers an error while the file is not in its cache yet (a transfer that
 * has only just been queued), and the stream reads that as "nothing has arrived
 * yet" — a failed poll is a 0 here, not an error the video element would show.
 */
/** Files whose prefix query already failed once; one log line is enough. */
const prefixFailures = new Set<number>()

export async function downloadedPrefix(
  deps: Pick<ActionDeps, 'invoke' | 'logger'>,
  input: { fileId: number; offset: number },
): Promise<number> {
  try {
    const answer = await deps.invoke({
      _: 'getFileDownloadedPrefixSize',
      file_id: input.fileId,
      offset: Math.max(0, Math.floor(input.offset)),
    })
    const size = Number(answer?.size ?? 0)
    return Number.isFinite(size) && size > 0 ? size : 0
  } catch (error) {
    // "Not in the cache yet" is the normal first answer for a just-queued file,
    // so the stream reads it as "nothing yet". The first failure per file is
    // logged: a systematic refusal would otherwise only show up as a video that
    // never starts.
    if (!prefixFailures.has(input.fileId)) {
      prefixFailures.add(input.fileId)
      deps.logger.warn(
        `prefix size unavailable for file ${input.fileId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return 0
  }
}

/** Stops a transfer no window is waiting for any more (a bubble scrolled away). */
export async function cancelDownload(
  deps: Pick<ActionDeps, 'invoke'>,
  fileId: number,
): Promise<void> {
  await deps.invoke({ _: 'cancelDownloadFile', file_id: fileId, only_if_pending: false })
}

export async function downloadFile(
  deps: ActionDeps,
  input: { fileId: number; priority: number },
): Promise<{ path: string; url: string }> {
  const { path, file } = await fetchFilePath(deps, input.fileId, input.priority)
  const url = registerMediaFile(path)
  deps.emit({
    type: 'file',
    fileId: input.fileId,
    downloaded: file?.local?.downloaded_size ?? 0,
    total: file?.expected_size ?? file?.size ?? 0,
    url,
    completed: true,
  })
  return { path, url }
}
