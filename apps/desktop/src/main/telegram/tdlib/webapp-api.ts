import type { MiniAppLaunch, MiniAppOpenRequest } from '@wegram/protocol'

import * as actions from './actions'
import type { ActionDeps } from './actions'

/**
 * Mini Apps' seam methods — resolve a signed URL, release a launch and post
 * `WebApp.sendData` back — bound the way `bot-api.ts` is: the adapter class is
 * at its line budget, and these are one call plus their arguments.
 *
 * The deps arrive lazily because this object is built before the constructor
 * has finished creating `actionDeps`.
 */
export function createMiniAppApi(getDeps: () => ActionDeps) {
  return {
    openMiniApp: async (
      input: MiniAppOpenRequest,
      theme: 'light' | 'dark',
    ): Promise<MiniAppLaunch> => actions.openMiniApp(getDeps(), input, theme),
    invokeWebAppCustomRequest: async (input: {
      botUserId: number
      method: string
      parameters: string
    }): Promise<unknown> => actions.invokeMiniAppCustomRequest(getDeps(), input),
    closeMiniApp: async (launchId?: string): Promise<void> =>
      actions.closeMiniApp(getDeps(), launchId),
    sendMiniAppData: async (input: {
      botUserId: number
      buttonText: string
      data: string
    }): Promise<void> => actions.sendMiniAppData(getDeps(), input),
  }
}
