import { AppError } from '@wechatgram/protocol'
import type {
  AuthState,
  ChatSummary,
  ConnectionState,
  Message,
  ProxyConfig,
  ProxyTestResult,
  Self,
} from '@wechatgram/protocol'

/** Console logger; kept dependency-free on purpose for the main process. */
export function createLogger(scope: string) {
  const prefix = `[${scope}]`
  return {
    info: (...args: unknown[]) => console.log(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
  }
}

export type Logger = ReturnType<typeof createLogger>

/** Groups TDLib raw errors into the app-wide error shape (§7.2). */
export function toAdapterError(cause: unknown, fallbackMessage: string): AppError {
  if (cause instanceof AppError) return cause
  const raw = cause as { code?: number; message?: string } | undefined
  const message = raw?.message ?? fallbackMessage
  const code = raw?.code === 429 ? 'rate_limited' : 'tdlib_error'
  const retryAfter = code === 'rate_limited' ? parseRetryAfter(message) : undefined
  return new AppError(code, message, retryAfter)
}

function parseRetryAfter(message: string): number | undefined {
  const match = /retry after (\d+)/i.exec(message)
  return match?.[1] ? Number(match[1]) : undefined
}

export function assertReady(state: AuthState): asserts state is Extract<AuthState, { kind: 'ready' }> {
  if (state.kind !== 'ready') {
    throw new AppError('auth_required', 'Not authorized yet')
  }
}
