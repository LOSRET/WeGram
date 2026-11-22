import type { ChatReport } from '@wegram/protocol'

import type { TdObject } from '../client'

/**
 * One `reportChat` answer, mapped into the shape the 举报 sheet drives.
 *
 * TDLib files a report in phases: the first call (no reason) answers
 * `reportChatResultOptionRequired` with the reasons this chat kind offers, the
 * second carries one of those ids, and some reasons then insist on a comment
 * (`reportChatResultTextRequired`, with a *new* id to use for that last step).
 * `reportChatResultMessagesRequired` wants messages picked instead of a chat —
 * a per-message path this client does not build — and `reportChatResultOk` is
 * the end. The ids are TDLib `bytes`: they travel as the base64 strings TDLib
 * sent and are never inspected here.
 */
export function mapReportResult(result: TdObject | undefined): ChatReport {
  switch (result?._) {
    case 'reportChatResultOk':
      return { reported: true }
    case 'reportChatResultOptionRequired': {
      const options = asObjects(result.options).map((option) => ({
        id: String(option.id ?? ''),
        text: String(option.text ?? ''),
      }))
      return {
        reported: false,
        ...(typeof result.title === 'string' && result.title ? { title: result.title } : {}),
        options: options.filter((option) => option.id !== ''),
      }
    }
    case 'reportChatResultTextRequired':
      return {
        reported: false,
        textRequired: true,
        ...(typeof result.option_id === 'string' ? { optionId: result.option_id } : {}),
      }
    case 'reportChatResultMessagesRequired':
      return { reported: false, messagesRequired: true }
    default:
      // An unknown constructor is not silently "reported": the caller would show a
      // success toast for a report Telegram never filed.
      return { reported: false }
  }
}

/** TDLib arrays are sometimes absent on an empty answer. */
function asObjects(value: unknown): TdObject[] {
  return Array.isArray(value) ? (value as TdObject[]) : []
}
