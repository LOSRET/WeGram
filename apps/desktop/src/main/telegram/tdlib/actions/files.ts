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

/**
 * Begins (or re-targets) a download and answers where its bytes live.
 *
 * `synchronous: false` is the point: the call returns as soon as TDLib has
 * queued the transfer, with the local path it is about to fill and the size the
 * file will have. Sending it again with a different `offset` is how a seek
 * works — TDLib drops the previous range and fetches from there.
 */
export async function beginStream(
  deps: Pick<ActionDeps, 'invoke'>,
  input: { fileId: number; offset: number; priority: number },
): Promise<{ path: string; size: number }> {
  const file = await deps.invoke({
    _: 'downloadFile',
    file_id: input.fileId,
    priority: input.priority,
    offset: Math.max(0, Math.floor(input.offset)),
    limit: 0,
    synchronous: false,
  })
  const path: unknown = file?.local?.path
  const size = Number(file?.expected_size ?? file?.size ?? 0)
  if (typeof path !== 'string' || path.length === 0 || !(size > 0)) {
    throw new AppError('internal', `File ${input.fileId} cannot be streamed yet`)
  }
  return { path, size }
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
