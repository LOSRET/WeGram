import { describe, expect, it } from 'vitest'

import { bootCopy } from './bootCopy'

describe('bootCopy', () => {
  it('names each startup phase instead of one generic line', () => {
    const titles = [
      bootCopy(null, false, null).title,
      bootCopy({ kind: 'starting' }, false, null).title,
      bootCopy({ kind: 'opening' }, false, null).title,
      bootCopy({ kind: 'connecting', viaProxy: false }, false, null).title,
      bootCopy({ kind: 'connecting', viaProxy: true }, false, null).title,
      bootCopy({ kind: 'offline' }, false, null).title,
      bootCopy({ kind: 'updating' }, false, null).title,
    ]
    expect(new Set(titles).size).toBe(titles.length)
    expect(titles.every((title) => title !== '正在连接 Telegram…')).toBe(true)
  })

  it('stops spinning and keeps the reason when the client never started', () => {
    const copy = bootCopy({ kind: 'failed', message: 'Win32 error 126' }, false, null)
    expect(copy.tone).toBe('failed')
    expect(copy.title).toContain('未能启动')
    expect(copy.detail).toBe('Win32 error 126')
    expect(copy.hint).toContain('重新打开 WeGram')
  })

  it('tells a crash apart from a failed start', () => {
    const crashed = bootCopy({ kind: 'crashed', message: 'receive loop failed' }, false, null)
    expect(crashed.tone).toBe('failed')
    expect(crashed.title).toContain('崩溃')
    expect(crashed.detail).toBe('receive loop failed')
  })

  it('falls back to the closed panel for an ordinary disconnect', () => {
    const copy = bootCopy({ kind: 'ready' }, true, 'connection reset')
    expect(copy.tone).toBe('failed')
    expect(copy.title).toBe('连接已关闭')
    expect(copy.detail).toBe('connection reset')
  })
})
