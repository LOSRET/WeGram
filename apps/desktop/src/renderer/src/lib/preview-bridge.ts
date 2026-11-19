/**
 * Dev-only entry point for the browser preview (`pnpm web`).
 *
 * The implementation lives in `preview/` (session + invoke switch in `index.ts`,
 * fixture data in `fixtures.ts`). App logic must never import this module: it
 * only runs when `window.tg` does not exist.
 */
export { installPreviewBridge } from './preview'
