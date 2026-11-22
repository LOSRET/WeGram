import { describe, expect, it } from 'vitest'

import type { TdObject } from '../client'
import { mapReportResult } from './report'

describe('mapReportResult', () => {
  it('reads the filed answer', () => {
    expect(mapReportResult({ _: 'reportChatResultOk' })).toEqual({ reported: true })
  })

  it('names the reasons the first phase returns, keeping their ids verbatim', () => {
    const answer = mapReportResult({
      _: 'reportChatResultOptionRequired',
      title: '举报这个聊天',
      options: [
        { _: 'reportOption', id: 'c3BhbQ==', text: '垃圾信息', type: {} },
        { _: 'reportOption', id: 'b3RoZXI=', text: '其他', type: {} },
      ],
    } as TdObject)

    expect(answer.reported).toBe(false)
    expect(answer.title).toBe('举报这个聊天')
    // The ids are TDLib bytes (base64 here): handed back untouched, never decoded.
    expect(answer.options).toEqual([
      { id: 'c3BhbQ==', text: '垃圾信息' },
      { id: 'b3RoZXI=', text: '其他' },
    ])
  })

  it('carries the new id a comment step must send back', () => {
    const answer = mapReportResult({
      _: 'reportChatResultTextRequired',
      option_id: 'dGV4dA==',
      is_optional: false,
    } as TdObject)

    expect(answer).toEqual({ reported: false, textRequired: true, optionId: 'dGV4dA==' })
  })

  it('marks the comment step optional when TDLib allows skipping it', () => {
    const answer = mapReportResult({
      _: 'reportChatResultTextRequired',
      option_id: 'dGV4dA==',
      is_optional: true,
    } as TdObject)

    expect(answer).toEqual({
      reported: false,
      textRequired: true,
      optionId: 'dGV4dA==',
      textOptional: true,
    })
  })

  it('reports the per-message requirement instead of claiming success', () => {
    expect(mapReportResult({ _: 'reportChatResultMessagesRequired' })).toEqual({
      reported: false,
      messagesRequired: true,
    })
  })

  it('treats an unknown answer as "not filed", never as success', () => {
    expect(mapReportResult({ _: 'somethingNew' })).toEqual({ reported: false })
    expect(mapReportResult(undefined)).toEqual({ reported: false })
  })
})
