import { AppError } from '@wegram/protocol'
import type {
  BotCommandsAnswer,
  CallbackAnswer,
  InlineButtonCallback,
  InlineQueryAnswer,
} from '@wegram/protocol'

import type { Fixture } from './constants'

/**
 * The fake bot's endpoints: the commands it publishes, the answer to a pressed
 * inline button, and inline queries (`@username query`, §8.3).
 *
 * The fixture account carries one bot (`WeGram 助手`), so the composer's "/" list,
 * the inline keyboard and the inline picker are exercised without a Telegram
 * account. Its answers are canned — there is no bot server behind it — and they
 * say so.
 *
 * A factory rather than loose functions because an inline query has to remember
 * what it answered: TDLib names a query with an id, and sending a result posts
 * that id plus the result's own id back.
 */
export function createMockBots(fixtures: Map<number, Fixture>) {
  /** queryId → its results (result id → the text the fake sends). */
  const queries = new Map<string, Map<string, string>>()
  let sequence = 0

  /** The fixture bot that owns an @username, or `null` for anything else. */
  const botWithUsername = (username: string): Fixture | null => {
    const handle = username.replace(/^@/, '').trim().toLowerCase()
    if (!handle) return null
    for (const fixture of fixtures.values()) {
      const bot = fixture.bot
      if (bot?.username && bot.username.toLowerCase() === handle) return fixture
    }
    return null
  }

  /** A chat that is not the fixture bot answers "no commands", like TDLib does. */
  const commands = (chatId: number): BotCommandsAnswer => {
    const bot = fixtures.get(chatId)?.bot
    return bot ? { isBot: true, commands: bot.commands } : { isBot: false, commands: [] }
  }

  /**
   * Pressing a callback button in the mock: the fixture's bot answers at once.
   * A button that needs the 2-step password is refused, exactly like the real
   * adapter refuses it — the client has no password prompt.
   */
  const callback = (input: { chatId: number; callback: InlineButtonCallback }): CallbackAnswer => {
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

  /**
   * `@bot query`: three article results built from the query, so the picker can be
   * walked without a bot server. Only article results exist here — the real
   * adapter also maps photos, stickers, gifs and files.
   */
  const inlineQuery = (input: {
    chatId: number
    username: string
    query: string
    offset?: string
  }): InlineQueryAnswer => {
    const handle = input.username.replace(/^@/, '').trim()
    if (!botWithUsername(handle)) throw new AppError('invalid_payload', `找不到 @${handle}`)
    // One page only: the fixture has three rows and no cursor.
    if (input.offset) return { queryId: '', nextOffset: '', results: [] }
    const query = input.query.trim()
    const echo = query || '你好'
    const rows: Array<{
      id: string
      kind: string
      title: string
      description: string
      text: string
    }> = [
      {
        id: 'echo',
        kind: '文章',
        title: echo,
        description: '把这句话发出去（模拟 inline 结果）',
        text: echo,
      },
      {
        id: 'about',
        kind: '文章',
        title: 'WeGram 助手 · 关于',
        description: '模拟的第二个结果',
        text: 'WeGram 助手：这是一个模拟的 inline 结果。',
      },
      {
        id: 'help',
        kind: '文章',
        title: '/help',
        description: '把命令发给机器人',
        text: '/help',
      },
    ]
    const queryId = `mock-inline-${sequence}`
    sequence += 1
    queries.set(queryId, new Map(rows.map((row) => [row.id, row.text])))
    return {
      queryId,
      nextOffset: '',
      results: rows.map(({ id, kind, title, description }) => ({ id, kind, title, description })),
    }
  }

  /** The text one answered result sends; a stale query id is refused. */
  const inlineResultText = (input: { queryId: string; resultId: string }): string => {
    const text = queries.get(input.queryId)?.get(input.resultId)
    if (text === undefined)
      throw new AppError('invalid_payload', '这个 inline 结果已过期，请重新输入')
    return text
  }

  return { commands, callback, inlineQuery, inlineResultText }
}
