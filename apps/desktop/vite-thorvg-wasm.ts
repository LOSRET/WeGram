import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

import type { Plugin } from 'vite'

const MODULE_ID = 'virtual:thorvg-wasm'

/**
 * ThorVG's Emscripten glue fetches `thorvg.wasm` next to its module. That works
 * while the renderer is served over http (the browser preview and `electron-vite
 * dev`), but the packaged shell loads the renderer from `file://`, where fetch()
 * cannot read a sibling file — so the binary is exposed as a `data:` URL instead.
 *
 * Reading it out of the installed package keeps the wasm in step with the JS and
 * avoids a checked-in binary: `import wasmUrl from 'virtual:thorvg-wasm'`.
 */
export function thorvgWasm(appDir: string): Plugin {
  const resolved = '\0' + MODULE_ID
  return {
    name: 'wegram-thorvg-wasm',
    resolveId(source) {
      return source === MODULE_ID ? resolved : null
    },
    load(source) {
      if (source !== resolved) return null
      // Resolve from the app package so pnpm's per-package node_modules link is
      // used, wherever the config is loaded from.
      const require = createRequire(resolve(appDir, 'package.json'))
      const entry = require.resolve('@thorvg/webcanvas')
      const wasm = readFileSync(join(dirname(entry), 'thorvg.wasm'))
      const dataUrl = 'data:application/wasm;base64,' + wasm.toString('base64')
      return 'export default ' + JSON.stringify(dataUrl)
    },
  }
}
