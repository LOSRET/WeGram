import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

import { thorvgWasm } from './vite-thorvg-wasm'

/**
 * The root package.json is the single source of truth for the version (see
 * scripts/sync-version.mjs). The renderer has no access to Electron's
 * app.getVersion(), so the value is inlined here; main reads app.getVersion().
 */
const { version } = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
  version: string
}

const protocolAlias = {
  '@wegram/mock-fixtures': resolve(__dirname, '../../packages/mock-fixtures/src/index.ts'),
  '@wegram/mock-session': resolve(__dirname, '../../packages/mock-session/src/index.ts'),
  '@wegram/protocol': resolve(__dirname, '../../packages/protocol/src/index.ts'),
}

/**
 * Main-process only: the adapter seam and the fake adapter. Kept out of the
 * shared alias so a renderer import cannot pull `node:fs` in by accident.
 */
const adapterAlias = {
  '@wegram/adapter-contract': resolve(__dirname, '../../packages/adapter-contract/src/index.ts'),
  '@wegram/mock-adapter': resolve(__dirname, '../../packages/mock-adapter/src/index.ts'),
}

const shared = {
  resolve: { alias: protocolAlias },
}

/**
 * A release artifact carries the deployment's own my.telegram.org credentials. They
 * are not user secrets — every official client ships its own — but they must never be
 * committed, so they are inlined from the environment and into the main bundle only.
 * Release CI supplies them from repository secrets; a source build inlines `""` and
 * the app falls back to the mock adapter (dev) or refuses to start (packaged).
 */
function apiCredentials(): string {
  const apiId = Number(process.env['TELEGRAM_API_ID'] ?? 0)
  const apiHash = (process.env['TELEGRAM_API_HASH'] ?? '').trim()
  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) return JSON.stringify('')
  return JSON.stringify(JSON.stringify({ apiId, apiHash }))
}

export default defineConfig({
  main: {
    ...shared,
    resolve: { alias: { ...protocolAlias, ...adapterAlias } },
    define: { __WEGRAM_API_CREDENTIALS__: apiCredentials() },
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@wegram/adapter-contract',
          '@wegram/mock-adapter',
          '@wegram/protocol',
          '@wegram/mock-session',
          '@wegram/mock-fixtures',
        ],
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // win-hello is synchronous; Mini App biometric prompts run off the main thread.
          'biometry-worker': resolve(__dirname, 'src/main/biometry-worker.ts'),
        },
      },
    },
  },
  preload: {
    ...shared,
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@wegram/protocol', '@wegram/mock-session', '@wegram/mock-fixtures'],
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          // The guest web view a Mini App loads runs with its own preload: the
          // host's `window.tg` API must never be visible to a remote page.
          miniapp: resolve(__dirname, 'src/preload/miniapp.ts'),
        },
      },
    },
  },
  renderer: {
    ...shared,
    root: resolve(__dirname, 'src/renderer'),
    define: { __WEGRAM_VERSION__: JSON.stringify(version) },
    plugins: [react(), tailwindcss(), thorvgWasm(__dirname)],
    // ThorVG's canvas locates thorvg.wasm next to its ESM; prebundling would move
    // import.meta.url into .vite/deps and the loader would fetch a missing file.
    optimizeDeps: { exclude: ['@thorvg/webcanvas'] },
    resolve: {
      alias: {
        ...protocolAlias,
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    server: {
      watch: {
        // Atomic-save temp dirs make the Windows file watcher throw EBUSY.
        ignored: ['**/*.tmpdir/**', '**/*.tmp'],
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
})
