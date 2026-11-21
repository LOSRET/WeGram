import { z } from 'zod'

/**
 * What the main process is doing before authorization can start.
 *
 * TDLib has two state machines of its own (`AuthorizationState` and
 * `ConnectionState`) and neither answers "the app will not start": a tdjson that
 * cannot be loaded, a database that cannot be opened or a client that dies are
 * all silent there. The login window used to show one generic "connecting" line
 * for every one of them — and kept spinning forever on a failed start, which is
 * exactly what the installed 0.1.1 build did.
 *
 * `failed` and `crashed` are terminal: they stop the spinner and say why,
 * instead of pretending the connection is still being made.
 */
export const bootStateSchema = z.discriminatedUnion('kind', [
  /** Loading tdjson and constructing the TDLib client. */
  z.object({ kind: z.literal('starting') }),
  /**
   * TDLib is opening its local database. It announces this as
   * `authorizationStateWaitTdlibParameters` before it has anything else to say.
   */
  z.object({ kind: z.literal('opening') }),
  /** Dialing Telegram; `viaProxy` when the client was told to use a proxy. */
  z.object({ kind: z.literal('connecting'), viaProxy: z.boolean() }),
  /** No usable network; TDLib retries by itself (`connectionStateWaitingForNetwork`). */
  z.object({ kind: z.literal('offline') }),
  /** Applying server changes (`connectionStateUpdating`). */
  z.object({ kind: z.literal('updating') }),
  /** The client is up; from here on the sign-in steps own the window. */
  z.object({ kind: z.literal('ready') }),
  /** `adapter.start()` threw: TDLib could not be loaded or constructed. */
  z.object({ kind: z.literal('failed'), message: z.string() }),
  /** The TDLib client went away without us asking (it crashed). */
  z.object({ kind: z.literal('crashed'), message: z.string() }),
])
export type BootState = z.infer<typeof bootStateSchema>
