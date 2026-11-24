import { describe, expect, it } from 'vitest'

import type { TdObject } from '../client'
import { botCommands } from './bots'

/** The bot-info lookup behind both the "/" menu and the first-open screen. */
function botDeps(description: unknown) {
  return {
    invoke: async (method: TdObject): Promise<unknown> => {
      if (method._ === 'getChat') {
        return { id: 13, type: { _: 'chatTypePrivate', user_id: 26 } }
      }
      if (method._ === 'getUser') return { id: 26, type: { _: 'userTypeBot' } }
      if (method._ === 'getUserFullInfo') {
        return {
          bot_info: {
            description,
            commands: [{ command: 'start', description: '开始' }],
          },
        }
      }
      throw new Error(`unexpected ${String(method._)}`)
    },
  }
}

describe('botCommands', () => {
  it('carries the empty-chat introduction together with the command list', async () => {
    await expect(botCommands(botDeps('你好，我是机器人。'), 13)).resolves.toEqual({
      isBot: true,
      commands: [{ command: 'start', description: '开始' }],
      description: '你好，我是机器人。',
    })
  })

  it('accepts the formattedText shape used by other TDLib builds', async () => {
    await expect(
      botCommands(botDeps({ _: 'formattedText', text: '  点下面的按钮开始  ' }), 13),
    ).resolves.toMatchObject({ description: '点下面的按钮开始' })
  })

  it('keeps an empty introduction valid so the Start button still appears', async () => {
    await expect(botCommands(botDeps(''), 13)).resolves.toMatchObject({
      isBot: true,
      description: '',
    })
  })
})
