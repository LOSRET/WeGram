import type { InvokeChannel } from '@wegram/protocol'

import { RECENT_EMOJI_LIMIT } from '../emoji'

/**
 * The `ui:*` channels of the browser preview, split out of `preview/index.ts`
 * when that file reached its size budget.
 *
 * In Electron these rows live in `ui.db` (drafts, reading positions, recent
 * emoji). The preview keeps the same shapes in memory for the session, so the
 * composer's draft restore, the transcript's landing position and the picker's
 * 最近使用 row behave the same way in a plain browser.
 */
interface PreviewUiStore {
  drafts: Record<number, string>
  anchors: Record<number, { messageId: number; offset: number }>
  /** Comment-thread positions, keyed `chatId:messageId` like the `ui.db` row. */
  commentAnchors: Record<string, { messageId: number; offset: number }>
  recentEmoji: string[]
  /** The 图片和视频 window's 音量; `null` is "never dragged", which plays at full. */
  viewerVolume: number | null
}

export const previewUiStore: PreviewUiStore = {
  drafts: {},
  anchors: {},
  commentAnchors: {},
  recentEmoji: [],
  viewerVolume: null,
}

type PreviewUiPayload = Record<string, unknown>

export function handlePreviewUi(channel: InvokeChannel, payload: PreviewUiPayload): unknown {
  const store = previewUiStore
  const chatId = Number(payload['chatId'])
  switch (channel) {
    case 'ui:getDraft': {
      const text = store.drafts[chatId]
      return text ? { text } : null
    }
    case 'ui:saveDraft': {
      const text = String(payload['text'] ?? '')
      if (text.trim().length) store.drafts[chatId] = text
      else delete store.drafts[chatId]
      return undefined
    }
    case 'ui:getAnchor':
      return store.anchors[chatId] ?? null
    case 'ui:saveAnchor': {
      const messageId = payload['messageId'] as number | null
      if (messageId === null) delete store.anchors[chatId]
      else store.anchors[chatId] = { messageId, offset: Number(payload['offset'] ?? 0) }
      return undefined
    }
    case 'ui:getCommentAnchor': {
      const key = `${chatId}:${String(payload['messageId'])}`
      return store.commentAnchors[key] ?? null
    }
    case 'ui:saveCommentAnchor': {
      const key = `${chatId}:${String(payload['messageId'])}`
      store.commentAnchors[key] = {
        messageId: Number(payload['anchorMessageId']),
        offset: Number(payload['offset'] ?? 0),
      }
      return undefined
    }
    case 'ui:getViewerVolume':
      return store.viewerVolume
    case 'ui:setViewerVolume': {
      const level = Number(payload['volume'])
      store.viewerVolume = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : null
      return undefined
    }
    case 'ui:getRecentEmoji':
      return store.recentEmoji
    case 'ui:saveRecentEmoji': {
      const list: unknown = payload['emoji']
      store.recentEmoji = Array.isArray(list)
        ? list
            .filter((item): item is string => typeof item === 'string')
            .slice(0, RECENT_EMOJI_LIMIT)
        : []
      return undefined
    }
    default:
      return undefined
  }
}
