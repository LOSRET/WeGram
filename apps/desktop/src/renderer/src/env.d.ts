import type { TgBridge } from '@wechatgram/protocol'

declare global {
  interface Window {
    tg: TgBridge
  }
}

export {}
