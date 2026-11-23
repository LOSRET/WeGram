import { init } from '@thorvg/webcanvas'

import wasmUrl from 'virtual:thorvg-wasm'

/**
 * The one ThorVG WASM engine of this renderer.
 *
 * ThorVG is the renderer behind LottieFiles' dotLottie player: it rasterises
 * Lottie into a canvas, so N stickers share one WebGL scene and one
 * `canvas.render()` instead of N SVG trees (which is what lottie-web costs; see
 * docs/技术方案.md §8.5). Sticker **grids** use it; the transcript keeps lottie-web,
 * where only a handful of stickers is ever visible.
 *
 * The wasm is inlined as a `data:` URL by vite-thorvg-wasm.ts: the packaged shell
 * loads the renderer from `file://`, where the Emscripten loader cannot fetch a
 * sibling .wasm. A failed init resets the promise, so the next grid tries again
 * and a grid that cannot start simply falls back to its still thumbnails.
 */
export type ThorvgEngine = Awaited<ReturnType<typeof init>>

let engine: Promise<ThorvgEngine> | null = null

/** WebGL first; a machine without it still gets the canvas through ThorVG's CPU renderer. */
export function loadThorvg(): Promise<ThorvgEngine> {
  const wasm = { locateFile: (): string => wasmUrl }
  engine ??= init({ ...wasm, renderer: 'gl' })
    .catch(() => init({ ...wasm, renderer: 'sw' }))
    .catch((error: unknown) => {
      engine = null
      throw error
    })
  return engine
}
