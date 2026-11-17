import {
  asAppErrorShape,
  invokeChannels,
  invokeSchemas,
  type InvokeChannel,
} from '@wechatgram/protocol'
import { ipcMain } from 'electron'

export type IpcHandler = (payload: unknown) => Promise<unknown> | unknown
export type IpcHandlerMap = Partial<Record<InvokeChannel, IpcHandler>>

export interface IpcResult {
  ok: boolean
  data?: unknown
  error?: { code: string; message: string; retryAfter?: number }
}

const registered: InvokeChannel[] = []

/**
 * Registers every declared channel. Payloads are re-validated here even though
 * the preload script already whitelists channels: the renderer is untrusted
 * (design doc §4, §7).
 */
export function registerIpc(handlers: IpcHandlerMap): void {
  for (const channel of invokeChannels) {
    const handler = handlers[channel]
    if (!handler) continue

    ipcMain.handle(channel, async (_event, payload: unknown): Promise<IpcResult> => {
      try {
        const parsed = invokeSchemas[channel].request.parse(payload)
        const data = await handler(parsed)
        return { ok: true, data }
      } catch (error) {
        if (isZodError(error)) {
          return {
            ok: false,
            error: { code: 'invalid_payload', message: formatZodError(error) },
          }
        }
        return { ok: false, error: asAppErrorShape(error) }
      }
    })
    registered.push(channel)
  }
}

export function unregisterIpc(): void {
  for (const channel of registered) ipcMain.removeHandler(channel)
  registered.length = 0
}

function isZodError(
  error: unknown,
): error is { name: 'ZodError'; issues: Array<{ path: PropertyKey[]; message: string }> } {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'ZodError' &&
    Array.isArray((error as { issues?: unknown }).issues)
  )
}

function formatZodError(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>
}): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
}
