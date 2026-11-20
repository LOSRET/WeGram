import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Browser-only preview of the renderer.
 *
 * Electron cannot start on every machine/harness (the binary may be blocked by
 * the environment), so the UI can also be verified in a browser against the
 * in-renderer preview bridge (`lib/preview-bridge.ts`). This is a development
 * tool, not a shipping target: there is no `window.tg` in a browser otherwise.
 */
const here = import.meta.dirname

const { version } = JSON.parse(readFileSync(resolve(here, '../../package.json'), 'utf8')) as {
  version: string
}

export default defineConfig({
  root: resolve(here, 'src/renderer'),
  // The browser preview never sees app.getVersion(): inline the root version.
  define: { __WEGRAM_VERSION__: JSON.stringify(version) },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@wegram/mock-fixtures': resolve(here, '../../packages/mock-fixtures/src/index.ts'),
      '@wegram/mock-session': resolve(here, '../../packages/mock-session/src/index.ts'),
      '@wegram/protocol': resolve(here, '../../packages/protocol/src/index.ts'),
      '@renderer': resolve(here, 'src/renderer/src'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    watch: {
      // The editor writes files atomically through a temp dir next to the target;
      // watching those temp files crashes the file watcher with EBUSY on Windows.
      ignored: ['**/*.tmpdir/**', '**/*.tmp'],
    },
  },
})
