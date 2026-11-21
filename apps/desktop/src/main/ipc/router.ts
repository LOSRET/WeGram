import {
  asAppErrorShape,
  invokeChannels,
  invokeSchemas,
  type AppErrorShape,
  type InvokeChannel,
  type InvokeRequest,
  type InvokeResponse,
} from '@wegram/protocol'
import { ipcMain } from 'electron'

/**
 * One handler per channel, typed with that channel's request schema.
 *
 * The payload used to be `unknown`, and every handler re-declared the shape it
 * expected with `payload as { ... }` — a shape that could (and did) drift from
 * the zod schema without a single compile error. The mapped type below makes
 * each handler read `payload.chatId` with the type the protocol promises.
 */
export type IpcHandlerMap = {
  [C in InvokeChannel]?: (
    payload: InvokeRequest<C>,
  ) => Promise<InvokeResponse<C>> | InvokeResponse<C>
}

export interface IpcResult {
  ok: boolean
  data?: unknown
  error?: AppErrorShape
}

const registered: InvokeChannel[] = []

/**
 * Registers every declared channel. Payloads are re-validated here even though
 * the preload script already whitelists channels: the renderer is untrusted
 * (design doc §4, §7).
 */
export function registerIpc(handlers: IpcHandlerMap): void {
  for (const channel of invokeChannels) {
    const run = handlers[channel]
    if (!run) continue

    // The one cast in this file: the mapped type pairs each channel with its own
    // payload, which `channel` (a union member) cannot carry into the closure.
    const handler = run as (payload: unknown) => unknown

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
