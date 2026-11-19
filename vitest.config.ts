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
