import type { Message, MessageKind } from '@wegram/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  avatarColor,
  formatChatTime,
  formatClock,
  formatDaySeparator,
  formatDuration,
  formatMessageTime,
  formatPhone,
  initials,
  isSameDay,
  messagePreview,
  previewSegments,
} from './format'

/**
 * Every formatter here compares against "now", so the clock is pinned. Timestamps
 * are built with the local `Date` constructor on purpose: the assertions then hold
 * in any timezone instead of only in Asia/Shanghai.
 */
const NOW = new Date(2026, 10, 17, 18, 30, 0) // Tue 17 Nov 2026, 18:30 local

const seconds = (year: number, month: number, day: number, hour = 9, minute = 5): number =>
  Math.floor(new Date(year, month, day, hour, minute, 0).getTime() / 1000)

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    chatId: 10,
    senderId: 1000,
    senderName: '测试',
    outgoing: false,
    date: seconds(2026, 10, 17),
    kind: 'text' as MessageKind,
    text: 'hello',
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('formatClock', () => {
  it('pads both halves to two digits', () => {
    expect(formatClock(new Date(2026, 10, 17, 9, 5))).toBe('09:05')
    expect(formatClock(new Date(2026, 10, 17, 18, 30))).toBe('18:30')
    expect(formatClock(new Date(2026, 10, 17, 0, 0))).toBe('00:00')
  })
})

describe('formatMessageTime', () => {
  it('renders the message clock as HH:MM', () => {
    expect(formatMessageTime(seconds(2026, 10, 17, 23, 59))).toBe('23:59')
  })
})

describe('formatPhone', () => {
  it('adds the leading + Telegram omits', () => {
    expect(formatPhone('8613800000000')).toBe('+8613800000000')
  })

  it('leaves an already international number alone', () => {
    expect(formatPhone('+49 151 0000 0000')).toBe('+49 151 0000 0000')
  })

  it('is empty for an empty value', () => {
    expect(formatPhone('   ')).toBe('')
  })
})

describe('formatChatTime', () => {
  it('is empty for a row without a timestamp', () => {
    expect(formatChatTime(undefined)).toBe('')
    expect(formatChatTime(0)).toBe('')
  })

  it('shows the clock for today', () => {
    expect(formatChatTime(seconds(2026, 10, 17, 9, 5))).toBe('09:05')
  })

  it('shows 昨天 for yesterday', () => {
    expect(formatChatTime(seconds(2026, 10, 16, 23, 59))).toBe('昨天 23:59')
  })

  it('shows 星期X between 2 and 6 days back', () => {
    // 14 Nov 2026 is a Saturday.
    expect(formatChatTime(seconds(2026, 10, 14, 12, 0))).toBe('星期六')
    // 11 Nov 2026 is a Wednesday.
    expect(formatChatTime(seconds(2026, 10, 11, 12, 0))).toBe('星期三')
  })

  it('shows MM/DD from a week back inside the same year', () => {
    expect(formatChatTime(seconds(2026, 9, 3, 8, 0))).toBe('10/03')
  })

  it('adds the year for older messages', () => {
    expect(formatChatTime(seconds(2025, 11, 31, 8, 0))).toBe('2025/12/31')
  })
})

describe('formatDaySeparator', () => {
  it('uses 今天 for the current day', () => {
    expect(formatDaySeparator(seconds(2026, 10, 17, 7, 2))).toBe('今天 07:02')
  })

  it('uses 昨天 for the previous day', () => {
    expect(formatDaySeparator(seconds(2026, 10, 16, 23, 59))).toBe('昨天 23:59')
  })

  it('uses a bare weekday inside the last week', () => {
    expect(formatDaySeparator(seconds(2026, 10, 14, 12, 0))).toBe('周六 12:00')
  })

  it('uses M月D日 inside the same year', () => {
    expect(formatDaySeparator(seconds(2026, 0, 5, 8, 30))).toBe('1月5日 08:30')
  })

  it('adds the year for older days', () => {
    expect(formatDaySeparator(seconds(2025, 11, 31, 8, 30))).toBe('2025年12月31日 08:30')
  })
})

describe('isSameDay', () => {
  it('compares calendar days, not instants', () => {
    expect(isSameDay(seconds(2026, 10, 17, 0, 0), seconds(2026, 10, 17, 23, 59))).toBe(true)
    expect(isSameDay(seconds(2026, 10, 17, 23, 59), seconds(2026, 10, 18, 0, 1))).toBe(false)
  })
})

describe('initials', () => {
  it('takes the first two characters', () => {
    expect(initials('微信团队')).toBe('微信')
    expect(initials('Lin')).toBe('Li')
  })

  it('falls back to ? for a blank title', () => {
    expect(initials('   ')).toBe('?')
  })
})

describe('avatarColor', () => {
  it('is stable and never undefined, including for negative ids', () => {
    expect(avatarColor(1)).toBe(avatarColor(1))
    expect(avatarColor(-1)).toBe(avatarColor(1))
    expect(avatarColor(-7000000000)).toMatch(/^#[0-9A-F]{6}$/)
  })
})

describe('formatDuration', () => {
  it('renders m:ss and tolerates a missing value', () => {
    expect(formatDuration(undefined)).toBe('0:00')
    expect(formatDuration(7)).toBe('0:07')
    expect(formatDuration(75)).toBe('1:15')
  })
})

describe('messagePreview', () => {
  it('prefixes media kinds the way WeChat labels them', () => {
    expect(messagePreview(message({ kind: 'photo', text: '' }))).toBe('[图片]')
    expect(messagePreview(message({ kind: 'photo', text: ' caption ' }))).toBe('[图片] caption')
    expect(messagePreview(message({ kind: 'video', text: '' }))).toBe('[视频]')
    expect(messagePreview(message({ kind: 'sticker' }))).toBe('[贴纸]')
    expect(messagePreview(message({ kind: 'poll', text: '投票吗' }))).toBe('[投票] 投票吗')
  })

  it('falls back to the file name when a file has no caption', () => {
    expect(
      messagePreview(
        message({
          kind: 'file',
          text: '',
          media: { fileId: 1, fileName: 'report.pdf', size: 1234, mimeType: 'application/pdf' },
        }),
      ),
    ).toBe('[文件] report.pdf')
  })

  it('renders a voice note with its duration', () => {
    expect(
      messagePreview(message({ kind: 'voice', text: '', media: { fileId: 2, duration: 12 } })),
    ).toBe('[语音] 0:12')
  })

  it('uses a placeholder for empty text and trims whitespace otherwise', () => {
    expect(messagePreview(message({ text: '   ' }))).toBe('[消息]')
    expect(messagePreview(message({ text: ' hi ' }))).toBe('hi')
  })
})

describe('previewSegments', () => {
  it('returns the whole preview when nothing is hidden', () => {
    expect(previewSegments('hello', undefined)).toEqual([{ text: 'hello', spoiler: false }])
    expect(previewSegments('hello', [])).toEqual([{ text: 'hello', spoiler: false }])
    expect(previewSegments('', [[0, 1]])).toEqual([])
  })

  it('splits around the hidden run without dropping a character', () => {
    const segments = previewSegments('abwwcd', [[2, 4]])
    expect(segments).toEqual([
      { text: 'ab', spoiler: false },
      { text: 'ww', spoiler: true },
      { text: 'cd', spoiler: false },
    ])
    expect(segments.map((segment) => segment.text).join('')).toBe('abwwcd')
  })

  it('masks a preview that is entirely spoiler', () => {
    expect(previewSegments('wwww', [[0, 4]])).toEqual([{ text: 'wwww', spoiler: true }])
  })

  it('clamps, sorts and merges overlapping or touching ranges', () => {
    expect(
      previewSegments('abcdef', [
        [4, 9],
        [1, 3],
        [2, 2],
        [3, 4],
      ]),
    ).toEqual([
      { text: 'a', spoiler: false },
      { text: 'bcdef', spoiler: true },
    ])
  })
})
