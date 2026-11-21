import type { BootState } from '@wegram/protocol'

import type { AdapterEvent } from '../adapter'

/**
 * The startup phase, shared by the client lifecycle and the update handler.
 *
 * It is deliberately a third state machine next to authorization and connection:
 * TDLib reports neither when it fails to start at all, which is why the login
 * window used to spin on one generic "connecting" line forever. The connection
 * phase is folded in, but only until the client is up — after that the network
 * belongs to `evt:connection` and the boot panel is gone.
 */
export class BootTracker {
  private current: BootState = { kind: 'starting' }
  /** The last error TDLib reported; its only reason for a crash. */
  private lastError: string | null = null

  constructor(private readonly emit: (event: AdapterEvent) => void) {}

  get state(): BootState {
    return this.current
  }

  set(state: BootState): void {
    // A repeated state must not cross IPC: TDLib re-sends `waitQr` with a fresh
    // link every few seconds, and the boot phase has not changed.
    if (sameBoot(this.current, state)) return
    this.current = state
    this.emit({ type: 'boot', state })
  }

  /**
   * A connection update describes the network, not the startup: once TDLib has
   * reached an authorization state (or failed/crashed), it must not drag the
   * panel back to an earlier stage.
   */
  noteConnection(state: BootState): void {
    const kind = this.current.kind
    if (kind === 'ready' || kind === 'failed' || kind === 'crashed') return
    this.set(state)
  }

  noteError(message: string): void {
    this.lastError = message
  }

  /** The client closed without us asking. */
  crash(): void {
    this.set({ kind: 'crashed', message: this.lastError ?? 'TDLib 客户端意外退出' })
  }
}

function sameBoot(a: BootState, b: BootState): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'connecting':
      return b.kind === 'connecting' && a.viaProxy === b.viaProxy
    case 'failed':
    case 'crashed':
      return b.kind === a.kind && a.message === b.message
    default:
      return true
  }
}
