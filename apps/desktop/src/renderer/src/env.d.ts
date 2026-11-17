import type { TgBridge } from '@wegram/protocol'

declare global {
  interface Window {
    tg: TgBridge
  }
}

export {}
