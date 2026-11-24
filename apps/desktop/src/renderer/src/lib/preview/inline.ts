import type { InlineQueryAnswer } from '@wegram/protocol'

import { previewBotUsername } from './fixtures'
import { handlePreviewSend, type PreviewSendContext } from './sends'

/**
 * inline 机器人 in the browser preview (§8.3): `@bot query` answered by the
 * fixture bot, and one result sent as a text message.
 *
 * The real answer is TDLib's; the preview mints the same shape. Its query id
 * carries the query text, so "sending a result" needs no session state: decode
 * the id, pick the row, and post it through the ordinary send path — which is
 * what the mock adapter does with a map.
 */

export const INLINE_CHANNELS = ['bots:inlineQuery', 'bots:inlineSend'] as const

export function isPreviewInlineChannel(channel: string): boolean {
  return (INLINE_CHANNELS as readonly string[]).includes(channel)
}

interface InlineRow {
  id: string
  kind: string
  title: string
  description: string
  text: string
}

/**
 * The preview's three article results, built from the query. Only article rows
 * exist here — the real mapper also draws photos, stickers, gifs and files.
 */
function rowsFor(query: string): InlineRow[] {
  const echo = query.trim() || '你好'
  return [
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
}

/** The carrier for the query text: TDLib's int64 id is opaque, so is this. */
const QUERY_PREFIX = 'preview-inline:'

export function handlePreviewInline(
  channel: string,
  payload: Record<string, unknown>,
  ctx: PreviewSendContext,
): InlineQueryAnswer | { localId: string; message: unknown } {
  switch (channel) {
    case 'bots:inlineQuery': {
      const handle = String(payload['username'] ?? '')
        .replace(/^@/, '')
        .trim()
        .toLowerCase()
      if (!handle || handle !== previewBotUsername()) {
        throw { code: 'invalid_payload', message: `找不到 @${handle}` }
      }
      // One page: the fixture has three rows and no cursor.
      if (payload['offset']) return { queryId: '', nextOffset: '', results: [] }
      const query = String(payload['query'] ?? '')
      return {
        queryId: QUERY_PREFIX + encodeURIComponent(query),
        nextOffset: '',
        results: rowsFor(query).map(({ id, kind, title, description }) => ({
          id,
          kind,
          title,
          description,
        })),
      }
    }
    case 'bots:inlineSend': {
      const text = resultText(String(payload['queryId'] ?? ''), String(payload['resultId'] ?? ''))
      // A sent inline result is an ordinary outgoing message; the send module
      // owns the row, the chat preview and the event.
      return handlePreviewSend(
        'messages:send',
        {
          chatId: payload['chatId'],
          text,
          ...(payload['topicId'] === undefined ? {} : { topicId: payload['topicId'] }),
        },
        ctx,
      ) as { localId: string; message: unknown }
    }
    default:
      throw { code: 'not_implemented', message: `${channel} is not a preview inline channel` }
  }
}

/** The text an answered result sends; a stale query id is refused. */
function resultText(queryId: string, resultId: string): string {
  if (!queryId.startsWith(QUERY_PREFIX)) {
    throw { code: 'invalid_payload', message: '这个 inline 结果已过期，请重新输入' }
  }
  const query = decodeURIComponent(queryId.slice(QUERY_PREFIX.length))
  const row = rowsFor(query).find((item) => item.id === resultId)
  if (!row) throw { code: 'invalid_payload', message: '这个 inline 结果已过期，请重新输入' }
  return row.text
}
