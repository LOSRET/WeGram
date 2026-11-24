import type { InlineQueryAnswer, InlineResult } from '@wegram/protocol'

import type { TdObject } from '../client'
import { asArray } from '../json'

/**
 * Inline query results (§8.3): `@bot query` in the composer, answered by TDLib's
 * `getInlineQueryResults`.
 *
 * TDLib splits a result over twelve `inlineQueryResult*` objects, and every one of
 * them names its payload differently (`article`, `photo`, `sticker`, …). The picker
 * draws one row per result — a thumbnail, a title, a description and the kind — so
 * this is the one place that reads a result's own words instead of letting the
 * renderer walk twelve shapes. A type this client does not know is dropped: an
 * empty row that sends something is worse than a shorter list.
 */

/** The row's word per TDLib type. */
const KIND: Record<string, string> = {
  inlineQueryResultArticle: '文章',
  inlineQueryResultContact: '联系人',
  inlineQueryResultLocation: '位置',
  inlineQueryResultVenue: '地点',
  inlineQueryResultGame: '游戏',
  inlineQueryResultAnimation: '动图',
  inlineQueryResultAudio: '音频',
  inlineQueryResultDocument: '文件',
  inlineQueryResultPhoto: '图片',
  inlineQueryResultSticker: '贴纸',
  inlineQueryResultVideo: '视频',
  inlineQueryResultVoiceNote: '语音',
}

/**
 * A TDLib `inlineQueryResults` object as the picker's DTO.
 *
 * `inline_query_id` is an int64 — it travels as a string, because a number past
 * 2^53 would lose digits and the id is what `sendInlineQueryResultMessage` wants
 * back. A missing id (TDLib refused the query) yields an empty answer, which the
 * picker reads as "this bot gave nothing".
 */
export function mapInlineResults(raw: TdObject | undefined): InlineQueryAnswer {
  const queryId = raw?.inline_query_id === undefined ? '' : String(raw.inline_query_id)
  const results = asArray<TdObject>(raw?.results).flatMap((result) => {
    const mapped = mapInlineResult(result)
    return mapped ? [mapped] : []
  })
  return {
    queryId,
    nextOffset: typeof raw?.next_offset === 'string' ? raw.next_offset : '',
    results,
  }
}

/** One `inlineQueryResult*`; `null` for a type this client draws nothing for. */
export function mapInlineResult(result: TdObject | undefined): InlineResult | null {
  const kind = KIND[String(result?._)]
  if (!kind || !result) return null
  const id = typeof result.id === 'string' ? result.id.trim() : ''
  if (!id) return null
  const { title, description, thumb } = wordsOf(result)
  return {
    id,
    kind,
    title: title || kind,
    ...(description ? { description } : {}),
    ...(thumb ? { thumbFileId: thumb } : {}),
  }
}

/**
 * The words a result shows, whatever its payload names them.
 *
 * The left column is the one field every client prints first (a title, a person's
 * name, a sticker's emoji), the right column is the second line — and a thumbnail
 * is always optional, so a row without one is still a row.
 */
function wordsOf(result: TdObject): {
  title: string
  description: string
  thumb: number | undefined
} {
  switch (result._) {
    case 'inlineQueryResultArticle':
      return {
        title: text(result.title),
        description: text(result.description),
        thumb: thumbnailFileId(result.thumbnail),
      }
    case 'inlineQueryResultContact': {
      const contact = result.contact ?? {}
      const name = [contact.first_name, contact.last_name]
        .map((part: unknown) => text(part))
        .filter(Boolean)
        .join(' ')
      return {
        title: name || text(contact.phone_number),
        description: text(contact.phone_number),
        thumb: thumbnailFileId(result.thumbnail),
      }
    }
    case 'inlineQueryResultLocation':
      return {
        title: text(result.title),
        description: '',
        thumb: thumbnailFileId(result.thumbnail),
      }
    case 'inlineQueryResultVenue': {
      const venue = result.venue ?? {}
      return {
        title: text(venue.title),
        description: text(venue.address),
        thumb: thumbnailFileId(result.thumbnail),
      }
    }
    case 'inlineQueryResultGame': {
      const game = result.game ?? {}
      return {
        title: text(game.title),
        description: text(game.description),
        thumb: photoFileId(game.photo),
      }
    }
    case 'inlineQueryResultAnimation': {
      const animation = result.animation ?? {}
      return {
        title: text(result.title),
        description: text(animation.file_name),
        thumb: thumbnailFileId(animation.thumbnail),
      }
    }
    case 'inlineQueryResultAudio': {
      const audio = result.audio ?? {}
      return {
        title: text(audio.title) || text(audio.file_name),
        description: [text(audio.performer), text(audio.file_name)].filter(Boolean).join(' · '),
        thumb: thumbnailFileId(audio.album_cover_thumbnail),
      }
    }
    case 'inlineQueryResultDocument': {
      const document = result.document ?? {}
      return {
        title: text(result.title) || text(document.file_name),
        description: text(result.description),
        thumb: thumbnailFileId(document.thumbnail),
      }
    }
    case 'inlineQueryResultPhoto':
      return {
        title: text(result.title),
        description: text(result.description),
        thumb: photoFileId(result.photo),
      }
    case 'inlineQueryResultSticker': {
      const sticker = result.sticker ?? {}
      return {
        title: text(sticker.emoji) || '贴纸',
        description: sticker.is_premium ? 'Premium' : '',
        thumb: thumbnailFileId(sticker.thumbnail),
      }
    }
    case 'inlineQueryResultVideo': {
      const video = result.video ?? {}
      return {
        title: text(result.title) || text(video.file_name),
        description: text(result.description),
        thumb: thumbnailFileId(video.thumbnail),
      }
    }
    case 'inlineQueryResultVoiceNote': {
      const voiceNote = result.voice_note ?? {}
      return {
        title: text(result.title) || '语音',
        description: durationText(voiceNote.duration),
        thumb: undefined,
      }
    }
    default:
      return { title: '', description: '', thumb: undefined }
  }
}

/** A TDLib string field, trimmed; anything else is "". */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** `thumbnail.file.id`, when the result carries a thumbnail at all. */
function thumbnailFileId(thumbnail: TdObject | undefined): number | undefined {
  return fileId(thumbnail?.file?.id)
}

/** A photo's largest size: TDLib lists them smallest-first. */
function photoFileId(photo: TdObject | undefined): number | undefined {
  const sizes = asArray<TdObject>(photo?.sizes)
  const last = sizes[sizes.length - 1]
  return fileId(last?.photo?.id)
}

function fileId(value: unknown): number | undefined {
  const id = Number(value ?? 0)
  return Number.isFinite(id) && id > 0 ? id : undefined
}

/** A voice note's length as "1:05"; TDLib only gives seconds. */
function durationText(value: unknown): string {
  const seconds = Math.max(0, Math.round(Number(value ?? 0)))
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}
