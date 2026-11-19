import type { ViewerItem } from '@wegram/protocol'
import { useEffect, useState } from 'react'

import { invoke } from '../../lib/ipc'

/**
 * One cell of the 预览 board. Real media carries a base64 minithumbnail and paints
 * instantly; when one is missing the cell fetches the file at the lowest
 * priority, because the board is only open when the reader asked to see the
 * whole strip at once.
 */
function PreviewCell({
  item,
  position,
  active,
  onSelect,
}: {
  item: ViewerItem
  position: number
  active: boolean
  onSelect: () => void
}) {
  const [src, setSrc] = useState<string | null>(
    item.minithumbnail ? `data:image/jpeg;base64,${item.minithumbnail}` : null,
  )

  useEffect(() => {
    if (src || item.fileId <= 0) return
    let alive = true
    invoke('media:download', { fileId: item.fileId, priority: 2 })
      .then(({ url }) => {
        if (alive) setSrc(url)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [item.fileId, src])

  return (
    <button
      type="button"
      className={`wx-viewer__cell${active ? ' is-active' : ''}`}
      title={item.fileName ?? `${item.kind === 'video' ? '视频' : '图片'} ${position + 1}`}
      onClick={onSelect}
    >
      {src ? <img src={src} alt="" /> : <span className="wx-viewer__cell-empty" />}
    </button>
  )
}

/**
 * The 预览 board docked to the right of the canvas: one cell per item of the
 * strip, the current one marked, so the reader can jump straight to a picture.
 */
export function ViewerGrid({
  items,
  index,
  onSelect,
}: {
  items: readonly ViewerItem[]
  index: number
  onSelect: (position: number) => void
}) {
  return (
    <aside className="wx-viewer__grid" aria-label="预览">
      {items.map((entry, position) => (
        <PreviewCell
          key={`${entry.fileId}-${position}`}
          item={entry}
          position={position}
          active={position === index}
          onSelect={() => onSelect(position)}
        />
      ))}
    </aside>
  )
}
