import type { EventChannel } from '@wegram/protocol'

export interface EventSink {
  send(channel: EventChannel, envelope: { seq: number; payload: unknown }): void
}

/**
 * Batches adapter events before they cross IPC.
 *
 * A busy group can produce thousands of TDLib updates per second; sending one
 * IPC message per update would stall the renderer (design doc §6.1). The 60ms
 * window keeps the list responsive without humanly noticeable lag.
 */
export class EventBus {
  private seq = 0
  private readonly pending: Array<{ channel: EventChannel; payload: unknown }> = []
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly sink: EventSink,
    private readonly flushMs = 60,
  ) {}

  publish(channel: EventChannel, payload: unknown): void {
    this.pending.push({ channel, payload })
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), this.flushMs)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.pending.length) return
    const batch = this.pending.splice(0, this.pending.length)
    for (const item of batch) {
      this.seq += 1
      this.sink.send(item.channel, { seq: this.seq, payload: item.payload })
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending.length = 0
  }
}
