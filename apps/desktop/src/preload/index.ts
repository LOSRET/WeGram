import {
  eventChannels,
  invokeChannels,
  type EventChannel,
  type EventEnvelope,
  type InvokeChannel,
  type InvokeRequest,
  type InvokeResponse,
  type TgBridge,
} from '@wechatgram/protocol'
import { contextBridge, ipcRenderer } from 'electron'

const allowedInvoke = new Set<string>(invokeChannels)
const allowedEvents = new Set<string>(eventChannels)

interface IpcResult {
  ok: boolean
  data?: unknown
  error?: { code: string; message: string; retryAfter?: number }
}

/**
 * The renderer's entire capability surface: two whitelisted entry points.
 * Channel names are literal unions from the protocol package, never built by
 * string concatenation (design doc §7.2).
 */
const bridge: TgBridge = {
  async invoke<C extends InvokeChannel>(
    channel: C,
    payload?: InvokeRequest<C>,
  ): Promise<InvokeResponse<C>> {
    if (!allowedInvoke.has(channel)) {
      throw { code: 'invalid_payload', message: `Blocked IPC channel: ${channel}` }
    }
    const result = (await ipcRenderer.invoke(channel, payload)) as IpcResult
    if (result.ok) return result.data as InvokeResponse<C>
    throw result.error ?? { code: 'internal', message: 'IPC call failed' }
  },

  on<C extends EventChannel>(
    channel: C,
    callback: (event: EventEnvelope<C>) => void,
  ): () => void {
    if (!allowedEvents.has(channel)) {
      throw new Error(`Blocked IPC event channel: ${channel}`)
    }
    const listener = (_event: Electron.IpcRendererEvent, envelope: EventEnvelope<C>): void => {
      callback(envelope)
    }
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },
}

contextBridge.exposeInMainWorld('tg', bridge)
