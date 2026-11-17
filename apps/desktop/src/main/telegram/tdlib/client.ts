import { getTdjson } from 'prebuilt-tdlib'
import { configure } from 'tdl'

import type { Logger } from '../../util'

/* TDLib responses are a 2MB generated type space; the adapter boundary is the
 * only place allowed to touch raw JSON, so it stays `unknown`-ish here and is
 * mapped into domain DTOs immediately. */
export type TdObject = Record<string, any>

/** The subset of `tdl`'s client the adapter uses. */
export interface TdClientLike {
  invoke(method: TdObject): Promise<any>
  on(event: 'update', handler: (update: TdObject) => void): void
  on(event: 'error', handler: (error: Error) => void): void
  on(event: 'close', handler: () => void): void
  close(): Promise<void>
  getVersion(): string
}

let tdlibConfigured = false

/** Loads tdjson once per process; the app and the smoke script both come here. */
export function configureTdlib(logger: Logger): void {
  if (tdlibConfigured) return
  configure({ tdjson: getTdjson(), verbosityLevel: 1 })
  tdlibConfigured = true
  logger.info('TDLib configured with prebuilt tdjson')
}

/** `getVersion()` throws until the first TDLib update arrives. */
export function safeVersion(client: TdClientLike | null): string {
  try {
    return client?.getVersion() ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
