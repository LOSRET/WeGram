import type { Sticker } from '@wegram/protocol'
import type { Animation, Canvas as ThorvgCanvas, Paint } from '@thorvg/webcanvas'
import { useEffect, useRef } from 'react'

import { ensureMedia, releaseMedia } from '../lib/media'
import { overlaps, stickerWindow } from '../lib/stickerCanvasWindow'
import { loadTgsText, markTgsFailure } from '../lib/tgs'
import { loadThorvg, type ThorvgEngine } from '../lib/thorvg'

/** 30 fps, the budget Telegram Desktop gives its sticker panels (kMinRepaintDelay). */
const FRAME_MS = 33
/** Lottie parses in flight — each one is a synchronous cost on the main thread. */
const DECODE_CONCURRENCY = 2
/**
 * After the last scroll event, painting and parsing resume this long later: the
 * scrolling frames belong to the compositor, and a Lottie parse is a 1–3 ms block.
 */
const SCROLL_SETTLE_MS = 120
/** A sticker that failed to arrive or parse is not retried on every scroll event. */
const FAILURE_COOLDOWN_MS = 60_000
/** Releases per painted frame: a saved frame is a drawImage plus an encode, not free. */
const DROP_FLUSH_PER_FRAME = 4
/** A saved frame is one cell's still image; 160 px covers an 82–104 px cell at DPR 2. */
const SAVED_FRAME_MAX_PX = 160

/** One TGS cell that has been parsed and added to the shared canvas. */
interface BuiltSticker {
  animation: Animation
  picture: Paint
  cell: HTMLElement
  /** Cached once at load: `animation.info()` allocates, and it was read per frame. */
  durationMs: number
  totalFrames: number
  /** On screen right now — only these are advanced and drawn. */
  visible: boolean
  /** Out of the drop band: its last frame is saved and the scene released. */
  dropPending: boolean
}

/** A macrotask boundary, so a burst of parses cannot become one long task. */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/** The element that scrolls this grid (null when the page itself does). */
function nearestScroller(node: HTMLElement): HTMLElement | null {
  let parent = node.parentElement
  while (parent && parent !== document.body) {
    const overflowY = getComputedStyle(parent).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return parent
    parent = parent.parentElement
  }
  return null
}

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
 *
 * The scene follows the reader (`lib/stickerCanvasWindow`): cells within two
 * screens are parsed, two at a time and with a main-thread yield between parses;
 * off screen they are only paused; three screens away they are released, but their
 * last painted frame is saved first and shown in the cell (Telegram Desktop's
 * `savedFrame`), so coming back never flashes the thumbnail. The cell keeps
 * `.wx-sticker-canvas-cell` while a saved frame stands in, and the animation is
 * parsed again behind it. Closing the panel, or opening another set, unmounts the
 * layer and disposes everything. Parsing waits `SCROLL_SETTLE_MS` after the last
 * scroll event, so a wheel never fights a Lottie parse; painting keeps running at
 * 30 fps while the grid scrolls — with one immediate frame whenever a cell becomes
 * visible — because a cell that scrolls into view has no pixels of its own until
 * the shared canvas draws it.
 *
 * Downloads go through `lib/media`'s owner leases — one owner per sticker — so
 * the `wx-media://` URL of a sticker already fetched is reused when the grid is
 * reopened (a 120-sticker pack used to ask TDLib again for all of them), and
 * closing the grid drops its leases, which cancels a pack that is still arriving
 * instead of letting it finish behind a box the reader closed. The lease is per
 * cell because `ensureMedia` holds one file per owner: a shared owner would
 * release — and cancel — the previous transfer on every next sticker.
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

    const scroller = nearestScroller(grid)
    let disposed = false
    let frame = 0
    let pumpTimer = 0
    let canvas: ThorvgCanvas | null = null
    let engine: ThorvgEngine | null = null
    let resizeObserver: ResizeObserver | null = null
    let dpr = 1
    let startedAt = 0
    let lastPaint = 0
    let lastScrollAt = 0
    /** Set when a cell became visible: the next frame must not wait for the 30 fps slot. */
    let paintNow = false
    let visibleCount = 0
    /** Parses in flight; `pump` never exceeds `DECODE_CONCURRENCY`. */
    let running = 0
    const built = new Map<number, BuiltSticker>()
    /** A released cell's last painted frame, standing in until its parse lands. */
    const frozen = new Map<number, HTMLImageElement>()
    const loading = new Set<number>()
    /** When a cell last failed; without this every scroll event would retry it. */
    const failed = new Map<number, number>()
    const queue: number[] = []
    /** Each cell's box in the scroller's content coordinates, measured on layout. */
    const tops = new Map<number, { top: number; height: number }>()
    const cells = new Map<number, HTMLElement>()
    /** The lease owners this grid holds; released when the layer unmounts. */
    const owners = new Set<string>()
    /** Cells inside the parse band right now — `pump` only parses these. */
    let wanted = new Set<number>()
    const canvasElement = document.createElement('canvas')
    canvasElement.className = 'wx-sticker-canvas'
    canvasElement.style.width = '100%'
    canvasElement.style.height = '100%'

    function ownerOf(index: number): string {
      return `${owner}:${index}`
    }

    /** The scroller's viewport, in the coordinates `tops` are measured in. */
    function viewport(): { top: number; height: number; scrollTop: number } {
      if (scroller) {
        const rect = scroller.getBoundingClientRect()
        return { top: rect.top, height: scroller.clientHeight, scrollTop: scroller.scrollTop }
      }
      return { top: 0, height: window.innerHeight, scrollTop: window.scrollY }
    }

    /**
     * Cell boxes in content coordinates, read once per layout: scrolling does not
     * move a cell inside its scroller, so this survives every scroll event.
     */
    function measureTops(): void {
      const view = viewport()
      tops.clear()
      for (const [index, cell] of cells) {
        const rect = cell.getBoundingClientRect()
        tops.set(index, {
          top: rect.top - view.top + view.scrollTop,
          height: Math.max(1, rect.height),
        })
      }
    }

    /**
     * One cell's current pixels, as a still image (tdesktop's `savedFrame`).
     *
     * Read right after `canvas.render()`: the WebGL drawing buffer is only valid
     * in the task that rendered it, so this must not be deferred to a later frame.
     * Returns null when the readback is blank or refused — the cell then falls
     * back to its own thumbnail, which is what the grid shows anyway.
     */
    function captureFrame(cell: HTMLElement): string | null {
      if (!canvas) return null
      const width = Math.max(1, Math.round(cell.offsetWidth * dpr))
      const height = Math.max(1, Math.round(cell.offsetHeight * dpr))
      const shrink = Math.min(1, SAVED_FRAME_MAX_PX / Math.max(width, height))
      const savedWidth = Math.max(1, Math.round(width * shrink))
      const savedHeight = Math.max(1, Math.round(height * shrink))
      const snapshot = document.createElement('canvas')
      snapshot.width = savedWidth
      snapshot.height = savedHeight
      const context = snapshot.getContext('2d')
      if (!context) return null
      try {
        context.drawImage(
          canvasElement,
          cell.offsetLeft * dpr,
          cell.offsetTop * dpr,
          width,
          height,
          0,
          0,
          savedWidth,
          savedHeight,
        )
        const pixels = context.getImageData(0, 0, savedWidth, savedHeight).data
        let painted = false
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i] !== 0) {
            painted = true
            break
          }
        }
        return painted ? snapshot.toDataURL('image/webp', 0.82) : null
      } catch {
        return null
      }
    }

    /**
     * Releases the cells that left the drop band, a few per frame: each release is
     * a readback plus an encode, and doing a screenful at once would stutter.
     */
    function flushDrops(): void {
      if (!canvas) return
      let released = 0
      for (const [index, entry] of built) {
        if (released >= DROP_FLUSH_PER_FRAME) return
        if (!entry.dropPending) continue
        released += 1
        const saved = captureFrame(entry.cell)
        if (!saved) {
          // The readback was blank or refused. Without a frame to stand in, the
          // cell would have to fall back to a thumbnail it may not even have yet
          // (a far cell was never armed) — so keep the scene instead.
          entry.dropPending = false
          continue
        }
        built.delete(index)
        canvas.remove(entry.picture)
        entry.animation.dispose()
        const previous = frozen.get(index)
        if (previous) {
          // Released before the new scene was painted, so the old frame is still
          // standing in: update it instead of stacking a second image.
          previous.src = saved
          continue
        }
        const image = document.createElement('img')
        image.className = 'wx-sticker-frame'
        image.alt = ''
        image.src = saved
        entry.cell.append(image)
        frozen.set(index, image)
      }
    }

    function paint(now: number): void {
      frame = 0
      if (disposed || !canvas) return
      // Nothing on screen: stop the loop rather than tick a hidden scene. It is
      // re-armed by `applyLayout` when a cell comes back.
      if (visibleCount === 0) return
      // Painting continues while scrolling: a cell that scrolls into view has no
      // pixels of its own until the shared canvas draws it, so pausing here turned
      // every newly visible cell into an empty box until the scroll stopped. Only
      // the 30 fps cap applies, plus one immediate frame when the visible set changed.
      if (!paintNow && now - lastPaint < FRAME_MS) {
        frame = requestAnimationFrame(paint)
        return
      }
      paintNow = false
      lastPaint = now
      if (startedAt === 0) startedAt = now
      const elapsed = now - startedAt
      for (const entry of built.values()) {
        if (!entry.visible) continue
        const duration = entry.durationMs || 1
        entry.animation.frame(((elapsed % duration) / duration) * entry.totalFrames)
      }
      // A cell being released has been hidden for a while, so it must be drawn one
      // last time or its saved frame would be empty. `flushDrops` removes at most a
      // few per frame, so nothing stays visible off screen for long.
      for (const entry of built.values()) {
        if (entry.dropPending) entry.picture.visible(true)
      }
      canvas.update()
      canvas.render()
      // A saved frame is dropped only once the canvas shows the new scene: removing
      // it when the parse lands would leave the cell blank until the next painted
      // frame.
      for (const [index, entry] of built) {
        if (!entry.visible) continue
        const saved = frozen.get(index)
        if (saved) {
          saved.remove()
          frozen.delete(index)
        }
      }
      flushDrops()
      frame = requestAnimationFrame(paint)
    }

    function ensurePainting(): void {
      if (disposed || frame !== 0 || visibleCount === 0) return
      frame = requestAnimationFrame(paint)
    }

    /**
     * Reads a cell's visibility and bands from `tops`, queues what is about to be
     * read, and marks what has gone too far. Called on every scroll event: it walks
     * the cell boxes, it does not touch the layout, and it disposes nothing — the
     * release happens in `flushDrops`, where the frame can still be read back.
     */
    function applyLayout(): void {
      if (disposed) return
      const view = viewport()
      const bands = stickerWindow(view.scrollTop, view.height)
      const onScreenTo = view.scrollTop + view.height
      const next = new Set<number>()
      for (const [index, box] of tops) {
        if (overlaps(bands.load, box.top, box.top + box.height)) next.add(index)
      }
      wanted = next

      let onScreen = 0
      for (const [index, entry] of built) {
        const box = tops.get(index)
        if (!box) continue
        const visible = box.top + box.height > view.scrollTop && box.top < onScreenTo
        if (entry.visible !== visible) {
          entry.visible = visible
          entry.picture.visible(visible)
          // Just entered the viewport: draw it on the next frame, not in 33 ms.
          if (visible) paintNow = true
        }
        entry.dropPending = !overlaps(bands.drop, box.top, box.top + box.height)
        if (visible) onScreen += 1
      }
      visibleCount = onScreen

      for (const index of wanted) {
        // The band covers every cell; only TGS ones go through the canvas.
        const sticker = stickers[index]
        if (!sticker || sticker.format !== 'tgs') continue
        if (built.has(index) || loading.has(index)) continue
        const failedAt = failed.get(index)
        if (failedAt !== undefined && performance.now() - failedAt < FAILURE_COOLDOWN_MS) continue
        loading.add(index)
        queue.push(index)
      }
      pump()
      ensurePainting()
    }

    function start(index: number): void {
      const sticker = stickers[index]
      const cell = cells.get(index)
      const cellOwner = ownerOf(index)
      if (!engine || !canvas || !sticker || sticker.format !== 'tgs' || !cell) {
        loading.delete(index)
        running -= 1
        return
      }
      const target = canvas
      const tvg = engine
      owners.add(cellOwner)
      void (async () => {
        let url = ''
        try {
          url = await ensureMedia(sticker.fileId, 8, cellOwner)
          if (disposed || !wanted.has(index)) return
          const data = await loadTgsText(url)
          if (disposed || !wanted.has(index)) return

          const animation = new tvg.Animation()
          animation.load(data)
          const picture = animation.picture
          if (!picture) {
            animation.dispose()
            failed.set(index, performance.now())
            return
          }
          const info = animation.info()
          const size = picture.size()
          const inner = Math.max(8, Math.min(cell.clientWidth, cell.clientHeight) - 8)
          const scale = (inner / Math.max(size.width || 1, size.height || 1)) * dpr
          picture.origin(0.5, 0.5)
          picture.scale(scale)
          picture.translate(
            (cell.offsetLeft + cell.offsetWidth / 2) * dpr,
            (cell.offsetTop + cell.offsetHeight / 2) * dpr,
          )
          // Drawn by `applyLayout` only when the cell is on screen.
          picture.visible(false)
          target.add(picture)
          built.set(index, {
            animation,
            picture,
            cell,
            durationMs: (info?.duration || 1) * 1000,
            totalFrames: info?.totalFrames || 1,
            visible: false,
            dropPending: false,
          })
          cell.classList.add('wx-sticker-canvas-cell')
          // The parse above is synchronous; the compositor gets a turn before the
          // next sticker is parsed.
          await yieldToMain()
          if (disposed) return
          applyLayout()
        } catch {
          // One bad sticker keeps its thumbnail (or its saved frame); the grid must
          // not fail for it — and it is left alone for a while, or every scroll
          // event retries it.
          failed.set(index, performance.now())
          if (url) markTgsFailure(url)
        } finally {
          loading.delete(index)
          running -= 1
          if (!disposed) pump()
        }
      })()
    }

    function pump(): void {
      if (disposed) return
      // A parse is a 1–3 ms main-thread block; while the reader is scrolling the
      // queue waits, and the timer below restarts it once the scroll settles.
      if (performance.now() - lastScrollAt < SCROLL_SETTLE_MS) {
        if (pumpTimer === 0) {
          pumpTimer = window.setTimeout(() => {
            pumpTimer = 0
            pump()
          }, SCROLL_SETTLE_MS)
        }
        return
      }
      while (!disposed && running < DECODE_CONCURRENCY && queue.length > 0) {
        const index = queue.shift()
        if (index === undefined) return
        if (built.has(index) || !wanted.has(index)) {
          loading.delete(index)
          continue
        }
        running += 1
        start(index)
      }
    }

    function onScroll(): void {
      lastScrollAt = performance.now()
      applyLayout()
    }

    void (async () => {
      try {
        engine = await loadThorvg()
        if (disposed) return

        const width = Math.max(1, grid.clientWidth)
        const height = Math.max(1, grid.clientHeight)
        // A 120-sticker pack is ~2 000–3 400 CSS px tall; at DPR 2 the backing
        // store would exceed the GPU's 4096 texture limit. Cap the scale so the
        // whole grid always fits one texture.
        dpr = Math.max(0.5, Math.min(2, window.devicePixelRatio || 1, 4096 / height, 4096 / width))
        root.append(canvasElement)
        canvas = new engine.Canvas(canvasElement, {
          width: Math.round(width * dpr),
          height: Math.round(height * dpr),
        })
        // ThorVG sizes the canvas element to its backing store; the layer must
        // stay inside the grid's CSS box or the body grows a horizontal bar.
        canvasElement.style.width = '100%'
        canvasElement.style.height = '100%'

        for (const cell of grid.querySelectorAll<HTMLElement>('[data-sticker-index]')) {
          const index = Number(cell.dataset['stickerIndex'])
          if (Number.isInteger(index)) cells.set(index, cell)
        }
        measureTops()
        if (scroller) scroller.addEventListener('scroll', onScroll, { passive: true })
        else window.addEventListener('scroll', onScroll, { passive: true })
        resizeObserver = new ResizeObserver(() => {
          measureTops()
          applyLayout()
        })
        resizeObserver.observe(grid)
        applyLayout()
      } catch {
        // No ThorVG (old GPU, blocked wasm): the grid keeps its thumbnails.
        if (!disposed) onFailed()
      }
    })()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      frame = 0
      if (pumpTimer !== 0) {
        window.clearTimeout(pumpTimer)
        pumpTimer = 0
      }
      queue.length = 0
      scroller?.removeEventListener('scroll', onScroll)
      window.removeEventListener('scroll', onScroll)
      resizeObserver?.disconnect()
      for (const entry of built.values()) entry.animation.dispose()
      built.clear()
      for (const image of frozen.values()) image.remove()
      frozen.clear()
      canvas?.destroy()
      canvasElement.remove()
      // Cancels whatever is still arriving once nobody else holds it; the grace
      // period in `lib/media` lets a StrictMode remount re-hold the same owner
      // first, so a dev double-mount does not throw the transfer away.
      for (const cellOwner of owners) releaseMedia(cellOwner)
    }
  }, [stickers, owner, onFailed])

  return <div ref={rootRef} className="wx-sticker-canvas-layer" aria-hidden="true" />
}
