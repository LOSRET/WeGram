import { z } from 'zod'

/**
 * Every failure the app may report across IPC.
 *
 * A union inferred from the schema, not hand-written beside it: the old
 * `code: z.string()` accepted any string at the boundary while the class only
 * allowed these nine, so a typo travelled as a valid `AppErrorShape`.
 */
export const appErrorCodeSchema = z.enum([
  'auth_required',
  'auth_failed',
  'invalid_payload',
  /** The account may not do this to the content (protected media, etc.). */
  'forbidden',
  'not_implemented',
  'tdlib_error',
  'rate_limited',
  'proxy_failed',
  'network',
  'internal',
])
export type AppErrorCode = z.infer<typeof appErrorCodeSchema>

export const appErrorSchema = z.object({
  code: appErrorCodeSchema,
  message: z.string(),
  retryAfter: z.number().optional(),
})
export type AppErrorShape = z.infer<typeof appErrorSchema>

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
