import { parentPort } from 'node:worker_threads'

import createWinHello from 'win-hello'

import type { BiometryWorkerRequest, BiometryWorkerResponse } from './biometry-worker-protocol'

const hello = createWinHello()

parentPort?.on('message', (raw: unknown) => {
  if (!isRequest(raw)) return
  void handle(raw)
})

async function handle(request: BiometryWorkerRequest): Promise<void> {
  try {
    if (request.kind === 'availability') {
      const available = await hello.isHelloAvailable()
      parentPort?.postMessage({ id: request.id, available } satisfies BiometryWorkerResponse)
      return
    }

    const handle =
      request.windowHandle === undefined ? undefined : Buffer.from(request.windowHandle)
    await hello.requestHello(request.message ?? 'Verify your identity', handle)
    parentPort?.postMessage({
      id: request.id,
      verified: true,
    } satisfies BiometryWorkerResponse)
  } catch (error) {
    parentPort?.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : 'Windows Hello failed',
    } satisfies BiometryWorkerResponse)
  }
}

function isRequest(value: unknown): value is BiometryWorkerRequest {
  if (typeof value !== 'object' || value === null) return false
  if (!('id' in value) || !('kind' in value)) return false
  return typeof value.id === 'number' && (value.kind === 'availability' || value.kind === 'verify')
}
