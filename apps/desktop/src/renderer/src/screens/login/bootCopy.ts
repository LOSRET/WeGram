import type { BootState } from '@wegram/protocol'

/** The boot / failure panel's copy for one state. Pure, so it can be tested. */
export interface BootCopy {
  title: string
  subtitle: string
  /** `busy` keeps the spinner; `failed` replaces it with the reason. */
  tone: 'busy' | 'failed'
  /** The error text, for a failure. */
  detail?: string
  /** What the reader can do about it. */
  hint?: string
}

/**
 * The login window's startup line (design doc §9.6).
 *
 * One generic «正在连接 Telegram…» used to cover every startup phase, so a client
 * that never came up looked exactly like a slow network — forever. Each phase now
 * says what is actually happening, and the two terminal states («未能启动»,
 * «已崩溃») stop the spinner and show the reason.
 */
export function bootCopy(boot: BootState | null, closed: boolean, error: string | null): BootCopy {
  if (boot?.kind === 'failed') {
    return {
      title: 'Telegram 连接未能启动',
      subtitle: '本地的 Telegram 组件没有启动成功。',
      tone: 'failed',
      detail: boot.message,
      hint: '可以点标题栏的齿轮检查代理，然后重新打开 WeGram。',
    }
  }
  if (boot?.kind === 'crashed') {
    return {
      title: 'Telegram 连接已崩溃',
      subtitle: '本地的 Telegram 组件意外退出，连接已中断。',
      tone: 'failed',
      detail: boot.message,
      hint: '重新打开 WeGram 就能再试。',
    }
  }
  if (closed) {
    return {
      title: '连接已关闭',
      subtitle: '与 Telegram 的连接已断开。',
      tone: 'failed',
      ...(error ? { detail: error } : {}),
      hint: '重新打开 WeGram 就能再试。',
    }
  }
  switch (boot?.kind) {
    case 'starting':
      return {
        title: '正在启动 Telegram 组件…',
        subtitle: '正在加载本地组件，请稍候。',
        tone: 'busy',
        ...(error ? { detail: error } : {}),
      }
    case 'opening':
      return {
        title: '正在打开本地数据库…',
        subtitle: '首次启动或聊天记录较多时会久一点。',
        tone: 'busy',
        ...(error ? { detail: error } : {}),
      }
    case 'connecting':
      return {
        title: boot.viaProxy ? '正在通过代理连接…' : '正在连接 Telegram 服务器…',
        subtitle: boot.viaProxy
          ? '正在经你设置的代理连接服务器。'
          : '网络受限时，需要先在设置里配置代理。',
        tone: 'busy',
        ...(error ? { detail: error } : {}),
      }
    case 'offline':
      return {
        title: '等待网络连接…',
        subtitle: '当前没有可用网络，恢复后会自动继续。',
        tone: 'busy',
        ...(error ? { detail: error } : {}),
      }
    case 'updating':
      return {
        title: '正在同步聊天记录…',
        subtitle: '正在更新本地数据，请稍候。',
        tone: 'busy',
        ...(error ? { detail: error } : {}),
      }
    case 'ready':
      return {
        title: '准备就绪…',
        subtitle: '马上进入登录。',
        tone: 'busy',
        ...(error ? { detail: error } : {}),
      }
    default:
      return {
        title: '正在启动…',
        subtitle: '正在读取启动状态。',
        tone: 'busy',
        ...(error ? { detail: error } : {}),
      }
  }
}
