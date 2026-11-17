/**
 * Ordering of the main process's event stream.
 *
 * Every `evt:*` envelope carries one `seq` taken from a single counter in
 * `main/telegram/updates.ts`, so the renderer can tell a hole from a duplicate even
 * though the events arrive on eight different channels. The rules are here rather
 * than in `App.tsx` because they are the part worth testing without a browser.
 */
export type SeqVerdict =
  /** The first event of a stream: nothing to compare against yet. */
  | 'first'
  /** Exactly the one we expected next. */
  | 'next'
  /** The same envelope again — not a hole, and not a reason to move the baseline. */
  | 'duplicate'
  /** A hole: whatever was in it will never be replayed. */
  | 'gap'
  /**
   * The counter went backwards, so this is a *new* stream (the adapter was rebuilt,
   * e.g. a re-login). The baseline has to move with it; the state the old stream left
   * behind is exactly what the new one will not repeat.
   */
  | 'restart'

export function classifySeq(previous: number | null, incoming: number): SeqVerdict {
  if (previous === null) return 'first'
  if (incoming === previous + 1) return 'next'
  if (incoming === previous) return 'duplicate'
  return incoming < previous ? 'restart' : 'gap'
}

/** Whether the verdict means "state may have been missed and has to be re-read". */
export function needsResync(verdict: SeqVerdict): boolean {
  return verdict === 'gap' || verdict === 'restart'
}
