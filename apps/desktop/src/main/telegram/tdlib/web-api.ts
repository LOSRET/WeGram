import type { InstantView } from '@wegram/protocol'

import * as actions from './actions'
import type { ActionDeps } from './actions'

/**
 * 即时预览's one TDLib request, bound the way `bot-api.ts` is: the adapter class
 * is at its line budget, and this is a call plus its argument mapping.
 */
export function createWebApi(getDeps: () => ActionDeps) {
  return {
    instantView: async (url: string): Promise<InstantView> =>
      actions.instantView(getDeps(), url),
  }
}
