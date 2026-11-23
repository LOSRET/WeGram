import type { Sticker } from '@wegram/protocol'
import type { Animation, Canvas as ThorvgCanvas } from '@thorvg/webcanvas'
import { useEffect, useRef } from 'react'

import { invoke } from '../lib/ipc'
import { loadTgsText, markTgsFailure } from '../lib/tgs'
import { loadThorvg } from '../lib/thorvg'

/** 30 fps, the budget Telegram Desktop gives its sticker panels (kMinRepaintDelay). */
const FRAME_MS = 33

/**
 * One ThorVG canvas over a sticker grid: every TGS cell of the set is drawn by
 * a single WebGL scene with one `render()` per frame, instead of one SVG tree per
 * cell (the lottie-web model the transcript still uses).
 *
 * The layer sits above the grid cells and is `pointer-events: none`, so the cells
 * keep their hover, title and click behaviour. A cell whose animation is ready
 * gets `.wx-sticker-canvas-cell`, which hides its static thumbnail — until then
 * (and if ThorVG fails altogether) the grid shows the thumbnails, exactly as a
 * plain grid would.
 */
export function StickerCanvasLayer({
  stickers,
  owner,
  onFailed,
}: {
  stickers: Sticker[]
  /** A `media:download` holder name, unique to this grid. */
  owner: string
  /** ThorVG could not start: the grid keeps its per-cell thumbnails. */
  onFailed: () => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const root = rootRef.current
    const grid = root?.parentElement
    if (!root || !grid) return

    let disposed = false
    let frame = 0
    let canvas: ThorvgCanvas | null = null
    let startedAt = 0
    let lastPaint = 0
    const animations: Animation[] = []
    const canvasElement = document.createElement('canvas')
    canvasElement.className = 'wx-sticker-canvas'
    canvasElement.style.width = '100%'
    canvasElement.style.height = '100%'

    const paint = (now: number): void => {
      if (disposed) return
      if (now - lastPaint < FRAME_MS) {
        frame = requestAnimationFrame(paint)
        return
      }
      lastPaint = now
      if (startedAt === 0) startedAt = now
      const elapsed = now - startedAt
      for (const animation of animations) {
        const info = animation.info()
        if (!info) continue
        const duration = (info.duration || 1) * 1000
        const total = info.totalFrames || 1
        animation.frame(((elapsed % duration) / duration) * total)
      }
      canvas?.update()
      canvas?.render()
      frame = requestAnimationFrame(paint)
    }

    void (async () => {
      try {
        const engine = await loadThorvg()
        if (disposed) return

        const width = Math.max(1, grid.clientWidth)
        const height = Math.max(1, grid.clientHeight)
        // A 120-sticker pack at 4 columns is ~3400 CSS px tall; at DPR 2 the
        // backing store would exceed the GPU's 4096 texture limit. Cap the
        // scale so the whole grid always fits one texture.
        const dpr = Math.max(
          0.5,
          Math.min(2, window.devicePixelRatio || 1, 4096 / height, 4096 / width),
        )
        root.append(canvasElement)
        canvas = new engine.Canvas(canvasElement, {
          width: Math.round(width * dpr),
          height: Math.round(height * dpr),
        })
        // ThorVG sizes the canvas element to its backing store; the layer must
        // stay inside the grid's CSS box or the body grows a horizontal bar.
        canvasElement.style.width = '100%'
        canvasElement.style.height = '100%'

        const cells = new Map<number, HTMLElement>()
        for (const cell of grid.querySelectorAll<HTMLElement>('[data-sticker-index]')) {
          const index = Number(cell.dataset['stickerIndex'])
          if (Number.isInteger(index)) cells.set(index, cell)
        }

        await Promise.all(
          stickers.map(async (sticker, index) => {
            if (sticker.format !== 'tgs') return
            const cell = cells.get(index)
            if (!cell) return
            let url = ''
            try {
              const download = await invoke('media:download', {
                fileId: sticker.fileId,
                priority: 8,
                owner,
              })
              url = download.url
              if (disposed) return
              const data = await loadTgsText(url)
              if (disposed || !canvas) return

              const animation = new engine.Animation()
              animation.load(data)
              const picture = animation.picture
              if (!picture) {
                animation.dispose()
                return
              }
              const size = picture.size()
              const sourceWidth = size.width || 1
              const sourceHeight = size.height || 1
              const inner = Math.max(8, Math.min(cell.clientWidth, cell.clientHeight) - 8)
              const scale = (inner / Math.max(sourceWidth, sourceHeight)) * dpr
              picture.origin(0.5, 0.5)
              picture.scale(scale)
              picture.translate(
                (cell.offsetLeft + cell.offsetWidth / 2) * dpr,
                (cell.offsetTop + cell.offsetHeight / 2) * dpr,
              )
              canvas.add(picture)
              animations.push(animation)
              cell.classList.add('wx-sticker-canvas-cell')
              if (animations.length === 1) frame = requestAnimationFrame(paint)
            } catch {
              // One bad sticker keeps its thumbnail; the grid must not fail for it.
              if (url) markTgsFailure(url)
            }
          }),
        )
      } catch {
        // No ThorVG (old GPU, blocked wasm): the grid keeps its thumbnails.
        if (!disposed) onFailed()
      }
    })()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      for (const animation of animations) animation.dispose()
      canvas?.destroy()
      canvasElement.remove()
    }
  }, [stickers, owner, onFailed])

  return <div ref={rootRef} className="wx-sticker-canvas-layer" aria-hidden="true" />
}
