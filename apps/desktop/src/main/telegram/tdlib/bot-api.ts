import type { BotCommandsAnswer, CallbackAnswer, InvokeRequest } from '@wegram/protocol'

import * as actions from './actions'
import type { ActionDeps } from './actions'

/**
 * The bot-domain seam methods — the composer's command list and pressing an
 * inline button — as one object `TdlibAdapter` binds. Split out of `index.ts`
 * the way `user-api.ts` was: the adapter class is at its line budget, and these
 * are a call plus its arguments.
 *
 * The deps come in lazily: this object is built before the constructor has
 * finished creating `actionDeps`, and every method reads them on the call.
 */
export function createBotApi(getDeps: () => ActionDeps) {
  return {
    /** The commands the chat's bot publishes; a non-bot chat answers none. */
    botCommands: async (chatId: number): Promise<BotCommandsAnswer> =>
      actions.botCommands(getDeps(), chatId),

    /** Presses one inline keyboard button and answers what the bot said back. */
    pressCallback: async (input: InvokeRequest<'bots:callback'>): Promise<CallbackAnswer> =>
      actions.pressCallback(getDeps(), input),
  }
}
