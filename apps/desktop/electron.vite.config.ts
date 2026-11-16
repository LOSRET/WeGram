import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const protocolAlias = {
  '@wechatgram/protocol': resolve(__dirname, '../../packages/protocol/src/index.ts'),
}

const shared = {
  resolve: { alias: protocolAlias },
}

export default defineConfig({
  main: {
    ...shared,
    plugins: [externalizeDepsPlugin({ exclude: ['@wechatgram/protocol'] })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    ...shared,
    plugins: [externalizeDepsPlugin({ exclude: ['@wechatgram/protocol'] })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    ...shared,
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
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
