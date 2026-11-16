import { z } from 'zod'

export const appErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryAfter: z.number().optional(),
})
export type AppErrorShape = z.infer<typeof appErrorSchema>

export type AppErrorCode =
  | 'auth_required'
  | 'auth_failed'
  | 'invalid_payload'
  | 'not_implemented'
  | 'tdlib_error'
  | 'rate_limited'
  | 'proxy_failed'
  | 'network'
  | 'internal'

/** Single error shape for the whole app: main throws it, renderer receives it. */
export class AppError extends Error {
  readonly code: AppErrorCode
  readonly retryAfter?: number

  constructor(code: AppErrorCode, message: string, retryAfter?: number) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.retryAfter = retryAfter
  }

  toShape(): AppErrorShape {
    return {
      code: this.code,
      message: this.message,
      ...(this.retryAfter === undefined ? {} : { retryAfter: this.retryAfter }),
    }
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}

export function asAppErrorShape(value: unknown): AppErrorShape {
  if (value instanceof AppError) return value.toShape()
  if (value instanceof Error) return { code: 'internal', message: value.message }
  return { code: 'internal', message: String(value) }
}

export function isAuthError(shape: AppErrorShape): boolean {
  return shape.code === 'auth_required' || shape.code === 'auth_failed'
}
