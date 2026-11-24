import { AppError } from '@wegram/protocol'
import type { BotCommandsAnswer, CallbackAnswer, InlineButtonCallback } from '@wegram/protocol'

import type { Fixture } from './constants'

/**
 * The fake bot's two endpoints: the commands it publishes and the answer to a
 * pressed inline button.
 *
 * The fixture account carries one bot (`WeGram 助手`), so the composer's "/" list
 * and the inline keyboard are exercised without a Telegram account. Its answer is
 * canned — there is no bot server behind it — and it says so.
 */

/** A chat that is not the fixture bot answers "no commands", like TDLib does. */
export function mockBotCommands(fixtures: Map<number, Fixture>, chatId: number): BotCommandsAnswer {
  const bot = fixtures.get(chatId)?.bot
  return bot ? { isBot: true, commands: bot.commands } : { isBot: false, commands: [] }
}

/**
 * Pressing a callback button in the mock: the fixture's bot answers at once.
 * A button that needs the 2-step password is refused, exactly like the real
 * adapter refuses it — the client has no password prompt.
 */
export function mockCallbackAnswer(
  fixtures: Map<number, Fixture>,
  input: { chatId: number; callback: InlineButtonCallback },
): CallbackAnswer {
  const bot = fixtures.get(input.chatId)?.bot
  if (!bot) throw new AppError('not_implemented', '这个会话不是机器人')
  if (input.callback.type === 'password') {
    throw new AppError('not_implemented', '需要两步验证密码的按钮暂未支持')
  }
  // The fixture's two buttons demo both answers the real adapter can draw: a
  // toast, and an alert the shell shows as a one-button dialog.
  if (input.callback.type === 'data' && input.callback.data === 'alert') {
    return {
      text: '这是一个模拟的机器人弹窗。\n第二行说明换行也会保留。',
      showAlert: true,
    }
  }
  return { text: '机器人收到了这次点击（模拟）' }
}
