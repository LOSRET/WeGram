import type { TgBridge } from '@wegram/protocol'

declare global {
  /** Injected by the Vite configs from the root package.json version. */
  const __WEGRAM_VERSION__: string

  interface Window {
    tg: TgBridge
  }
}

export {}
