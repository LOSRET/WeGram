import { describe, expect, it, vi } from 'vitest'

import { buildViewerMenu } from './viewerMenu'

function actions() {
  return {
    copy: vi.fn(),
    save: vi.fn(),
    locate: vi.fn(),
    open: vi.fn(),
  }
}

describe('buildViewerMenu', () => {
  it('offers copy and print for a photo, only save for a video', () => {
    const photo = buildViewerMenu({ video: false, actions: actions(), showNotice: vi.fn() })
    const video = buildViewerMenu({ video: true, actions: actions(), showNotice: vi.fn() })

    expect(photo.map((entry) => entry?.label ?? '---')).toEqual([
      '复制',
      '另存为…',
      '---',
      '打印',
      '转发…',
      '收藏',
      '---',
      '定位到聊天位置',
      '使用系统默认方式打开',
    ])
    expect(video.map((entry) => entry?.label ?? '---')).toEqual([
      '另存为…',
      '转发…',
      '收藏',
      '---',
      '定位到聊天位置',
      '使用系统默认方式打开',
    ])
  })

  it('dispatches each row to its action and reports the unimplemented ones', () => {
    const fns = actions()
    const showNotice = vi.fn()
    const entries = buildViewerMenu({ video: false, actions: fns, showNotice })

    entries.find((entry) => entry?.label === '复制')?.run()
    entries.find((entry) => entry?.label === '另存为…')?.run()
    entries.find((entry) => entry?.label === '转发…')?.run()
    entries.find((entry) => entry?.label === '定位到聊天位置')?.run()

    expect(fns.copy).toHaveBeenCalledOnce()
    expect(fns.save).toHaveBeenCalledOnce()
    expect(fns.locate).toHaveBeenCalledOnce()
    expect(showNotice).toHaveBeenCalledWith('还没有接入')
  })
})
