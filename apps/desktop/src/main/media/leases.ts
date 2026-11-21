/**
 * Who is still waiting for a file's download.
 *
 * The shell and the 图片和视频 window are separate renderers, and both may show
 * the same photo: a bubble that scrolls away must not stop the transfer the
 * viewer is using. Every `media:download` / `media:stream` names an owner, and
 * TDLib is only told to stop when the last holder of that file leaves.
 */
const holders = new Map<number, Set<string>>()

/** Adds one holder of a file's transfer. */
export function hold(fileId: number, owner: string): void {
  const set = holders.get(fileId)
  if (set) set.add(owner)
  else holders.set(fileId, new Set([owner]))
}

/**
 * Drops one holder and answers whether that call removed the **last** one — the
 * only case in which the caller may cancel the transfer.
 *
 * A request that already settled has released its holder, so a late
 * `media:cancel` from the same owner finds nothing to drop and answers false.
 * That matters: the file may be in use by another window by then, and a cancel
 * keyed on "no holder is left" must never fire twice.
 */
export function drop(fileId: number, owner: string): boolean {
  const set = holders.get(fileId)
  if (!set || !set.has(owner)) return false
  set.delete(owner)
  if (set.size > 0) return false
  holders.delete(fileId)
  return true
}
