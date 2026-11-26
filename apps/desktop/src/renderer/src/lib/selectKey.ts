/** The navigation keys a settings select's listbox moves with. */
export type SelectMoveKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'

/**
 * The option a navigation key activates.
 *
 * A select opens on its selected row, and ArrowDown/ArrowUp wrap at both ends
 * (that is what the client's dropdown does). Home and End jump to the ends. An
 * empty list stays at 0, and a stale index is clamped before it moves, so a
 * value that disappeared from the table cannot point past it.
 */
export function moveActiveOption(current: number, count: number, key: SelectMoveKey): number {
  if (count <= 0) return 0
  const base = Math.min(Math.max(current, 0), count - 1)
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowDown') return (base + 1) % count
  return (base - 1 + count) % count
}
