import type {
  AppErrorShape,
  InvokeChannel,
  InvokeRequest,
  InvokeResponse,
} from '@wegram/protocol'

export function invoke<C extends InvokeChannel>(
  channel: C,
  payload?: InvokeRequest<C>,
): Promise<InvokeResponse<C>> {
  return window.tg.invoke(channel, payload)
}

/** IPC errors arrive as plain `{ code, message }` shapes, not Error instances. */
export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

export function isAppErrorShape(error: unknown): error is AppErrorShape {
  return Boolean(error && typeof error === 'object' && 'code' in error && 'message' in error)
}
