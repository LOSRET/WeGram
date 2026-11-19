import type { TdObject } from './client'

/**
 * A TDLib field that should be an array, read as one.
 *
 * `client.ts` keeps responses untyped on purpose, so every reader has to decide
 * what a missing or malformed array means. Letting each one spell out its own
 * `Array.isArray(x) ? x : []` let the empty default drift between readers; this
 * is the one answer: "no items".
 *
 * The cast is the adapter boundary's claim about the item type, not a silencer:
 * `Array.isArray` already proved the value is an array.
 */
export function asArray<T = TdObject>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}
