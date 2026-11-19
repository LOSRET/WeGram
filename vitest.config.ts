import { defineConfig } from 'vitest/config'

/**
 * One test runner for the whole workspace (`pnpm test`).
 *
 * Scope: pure modules only — DTO mapping, reducers, formatters, parsers. There is
 * deliberately no DOM environment here: React components are exercised through
 * the mock adapter in the real Electron window, and the browser preview
 * (`pnpm web`), because their bugs are timing/measurement bugs that jsdom cannot
 * reproduce (see docs/HANDOFF.md "Non-obvious facts").
 */
export default defineConfig({
  // The renderer bundle gets this from electron.vite.config.ts / vite.web.config.ts.
  // Tests that import renderer modules (the fixture parity check) need the same
  // substitution, or the module throws on an undefined global.
  define: { __WEGRAM_VERSION__: JSON.stringify('0.0.0-test') },
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/desktop/src/**/*.test.ts',
      'apps/desktop/scripts/**/*.test.ts',
    ],
    environment: 'node',
    // Tests must be independent: a leaked timer would hide the exact kind of
    // stuck-state bug this project keeps hitting.
    restoreMocks: true,
    clearMocks: true,
  },
})
