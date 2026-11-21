import { AppError } from '@wegram/protocol'

import type { AdapterEvent } from '@wegram/adapter-contract'
import type { MockAssets } from './assets'
import { simulateTransfer } from './effects'

/**
 * The mock's transfer half.
 *
 * The fixtures are real files written under `userData`, so downloading one
 * reports the same `evt:file` progress the TDLib adapter does, and a stream is
 * immediately complete (every byte is already on disk). Split out of `index.ts`
 * when that file hit its line budget: these calls share one dependency — the
 * asset map — and nothing else in the adapter.
 */

export async function downloadMockFile(
  assets: MockAssets,
  emit: (event: AdapterEvent) => void,
  input: { fileId: number; priority: number },
): Promise<{ path: string; url: string }> {
  const file = assets.files.get(input.fileId)
  if (!file) throw new AppError('internal', `Unknown mock file ${input.fileId}`)
  await simulateTransfer({ files: assets.files, emit }, input.fileId, file.size, false)
  return { path: file.path, url: file.url }
}

export async function beginMockStream(
  assets: MockAssets,
  input: { fileId: number; offset: number; priority: number },
): Promise<{ path: string; size: number }> {
  const file = assets.files.get(input.fileId)
  if (!file) throw new AppError('internal', `Unknown mock file ${input.fileId}`)
  return { path: file.path, size: file.size }
}

export async function mockDownloadedPrefix(
  assets: MockAssets,
  input: { fileId: number; offset: number },
): Promise<number> {
  const file = assets.files.get(input.fileId)
  return file ? Math.max(0, file.size - input.offset) : 0
}
