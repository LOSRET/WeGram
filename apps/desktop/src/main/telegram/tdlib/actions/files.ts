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
